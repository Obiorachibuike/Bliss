from __future__ import annotations

import json
import shutil
import tempfile
import uuid
from pathlib import Path

from app.captions.ass import build_ass
from app.config import Config
from app.errors import AppError
from app.faces.tracking import crop_dimensions, crop_expression, track
from app.models import RenderSettings, now
from app.repository import Repository
from app.security import safe_filename
from app.video.media import probe, thumbnail
from app.workers.jobs import JobContext


def render(config: Config, repository: Repository, clip_id: str, settings: RenderSettings, context: JobContext) -> str:
    if not config.ffmpeg:
        raise AppError("FFMPEG_MISSING", "FFmpeg isn't installed.", "Install FFmpeg and restart ClipShip.")
    clip = repository.get_clip(clip_id)
    project = repository.get_project(clip["projectId"])
    source = repository.source_path(project["id"])
    media = project["media"]
    if settings.end_time > media["duration"] + 0.01:
        raise AppError("INVALID_BOUNDARY", "The selected clip ends after the source recording.", "Adjust the start and end times in the editor.")
    folder = repository.project_dir(project["id"])
    duration = settings.end_time - settings.start_time
    estimated = duration * settings.bitrate * 1_000_000 / 8
    if shutil.disk_usage(folder).free < estimated * 1.5 + 50 * 1024**2:
        raise AppError("DISK_FULL", "There isn't enough disk space for this export.", "Free disk space or use a lower bitrate.", True)
    export_id = uuid.uuid4().hex
    filename = f"{safe_filename(settings.filename)}-{export_id[:8]}.mp4"
    output = folder / "renders" / filename
    partial = folder / "renders" / f"{export_id}.partial.mp4"
    points = []
    try:
        if settings.track_faces and settings.face_strategy not in {"center", "manual"} and not media["isAudio"]:
            context.stage("tracking", 1, "Finding the speaker's face")
            points = track(source, settings.start_time, settings.end_time, media["width"], settings.face_strategy, context)
            (folder / "metadata" / f"{clip_id}-tracking.json").write_text(json.dumps({
                "strategy": settings.face_strategy, "method": "visual-mouth-motion" if settings.face_strategy == "active-speaker" else "largest-face",
                "points": [{"time": p.time, "centerX": p.center_x, "detected": p.detected} for p in points],
                "fallback": "center",
            }))
        else:
            context.skip("tracking")
        context.stage("captions", 15, "Preparing word-synchronized captions")
        with tempfile.TemporaryDirectory(prefix="clipship-render-", dir=folder / "renders") as work:
            work_path = Path(work)
            (work_path / "captions.ass").write_text(build_ass(settings), encoding="utf-8")
            context.stage("encoding", 17, "Encoding H.264 video · burning captions")
            args = [config.ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
            if media["isAudio"]:
                args += ["-f", "lavfi", "-i", f"color=c=0x111318:s={settings.width}x{settings.height}:r={settings.fps}:d={duration}",
                         "-ss", str(settings.start_time), "-t", str(duration), "-i", str(source), "-map", "0:v:0", "-map", "1:a:0"]
                filters = []
            else:
                args += ["-ss", str(settings.start_time), "-t", str(duration), "-i", str(source), "-map", "0:v:0"]
                if media["hasAudio"]:
                    args += ["-map", "0:a:0"]
                crop_w, crop_h = crop_dimensions(media["width"], media["height"], settings.width, settings.height)
                expression = crop_expression(points, media["width"], crop_w, duration,
                                             settings.manual_crop_x if settings.face_strategy == "manual" else None)
                filters = [f"crop={crop_w}:{crop_h}:x='{expression}':y=(ih-oh)/2",
                           f"scale={settings.width}:{settings.height}:flags=lanczos"]
            filters += [f"fps={settings.fps}"]
            if settings.caption_settings.enabled or settings.headline_settings.enabled:
                filters.append("ass=captions.ass")
            args += ["-vf", ",".join(filters), "-c:v", "libx264", "-preset", "fast", "-threads", "2", "-pix_fmt", "yuv420p",
                     "-b:v", f"{settings.bitrate}M", "-maxrate", f"{settings.bitrate * 1.5:g}M", "-bufsize", f"{settings.bitrate * 2}M"]
            if media["hasAudio"]:
                args += ["-af", f"volume={settings.audio_volume:g}", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
            args += ["-t", str(duration), "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", str(partial)]
            context.ffmpeg(args, duration, 17, 78, "Encoding video · burning captions", cwd=str(work_path))
        context.stage("finalizing", 96, "Verifying the exported MP4")
        verified = probe(config, partial)
        context.check_cancelled()
        if verified.codec != "h264" or verified.width != settings.width or verified.height != settings.height:
            raise AppError("EXPORT_INVALID", "The export couldn't be verified.", "Try another export configuration.", True)
        partial.replace(output)
        thumb = folder / "thumbnails" / f"export-{export_id}.jpg"
        has_thumb = thumbnail(config, output, thumb, min(1, duration / 4))
        repository.save_export({
            "id": export_id, "projectId": project["id"], "clipId": clip_id, "title": clip["title"], "filename": filename,
            "url": f"/api/media/exports/{export_id}", "thumbnailUrl": f"/api/media/projects/{project['id']}/thumbnails/export-{export_id}.jpg" if has_thumb else None,
            "size": output.stat().st_size, "duration": verified.duration, "width": verified.width, "height": verified.height,
            "preset": settings.preset, "createdAt": now(), "path": str(output) if config.runtime == "desktop" else f"Server · renders/{filename}",
        })
        repository.save_edit(clip_id, settings.json_data())
        return export_id
    except Exception:
        partial.unlink(missing_ok=True)
        output.unlink(missing_ok=True)
        raise
