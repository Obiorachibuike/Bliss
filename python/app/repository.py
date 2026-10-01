from __future__ import annotations

import json
import os
import shutil
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path

from app.config import Config
from app.errors import AppError
from app.models import Candidate, Job, Settings, Transcript, VideoMetadata, now
from app.security import inside, validate_id

MIGRATIONS = [
    """
    CREATE TABLE projects (id TEXT PRIMARY KEY, data TEXT NOT NULL, source_path TEXT NOT NULL, owns_source INTEGER NOT NULL);
    CREATE TABLE transcripts (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE candidates (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE INDEX candidates_project ON candidates(project_id);
    CREATE TABLE edits (clip_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE exports (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, clip_id TEXT, data TEXT NOT NULL);
    CREATE TABLE jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE network (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    """
]


def encode(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, allow_nan=False)


class Repository:
    def __init__(self, config: Config):
        self.config = config
        self._lock = threading.RLock()
        self.db_path = config.data_dir / "clipship.sqlite3"
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            for index, migration in enumerate(MIGRATIONS[version:], start=version + 1):
                db.executescript(migration)
                db.execute(f"PRAGMA user_version={index}")
        # A process restart cannot resume an FFmpeg/Whisper generator safely.
        for job in self.list_jobs():
            if job["status"] in {"queued", "running"}:
                job.update(status="failed", message="Processing was interrupted by a restart.", updatedAt=now(),
                           error={"code": "WORKER_RESTARTED", "message": "Processing was interrupted.",
                                  "detail": "Your project is safe. Start the operation again.", "retryable": True})
                self.save_job(job)
        for project in self.list_projects():
            if project["status"] == "analyzing":
                self.update_project(project["id"], {"status": "imported", "lastError": "Processing was interrupted. Analyze again to continue."})

    @contextmanager
    def connect(self):
        with self._lock:
            db = sqlite3.connect(self.db_path, timeout=30)
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()

    def project_dir(self, project_id: str) -> Path:
        return inside(self.config.data_dir / "projects", self.config.data_dir / "projects" / validate_id(project_id))

    def create_project(self, source: Path, metadata: VideoMetadata, title: str | None = None, owned: bool = False,
                       project_id: str | None = None) -> dict:
        project_id = project_id or uuid.uuid4().hex
        folder = self.project_dir(project_id)
        for name in ["source", "transcript", "clips", "renders", "thumbnails", "metadata"]:
            (folder / name).mkdir(parents=True, exist_ok=True)
        data = {
            "id": project_id, "title": (title or source.stem.replace("_", " ").replace("-", " "))[:120],
            "createdAt": now(), "updatedAt": now(), "status": "imported", "media": metadata.json_data(),
            "clipCount": 0, "exportCount": 0, "thumbnailUrl": None, "aiMode": "local", "lastError": None,
        }
        with self.connect() as db:
            db.execute("INSERT INTO projects VALUES (?, ?, ?, ?)", (project_id, encode(data), str(source), int(owned)))
        self.write_manifest(project_id)
        return self.get_project(project_id)

    def source_path(self, project_id: str) -> Path:
        validate_id(project_id)
        with self.connect() as db:
            row = db.execute("SELECT source_path FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise AppError("PROJECT_MISSING", "This project no longer exists.", "Return to your workspace and select another project.")
        source = Path(row["source_path"])
        if not source.is_file():
            raise AppError("FILE_MISSING", "The original recording is missing.", "Restore the source file to its original location or import it again.")
        return source

    def list_projects(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute("SELECT data FROM projects ORDER BY json_extract(data, '$.updatedAt') DESC").fetchall()
        return [json.loads(row["data"]) for row in rows]

    def get_project(self, project_id: str) -> dict:
        validate_id(project_id)
        with self.connect() as db:
            row = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
            if not row:
                raise AppError("PROJECT_MISSING", "This project no longer exists.")
            data = json.loads(row["data"])
            transcript = db.execute("SELECT data FROM transcripts WHERE project_id=?", (project_id,)).fetchone()
            clips = db.execute("SELECT data FROM candidates WHERE project_id=? ORDER BY json_extract(data, '$.score') DESC", (project_id,)).fetchall()
            edits = db.execute("SELECT e.data FROM edits e JOIN candidates c ON e.clip_id=c.id WHERE c.project_id=?", (project_id,)).fetchall()
        source_location = row["source_path"] if self.config.runtime == "desktop" else f"Server · projects/{project_id}/source/{Path(row['source_path']).name}"
        data.update(
            sourceUrl=f"/api/media/projects/{project_id}/source",
            sourceLocation=source_location,
            transcriptLocation=str(self.project_dir(project_id) / "transcript" / "transcript.json") if self.config.runtime == "desktop" else f"Server · projects/{project_id}/transcript/transcript.json",
            transcript=json.loads(transcript["data"]) if transcript else None,
            clips=[json.loads(c["data"]) for c in clips], edits=[json.loads(e["data"]) for e in edits],
            scenes=self.read_scenes(project_id),
        )
        return data

    def update_project(self, project_id: str, update: dict) -> dict:
        validate_id(project_id)
        with self.connect() as db:
            row = db.execute("SELECT data FROM projects WHERE id=?", (project_id,)).fetchone()
            if not row:
                raise AppError("PROJECT_MISSING", "This project no longer exists.")
            data = json.loads(row["data"])
            data.update(update, updatedAt=now())
            db.execute("UPDATE projects SET data=? WHERE id=?", (encode(data), project_id))
        self.write_manifest(project_id)
        return self.get_project(project_id)

    def write_manifest(self, project_id: str):
        # Atomic, human-readable backup; database remains authoritative.
        folder = self.project_dir(project_id)
        folder.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            row = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if row:
            data = json.loads(row["data"])
            data["sourceReference"] = row["source_path"]
            temp = folder / "project.json.tmp"
            temp.write_text(json.dumps(data, indent=2), encoding="utf-8")
            os.replace(temp, folder / "project.json")

    def delete_project(self, project_id: str):
        folder = self.project_dir(project_id)
        with self.connect() as db:
            row = db.execute("SELECT owns_source FROM projects WHERE id=?", (project_id,)).fetchone()
            if not row:
                raise AppError("PROJECT_MISSING", "This project no longer exists.")
            db.execute("DELETE FROM projects WHERE id=?", (project_id,))
        # Referenced source files outside the project folder are never deleted.
        if folder.exists():
            shutil.rmtree(folder)

    def save_transcript(self, project_id: str, transcript: Transcript):
        data = transcript.json_data()
        folder = self.project_dir(project_id) / "transcript"
        folder.mkdir(exist_ok=True)
        temp = folder / "transcript.json.tmp"
        temp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(temp, folder / "transcript.json")
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO transcripts VALUES (?, ?)", (project_id, encode(data)))

    def save_candidates(self, project_id: str, candidates: list[Candidate]):
        with self.connect() as db:
            # Preserve existing edited clips/exports when reanalysis runs.
            for candidate in candidates:
                db.execute("INSERT INTO candidates VALUES (?, ?, ?)", (candidate.id, project_id, encode(candidate.json_data())))
            count = db.execute("SELECT COUNT(*) FROM candidates WHERE project_id=?", (project_id,)).fetchone()[0]
        self.update_project(project_id, {"clipCount": count})

    def get_clip(self, clip_id: str) -> dict:
        validate_id(clip_id)
        with self.connect() as db:
            row = db.execute("SELECT data FROM candidates WHERE id=?", (clip_id,)).fetchone()
        if not row:
            raise AppError("CLIP_MISSING", "This clip is no longer available.")
        return json.loads(row["data"])

    def update_clip(self, clip_id: str, update: dict) -> dict:
        data = self.get_clip(clip_id)
        data.update(update)
        with self.connect() as db:
            db.execute("UPDATE candidates SET data=? WHERE id=?", (encode(data), clip_id))
        return data

    def save_edit(self, clip_id: str, settings: dict) -> dict:
        clip = self.get_clip(clip_id)
        data = {"clipId": clip_id, "projectId": clip["projectId"], "settings": settings, "updatedAt": now()}
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO edits VALUES (?, ?)", (clip_id, encode(data)))
        folder = self.project_dir(clip["projectId"]) / "clips"
        (folder / f"{clip_id}.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
        return data

    def save_export(self, data: dict):
        with self.connect() as db:
            db.execute("INSERT INTO exports VALUES (?, ?, ?, ?)", (data["id"], data["projectId"], data["clipId"], encode(data)))
            count = db.execute("SELECT COUNT(*) FROM exports WHERE project_id=?", (data["projectId"],)).fetchone()[0]
        self.update_project(data["projectId"], {"exportCount": count})

    def list_exports(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute("SELECT data FROM exports ORDER BY json_extract(data, '$.createdAt') DESC").fetchall()
        return [json.loads(row["data"]) for row in rows]

    def get_export(self, export_id: str) -> dict:
        validate_id(export_id)
        with self.connect() as db:
            row = db.execute("SELECT data FROM exports WHERE id=?", (export_id,)).fetchone()
        if not row:
            raise AppError("EXPORT_MISSING", "This export was deleted or couldn't be found.")
        return json.loads(row["data"])

    def export_path(self, export_id: str) -> Path:
        data = self.get_export(export_id)
        return inside(self.project_dir(data["projectId"]), self.project_dir(data["projectId"]) / "renders" / data["filename"])

    def delete_export(self, export_id: str):
        data = self.get_export(export_id)
        path = self.export_path(export_id)
        path.unlink(missing_ok=True)
        with self.connect() as db:
            db.execute("DELETE FROM exports WHERE id=?", (export_id,))
            count = db.execute("SELECT COUNT(*) FROM exports WHERE project_id=?", (data["projectId"],)).fetchone()[0]
        self.update_project(data["projectId"], {"exportCount": count})

    def save_job(self, job: Job | dict):
        data = job.json_data() if isinstance(job, Job) else job
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO jobs VALUES (?, ?)", (data["id"], encode(data)))

    def list_jobs(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute("SELECT data FROM jobs ORDER BY json_extract(data, '$.createdAt') DESC LIMIT 100").fetchall()
        return [json.loads(row["data"]) for row in rows]

    def get_job(self, job_id: str) -> dict:
        validate_id(job_id)
        with self.connect() as db:
            row = db.execute("SELECT data FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            raise AppError("JOB_MISSING", "This processing job couldn't be found.")
        return json.loads(row["data"])

    def get_settings(self) -> dict:
        with self.connect() as db:
            row = db.execute("SELECT data FROM settings WHERE key='app'").fetchone()
        return json.loads(row["data"]) if row else Settings().json_data()

    def save_settings(self, settings: Settings) -> dict:
        data = settings.json_data()
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO settings VALUES ('app', ?)", (encode(data),))
        return data

    def network_record(self, kind: str, provider: str, amount: int, project_id: str | None) -> str:
        record_id = uuid.uuid4().hex
        data = {"id": record_id, "kind": kind, "provider": provider, "bytesSent": amount, "projectId": project_id,
                "timestamp": now(), "status": "started"}
        with self.connect() as db:
            db.execute("INSERT INTO network VALUES (?, ?)", (record_id, encode(data)))
        return record_id

    def finish_network(self, record_id: str, success: bool):
        with self.connect() as db:
            row = db.execute("SELECT data FROM network WHERE id=?", (record_id,)).fetchone()
            data = json.loads(row["data"])
            data["status"] = "completed" if success else "failed"
            db.execute("UPDATE network SET data=? WHERE id=?", (encode(data), record_id))

    def list_network(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute("SELECT data FROM network ORDER BY json_extract(data, '$.timestamp') DESC LIMIT 200").fetchall()
        return [json.loads(row["data"]) for row in rows]

    def clear_network(self):
        with self.connect() as db:
            db.execute("DELETE FROM network")

    def read_scenes(self, project_id: str) -> list[float]:
        path = self.project_dir(project_id) / "metadata" / "scenes.json"
        return json.loads(path.read_text()) if path.is_file() else []

    def save_scenes(self, project_id: str, scenes: list[float]):
        (self.project_dir(project_id) / "metadata" / "scenes.json").write_text(json.dumps(scenes))

    def storage_used(self) -> int:
        # SQLite stores uploaded/source size; do not recursively scan multi-hour files.
        with self.connect() as db:
            rows = db.execute("SELECT data, owns_source FROM projects").fetchall()
        source_size = sum(json.loads(row["data"])["media"]["size"] for row in rows if row["owns_source"])
        return source_size + sum(e["size"] for e in self.list_exports())
