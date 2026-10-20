"""Injectable side-effect adapters (§12.5). Lab stubs record receipts only.

Receipts are keyed by ``execution_id + step`` for idempotency. Production
Cloudflare / cloud fencing APIs are intentionally NOT implemented here.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class Receipt:
    execution_id: str
    step: str
    ok: bool
    detail: dict[str, Any] = field(default_factory=dict)
    at: float = field(default_factory=time.time)


class SideEffectAdapter(Protocol):
    def run(self, execution_id: str, step: str, **ctx: Any) -> Receipt: ...

    @property
    def side_effect_count(self) -> int: ...

    @property
    def receipts(self) -> list[Receipt]: ...


class RecordingStubAdapter:
    """Lab stub: records each side effect; never talks to CF / cloud APIs."""

    SIDE_EFFECT_STEPS = frozenset(
        {
            "FENCING_APP",
            "DRAIN_WAIT",
            "FENCING_NETWORK",
            "FENCING_COMPUTE",
            "TERMINATING_OLD_SESSIONS",
            "VERIFYING",
            "PROMOTING",
            "CF_CUTOVER",
        }
    )

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._receipts: list[Receipt] = []
        self._by_key: dict[str, Receipt] = {}
        self._count = 0
        self.blocked = False  # tests can flip to force zero effects on loser path

    @property
    def side_effect_count(self) -> int:
        with self._lock:
            return self._count

    @property
    def receipts(self) -> list[Receipt]:
        with self._lock:
            return list(self._receipts)

    def run(self, execution_id: str, step: str, **ctx: Any) -> Receipt:
        key = f"{execution_id}:{step}"
        with self._lock:
            if self.blocked:
                raise RuntimeError(
                    f"adapter blocked: refusing side effect {key} (observer / taken-over)"
                )
            if key in self._by_key:
                return self._by_key[key]
            if step not in self.SIDE_EFFECT_STEPS:
                # Non-side-effect bookkeeping steps (CLAIMED etc.) are not counted.
                r = Receipt(execution_id, step, True, {"skipped": True, **ctx})
                self._by_key[key] = r
                self._receipts.append(r)
                return r
            self._count += 1
            r = Receipt(
                execution_id,
                step,
                True,
                {
                    "idempotency_key": key,
                    "from_holder": ctx.get("from_holder"),
                    "to_holder": ctx.get("to_holder"),
                    "owner_gen": ctx.get("owner_gen"),
                    "n": self._count,
                },
            )
            self._by_key[key] = r
            self._receipts.append(r)
            return r


class NullAdapter:
    """Always refuses side effects — used by OBSERVING / LOST_CLAIM / TAKEN_OVER."""

    def __init__(self) -> None:
        self._receipts: list[Receipt] = []

    @property
    def side_effect_count(self) -> int:
        return 0

    @property
    def receipts(self) -> list[Receipt]:
        return list(self._receipts)

    def run(self, execution_id: str, step: str, **ctx: Any) -> Receipt:
        raise RuntimeError(
            f"NullAdapter: zero side effects allowed (step={step} eid={execution_id})"
        )
