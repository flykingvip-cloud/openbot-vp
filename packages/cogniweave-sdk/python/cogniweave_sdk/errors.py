class CogniWeaveError(Exception):
    """Base exception for Python SDK."""


class ApiError(CogniWeaveError):
    def __init__(self, status: int, message: str, body: object | None = None) -> None:
        super().__init__(f"CogniWeave API error ({status}): {message}")
        self.status = status
        self.message = message
        self.body = body
