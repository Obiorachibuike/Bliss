from __future__ import annotations

import importlib.util
import threading
import uuid
from pathlib import Path

from app.config import MODELS, Config
from app.errors import AppError, JobCancelled
from app.models import Segment, Transcript, Word
from app.repository import Repository
from app.workers.jobs import JobContext


class Transcriber:
    def __init__(self, config: Config):
        self.config = config
        self._lock = threading.Lock()
        self._model = None
        self._model_name = None

    @staticmethod
    def available() -> bool:
        return importlib.util.find_spec("faster_whisper") is not None

    def installed(self, name: str) -> bool:
        path = self.config.model_dir / name
        return all((path / filename).is_file() for filename in ["model.bin", "config.json", "tokenizer.json"])

    def models(self) -> list[dict]:
        return [{"name": name, "label": label, "size": size, "installed": self.installed(name), "recommended": recommended}
                for name, (label, size, recommended) in MODELS.items()]

    def validate(self, name: str):
        if not self.available():
            raise AppError("TRANSCRIBER_MISSING", "The local transcription engine isn't installed.", "Install python/requirements.txt using Python 3.11 or newer, then restart the worker.")
        if name not in MODELS or not self.installed(name):
            raise AppError("MODEL_UNAVAILABLE", f"Whisper {name} isn't installed yet.", "Open Settings → AI models to download it explicitly, or place a CTranslate2 model in your model directory. Your recording hasn't been sent anywhere.", True)

    def transcribe(self, audio: Path, name: str, duration: float, language: str | None, context: JobContext) -> Transcript:
        self.validate(name)
        context.update(10, "Waiting for the local transcription engine")
        while not self._lock.acquire(timeout=0.2):
            context.check_cancelled()
        try:
            context.check_cancelled()
            from faster_whisper import WhisperModel
            if self._model is None or self._model_name != name:
                context.update(10, f"Loading Whisper {name}")
                try:
                    self._model = WhisperModel(
                        str(self.config.model_dir / name), device=self.config.device, compute_type=self.config.compute_type,
                        cpu_threads=4, num_workers=1, local_files_only=True,
                    )
                    self._model_name = name
                except Exception as exc:
                    self._model = None
                    if self.config.device == "cuda":
                        raise AppError("GPU_UNAVAILABLE", "The selected GPU isn't available.", "Install compatible CUDA libraries or switch WHISPER_DEVICE to cpu.", True) from exc
                    raise AppError("MODEL_LOAD_FAILED", "The transcription model couldn't be loaded.", "Check available RAM and re-download the model. Whisper Base uses less memory.", True) from exc
            segments, info = self._model.transcribe(
                str(audio), word_timestamps=True, vad_filter=True, language=language or None,
                beam_size=3, condition_on_previous_text=False,
            )
            result = []
            for index, segment in enumerate(segments):
                context.check_cancelled()
                words = [Word(id=uuid.uuid4().hex, word=w.word.strip(), start=round(max(0, w.start), 3),
                              end=round(min(duration, max(w.start, w.end)), 3))
                         for w in (segment.words or []) if w.word.strip() and w.start <= duration]
                # Timestamp-less output is rejected, never synthesized in production.
                if segment.text.strip() and not words:
                    raise AppError("WORD_TIMESTAMPS_MISSING", "The model didn't return word-level timing.", "Choose a supported faster-whisper model and transcribe again.", True)
                result.append(Segment(id=index, start=round(segment.start, 3), end=round(segment.end, 3),
                                      text=segment.text.strip(), words=words))
                context.update(10 + 57 * min(1, segment.end / duration), "Transcribing speech · word-level timestamps")
            if not result:
                raise AppError("NO_SPEECH", "No clear speech was detected in this recording.", "Check the audio track, try a larger model, or import a recording with audible speech.")
            return Transcript(language=info.language, duration=duration, segments=result, model=f"faster-whisper/{name}")
        finally:
            self._lock.release()

    def install(self, name: str, repository: Repository, context: JobContext) -> str:
        if name not in MODELS:
            raise AppError("UNKNOWN_MODEL", "This transcription model is not supported.")
        context.stage("download", 0, f"Connecting to the model repository · Whisper {name}")
        record = repository.network_record("model-download", "Hugging Face", 0, None)
        success = False
        try:
            # Download one file at a time so completed file bytes are measurable. No made-up timer.
            import httpx
            from huggingface_hub import hf_hub_url
            target = self.config.model_dir / name
            target.mkdir(parents=True, exist_ok=True)
            files = ["config.json", "tokenizer.json", "vocabulary.json", "model.bin"]
            repo = f"Systran/faster-whisper-{name}"
            with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(60, read=120), trust_env=False) as client:
                for index, filename in enumerate(files):
                    context.check_cancelled()
                    output = target / filename
                    if output.is_file():
                        continue
                    temporary = target / f"{filename}.part"
                    try:
                        with client.stream("GET", hf_hub_url(repo, filename)) as response:
                            if response.status_code == 404 and filename == "vocabulary.json":
                                continue
                            response.raise_for_status()
                            total = int(response.headers.get("content-length", 0))
                            downloaded = 0
                            with temporary.open("wb") as handle:
                                for chunk in response.iter_bytes(1024 * 256):
                                    context.check_cancelled()
                                    handle.write(chunk)
                                    downloaded += len(chunk)
                                    if total:
                                        context.update((index + downloaded / total) / len(files) * 98,
                                                       f"Downloading {filename} · {downloaded // 1024**2} / {total // 1024**2} MB")
                                    else:
                                        context.update(message=f"Downloading {filename} · {downloaded // 1024**2} MB received")
                        temporary.replace(output)
                    finally:
                        temporary.unlink(missing_ok=True)
                    context.update((index + 1) / len(files) * 98, f"Downloaded {filename}")
            context.stage("verify", 99, "Verifying model files")
            if not self.installed(name):
                raise AppError("MODEL_INCOMPLETE", "The model download is incomplete.", "Retry the download or install a CTranslate2 model manually.", True)
            success = True
            return name
        except (AppError, JobCancelled):
            raise
        except Exception as exc:
            raise AppError("MODEL_DOWNLOAD_FAILED", "We couldn't download this model.", "Check your connection to huggingface.co. You can also copy a downloaded CTranslate2 model into the model directory. No recording was uploaded.", True) from exc
        finally:
            repository.finish_network(record, success)
