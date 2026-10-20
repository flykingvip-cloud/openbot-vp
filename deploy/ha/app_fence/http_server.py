"""stdlib HTTP App Fence server: POST /internal/fence + /healthz + /readyz.

Contract matches ``deploy/ha/controller/fence/app_fence.HttpAppFenceClient``.

Auth (lab-safe defaults):
- No auth required unless ``HA_APP_FENCE_TOKEN`` is set (shared bearer / header).
- Production: terminate mTLS at reverse-proxy / gateway (see README + GATEWAY-INTEGRATION.md).
  This process does not embed certs; TLS optional via ``--tls-cert`` / ``--tls-key``.

Red lines: Auto Failover OFF / NOT APPROVED; no secrets committed.
"""
from __future__ import annotations

import json
import os
import ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional
from urllib.parse import urlparse

from app_fence.state import AppFenceState


FENCE_PATH = "/internal/fence"
RESET_PATH = "/internal/fence/reset"
HEALTHZ_PATHS = {"/healthz", "/health"}
READYZ_PATHS = {"/readyz", "/ready"}


def _truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def resolve_token() -> str:
    return os.environ.get("HA_APP_FENCE_TOKEN", "").strip()


class AppFenceHandler(BaseHTTPRequestHandler):
    """HTTP handler bound to a shared ``AppFenceState`` on the server."""

    server: "AppFenceHTTPServer"  # type: ignore[assignment]

    def log_message(self, fmt: str, *args: Any) -> None:
        # Keep lab output quiet unless HA_APP_FENCE_VERBOSE=1
        if _truthy("HA_APP_FENCE_VERBOSE"):
            super().log_message(fmt, *args)

    def _send_json(self, status: int, body: dict[str, Any]) -> None:
        raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(raw)

    def _read_json_body(self) -> tuple[Optional[dict[str, Any]], Optional[str]]:
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0:
            return {}, None
        if length > 1_000_000:
            return None, "body too large"
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            return None, f"invalid JSON: {e}"
        if data is None:
            return {}, None
        if not isinstance(data, dict):
            return None, "JSON body must be an object"
        return data, None

    def _check_auth(self) -> Optional[str]:
        """Return error message if auth fails; None if OK.

        Lab: if HA_APP_FENCE_TOKEN unset → allow (plain HTTP lab).
        If set → require Authorization: Bearer <token> or X-HA-Fence-Token.
        """
        expected = resolve_token()
        if not expected:
            return None
        auth = (self.headers.get("Authorization") or "").strip()
        header_tok = (self.headers.get("X-HA-Fence-Token") or "").strip()
        bearer = ""
        if auth.lower().startswith("bearer "):
            bearer = auth[7:].strip()
        got = bearer or header_tok
        if not got or got != expected:
            return "unauthorized: missing or invalid fence token"
        return None

    def _path(self) -> str:
        return urlparse(self.path).path.rstrip("/") or "/"

    # Normalize trailing slash except we already strip — map empty to /
    def _norm_path(self) -> str:
        p = urlparse(self.path).path
        if p != "/" and p.endswith("/"):
            p = p[:-1]
        return p

    def do_GET(self) -> None:  # noqa: N802
        path = self._norm_path()
        state = self.server.state
        if path in HEALTHZ_PATHS:
            self._send_json(state.healthz_status_code(), state.healthz_body())
            return
        if path in READYZ_PATHS:
            self._send_json(state.readyz_status_code(), state.readyz_body())
            return
        self._send_json(404, {"error": "not_found", "path": path})

    def do_HEAD(self) -> None:  # noqa: N802
        path = self._norm_path()
        state = self.server.state
        if path in HEALTHZ_PATHS:
            self._send_json(state.healthz_status_code(), state.healthz_body())
            return
        if path in READYZ_PATHS:
            self._send_json(state.readyz_status_code(), state.readyz_body())
            return
        self._send_json(404, {"error": "not_found", "path": path})

    def do_POST(self) -> None:  # noqa: N802
        path = self._norm_path()
        if path == RESET_PATH:
            self._handle_reset()
            return
        if path != FENCE_PATH:
            self._send_json(404, {"error": "not_found", "path": path})
            return
        self._handle_fence()

    def _handle_reset(self) -> None:
        auth_err = self._check_auth()
        if auth_err:
            self._send_json(401, {"acked": False, "error": auth_err})
            return
        if not _truthy("HA_APP_FENCE_ALLOW_RESET"):
            self._send_json(
                403,
                {
                    "error": "reset forbidden",
                    "hint": "set HA_APP_FENCE_ALLOW_RESET=1 for lab failback only",
                },
            )
            return
        body = self.server.state.reset_for_lab()
        self._send_json(200, body)

    def _handle_fence(self) -> None:
        auth_err = self._check_auth()
        if auth_err:
            self._send_json(401, {"acked": False, "error": auth_err})
            return

        body, err = self._read_json_body()
        if err:
            self._send_json(400, {"acked": False, "error": err})
            return
        assert body is not None

        header_key = (self.headers.get("X-Idempotency-Key") or "").strip()
        body_key = str(body.get("idempotency_key") or "").strip()
        if not header_key and not body_key:
            self._send_json(
                400,
                {
                    "acked": False,
                    "error": "missing idempotency key",
                    "hint": "send X-Idempotency-Key and/or body.idempotency_key",
                },
            )
            return
        if header_key and body_key and header_key != body_key:
            self._send_json(
                400,
                {
                    "acked": False,
                    "error": "idempotency key mismatch",
                    "header": header_key,
                    "body": body_key,
                },
            )
            return
        idempotency_key = header_key or body_key

        action = body.get("action", "fence")
        if action not in (None, "", "fence"):
            self._send_json(
                400,
                {"acked": False, "error": f"unsupported action: {action!r}"},
            )
            return

        execution_id = str(body.get("execution_id") or "").strip()
        if not execution_id:
            self._send_json(400, {"acked": False, "error": "execution_id required"})
            return

        from_holder = str(body.get("from_holder") or "")
        to_holder = str(body.get("to_holder") or "")
        try:
            owner_gen = int(body.get("owner_gen") if body.get("owner_gen") is not None else 0)
        except (TypeError, ValueError):
            self._send_json(400, {"acked": False, "error": "owner_gen must be int"})
            return

        to_epoch_raw = body.get("to_epoch")
        to_epoch: Optional[int]
        if to_epoch_raw is None or to_epoch_raw == "":
            to_epoch = None
        else:
            try:
                to_epoch = int(to_epoch_raw)
            except (TypeError, ValueError):
                self._send_json(400, {"acked": False, "error": "to_epoch must be int"})
                return

        state = self.server.state
        existing = state.get_receipt(idempotency_key)
        if existing is not None:
            replay_body = dict(existing.body)
            replay_body["replay"] = True
            self._send_json(existing.status_code, replay_body)
            return

        receipt = state.apply_fence(
            execution_id=execution_id,
            from_holder=from_holder,
            to_holder=to_holder,
            owner_gen=owner_gen,
            to_epoch=to_epoch,
            idempotency_key=idempotency_key,
        )
        self._send_json(receipt.status_code, receipt.body)


