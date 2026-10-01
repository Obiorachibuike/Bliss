from __future__ import annotations

import asyncio
import logging
import os
import signal
import subprocess
import tempfile
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from app.errors import AppError, JobCancelled
from app.models import Job, JobStep, now
from app.repository import Repository

logger = logging.getLogger("clipship.jobs")
TERMINAL = {"completed", "failed", "cancelled"}


class JobContext:
    def __init__(self, manager: "JobManager", job: Job):
        self.manager = manager
        self.job = job
        self.cancel_event = threading.Event()
        self.process: subprocess.Popen | None = None
        self._lock = threading.RLock()

    def check_cancelled(self):
        if self.cancel_event.is_set():
            raise JobCancelled()

    def update(self, progress: float | None = None, message: str | None = None):
        self.check_cancelled()
        with self._lock:
            if progress is not None:
                self.job.progress = round(max(self.job.progress, min(99.9, progress)), 2)
            if message is not None:
                self.job.message = message
            self.job.updated_at = now()
            self.manager.publish(self.job)

    def stage(self, key: str, progress: float, message: str):
        with self._lock:
            for step in self.job.steps:
                if step.status == "running":
                    step.status = "completed"
                if step.key == key:
                    step.status = "running"
        self.update(progress, message)

    def skip(self, key: str):
        for step in self.job.steps:
            if step.key == key:
                step.status = "skipped"
        self.update()

    def terminate_process(self):
        with self._lock:
            process = self.process
            if process is not None and process.poll() is None:
                try:
                    if os.name == "posix":
                        os.killpg(process.pid, signal.SIGTERM)
                    else:
                        process.terminate()
                    process.wait(timeout=3)
                except (ProcessLookupError, subprocess.TimeoutExpired):
                    try:
                        process.kill()
                    except OSError:
                        pass

    def ffmpeg(self, args: list[str], duration: float, base: float, span: float, message: str, cwd: str | None = None):
        self.check_cancelled()
        # Argument vector, never a shell string. stderr is bounded by an anonymous temp file,
        # not a browser-visible/private filename log.
        with tempfile.TemporaryFile() as error_file:
            try:
                process = subprocess.Popen(
                    args, stdout=subprocess.PIPE, stderr=error_file, stdin=subprocess.DEVNULL,
                    text=True, bufsize=1, cwd=cwd, start_new_session=os.name == "posix",
                )
            except (FileNotFoundError, PermissionError) as exc:
                raise AppError("FFMPEG_UNAVAILABLE", "FFmpeg couldn't be started.", "Install FFmpeg and check its file permissions.") from exc
            with self._lock:
                self.process = process
            try:
                assert process.stdout is not None
                for line in process.stdout:
                    self.check_cancelled()
                    key, _, value = line.strip().partition("=")
                    if key in {"out_time_ms", "out_time_us"}:
                        try:
                            seconds = int(value) / 1_000_000
                            self.update(base + span * min(1, seconds / max(duration, 0.01)), message)
                        except ValueError:
                            continue
                code = process.wait()
                self.check_cancelled()
                if code != 0:
                    error_file.seek(0)
                    raw = error_file.read(20000).decode(errors="replace").lower()
                    if "no space left" in raw:
                        raise AppError("DISK_FULL", "There isn't enough free space to finish.", "Free disk space or choose another storage directory.", True)
                    if "permission denied" in raw:
                        raise AppError("PERMISSION_DENIED", "ClipShip doesn't have permission to read or write this file.", "Check folder permissions and try again.", True)
                    raise AppError("FFMPEG_FAILED", "We couldn't process this recording.", "The media may be damaged or use an unsupported codec. Try MP4 with H.264 video and AAC audio.", True)
            finally:
                self.terminate_process()
                if process.stdout:
                    process.stdout.close()
                with self._lock:
                    self.process = None


