from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path

import cv2

from app.config import Config
from app.errors import AppError
from app.models import VideoMetadata
from app.workers.jobs import JobContext


def probe(config: Config, source: Path) -> VideoMetadata:
    if not config.ffprobe:
        raise AppError("FFPROBE_MISSING", "FFprobe isn't installed.", "Install FFmpeg (which includes FFprobe) and add it to PATH, then restart ClipShip.")
    try:
        result = subprocess.run(
            [config.ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(source)],
            capture_output=True, timeout=45, check=False,
        )
        if result.returncode:
            raise AppError("INVALID_MEDIA", "We couldn't read this recording.", "The file may be damaged or use an unsupported codec. Try an MP4 with H.264 video and AAC audio.")
        data = json.loads(result.stdout)
    except subprocess.TimeoutExpired as exc:
        raise AppError("PROBE_TIMEOUT", "Reading this recording took too long.", "Check that the file is on an available local disk and try again.", True) from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise AppError("INVALID_MEDIA", "We couldn't read this media file.", "Check your FFprobe installation or choose another recording.") from exc
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not video and not audio:
        raise AppError("NO_MEDIA", "This file doesn't contain a usable video or audio track.")
    try:
        duration = float(data.get("format", {}).get("duration") or max(float(s.get("duration", 0)) for s in streams))
    except (ValueError, TypeError):
        duration = 0
    if not math.isfinite(duration) or duration <= 0:
        raise AppError("INVALID_DURATION", "The recording has no readable duration.", "Try remuxing the file to MP4 using FFmpeg.")
    fps = 30.0
    if video:
        numerator, _, denominator = (video.get("avg_frame_rate") or "30/1").partition("/")
        try:
            fps = float(numerator) / float(denominator or 1)
        except (ValueError, ZeroDivisionError):
            fps = 30.0
    return VideoMetadata(
        filename=source.name, size=source.stat().st_size, width=int(video.get("width", 0)) if video else 0,
        height=int(video.get("height", 0)) if video else 0, fps=round(fps, 3), duration=round(duration, 3),
        codec=video.get("codec_name", "unknown") if video else audio.get("codec_name", "unknown"),
        has_audio=audio is not None, audio_codec=audio.get("codec_name") if audio else None,
        audio_channels=audio.get("channels") if audio else None, is_audio=video is None,
    )


def thumbnail(config: Config, source: Path, output: Path, time: float, is_audio: bool = False) -> bool:
    if not config.ffmpeg or is_audio:
        return False
    try:
        result = subprocess.run(
            [config.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", str(max(0, time)), "-i", str(source),
             "-frames:v", "1", "-vf", "scale=640:360:force_original_aspect_ratio=increase,crop=640:360", "-q:v", "3", str(output)],
            capture_output=True, timeout=30, check=False,
        )
        return result.returncode == 0 and output.is_file()
    except (OSError, subprocess.TimeoutExpired):
        return False


def extract_audio(config: Config, source: Path, output: Path, duration: float, context: JobContext):
    if not config.ffmpeg:
        raise AppError("FFMPEG_MISSING", "FFmpeg isn't installed.", "Install FFmpeg and add it to PATH, or set FFMPEG_PATH in the worker environment.")
    context.ffmpeg(
        [config.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-vn", "-map", "0:a:0",
         "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-progress", "pipe:1", "-nostats", str(output)],
        duration, 1, 9, "Extracting audio locally" if config.runtime == "desktop" else "Extracting audio on this server",
    )


def detect_scenes(source: Path, duration: float, context: JobContext) -> list[float]:
    # A sparse, bounded histogram pass: never loads a whole recording into RAM.
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        return []
    step = max(1.0, duration / 1200)
    previous = None
    scenes = [0.0]
    try:
        samples = max(1, math.ceil(duration / step))
        for index in range(samples):
            context.check_cancelled()
            timestamp = index * step
            cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
            ok, frame = cap.read()
            if not ok:
                continue
            hsv = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2HSV)
            hist = cv2.calcHist([hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
            cv2.normalize(hist, hist)
            if previous is not None and cv2.compareHist(previous, hist, cv2.HISTCMP_BHATTACHARYYA) > 0.6:
                scenes.append(round(timestamp, 3))
            previous = hist
            if index % 20 == 0:
                context.update(68 + 6 * (index + 1) / samples, "Detecting scene changes")
    finally:
        cap.release()
    return scenes
