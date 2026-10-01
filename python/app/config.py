from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from platformdirs import user_data_path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
MODELS = {
    "tiny": ("Whisper Tiny", "75 MB", False),
    "base": ("Whisper Base", "145 MB", False),
    "small": ("Whisper Small", "465 MB", True),
    "medium": ("Whisper Medium", "1.5 GB", False),
    "large-v3": ("Whisper Large v3", "3 GB", False),
}
MEDIA_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac"}


def binary(name: str) -> str | None:
    configured = os.getenv(f"{name.upper()}_PATH")
    if configured:
        path = Path(configured).expanduser()
        return str(path.resolve()) if path.is_file() else shutil.which(configured)
    found = shutil.which(name)
    if found:
        return found
    # Linux preview convenience only. Native installations should use PATH/env.
    fallback = REPOSITORY_ROOT / "node_modules" / f"@{name}-installer" / "linux-x64" / name
    return str(fallback) if fallback.is_file() else None


@dataclass
class Config:
    runtime: str = field(default_factory=lambda: os.getenv("CLIPSHIP_RUNTIME", "web"))
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR") or user_data_path("ClipShip", "ClipShip")))
    model_dir: Path = field(default_factory=lambda: Path(os.getenv("MODEL_DIR") or user_data_path("ClipShip", "ClipShip") / "models"))
    ffmpeg: str | None = field(default_factory=lambda: binary("ffmpeg"))
    ffprobe: str | None = field(default_factory=lambda: binary("ffprobe"))
    worker_token: str = field(default_factory=lambda: os.getenv("CLIPSHIP_WORKER_TOKEN", ""))
    access_token: str = field(default_factory=lambda: os.getenv("CLIPSHIP_ACCESS_TOKEN", ""))
    max_upload_bytes: int = field(default_factory=lambda: int(os.getenv("MAX_UPLOAD_BYTES", str(20 * 1024**3))))
    device: str = field(default_factory=lambda: os.getenv("WHISPER_DEVICE", "cpu"))
    compute_type: str = field(default_factory=lambda: os.getenv("WHISPER_COMPUTE_TYPE", "int8"))
    allowed_endpoints: set[str] = field(default_factory=lambda: {x.rstrip("/") for x in os.getenv("AI_ALLOWED_ENDPOINTS", "").split(",") if x})

    def __post_init__(self):
        self.data_dir = self.data_dir.expanduser().resolve()
        self.model_dir = self.model_dir.expanduser().resolve()
        if self.runtime not in {"web", "desktop"}:
            raise ValueError("CLIPSHIP_RUNTIME must be web or desktop")
        if self.runtime == "desktop" and not self.worker_token:
            raise ValueError("Desktop workers require a per-launch CLIPSHIP_WORKER_TOKEN")
        for directory in [self.data_dir, self.data_dir / "projects", self.data_dir / "logs", self.model_dir]:
            directory.mkdir(parents=True, exist_ok=True)
