from __future__ import annotations

import re
from pathlib import Path

from app.config import MEDIA_EXTENSIONS
from app.errors import AppError

ID_PATTERN = re.compile(r"^[a-f0-9]{32}$")


def validate_id(value: str) -> str:
    if not ID_PATTERN.fullmatch(value):
        raise AppError("INVALID_ID", "This item identifier is invalid.", "Return to your project and try again.")
    return value


def inside(root: Path, path: Path) -> Path:
    path = path.resolve()
    if not path.is_relative_to(root.resolve()):
        raise AppError("INVALID_PATH", "Access outside the project directory is not allowed.")
    return path


def media_path(value: str) -> Path:
    path = Path(value).expanduser().resolve()
    if not path.is_file():
        raise AppError("FILE_MISSING", "We couldn't find this recording.", "The original file may have been moved or deleted. Import it again.")
    if path.suffix.lower() not in MEDIA_EXTENSIONS:
        raise AppError("UNSUPPORTED_FORMAT", "This file type isn't supported.", "Choose MP4, MOV, MKV, WebM, AVI, or a common audio format.")
    return path


def safe_filename(value: str, fallback: str = "clip") -> str:
    name = re.sub(r"[^\w\- .]", "", Path(value).name, flags=re.UNICODE).strip(". ")
    name = re.sub(r"\s+", "-", name)[:100]
    if name.lower().endswith(".mp4"):
        name = name[:-4]
    return name or fallback
