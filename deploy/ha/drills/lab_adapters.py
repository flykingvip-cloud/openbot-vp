"""LabFenceAdapter — Stage B lab-form fencing (§19.2 drills 16L–19L).

Lab form (this module):
  - Network / Compute / CF / App Fence → receipt stubs only (no cloud APIs)
  - TERMINATING_OLD_SESSIONS → real ``openbot_ha_terminate_holder_sessions``
  - VERIFYING → real holder_sessions=0 + pg_prepared_xacts empty

Production-form real Network Fence / SG / NACL / Managed PG vendor FO /
Cloudflare Origin APIs are **Stage D** — not enabled here.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import psycopg
from psycopg.rows import dict_row

# Re-export Receipt shape compatible with controller.adapters
import sys
from pathlib import Path as _Path

# When imported under drills PYTHONPATH, controller package may sit beside us.
_CTL = str(_Path(__file__).resolve().parent.parent / "controller")
if _CTL not in sys.path:
    sys.path.insert(0, _CTL)

import adapters as ctl_adapters  # noqa: E402


Receipt = ctl_adapters.Receipt


@dataclass
class DrainTimings:
    """Measured T_old_txn_drain components (§3.5.1)."""

    t_scan: float = 0.0
    t_wait: float = 0.0
    t_terminate: float = 0.0
    t_confirm: float = 0.0
    terminated: int = 0
    sessions_left: int = -1
    prepared_left: int = -1

    @property
    def t_old_txn_drain(self) -> float:
        return self.t_scan + self.t_wait + self.t_terminate + self.t_confirm


class LabFenceAdapter:
    """Injectable SideEffectAdapter for Stage B lab drills.

    Real SQL only for terminate + VERIFY. All other fence / CF steps are
    lab receipts keyed by ``execution_id + step`` (idempotent).
    """

    SIDE_EFFECT_STEPS = ctl_adapters.RecordingStubAdapter.SIDE_EFFECT_STEPS

    def __init__(
        self,
        database_url: str,
        *,
        app_fence_acked: bool = False,
        t_wait_s: float = 5.0,
        t_confirm_s: float = 1.0,
        terminate_timeout_ms: int = 2000,
        skip_compute_documented: bool = True,
    ) -> None:
        self.database_url = database_url
        self.app_fence_acked = app_fence_acked
        self.t_wait_s = t_wait_s
        self.t_confirm_s = t_confirm_s
        self.terminate_timeout_ms = terminate_timeout_ms
        self.skip_compute_documented = skip_compute_documented
        self._lock = threading.Lock()
        self._receipts: list[Receipt] = []
        self._by_key: dict[str, Receipt] = {}
        self._count = 0
        self.blocked = False
        self.timings = DrainTimings()
        self.last_verify: dict[str, Any] = {}

    @property
    def side_effect_count(self) -> int:
        with self._lock:
            return self._count

    @property
    def receipts(self) -> list[Receipt]:
        with self._lock:
            return list(self._receipts)

    def _connect(self) -> psycopg.Connection:
        return psycopg.connect(
            self.database_url,
            application_name="lab-fence-adapter",
            row_factory=dict_row,
        )

    def _record(self, execution_id: str, step: str, detail: dict[str, Any]) -> Receipt:
        key = f"{execution_id}:{step}"
        with self._lock:
            if self.blocked:
                raise RuntimeError(
                    f"adapter blocked: refusing side effect {key} (observer / taken-over)"
                )
            if key in self._by_key:
                return self._by_key[key]
            if step in self.SIDE_EFFECT_STEPS:
                self._count += 1
            r = Receipt(
                execution_id,
                step,
                True,
                {
                    "idempotency_key": key,
                    "lab_form": True,
                    "n": self._count,
                    **detail,
                },
            )
            self._by_key[key] = r
            self._receipts.append(r)
            return r

    def run(self, execution_id: str, step: str, **ctx: Any) -> Receipt:
        key = f"{execution_id}:{step}"
        with self._lock:
            if self.blocked:
                raise RuntimeError(
                    f"adapter blocked: refusing side effect {key} (observer / taken-over)"
                )
            if key in self._by_key:
                return self._by_key[key]

        if step == "FENCING_APP":
            return self._record(
                execution_id,
                step,
                {
                    "kind": "lab_stub",
                    "app_fence_acked": self.app_fence_acked,
                    "note": "lab App Fence receipt; production App Fence = Stage D path",
                    "from_holder": ctx.get("from_holder"),
                    "to_holder": ctx.get("to_holder"),
                    "owner_gen": ctx.get("owner_gen"),
                },
            )

        if step == "DRAIN_WAIT":
            t0 = time.monotonic()
            waited = 0.0
            if self.app_fence_acked and self.t_wait_s > 0:
                # §3.5.1: only wait when App Fence confirmed
                time.sleep(self.t_wait_s)
                waited = self.t_wait_s
            self.timings.t_wait = waited
            return self._record(
                execution_id,
                step,
                {
                    "kind": "lab_drain_wait",
                    "waited_s": waited,
                    "app_fence_acked": self.app_fence_acked,
                    "elapsed_s": round(time.monotonic() - t0, 4),
                },
            )

        if step == "FENCING_NETWORK":
            return self._record(
                execution_id,
                step,
                {
                    "kind": "lab_stub",
                    "note": (
                        "lab Network Fence receipt only; "
                        "production-form real Network Fence (SG/NACL) = Stage D"
                    ),
                    "from_holder": ctx.get("from_holder"),
                    "to_holder": ctx.get("to_holder"),
                },
            )

        if step == "FENCING_COMPUTE":
            return self._record(
                execution_id,
                step,
                {
                    "kind": "lab_stub",
                    "skip_documented": self.skip_compute_documented,
                    "note": "lab Compute Fence receipt / skip-documented; real compute stop = Stage D",
                },
            )

        if step == "TERMINATING_OLD_SESSIONS":
            return self._do_terminate(execution_id, ctx)

        if step == "VERIFYING":
            return self._do_verify(execution_id, ctx)

        if step in ("PROMOTING", "CF_CUTOVER"):
            return self._record(
                execution_id,
                step,
                {
                    "kind": "lab_stub",
                    "note": "lab CF/promote receipt; real Cloudflare Origin API = Stage D",
                    "to_epoch": ctx.get("to_epoch"),
                },
            )

        # Bookkeeping / unknown
        return self._record(execution_id, step, {"skipped": True, **{k: ctx.get(k) for k in ctx}})

    def _do_terminate(self, execution_id: str, ctx: dict[str, Any]) -> Receipt:
        from_holder = ctx.get("from_holder")
        from_db_role = ctx.get("from_db_role")
        if not from_holder:
            raise RuntimeError("TERMINATING_OLD_SESSIONS requires from_holder")
        t0 = time.monotonic()
        # Cheap scan first (§3.5.1 T_scan)
        t_scan0 = time.monotonic()
        with self._connect() as conn:
            with conn.cursor() as cur:
                if from_db_role is None:
                    cur.execute(
                        "SELECT holder_db_role FROM public.writer_epoch_guard WHERE lock_name='openbot_writer'"
                    )
                    row = cur.fetchone()
                    from_db_role = row["holder_db_role"] if row else None
                cur.execute(
                    "SELECT count(*) AS n FROM public.openbot_ha_holder_sessions(%s, %s)",
                    (from_holder, from_db_role),
                )
                scanned = int(cur.fetchone()["n"])
            self.timings.t_scan = time.monotonic() - t_scan0

            t_term0 = time.monotonic()
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT * FROM public.openbot_ha_terminate_holder_sessions(
                        %s, %s, %s, %s::uuid)
                    """,
                    (from_holder, from_db_role, self.terminate_timeout_ms, execution_id),
                )
                rows = list(cur.fetchall())
            conn.commit()
            self.timings.t_terminate = time.monotonic() - t_term0
            self.timings.terminated = len(rows)

        return self._record(
            execution_id,
            "TERMINATING_OLD_SESSIONS",
            {
                "kind": "real_sql",
                "from_holder": from_holder,
                "from_db_role": from_db_role,
                "scanned": scanned,
                "terminated": len(rows),
                "timeout_ms": self.terminate_timeout_ms,
                "elapsed_s": round(time.monotonic() - t0, 4),
                "pids": [r.get("pid") for r in rows],
            },
        )

    def _do_verify(self, execution_id: str, ctx: dict[str, Any]) -> Receipt:
        from_holder = ctx.get("from_holder")
        from_db_role = ctx.get("from_db_role")
        if not from_holder:
            raise RuntimeError("VERIFYING requires from_holder")
        t0 = time.monotonic()
        deadline = t0 + max(self.t_confirm_s, 0.05)
        left = -1
        prepared = -1
        attempts = 0
        with self._connect() as conn:
            if from_db_role is None:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT holder_db_role FROM public.writer_epoch_guard WHERE lock_name='openbot_writer'"
                    )
                    row = cur.fetchone()
                    from_db_role = row["holder_db_role"] if row else None
            while True:
                attempts += 1
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT count(*) AS n FROM public.openbot_ha_holder_sessions(%s, %s)",
                        (from_holder, from_db_role),
                    )
                    left = int(cur.fetchone()["n"])
                    cur.execute("SELECT count(*) AS n FROM pg_catalog.pg_prepared_xacts")
                    prepared = int(cur.fetchone()["n"])
                if left == 0 and prepared == 0:
                    break
                if time.monotonic() >= deadline:
                    break
                # One more terminate pass if sessions linger
                if left > 0:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            SELECT * FROM public.openbot_ha_terminate_holder_sessions(
                                %s, %s, %s, %s::uuid)
                            """,
                            (from_holder, from_db_role, self.terminate_timeout_ms, execution_id),
                        )
                        cur.fetchall()
                    conn.commit()
                time.sleep(0.05)

        self.timings.t_confirm = time.monotonic() - t0
        self.timings.sessions_left = left
        self.timings.prepared_left = prepared
        ok = left == 0 and prepared == 0
        detail = {
            "kind": "real_sql_verify",
            "ok": ok,
            "holder_sessions": left,
            "prepared_xacts": prepared,
            "attempts": attempts,
            "from_holder": from_holder,
            "from_db_role": from_db_role,
            "elapsed_s": round(self.timings.t_confirm, 4),
            "t_old_txn_drain": round(self.timings.t_old_txn_drain, 4),
            "timings": {
                "t_scan": round(self.timings.t_scan, 4),
                "t_wait": round(self.timings.t_wait, 4),
                "t_terminate": round(self.timings.t_terminate, 4),
                "t_confirm": round(self.timings.t_confirm, 4),
            },
        }
        self.last_verify = detail
        if not ok:
            raise RuntimeError(
                f"VERIFY failed: holder_sessions={left} prepared_xacts={prepared}"
            )
        return self._record(execution_id, "VERIFYING", detail)
