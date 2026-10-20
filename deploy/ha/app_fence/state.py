"""In-memory App Fence node state + idempotent receipts."""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Any, Optional


ROLE_PRIMARY = "PRIMARY_WRITER"
ROLE_FENCED = "FENCED"
ROLE_DRAINING = "DRAINING"


@dataclass
class FenceReceipt:
    """Stored response for an idempotency key (replay must be identical)."""

    status_code: int
    body: dict[str, Any]


@dataclass
class AppFenceState:
    """Process-local fence state for one node.

    Thread-safe. Not durable across restarts — production gateways should
    persist role or re-fence on boot under Failover control (out of E1 scope).
    """

    node_id: str = "node-local"
    role: str = ROLE_PRIMARY
    expected_epoch: Optional[int] = None
    last_execution_id: Optional[str] = None
    last_from_holder: Optional[str] = None
    last_to_holder: Optional[str] = None
    last_owner_gen: Optional[int] = None
    receipts: dict[str, FenceReceipt] = field(default_factory=dict)
    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False)

    def is_fenced(self) -> bool:
        with self._lock:
            return self.role == ROLE_FENCED

    def healthz_status_code(self) -> int:
        """Design §6 / §9: FENCED → /healthz non-200 (prefer 503)."""
        return 503 if self.is_fenced() else 200

    def healthz_body(self) -> dict[str, Any]:
        with self._lock:
            if self.role == ROLE_FENCED:
                return {
                    "ok": False,
                    "status": "fenced",
                    "role": ROLE_FENCED,
                    "node_id": self.node_id,
                    "expected_epoch": self.expected_epoch,
                }
            return {
                "ok": True,
                "status": "live",
                "role": self.role,
                "node_id": self.node_id,
                "expected_epoch": self.expected_epoch,
            }

    def readyz_status_code(self) -> int:
        # Fenced node is not ready for writes / CF ready probe.
        return 503 if self.is_fenced() else 200

    def readyz_body(self) -> dict[str, Any]:
        with self._lock:
            ready = self.role != ROLE_FENCED
            return {
                "ready": ready,
                "role": self.role,
                "node_id": self.node_id,
            }

    def get_receipt(self, idempotency_key: str) -> Optional[FenceReceipt]:
        with self._lock:
            return self.receipts.get(idempotency_key)

    def apply_fence(
        self,
        *,
        execution_id: str,
        from_holder: str,
        to_holder: str,
        owner_gen: int,
        to_epoch: Optional[int],
        idempotency_key: str,
    ) -> FenceReceipt:
        """Apply fence or return stored receipt for the same idempotency key."""
        with self._lock:
            existing = self.receipts.get(idempotency_key)
            if existing is not None:
                return existing

            # Transition: PRIMARY/DRAINING/other → FENCED (idempotent first apply).
            if self.role != ROLE_FENCED:
                self.role = ROLE_FENCED
            self.last_execution_id = execution_id
            self.last_from_holder = from_holder
            self.last_to_holder = to_holder
            self.last_owner_gen = owner_gen
            if to_epoch is not None:
                self.expected_epoch = to_epoch

            body: dict[str, Any] = {
                "acked": True,
                "role": ROLE_FENCED,
                "healthz": 503,
                "execution_id": execution_id,
                "from_holder": from_holder,
                "to_holder": to_holder,
                "owner_gen": owner_gen,
                "to_epoch": to_epoch,
                "idempotency_key": idempotency_key,
                "node_id": self.node_id,
                "replay": False,
            }
            receipt = FenceReceipt(status_code=200, body=body)
            self.receipts[idempotency_key] = receipt
            return receipt

    def reset_for_lab(self) -> dict[str, Any]:
        """Lab/failback helper — requires explicit env gate in HTTP layer."""
        with self._lock:
            self.role = ROLE_PRIMARY
            self.last_execution_id = None
            self.last_from_holder = None
            self.last_to_holder = None
            self.last_owner_gen = None
            # Keep expected_epoch unset until next lease/fence; clear receipts.
            self.expected_epoch = None
            self.receipts.clear()
            return {
                "ok": True,
                "role": self.role,
                "node_id": self.node_id,
                "note": "lab reset only; not Auto FO",
            }
