"""Dual Controller runtime: claim → CAS steps → renew / takeover (§12)."""
from __future__ import annotations

import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

import psycopg
from psycopg.types.json import Json

import adapters
import claim as claim_mod
import db
import lease
import recovery
from config import ControllerConfig
from states import HAPPY_PATH, PRE_VERIFIED

log = logging.getLogger("ha.controller")


@dataclass
class RunResult:
    outcome: str  # WON | LOST_CLAIM | TAKEN_OVER | DONE | ABORTED | ERROR
    execution_id: Optional[str] = None
    owner_gen: int = 0
    local_state: str = "IDLE"
    side_effect_count: int = 0
    steps: list[str] = field(default_factory=list)
    detail: str = ""


class Controller:
    def __init__(
        self,
        cfg: ControllerConfig,
        adapter: Optional[adapters.SideEffectAdapter] = None,
        *,
        allow_side_effects: bool = True,
        adapter_factory: Optional[Any] = None,
    ) -> None:
        self.cfg = cfg
        # Prefer factory so takeover / retry can rebuild LabFenceAdapter (not only stubs).
        self._adapter_factory = adapter_factory or (lambda: adapters.RecordingStubAdapter())
        self.adapter: adapters.SideEffectAdapter = adapter or self._adapter_factory()
        self.allow_side_effects = allow_side_effects
        self.local_state = "IDLE"
        self._observing = False

    def _dsn(self) -> str:
        return self.cfg.database_url

    def heartbeat(self, conn: Optional[psycopg.Connection] = None) -> None:
        own = conn is None
        c = conn or db.connect(self._dsn(), appname=f"hb-{self.cfg.controller_id}")
        try:
            lease.heartbeat(
                c,
                controller_id=self.cfg.controller_id,
                failure_domain=self.cfg.failure_domain,
                version=self.cfg.version,
            )
        finally:
            if own:
                c.close()

    def observe_epoch(self, conn: psycopg.Connection) -> tuple[int, str]:
        ep = int(
            db.q1(
                conn,
                "SELECT current_epoch FROM public.writer_epoch_guard WHERE lock_name=%s",
                (self.cfg.lock_name,),
            )
        )
        hid = db.q1(
            conn,
            "SELECT holder_id FROM public.writer_lease WHERE lock_name=%s",
            (self.cfg.lock_name,),
        )
        return ep, str(hid)

    def claim(
        self,
        conn: psycopg.Connection,
        *,
        observed_epoch: int,
        to_holder: str,
        execution_id: Optional[str] = None,
    ) -> claim_mod.ClaimResult:
        self.local_state = "CLAIMING"
        result = claim_mod.claim(
            conn,
            controller_id=self.cfg.controller_id,
            observed_epoch=observed_epoch,
            to_holder=to_holder,
            mode=self.cfg.mode,
            lock_name=self.cfg.lock_name,
            ttl_s=self.cfg.owner_lease_ttl_s,
            execution_id=execution_id,
        )
        if not result.won:
            self.local_state = "LOST_CLAIM"
            self._enter_observing()
        else:
            self.local_state = "CLAIMED"
        return result

    def _enter_observing(self) -> None:
        self._observing = True
        self.allow_side_effects = False
        self.local_state = "OBSERVING"
        # Swap to NullAdapter so any accidental call raises rather than acting.
        if not isinstance(self.adapter, adapters.NullAdapter):
            self.adapter = adapters.NullAdapter()

    def renew(self, conn: psycopg.Connection, execution_id: str, owner_gen: int) -> lease.RenewResult:
        r = lease.renew_owner_lease(
            conn,
            execution_id=execution_id,
            controller_id=self.cfg.controller_id,
            owner_gen=owner_gen,
            ttl_s=self.cfg.owner_lease_ttl_s,
        )
        if r.taken_over:
            self.local_state = "TAKEN_OVER"
            self.allow_side_effects = False
            self.adapter = adapters.NullAdapter()
        return r

    def cas_transition(
        self,
        conn: psycopg.Connection,
        *,
        execution_id: str,
        owner_gen: int,
        current: str,
        next_state: str,
        step_name: str,
        extra: Optional[dict] = None,
    ) -> int:
        if not self.allow_side_effects and next_state not in ("OBSERVING", "DONE"):
            raise RuntimeError(
                f"refusing transition {current}->{next_state}: side effects disabled "
                f"(local_state={self.local_state})"
            )
        step = {
            "step": step_name,
            "from": current,
            "to": next_state,
            "controller_id": self.cfg.controller_id,
            "owner_gen": owner_gen,
            "failure_domain": self.cfg.failure_domain,
            "at": time.time(),
            **(extra or {}),
        }
        rc = lease.transition(
            conn,
            execution_id=execution_id,
            owner_gen=owner_gen,
            current=current,
            next_state=next_state,
            step=step,
        )
        if rc == 0:
            # owner_gen mismatch or state raced → treat as loss of ownership
            self.local_state = "TAKEN_OVER"
            self.allow_side_effects = False
            self.adapter = adapters.NullAdapter()
        else:
            self.local_state = next_state
        return rc

    def side_effect(self, execution_id: str, step: str, **ctx: Any) -> adapters.Receipt:
        if not self.allow_side_effects or self._observing or self.local_state in (
            "LOST_CLAIM",
            "OBSERVING",
            "TAKEN_OVER",
        ):
            raise RuntimeError(
                f"zero side effects: local_state={self.local_state} step={step}"
            )
        return self.adapter.run(execution_id, step, **ctx)

    def bump_epoch(
        self,
        conn: psycopg.Connection,
        *,
        execution_id: str,
        owner_gen: int,
        from_epoch: int,
        to_holder: str,
        to_db_role: str,
    ) -> int:
        if not self.allow_side_effects:
            raise RuntimeError("bump refused: side effects disabled")
        db.exec_sql(conn, "BEGIN")
        db.exec_sql(conn, "SET LOCAL lock_timeout = '5s'")
        db.exec_sql(conn, "SET LOCAL statement_timeout = '10s'")
        rows = db.q(
            conn,
            "SELECT public.openbot_ha_bump_epoch(%s::uuid, %s, %s, %s, %s::name) AS e",
            (execution_id, owner_gen, from_epoch, to_holder, to_db_role),
        )
        conn.commit()
        self.local_state = "LEASED"
        return int(rows[0]["e"])

    def takeover(self, conn: psycopg.Connection, execution_id: str) -> Optional[int]:
        gen = lease.takeover(
            conn,
            execution_id=execution_id,
            controller_id=self.cfg.controller_id,
            ttl_s=self.cfg.owner_lease_ttl_s,
        )
        if gen is not None:
            self.local_state = "RETRYING"
            self.allow_side_effects = True
            self._observing = False
            if isinstance(self.adapter, adapters.NullAdapter):
                self.adapter = self._adapter_factory()
        return gen

    def recover_scan(self, conn: psycopg.Connection) -> list[recovery.RecoveryPlan]:
        return recovery.scan_recoverable(conn, self.cfg.lock_name)

    def run_manual_failover(
        self,
        *,
        to_holder: str,
        to_db_role: str,
        observed_epoch: Optional[int] = None,
        execution_id: Optional[str] = None,
        skip_compute: bool = False,
        stop_after: Optional[str] = None,
    ) -> RunResult:
        """Drive one manual failover attempt (default mode). Auto FO not used."""
        if self.cfg.mode != "manual":
            return RunResult(
                outcome="ERROR",
                detail="Production Auto Failover NOT APPROVED; refuse mode=auto",
            )

        steps_done: list[str] = []
        with db.session(self._dsn(), appname=f"ctl-{self.cfg.controller_id}") as conn:
            self.heartbeat(conn)
            plans = self.recover_scan(conn)
            if plans:
                log.info("recovery plans on start: %s", [p.action for p in plans])

            ep, from_holder = self.observe_epoch(conn)
            if observed_epoch is None:
                observed_epoch = ep
            elif observed_epoch != ep:
                # epoch already moved — Claim will lose; still attempt for LOST_CLAIM path
                pass

            cr = self.claim(
                conn,
                observed_epoch=observed_epoch,
                to_holder=to_holder,
                execution_id=execution_id,
            )
            if not cr.won:
                return RunResult(
                    outcome="LOST_CLAIM",
                    local_state=self.local_state,
                    side_effect_count=self.adapter.side_effect_count,
                    detail="INV-ONE / epoch mismatch → OBSERVING, zero side effects",
                )

            eid = cr.execution_id
            assert eid is not None
            gen = cr.owner_gen
            from_epoch = int(cr.from_epoch)  # type: ignore[arg-type]
            assert cr.from_holder is not None
            from_holder = cr.from_holder
            from_db_role = db.q1(
                conn,
                "SELECT holder_db_role FROM public.writer_epoch_guard WHERE lock_name=%s",
                (self.cfg.lock_name,),
            )
            steps_done.append("CLAIMED")

            path = [
                ("CLAIMED", "FENCING_APP", "FENCING_APP"),
                ("FENCING_APP", "DRAIN_WAIT", "DRAIN_WAIT"),
                ("DRAIN_WAIT", "FENCING_NETWORK", "FENCING_NETWORK"),
            ]
            if not skip_compute:
                path.append(("FENCING_NETWORK", "FENCING_COMPUTE", "FENCING_COMPUTE"))
                path.append(("FENCING_COMPUTE", "TERMINATING_OLD_SESSIONS", "TERMINATING_OLD_SESSIONS"))
            else:
                path.append(("FENCING_NETWORK", "TERMINATING_OLD_SESSIONS", "TERMINATING_OLD_SESSIONS"))
            path.extend(
                [
                    ("TERMINATING_OLD_SESSIONS", "VERIFYING", "VERIFYING"),
                    ("VERIFYING", "VERIFIED", "VERIFYING"),
                ]
            )

            current = "CLAIMED"
            for cur, nxt, effect_step in path:
                rr = self.renew(conn, eid, gen)
                if rr.taken_over:
                    return RunResult(
                        outcome="TAKEN_OVER",
                        execution_id=eid,
                        owner_gen=gen,
                        local_state="TAKEN_OVER",
                        side_effect_count=self.adapter.side_effect_count,
                        steps=steps_done,
                    )
                # Side effect BEFORE CAS only when still owner; re-check via renew already done.
                try:
                    receipt = self.side_effect(
                        eid,
                        effect_step,
                        from_holder=from_holder,
                        to_holder=to_holder,
                        owner_gen=gen,
                        from_db_role=from_db_role,
                        to_db_role=to_db_role,
                    )
                except RuntimeError as e:
                    return RunResult(
                        outcome="ERROR",
                        execution_id=eid,
                        owner_gen=gen,
                        local_state=self.local_state,
                        side_effect_count=self.adapter.side_effect_count,
                        steps=steps_done,
                        detail=str(e),
                    )
                rc = self.cas_transition(
                    conn,
                    execution_id=eid,
                    owner_gen=gen,
                    current=cur,
                    next_state=nxt,
                    step_name=effect_step,
                    extra={"receipt": receipt.detail},
                )
                if rc == 0:
                    return RunResult(
                        outcome="TAKEN_OVER",
                        execution_id=eid,
                        owner_gen=gen,
                        local_state="TAKEN_OVER",
                        side_effect_count=self.adapter.side_effect_count,
                        steps=steps_done,
                        detail="CAS transition rowcount=0",
                    )
                steps_done.append(nxt)
                current = nxt
                if stop_after and current == stop_after:
                    return RunResult(
                        outcome="WON",
                        execution_id=eid,
                        owner_gen=gen,
                        local_state=current,
                        side_effect_count=self.adapter.side_effect_count,
                        steps=steps_done,
                        detail=f"stopped after {stop_after}",
                    )

            # EPOCH_BUMP
            rr = self.renew(conn, eid, gen)
            if rr.taken_over:
                return RunResult(
                    outcome="TAKEN_OVER",
                    execution_id=eid,
                    owner_gen=gen,
                    local_state="TAKEN_OVER",
                    side_effect_count=self.adapter.side_effect_count,
                    steps=steps_done,
                )
            try:
                new_ep = self.bump_epoch(
                    conn,
                    execution_id=eid,
                    owner_gen=gen,
                    from_epoch=from_epoch,
                    to_holder=to_holder,
                    to_db_role=to_db_role,
                )
            except Exception as e:
                return RunResult(
                    outcome="ABORTED",
                    execution_id=eid,
                    owner_gen=gen,
                    local_state=self.local_state,
                    side_effect_count=self.adapter.side_effect_count,
                    steps=steps_done,
                    detail=f"bump failed: {e}",
                )
            steps_done.append("LEASED")
            # bump already set state=LEASED

            for cur, nxt, effect_step in [
                ("LEASED", "PROMOTING", "PROMOTING"),
                ("PROMOTING", "CF_CUTOVER", "CF_CUTOVER"),
                ("CF_CUTOVER", "OBSERVING", "CF_CUTOVER"),
                ("OBSERVING", "DONE", "DONE"),
            ]:
                rr = self.renew(conn, eid, gen)
                if rr.taken_over:
                    return RunResult(
                        outcome="TAKEN_OVER",
                        execution_id=eid,
                        owner_gen=gen,
                        local_state="TAKEN_OVER",
                        side_effect_count=self.adapter.side_effect_count,
                        steps=steps_done,
                    )
                if effect_step in adapters.RecordingStubAdapter.SIDE_EFFECT_STEPS:
                    self.side_effect(
                        eid,
                        effect_step,
                        from_holder=from_holder,
                        to_holder=to_holder,
                        owner_gen=gen,
                        from_db_role=from_db_role,
                        to_db_role=to_db_role,
                        to_epoch=new_ep,
                    )
                rc = self.cas_transition(
                    conn,
                    execution_id=eid,
                    owner_gen=gen,
                    current=cur,
                    next_state=nxt,
                    step_name=effect_step if effect_step != "DONE" else "FINISH",
                    extra={"to_epoch": new_ep},
                )
                if rc == 0:
                    return RunResult(
                        outcome="TAKEN_OVER",
                        execution_id=eid,
                        owner_gen=gen,
                        local_state="TAKEN_OVER",
                        side_effect_count=self.adapter.side_effect_count,
                        steps=steps_done,
                    )
                steps_done.append(nxt)

            self.local_state = "DONE"
            return RunResult(
                outcome="DONE",
                execution_id=eid,
                owner_gen=gen,
                local_state="DONE",
                side_effect_count=self.adapter.side_effect_count,
                steps=steps_done,
                detail=f"epoch {from_epoch}->{new_ep}",
            )

    def resume_failover(
        self,
        *,
        execution_id: str,
        owner_gen: int,
        to_holder: str,
        to_db_role: str,
        from_holder: str,
        from_epoch: int,
        from_db_role: Optional[str] = None,
        start_state: str,
        skip_compute: bool = False,
    ) -> RunResult:
        """Continue a claimed execution from ``start_state`` through DONE (lab resume / takeover)."""
        if self.cfg.mode != "manual":
            return RunResult(
                outcome="ERROR",
                detail="Production Auto Failover NOT APPROVED; refuse mode=auto",
            )
        self.allow_side_effects = True
        self._observing = False
        if isinstance(self.adapter, adapters.NullAdapter):
            self.adapter = self._adapter_factory()
        self.local_state = start_state
        steps_done: list[str] = [start_state]
        eid = execution_id
        gen = owner_gen

        # Build remaining happy-path segments after start_state.
        path: list[tuple[str, str, str]] = []
        full = [
            ("CLAIMED", "FENCING_APP", "FENCING_APP"),
            ("FENCING_APP", "DRAIN_WAIT", "DRAIN_WAIT"),
            ("DRAIN_WAIT", "FENCING_NETWORK", "FENCING_NETWORK"),
        ]
        if not skip_compute:
            full.append(("FENCING_NETWORK", "FENCING_COMPUTE", "FENCING_COMPUTE"))
            full.append(("FENCING_COMPUTE", "TERMINATING_OLD_SESSIONS", "TERMINATING_OLD_SESSIONS"))
        else:
            full.append(("FENCING_NETWORK", "TERMINATING_OLD_SESSIONS", "TERMINATING_OLD_SESSIONS"))
        full.extend(
            [
                ("TERMINATING_OLD_SESSIONS", "VERIFYING", "VERIFYING"),
                ("VERIFYING", "VERIFIED", "VERIFYING"),
            ]
        )
        seen_start = start_state == "CLAIMED"
        for cur, nxt, effect_step in full:
            if not seen_start:
                if cur == start_state:
                    seen_start = True
                else:
                    continue
            path.append((cur, nxt, effect_step))

        with db.session(self._dsn(), appname=f"ctl-resume-{self.cfg.controller_id}") as conn:
            self.heartbeat(conn)
            if from_db_role is None:
                from_db_role = db.q1(
                    conn,
                    "SELECT holder_db_role FROM public.writer_epoch_guard WHERE lock_name=%s",
                    (self.cfg.lock_name,),
                )

            current = start_state
            if path:
                for cur, nxt, effect_step in path:
                    rr = self.renew(conn, eid, gen)
                    if rr.taken_over:
                        return RunResult(
                            outcome="TAKEN_OVER",
                            execution_id=eid,
                            owner_gen=gen,
                            local_state="TAKEN_OVER",
                            side_effect_count=self.adapter.side_effect_count,
                            steps=steps_done,
                        )
                    try:
                        receipt = self.side_effect(
                            eid,
                            effect_step,
                            from_holder=from_holder,
                            to_holder=to_holder,
                            owner_gen=gen,
                            from_db_role=from_db_role,
                            to_db_role=to_db_role,
                        )
                    except RuntimeError as e:
                        return RunResult(
                            outcome="ERROR",
                            execution_id=eid,
                            owner_gen=gen,
                            local_state=self.local_state,
                            side_effect_count=self.adapter.side_effect_count,
                            steps=steps_done,
                            detail=str(e),
                        )
                    rc = self.cas_transition(
                        conn,
                        execution_id=eid,
                        owner_gen=gen,
                        current=cur,
                        next_state=nxt,
                        step_name=effect_step,
                        extra={"receipt": receipt.detail},
                    )
                    if rc == 0:
                        return RunResult(
                            outcome="TAKEN_OVER",
                            execution_id=eid,
                            owner_gen=gen,
                            local_state="TAKEN_OVER",
                            side_effect_count=self.adapter.side_effect_count,
                            steps=steps_done,
                            detail="CAS transition rowcount=0",
                        )
                    steps_done.append(nxt)
                    current = nxt

            if current == "VERIFIED":
                rr = self.renew(conn, eid, gen)
                if rr.taken_over:
                    return RunResult(
                        outcome="TAKEN_OVER",
                        execution_id=eid,
                        owner_gen=gen,
                        local_state="TAKEN_OVER",
                        side_effect_count=self.adapter.side_effect_count,
                        steps=steps_done,
                    )
                try:
                    new_ep = self.bump_epoch(
                        conn,
                        execution_id=eid,
                        owner_gen=gen,
                        from_epoch=from_epoch,
                        to_holder=to_holder,
                        to_db_role=to_db_role,
                    )
                except Exception as e:
                    return RunResult(
                        outcome="ABORTED",
                        execution_id=eid,
                        owner_gen=gen,
                        local_state=self.local_state,
                        side_effect_count=self.adapter.side_effect_count,
                        steps=steps_done,
                        detail=f"bump failed: {e}",
                    )
                steps_done.append("LEASED")
                current = "LEASED"
            else:
                # Already past bump (LEASED / PROMOTING / …)
                ep_now = db.q1(
                    conn,
                    "SELECT current_epoch FROM public.writer_epoch_guard WHERE lock_name=%s",
                    (self.cfg.lock_name,),
                )
                new_ep = int(ep_now)

            if current in ("LEASED", "PROMOTING", "CF_CUTOVER", "OBSERVING"):
                post = [
                    ("LEASED", "PROMOTING", "PROMOTING"),
                    ("PROMOTING", "CF_CUTOVER", "CF_CUTOVER"),
                    ("CF_CUTOVER", "OBSERVING", "CF_CUTOVER"),
                    ("OBSERVING", "DONE", "DONE"),
                ]
                seen = False
                for cur, nxt, effect_step in post:
                    if not seen:
                        if cur == current:
                            seen = True
                        else:
                            continue
                    rr = self.renew(conn, eid, gen)
                    if rr.taken_over:
                        return RunResult(
                            outcome="TAKEN_OVER",
                            execution_id=eid,
                            owner_gen=gen,
                            local_state="TAKEN_OVER",
                            side_effect_count=self.adapter.side_effect_count,
                            steps=steps_done,
                        )
                    if effect_step in adapters.RecordingStubAdapter.SIDE_EFFECT_STEPS:
                        self.side_effect(
                            eid,
                            effect_step,
                            from_holder=from_holder,
                            to_holder=to_holder,
                            owner_gen=gen,
                            from_db_role=from_db_role,
                            to_db_role=to_db_role,
                            to_epoch=new_ep,
                        )
                    rc = self.cas_transition(
                        conn,
                        execution_id=eid,
                        owner_gen=gen,
                        current=cur,
                        next_state=nxt,
                        step_name=effect_step if effect_step != "DONE" else "FINISH",
                        extra={"to_epoch": new_ep},
                    )
                    if rc == 0:
                        return RunResult(
                            outcome="TAKEN_OVER",
                            execution_id=eid,
                            owner_gen=gen,
                            local_state="TAKEN_OVER",
                            side_effect_count=self.adapter.side_effect_count,
                            steps=steps_done,
                        )
                    steps_done.append(nxt)

            self.local_state = "DONE"
            return RunResult(
                outcome="DONE",
                execution_id=eid,
                owner_gen=gen,
                local_state="DONE",
                side_effect_count=self.adapter.side_effect_count,
                steps=steps_done,
                detail=f"resumed from {start_state}; epoch->{new_ep}",
            )
