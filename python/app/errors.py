from __future__ import annotations


class AppError(Exception):
    def __init__(self, code: str, message: str, detail: str = "", retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail
        self.retryable = retryable

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "detail": self.detail, "retryable": self.retryable}


class JobCancelled(Exception):
    pass
