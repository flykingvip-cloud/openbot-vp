"""Promote step — mark new holder ready (lab/mock; real node API deferred)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional, Protocol


class PromoteClient(Protocol):
    def promote(
        self,
        *,
        execution_id: str,
        to_holder: str,
        to_epoch: Optional[int] = None,
    ) -> dict[str, Any]: ...


@dataclass
class MockPromoteClient:
    force_fail: bool = False
    calls: list[dict[str, Any]] = field(default_factory=list)

    def promote(
        self,
        *,
        execution_id: str,
        to_holder: str,
        to_epoch: Optional[int] = None,
    ) -> dict[str, Any]:
        key = f"{execution_id}:PROMOTING"
        payload = {
            "execution_id": execution_id,
            "to_holder": to_holder,
            "to_epoch": to_epoch,
            "idempotency_key": key,
        }
        self.calls.append(payload)
        if self.force_fail:
            raise RuntimeError("MockPromoteClient: forced failure")
        return {"ok": True, "role": "PRIMARY", "provider": "mock", **payload}