class AppFenceHTTPServer(ThreadingHTTPServer):
    def __init__(
        self,
        server_address: tuple[str, int],
        state: AppFenceState,
    ) -> None:
        self.state = state
        super().__init__(server_address, AppFenceHandler)


def create_server(
    *,
    host: str = "127.0.0.1",
    port: int = 8443,
    node_id: str = "node-local",
    tls_cert: str = "",
    tls_key: str = "",
    tls_ca: str = "",
    state: Optional[AppFenceState] = None,
) -> AppFenceHTTPServer:
    st = state or AppFenceState(node_id=node_id)
    httpd = AppFenceHTTPServer((host, port), st)
    if tls_cert and tls_key:
        # Optional TLS for lab HTTPS; production mTLS usually at proxy.
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=tls_cert, keyfile=tls_key)
        if tls_ca:
            ctx.load_verify_locations(cafile=tls_ca)
            ctx.verify_mode = ssl.CERT_REQUIRED  # mTLS when CA provided
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    return httpd


def serve_forever(
    *,
    host: str = "127.0.0.1",
    port: int = 8443,
    node_id: str = "node-local",
    tls_cert: str = "",
    tls_key: str = "",
    tls_ca: str = "",
) -> None:
    httpd = create_server(
        host=host,
        port=port,
        node_id=node_id,
        tls_cert=tls_cert,
        tls_key=tls_key,
        tls_ca=tls_ca,
    )
    scheme = "https" if (tls_cert and tls_key) else "http"
    print(
        f"app-fence listening {scheme}://{host}:{port} "
        f"node_id={node_id} AutoFO=OFF/NOT_APPROVED",
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("shutting down", flush=True)
    finally:
        httpd.server_close()
