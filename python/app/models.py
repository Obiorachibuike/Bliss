from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    def json_data(self) -> dict:
        return self.model_dump(mode="json", by_alias=True)


class Word(Model):
    id: str
    word: str = Field(max_length=500)
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float = Field(ge=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def valid_time(self):
        if self.end < self.start:
            raise ValueError("Word end must follow its start")
        return self


class Segment(Model):
    id: int
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float = Field(ge=0, allow_inf_nan=False)
    text: str
    words: list[Word]


class Transcript(Model):
    language: str
    duration: float
    segments: list[Segment]
    model: str


class VideoMetadata(Model):
    filename: str
    size: int
    width: int
    height: int
    fps: float
    duration: float
    codec: str
    has_audio: bool
    audio_codec: str | None = None
    audio_channels: int | None = None
    is_audio: bool = False


Category = Literal["hook", "educational", "story", "controversial", "emotional", "insight", "funny", "quotable"]


class Candidate(Model):
    id: str
    project_id: str
    start_time: float
    end_time: float
    duration: float
    title: str
    hook: str
    score: float
    reasons: list[str]
    transcript: str
    categories: list[Category]
    favorite: bool = False
    rejected: bool = False
    thumbnail_url: str | None = None
    headlines: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=now)


class CaptionSettings(Model):
    enabled: bool = True
    style: Literal["classic", "minimal", "bold", "creator", "karaoke", "highlight", "clean"] = "creator"
    font: Literal["DejaVu Sans", "Arial", "Verdana"] = "DejaVu Sans"
    font_size: int = Field(default=64, ge=16, le=160)
    position: Literal["top", "center", "bottom"] = "bottom"
    color: str = "#FFFFFF"
    highlight_color: str = "#B29AFF"
    background: str = "#000000"
    max_words: int = Field(default=4, ge=1, le=12)
    animation: Literal["none", "fade", "pop"] = "none"

    @field_validator("color", "highlight_color", "background")
    @classmethod
    def colors(cls, value: str) -> str:
        import re
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise ValueError("Use a six-digit hex color")
        return value


class HeadlineSettings(Model):
    enabled: bool = False
    text: str = Field(default="", max_length=240)
    font_size: int = Field(default=64, ge=16, le=160)
    color: str = "#FFFFFF"
    background: str = "#7C5CFF"
    position: Literal["top", "center", "bottom"] = "top"
    alignment: Literal["left", "center", "right"] = "center"
    font: Literal["DejaVu Sans", "Arial", "Verdana"] = "DejaVu Sans"

    @field_validator("color", "background")
    @classmethod
    def colors(cls, value: str) -> str:
        return CaptionSettings.colors(value)


class RenderSettings(Model):
    preset: Literal["tiktok", "reels", "shorts", "custom"] = "shorts"
    aspect_ratio: Literal["9:16", "1:1", "16:9"] = "9:16"
    width: int = Field(default=1080, ge=240, le=3840)
    height: int = Field(default=1920, ge=240, le=3840)
    fps: int = Field(default=30, ge=15, le=60)
    bitrate: int = Field(default=8, ge=1, le=50)
    filename: str = Field(default="clip", max_length=120)
    format: Literal["mp4"] = "mp4"
    face_strategy: Literal["active-speaker", "largest", "center", "manual"] = "largest"
    manual_crop_x: float = Field(default=0.5, ge=0, le=1, allow_inf_nan=False)
    track_faces: bool = True
    audio_volume: float = Field(default=1.0, ge=0, le=2, allow_inf_nan=False)
    caption_settings: CaptionSettings = Field(default_factory=CaptionSettings)
    headline_settings: HeadlineSettings = Field(default_factory=HeadlineSettings)
    words: list[Word] = Field(default_factory=list, max_length=10000)
    start_time: float = Field(ge=0, allow_inf_nan=False)
    end_time: float = Field(gt=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def valid_render(self):
        if self.end_time <= self.start_time or self.end_time - self.start_time > 600:
            raise ValueError("Clips must be between 0 and 600 seconds")
        if self.width % 2 or self.height % 2:
            raise ValueError("H.264 output dimensions must be even")
        for word in self.words:
            if word.start < self.start_time - 0.01 or word.end > self.end_time + 0.01:
                raise ValueError("Caption words must be inside the selected clip")
        if any(b.start < a.start for a, b in zip(self.words, self.words[1:])):
            raise ValueError("Caption words must be ordered by time")
        return self


class AnalyzeOptions(Model):
    min_duration: float = Field(default=20, ge=5, le=180, allow_inf_nan=False)
    max_duration: float = Field(default=90, ge=10, le=300, allow_inf_nan=False)
    ai_mode: Literal["local", "api"] = "local"
    model: Literal["tiny", "base", "small", "medium", "large-v3"] = "small"
    language: str | None = Field(default=None, max_length=8)
    provider: Literal["openai", "anthropic", "gemini", "custom", "ollama"] = "openai"
    provider_model: str = Field(default="gpt-4o-mini", max_length=100)
    endpoint: str = Field(default="", max_length=2048)
    transcript_consent: bool = False

    @model_validator(mode="after")
    def valid_options(self):
        if self.max_duration < self.min_duration:
            raise ValueError("Maximum duration must be at least minimum duration")
        if self.ai_mode == "api" and not self.transcript_consent:
            raise ValueError("API mode requires explicit transcript-sharing consent")
        return self


class JobStep(Model):
    key: str
    label: str
    status: Literal["pending", "running", "completed", "skipped"] = "pending"


class Job(Model):
    id: str
    project_id: str | None = None
    clip_id: str | None = None
    kind: Literal["analysis", "transcription", "render", "model-download"]
    status: Literal["queued", "running", "completed", "failed", "cancelled"] = "queued"
    progress: float = Field(default=0, ge=0, le=100)
    message: str = "Waiting to start"
    steps: list[JobStep] = Field(default_factory=list)
    created_at: str = Field(default_factory=now)
    updated_at: str = Field(default_factory=now)
    error: dict | None = None
    result_id: str | None = None


class Settings(Model):
    theme: Literal["dark", "light", "system"] = "dark"
    language: str = "en"
    autosave: bool = True
    ai_mode: Literal["local", "api"] = "local"
    model: Literal["tiny", "base", "small", "medium", "large-v3"] = "small"
    provider: Literal["openai", "anthropic", "gemini", "custom", "ollama"] = "openai"
    provider_model: str = "gpt-4o-mini"
    endpoint: str = ""
    local_llm: Literal["heuristic", "ollama"] = "heuristic"
    min_duration: int = Field(default=20, ge=5, le=180)
    max_duration: int = Field(default=90, ge=10, le=300)
    aspect_ratio: Literal["9:16", "1:1", "16:9"] = "9:16"
    fps: int = Field(default=30, ge=15, le=60)
    caption_style: Literal["classic", "minimal", "bold", "creator", "karaoke", "highlight", "clean"] = "creator"
    export_directory: str = ""

    @model_validator(mode="after")
    def valid_durations(self):
        if self.max_duration < self.min_duration:
            raise ValueError("Preferred duration range is invalid")
        return self


def bounded(value: float, lower: float, upper: float) -> float:
    if not math.isfinite(value):
        return lower
    return max(lower, min(upper, value))
