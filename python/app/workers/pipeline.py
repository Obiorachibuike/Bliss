from __future__ import annotations

from app.ai.discovery import align_api_candidates, discover
from app.ai.providers import ProviderRegistry
from app.config import Config
from app.errors import AppError
from app.models import AnalyzeOptions, Transcript
from app.repository import Repository
from app.transcription.whisper import Transcriber
from app.video.media import detect_scenes, extract_audio, thumbnail
from app.workers.jobs import JobContext

ANALYSIS_STEPS = [
    ("audio", "Extracting audio"), ("transcription", "Transcribing speech"),
    ("scenes", "Detecting scenes"), ("discovery", "Finding clip opportunities"),
    ("thumbnails", "Preparing your clips"),
]
RENDER_STEPS = [("tracking", "Smart reframing"), ("captions", "Preparing captions"), ("encoding", "Encoding video"), ("finalizing", "Finalizing export")]


class Pipeline:
    def __init__(self, config: Config, repository: Repository, transcriber: Transcriber, providers: ProviderRegistry):
        self.config = config
        self.repository = repository
        self.transcriber = transcriber
        self.providers = providers

    def analyze(self, project_id: str, options: AnalyzeOptions, context: JobContext, transcribe_only: bool = False) -> str:
        project = self.repository.get_project(project_id)
        source = self.repository.source_path(project_id)
        if not project["media"]["hasAudio"]:
            raise AppError("NO_AUDIO", "This recording doesn't contain an audio track.", "Import a recording with audible speech to discover clips and generate captions.")
        folder = self.repository.project_dir(project_id)
        cached = project["transcript"]
        reuse = cached and cached["model"] == f"faster-whisper/{options.model}" and (not options.language or cached["language"] == options.language)
        # Validate model before starting, unless reusing a real persisted transcript.
        if not reuse:
            self.transcriber.validate(options.model)
        self.repository.update_project(project_id, {"status": "analyzing", "aiMode": options.ai_mode, "lastError": None})
        if reuse:
            context.skip("audio")
            context.skip("transcription")
            transcript = Transcript.model_validate(cached)
            context.update(67, "Using your saved word-level transcript")
        else:
            audio = folder / "source" / "audio-16khz.wav"
            try:
                context.stage("audio", 1, "Extracting the speech track")
                extract_audio(self.config, source, audio, project["media"]["duration"], context)
                context.stage("transcription", 10, "Transcribing speech locally")
                transcript = self.transcriber.transcribe(audio, options.model, project["media"]["duration"], options.language, context)
                self.repository.save_transcript(project_id, transcript)
            finally:
                # Audio is derivable; remove large PCM intermediates even after cancellation.
                audio.unlink(missing_ok=True)
        if transcribe_only:
            self.repository.update_project(project_id, {"status": "ready"})
            return project_id
        context.stage("scenes", 68, "Detecting scene changes")
        if project["media"]["isAudio"]:
            context.skip("scenes")
        else:
            scenes = detect_scenes(source, project["media"]["duration"], context)
            self.repository.save_scenes(project_id, scenes)
        context.stage("discovery", 75, "Finding meaningful moments in your transcript")
        if options.ai_mode == "api" or options.provider == "ollama":
            raw = self.providers.analyze(transcript, options, project_id, context)
            candidates = align_api_candidates(raw, transcript, project_id, options)
        else:
            candidates = discover(transcript, project_id, options, context)
        context.stage("thumbnails", 88, f"Preparing {len(candidates)} clip recommendations")
        for index, clip in enumerate(candidates):
            context.check_cancelled()
            output = folder / "thumbnails" / f"{clip.id}.jpg"
            if thumbnail(self.config, source, output, (clip.start_time + clip.end_time) / 2, project["media"]["isAudio"]):
                clip.thumbnail_url = f"/api/media/projects/{project_id}/thumbnails/{clip.id}.jpg"
            context.update(88 + 10 * (index + 1) / max(1, len(candidates)), f"Preparing clip {index + 1} of {len(candidates)}")
        context.check_cancelled()
        self.repository.save_candidates(project_id, candidates)
        self.repository.update_project(project_id, {"status": "ready", "lastError": None})
        return project_id
