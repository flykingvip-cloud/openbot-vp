"""Application Fence client → POST /internal/fence (mTLS knobs)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional, Protocol

from fence.http_util import HttpError, build_ssl_context, http_json


class AppFenceClient(Protocol):
    def fence(
        self,
        *,
        execution_id: str,
        from_holder: str,
        to_holder: str,
        owner_gen: int,
        to_epoch: Optional[int] = None,
    ) -> dict[str, Any]: ...


@dataclass
class MockAppFenceClient:
    """In-memory App Fence; records calls; optional force-fail."""

    force_fail: bool = False
    timeout_ack: bool = False
    calls: list[dict[str, Any]] = field(default_factory=list)

    def fence(
        self,
        *,
        execution_id: str,
        from_holder: str,
        to_holder: str,
        owner_gen: int,
        to_epoch: Optional[int] = None,
    ) -> dict[str, Any]:
        payload = {
            "execution_id": execution_id,
            "from_holder": from_holder,
            "to_holder": to_holder,
            "owner_gen": owner_gen,
            "to_epoch": to_epoch,
            "idempotency_key": f"{execution_id}:FENCING_APP",
        }
        self.calls.append(payload)
        if self.force_fail:
            raise RuntimeError("MockAppFenceClient: forced failure")
        if self.timeout_ack:
            return {"acked": False, "role": "UNKNOWN", "note": "timeout-simulated"}
        return {"acked": True, "role": "FENCED", "healthz": 503, **payload}


@dataclass
class HttpAppFenceClient:
    """HTTP client for node /internal/fence.

    Lab/staging reference server: ``deploy/ha/app_fence`` (`POST /internal/fence`).
    """

    base_url: str
    timeout_s: float = 10.0
    mtls_cert: str = ""
    mtls_key: str = ""
    mtls_ca: str = ""

    def fence(
        self,
        *,
        execution_id: str,
        from_holder: str,
        to_holder: str,
        owner_gen: int,
        to_epoch: Optional[int] = None,
    ) -> dict[str, Any]:
        if not self.base_url:
            raise RuntimeError("HA_APP_FENCE_URL is empty")
        url = self.base_url.rstrip("/")
        body = {
            "execution_id": execution_id,
            "from_holder": from_holder,
            "to_holder": to_holder,
            "owner_gen": owner_gen,
            "to_epoch": to_epoch,
            "action": "fence",
            "idempotency_key": f"{execution_id}:FENCING_APP",
        }
        ctx = build_ssl_context(
            cert=self.mtls_cert, key=self.mtls_key, ca=self.mtls_ca
        )
        try:
            return http_json(
                "POST",
                url,
                body=body,
                timeout_s=self.timeout_s,
                ssl_context=ctx,
                headers={"X-Idempotency-Key": body["idempotency_key"]},
            )
        except HttpError as e:
            # App Fence is best-effort (§9.2): surface as non-acked receipt
            return {
                "acked": False,
                "http_status": e.status,
                "error": str(e),
                "idempotency_key": body["idempotency_key"],
            }
