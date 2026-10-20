"""Minimal HTTP helpers for App Fence / CF clients (stdlib only)."""
from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request
from typing import Any, Optional


class HttpError(RuntimeError):
    def __init__(self, status: int, body: str, url: str) -> None:
        self.status = status
        self.body = body
        self.url = url
        super().__init__(f"HTTP {status} for {url}: {body[:200]}")


def build_ssl_context(
    *,
    cert: str = "",
    key: str = "",
    ca: str = "",
) -> Optional[ssl.SSLContext]:
    if not (cert or key or ca):
        return None
    ctx = ssl.create_default_context(cafile=ca or None)
    if cert and key:
        ctx.load_cert_chain(certfile=cert, keyfile=key)
    elif cert:
        ctx.load_cert_chain(certfile=cert)
    return ctx


def http_json(
    method: str,
    url: str,
    *,
    headers: Optional[dict[str, str]] = None,
    body: Optional[dict[str, Any]] = None,
    timeout_s: float = 30.0,
    ssl_context: Optional[ssl.SSLContext] = None,
) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method.upper())
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout_s, context=ssl_context) as resp:
            raw = resp.read().decode("utf-8") or "{}"
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise HttpError(e.code, err_body, url) from e
