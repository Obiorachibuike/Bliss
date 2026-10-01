import json
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


class SafeJSONFormatter(logging.Formatter):
    def format(self, record):
        data = {"timestamp": self.formatTime(record), "level": record.levelname, "event": record.getMessage()}
        for key in ["job_id", "kind", "error_code", "exception_type"]:
            if hasattr(record, key):
                data[key] = getattr(record, key)
        return json.dumps(data)


def configure_logging(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("clipship")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not logger.handlers:
        handler = RotatingFileHandler(directory / "python-worker.log", maxBytes=5 * 1024**2, backupCount=3)
        handler.setFormatter(SafeJSONFormatter())
        logger.addHandler(handler)
    # HTTP clients may include query tokens in their debug logs.
    for name in ["httpx", "httpcore", "huggingface_hub", "faster_whisper"]:
        logging.getLogger(name).setLevel(logging.ERROR)
