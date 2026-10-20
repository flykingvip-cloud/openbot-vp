"""CompositeFenceAdapter — dispatch fence steps; real terminate/VERIFY SQL."""
from __future__ import annotations

import threading
import time
from typing import Any

import adapters

class _DrainTimings:
    """Measured T_old_txn_drain components (§3.5.1) — mirrors lab_adapters."""

    def __init__(self) -> None:
        self.t_scan = 0.0
        self.t_wait = 0.0
        self.t_terminate = 0.0
        self.t_confirm = 0.0
        self.terminated = 0
        self.sessions_left = -1
        self.prepared_left = -1

    @property
    def t_old_txn_drain(self) -> float:
        return self.t_scan + self.t_wait + self.t_terminate + self.t_confirm


class CompositeFenceAdapter:
    """SideEffectAdapter composing App/Network/Compute/CF/Promote + real SQL.

    - TERMINATING_OLD_SESSIONS / VERIFYING always use real SQL (like LabFenceAdapter)
    - Other steps call injected clients (Mock by default; Http/Aws when enabled)
    - Disabled clients emit documented skip receipts (not live calls)
    """

    SIDE_EFFECT_STEPS = adapters.RecordingStubAdapter.SIDE_EFFECT_STEPS

    def __init__(
        self,
        database_url: str,
        *,
        app_client: Any = None,
        network_client: Any = None,
        compute_client: Any = None,
        cf_client: Any = None,
        promote_client: Any = None,
        enable_app: bool = False,
        enable_network: bool = False,
        enable_compute: bool = False,
        enable_cf: bool = False,
        enable_promote: bool = False,
        app_fence_acked: bool = False,
        t_wait_s: float = 5.0,
        t_confirm_s: float = 1.0,
        terminate_timeout_ms: int = 2000,
        skip_compute_documented: bool = True,
        cf_old_origin: str = "",
        cf_new_origin: str = "",
    ) -> None:
        self.database_url = database_url
        self.app_client = app_client
        self.network_client = network_client
        self.compute_client = compute_client
        self.cf_client = cf_client
        self.promote_client = promote_client
        self.enable_app = enable_app
        self.enable_network = enable_network
        self.enable_compute = enable_compute
        self.enable_cf = enable_cf
        self.enable_promote = enable_promote
        self.app_fence_acked = app_fence_acked
        self.t_wait_s = t_wait_s
        self.t_confirm_s = t_confirm_s
        self.terminate_timeout_ms = terminate_timeout_ms
        self.skip_compute_documented = skip_compute_documented
        self.cf_old_origin = cf_old_origin
        self.cf_new_origin = cf_new_origin

        self._lock = threading.Lock()
        self._receipts: list[adapters.Receipt] = []
        self._by_key: dict[str, adapters.Receipt] = {}
        self._count = 0
        self.blocked = False
        self.last_verify: dict[str, Any] = {}
        self._network_receipt: dict[str, Any] = {}
        self._compute_receipt: dict[str, Any] = {}
        self.timings = _DrainTimings()

    @property
    def side_effect_count(self) -> int:
        with self._lock:
            return self._count

    @property
    def receipts(self) -> list[adapters.Receipt]:
        with self._lock:
            return list(self._receipts)

    def _connect(self):
        import psycopg
        from psycopg.rows import dict_row

        return psycopg.connect(
            self.database_url,
            application_name="composite-fence-adapter",
            row_factory=dict_row,
        )

    def _record(self, execution_id: str, step: str, detail: dict[str, Any]) -> adapters.Receipt:
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
            r = adapters.Receipt(
                execution_id,
                step,
                True,
                {"idempotency_key": key, "n": self._count, **detail},
            )
            self._by_key[key] = r
            self._receipts.append(r)
            return r

    def run(self, execution_id: str, step: str, **ctx: Any) -> adapters.Receipt:
        key = f"{execution_id}:{step}"
        with self._lock:
            if self.blocked:
                raise RuntimeError(
                    f"adapter blocked: refusing side effect {key} (observer / taken-over)"
                )
            if key in self._by_key:
                return self._by_key[key]

        if step == "FENCING_APP":
            return self._do_app(execution_id, ctx)
        if step == "DRAIN_WAIT":
            return self._do_drain_wait(execution_id, ctx)
        if step == "FENCING_NETWORK":
            return self._do_network(execution_id, ctx)
        if step == "FENCING_COMPUTE":
            return self._do_compute(execution_id, ctx)
        if step == "TERMINATING_OLD_SESSIONS":
            return self._do_terminate(execution_id, ctx)
        if step == "VERIFYING":
            return self._do_verify(execution_id, ctx)
        if step == "PROMOTING":
            return self._do_promote(execution_id, ctx)
        if step == "CF_CUTOVER":
            return self._do_cf(execution_id, ctx)
        return self._record(execution_id, step, {"skipped": True, **{k: ctx.get(k) for k in ctx}})

    def _do_app(self, execution_id: str, ctx: dict[str, Any]) -> adapters.Receipt:
        if not self.enable_app or self.app_client is None:
            return self._record(
                execution_id,
                "FENCING_APP",
                {
                    "kind": "disabled_skip",
                    "app_fence_acked": self.app_fence_acked,
                    "note": "App Fence disabled (HA_FENCE_ENABLE_APP!=1)",
                    "from_holder": ctx.get("from_holder"),
                    "to_holder": ctx.get("to_holder"),
                },
            )
        out = self.app_client.fence(
            execution_id=execution_id,
            from_holder=str(ctx.get("from_holder") or ""),
            to_holder=str(ctx.get("to_holder") or ""),
            owner_gen=int(ctx.get("owner_gen") or 0),
            to_epoch=ctx.get("to_epoch"),
        )
        acked = bool(out.get("acked", True))
        self.app_fence_acked = acked or self.app_fence_acked
        return self._record(
            execution_id,
            "FENCING_APP",
            {"kind": "app_fence", "app_fence_acked": acked, "client": out},
        )

    def _do_drain_wait(self, execution_id: str, ctx: dict[str, Any]) -> adapters.Receipt:
        t0 = time.monotonic()
        waited = 0.0
        if self.app_fence_acked and self.t_wait_s > 0:
            time.sleep(self.t_wait_s)
            waited = self.t_wait_s
        self.timings.t_wait = waited
        return self._record(
            execution_id,
            "DRAIN_WAIT",
            {
                "kind": "drain_wait",
                "waited_s": waited,
                "app_fence_acked": self.app_fence_acked,
                "elapsed_s": round(time.monotonic() - t0, 4),
            },
        )

    def _do_network(self, execution_id: str, ctx: dict[str, Any]) -> adapters.Receipt:
        if not self.enable_network or self.network_client is None:
            detail = {
                "kind": "disabled_skip",
                "note": "Network Fence disabled (HA_FENCE_ENABLE_NETWORK!=1)",
                "from_holder": ctx.get("from_holder"),
            }
            self._network_receipt = detail
            return self._record(execution_id, "FENCING_NETWORK", detail)
        out = self.network_client.isolate_old_primary(
            execution_id=execution_id,
            from_holder=str(ctx.get("from_holder") or ""),
            to_holder=str(ctx.get("to_holder") or ""),
        )
        self._network_receipt = dict(out)
        return self._record(
            execution_id, "FENCING_NETWORK", {"kind": "network_fence", "client": out}
        )

    def _do_compute(self, execution_id: str, ctx: dict[str, Any]) -> adapters.Receipt:
        if not self.enable_compute or self.compute_client is None:
            detail = {
                "kind": "disabled_skip",
                "skip_documented": self.skip_compute_documented,
                "note": "Compute Fence disabled / skip-documented",
            }
            self._compute_receipt = detail
            return self._record(execution_id, "FENCING_COMPUTE", detail)
        out = self.compute_client.stop_or_isolate(
            execution_id=execution_id,
            from_holder=str(ctx.get("from_holder") or ""),
        )
        self._compute_receipt = dict(out)
        return self._record(
            execution_id, "FENCING_COMPUTE", {"kind": "compute_fence", "client": out}
        )

    def _do_promote(self, execution_id: str, ctx: dict[str, Any]) -> adapters.Receipt:
        if not self.enable_promote or self.promote_client is None:
            return self._record(
                execution_id,
                "PROMOTING",
                {
                    "kind": "disabled_skip",
                    "note": "Promote disabled (HA_FENCE_ENABLE_PROMOTE!=1)",
                    "to_epoch": ctx.get("to_epoch"),
                },
            )
        out = self.promote_client.promote(
            execution_id=execution_id,
            to_holder=str(ctx.get("to_holder") or ""),
            to_epoch=ctx.get("to_epoch"),
        )
        return self._record(execution_id, "PROMOTING", {"kind": "promote", "client": out})

    def _do_cf(self, execution_id: str, ctx: dict[str, Any]) -> adapters.Receipt:
        if not self.enable_cf or self.cf_client is None:
            return self._record(
                execution_id,
                "CF_CUTOVER",
                {
                    "kind": "disabled_skip",
                    "note": "CF cutover disabled (HA_FENCE_ENABLE_CF!=1)",
                    "to_epoch": ctx.get("to_epoch"),
                },
            )
        out = self.cf_client.cutover(
            execution_id=execution_id,
            to_epoch=int(ctx.get("to_epoch") or 0),
            to_holder=str(ctx.get("to_holder") or ""),
            old_origin=self.cf_old_origin or str(ctx.get("from_holder") or ""),
            new_origin=self.cf_new_origin or str(ctx.get("to_holder") or ""),
            lease_epoch=ctx.get("lease_epoch"),
            lease_holder=ctx.get("lease_holder"),
        )
        return self._record(execution_id, "CF_CUTOVER", {"kind": "cf_cutover", "client": out})

    def _do_terminate(self, execution_id: str, ctx: dict[str, Any]) -> adapters.Receipt:
        from_holder = ctx.get("from_holder")
        from_db_role = ctx.get("from_db_role")
        if not from_holder:
            raise RuntimeError("TERMINATING_OLD_SESSIONS requires from_holder")
        t0 = time.monotonic()
        t_scan0 = time.monotonic()
        with self._connect() as conn:
            with conn.cursor() as cur:
                if from_db_role is None:
                    cur.execute(
                        "SELECT holder_db_role FROM public.writer_epoch_guard "
                        "WHERE lock_name='openbot_writer'"
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

    def _do_verify(self, execution_id: str, ctx: dict[str, Any]) -> adapters.Receipt:
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
                        "SELECT holder_db_role FROM public.writer_epoch_guard "
                        "WHERE lock_name='openbot_writer'"
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
        # VERIFY enrichment when network/compute ran
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
            "network_fence_rule_version": self._network_receipt.get("rule_version")
            or (self._network_receipt.get("client") or {}).get("rule_version"),
            "network_fence": self._network_receipt or None,
            "compute_instance_state": self._compute_receipt.get("instance_state")
            or (self._compute_receipt.get("client") or {}).get("instance_state"),
            "compute_fence": self._compute_receipt or None,
        }
        self.last_verify = detail
        if not ok:
            raise RuntimeError(
                f"VERIFY failed: holder_sessions={left} prepared_xacts={prepared}"
            )
        return self._record(execution_id, "VERIFYING", detail)
