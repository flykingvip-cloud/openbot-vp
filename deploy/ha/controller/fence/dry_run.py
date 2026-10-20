"""DryRunFenceAdapter — records intended calls only; always-ok receipts."""
from __future__ import annotations

import threading
import time
from typing import Any, Optional

import adapters


class DryRunFenceAdapter:
    """No cloud / CF / SQL side effects. Receipts describe *would-do* actions."""

    SIDE_EFFECT_STEPS = adapters.RecordingStubAdapter.SIDE_EFFECT_STEPS

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._receipts: list[adapters.Receipt] = []
        self._by_key: dict[str, adapters.Receipt] = {}
        self._count = 0
        self.blocked = False
        self.intended: list[dict[str, Any]] = []
        self.last_verify: dict[str, Any] = {}

    @property
    def side_effect_count(self) -> int:
        with self._lock:
            return self._count

    @property
    def receipts(self) -> list[adapters.Receipt]:
        with self._lock:
            return list(self._receipts)

    def run(self, execution_id: str, step: str, **ctx: Any) -> adapters.Receipt:
        key = f"{execution_id}:{step}"
        with self._lock:
            if self.blocked:
                raise RuntimeError(
                    f"adapter blocked: refusing side effect {key} (observer / taken-over)"
                )
            if key in self._by_key:
                return self._by_key[key]

        intended = {
            "kind": "dry_run",
            "step": step,
            "idempotency_key": key,
            "would_call": _would_call(step),
            "from_holder": ctx.get("from_holder"),
            "to_holder": ctx.get("to_holder"),
            "to_epoch": ctx.get("to_epoch"),
            "owner_gen": ctx.get("owner_gen"),
        }
        with self._lock:
            self.intended.append(dict(intended))
            if step in self.SIDE_EFFECT_STEPS:
                self._count += 1
            detail = {"ok": True, "n": self._count, **intended}
            if step == "VERIFYING":
                detail.update(
                    {
                        "holder_sessions": 0,
                        "prepared_xacts": 0,
                        "network_fence_rule_version": None,
                        "compute_instance_state": None,
                        "note": "dry_run VERIFY — no SQL",
                    }
                )
                self.last_verify = detail
            r = adapters.Receipt(execution_id, step, True, detail)
            self._by_key[key] = r
            self._receipts.append(r)
            return r


def _would_call(step: str) -> str:
    return {
        "FENCING_APP": "POST /internal/fence",
        "DRAIN_WAIT": "sleep T_wait if app_fence_acked",
        "FENCING_NETWORK": "cloud NetworkFence.isolate_old_primary",
        "FENCING_COMPUTE": "cloud ComputeFence.stop_or_isolate",
        "TERMINATING_OLD_SESSIONS": "SQL openbot_ha_terminate_holder_sessions",
        "VERIFYING": "SQL holder_sessions=0 + prepared_xacts=0",
        "PROMOTING": "PromoteClient.promote",
        "CF_CUTOVER": "CF remove-old → add-new (§12.5)",
    }.get(step, "noop")