class JobManager:
    def __init__(self, repository: Repository, max_workers: int = 2):
        self.repository = repository
        self.executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="clipship-worker")
        self.contexts: dict[str, JobContext] = {}
        self.sequences: dict[str, int] = {}
        self.subscribers: dict[str, list[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = {}
        self._lock = threading.RLock()

    def submit(self, kind: str, worker: Callable[[JobContext], str | None], project_id: str | None = None,
               clip_id: str | None = None, steps: list[tuple[str, str]] | None = None) -> dict:
        with self._lock:
            if project_id and kind in {"analysis", "transcription"}:
                for context in self.contexts.values():
                    if context.job.project_id == project_id and context.job.kind in {"analysis", "transcription"} and context.job.status not in TERMINAL:
                        raise AppError("JOB_ACTIVE", "This project is already being analyzed.", "Wait for the current job or cancel it first.")
            job = Job(id=uuid.uuid4().hex, kind=kind, project_id=project_id, clip_id=clip_id,
                      steps=[JobStep(key=k, label=label) for k, label in (steps or [])])
            context = JobContext(self, job)
            self.contexts[job.id] = context
            self.publish(job)
        self.executor.submit(self._run, context, worker)
        return self.repository.get_job(job.id)

    def _run(self, context: JobContext, worker: Callable):
        job = context.job
        try:
            context.check_cancelled()
            job.status = "running"
            context.update(message="Starting local processing" if self.repository.config.runtime == "desktop" else "Starting server processing")
            result = worker(context)
            context.check_cancelled()
            job.status = "completed"
            job.progress = 100
            job.result_id = result
            job.message = "Ready" if job.kind != "render" else "Your clip is ready to download"
            for step in job.steps:
                if step.status != "skipped":
                    step.status = "completed"
            logger.info("job_completed", extra={"job_id": job.id, "kind": job.kind})
        except JobCancelled:
            job.status = "cancelled"
            job.message = "Processing cancelled. Your project is safe."
            if job.project_id and job.kind in {"analysis", "transcription"}:
                self.repository.update_project(job.project_id, {"status": "imported", "lastError": None})
            logger.info("job_cancelled", extra={"job_id": job.id})
        except AppError as exc:
            job.status = "failed"
            job.message = exc.message
            job.error = exc.as_dict()
            if job.project_id and job.kind in {"analysis", "transcription"}:
                self.repository.update_project(job.project_id, {"status": "failed", "lastError": exc.message})
            logger.warning("job_failed", extra={"job_id": job.id, "error_code": exc.code})
        except Exception as exc:
            # No exception string/traceback in routine logs: third-party errors can include private data.
            job.status = "failed"
            job.message = "The processing worker encountered a problem."
            job.error = AppError("WORKER_ERROR", job.message, "Try again. If this continues, check dependencies and the local worker logs.", True).as_dict()
            if job.project_id and job.kind in {"analysis", "transcription"}:
                self.repository.update_project(job.project_id, {"status": "failed", "lastError": job.message})
            logger.error("worker_exception", extra={"job_id": job.id, "exception_type": type(exc).__name__})
        finally:
            context.terminate_process()
            job.updated_at = now()
            self.publish(job)

    def publish(self, job: Job):
        with self._lock:
            self.repository.save_job(job)
            sequence = self.sequences.get(job.id, 0) + 1
            self.sequences[job.id] = sequence
            event_type = {"completed": "job-completed", "failed": "job-failed", "cancelled": "job-cancelled"}.get(job.status, "progress")
            event = {"type": event_type, "jobId": job.id, "sequence": sequence, "job": job.json_data()}
            for loop, queue in list(self.subscribers.get(job.id, [])):
                if not loop.is_closed():
                    loop.call_soon_threadsafe(self._put_event, queue, event)

    @staticmethod
    def _put_event(queue: asyncio.Queue, event: dict):
        if queue.full():
            queue.get_nowait()
        queue.put_nowait(event)

    def subscribe(self, job_id: str) -> tuple[asyncio.Queue, Callable]:
        # Called by the ASGI loop; subscribe before taking the initial snapshot to avoid lost events.
        loop = asyncio.get_running_loop()
        queue = asyncio.Queue(maxsize=32)
        with self._lock:
            self.subscribers.setdefault(job_id, []).append((loop, queue))
        def unsubscribe():
            with self._lock:
                entries = self.subscribers.get(job_id, [])
                if (loop, queue) in entries:
                    entries.remove((loop, queue))
                if not entries:
                    self.subscribers.pop(job_id, None)
        return queue, unsubscribe

    def snapshot(self, job_id: str) -> dict:
        with self._lock:
            return {"type": "snapshot", "jobId": job_id, "sequence": self.sequences.get(job_id, 0), "job": self.repository.get_job(job_id)}

    def cancel(self, job_id: str) -> dict:
        job = self.repository.get_job(job_id)
        if job["status"] in TERMINAL:
            return job
        with self._lock:
            context = self.contexts.get(job_id)
        if context:
            context.cancel_event.set()
            context.terminate_process()
            # The running worker publishes the final state after cleaning partial output.
            context.job.message = "Cancelling and cleaning up…"
            context.job.updated_at = now()
            self.publish(context.job)
        return self.repository.get_job(job_id)

    def active_for_project(self, project_id: str) -> bool:
        return any(c.job.project_id == project_id and c.job.status not in TERMINAL for c in self.contexts.values())

    def shutdown(self):
        for context in list(self.contexts.values()):
            if context.job.status not in TERMINAL:
                context.cancel_event.set()
                context.terminate_process()
        self.executor.shutdown(wait=True, cancel_futures=True)
