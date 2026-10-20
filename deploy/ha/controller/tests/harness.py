#!/usr/bin/env python3
"""
HA V2.1.2 Stage C — Dual Controller lab harness.

Proves:
  DC-01  dual Claim → exactly one winner (INV-ONE)
  DC-02  loser side-effect count = 0
  DC-03  zombie owner_gen cannot CAS-advance state / bump
  DC-04  takeover after owner lease expiry
  DC-05  heartbeat upsert on ha_controller_instance
  DC-06  winner can drive manual path at least through VERIFIED (stubs)
  DC-07  §12.6 recovery scan returns a plan for non-terminal rows

Env: PGHOST/PGPORT/PGDATABASE/PGUSER (superuser) from run-ephemeral.sh
"""
from __future__ import annotations

import os
import sys
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Optional

# controller package on PYTHONPATH
import adapters
import db
from config import ControllerConfig
from runtime import Controller

HOST = os.environ.get("PGHOST", "/tmp")
PORT = int(os.environ.get("PGPORT", "5432"))
DBNAME = os.environ.get("PGDATABASE", "ha_ctl_it")
SU = os.environ.get("PGUSER", "hacs_su")


def dsn_for(user: str) -> str:
    return f"dbname={DBNAME} user={user} host={HOST} port={PORT}"


@dataclass
class Result:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class Suite:
    results: list[Result] = field(default_factory=list)

    def add(self, r: Result) -> None:
        print(f"{'PASS' if r.ok else 'FAIL'}  {r.name}" + (f"  ({r.detail})" if r.detail else ""))
        if not r.ok and r.detail:
            for line in r.detail.strip().splitlines()[:30]:
                print(f"        {line}")
        self.results.append(r)

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if not r.ok)


def cfg(cid: str, domain: str = "lab-a") -> ControllerConfig:
    return ControllerConfig(
        controller_id=cid,
        failure_domain=domain,
        version="stage-c-test",
        database_url=dsn_for("openbot_controller"),
        mode="manual",
        owner_lease_ttl_s=20,
    )


def current_epoch(conn) -> int:
    return int(
        db.q1(
            conn,
            "SELECT current_epoch FROM public.writer_epoch_guard WHERE lock_name='openbot_writer'",
        )
    )


def abort_live(conn, from_epoch: Optional[int] = None) -> None:
    if from_epoch is None:
        db.exec_sql(
            conn,
            """
            UPDATE public.ha_failover_execution
               SET state='ABORTED_CLOSED', updated_at=now()
             WHERE state NOT IN ('DONE','ABORTED_CLOSED','LEASED')
            """,
        )
    else:
        db.exec_sql(
            conn,
            """
            UPDATE public.ha_failover_execution
               SET state='ABORTED_CLOSED', updated_at=now()
             WHERE from_epoch=%s AND state <> 'ABORTED_CLOSED'
            """,
            (from_epoch,),
        )
    conn.commit()


def case_dc_01_02(suite: Suite) -> None:
    """Dual Claim: one winner; loser zero side effects."""
    adapter1 = adapters.RecordingStubAdapter()
    adapter2 = adapters.RecordingStubAdapter()
    c1 = Controller(cfg("controller-1", "az-a"), adapter=adapter1)
    c2 = Controller(cfg("controller-2", "az-b"), adapter=adapter2)

    with db.session(dsn_for(SU)) as su:
        abort_live(su)
        ep = current_epoch(su)
        hid = db.q1(su, "SELECT holder_id FROM public.writer_lease WHERE lock_name='openbot_writer'")
        to_h = "node-b" if hid != "node-b" else "node-a"

    barrier = threading.Barrier(2)
    outcomes: dict[str, object] = {}
    errors: list[str] = []

    def runner(ctl: Controller, key: str) -> None:
        try:
            barrier.wait(10)
            # Claim only first — then winner proceeds a few fence steps; loser stays observing.
            with db.session(ctl.cfg.database_url, appname=key) as conn:
                ctl.heartbeat(conn)
                cr = ctl.claim(conn, observed_epoch=ep, to_holder=to_h)
                outcomes[key + "_claim"] = cr
                if cr.won:
                    # Advance a couple of side-effect steps
                    eid = cr.execution_id
                    gen = cr.owner_gen
                    assert eid
                    for cur, nxt, step in [
                        ("CLAIMED", "FENCING_APP", "FENCING_APP"),
                        ("FENCING_APP", "DRAIN_WAIT", "DRAIN_WAIT"),
                    ]:
                        ctl.side_effect(eid, step, from_holder=hid, to_holder=to_h, owner_gen=gen)
                        rc = ctl.cas_transition(
                            conn,
                            execution_id=eid,
                            owner_gen=gen,
                            current=cur,
                            next_state=nxt,
                            step_name=step,
                        )
                        if rc != 1:
                            raise AssertionError(f"CAS {cur}->{nxt} rc={rc}")
                    outcomes[key + "_won"] = True
                else:
                    # Loser must not perform side effects
                    try:
                        ctl.side_effect("00000000-0000-0000-0000-000000000000", "FENCING_APP")
                        errors.append(f"{key}: loser side_effect did not raise")
                    except RuntimeError:
                        pass
                    outcomes[key + "_won"] = False
        except Exception:
            errors.append(traceback.format_exc())

    t1 = threading.Thread(target=runner, args=(c1, "c1"), daemon=True)
    t2 = threading.Thread(target=runner, args=(c2, "c2"), daemon=True)
    t1.start()
    t2.start()
    t1.join(30)
    t2.join(30)

    if errors:
        suite.add(Result("DC-01", False, "\n".join(errors)))
        suite.add(Result("DC-02", False, "skipped"))
        return

    wins = [k for k in ("c1", "c2") if outcomes.get(k + "_won") is True]
    losses = [k for k in ("c1", "c2") if outcomes.get(k + "_won") is False]

    with db.session(dsn_for(SU)) as su:
        n_live = int(
            db.q1(
                su,
                """
                SELECT count(*) FROM public.ha_failover_execution
                 WHERE from_epoch=%s AND state <> 'ABORTED_CLOSED'
                """,
                (ep,),
            )
        )

    ok_one = n_live == 1 and len(wins) == 1 and len(losses) == 1
    suite.add(
        Result(
            "DC-01",
            ok_one,
            detail=f"live={n_live} wins={wins} losses={losses}",
        )
    )

    loser = losses[0] if losses else None
    loser_count = adapter2.side_effect_count if loser == "c2" else adapter1.side_effect_count
    # Also verify NullAdapter after LOST_CLAIM
    loser_ctl = c2 if loser == "c2" else c1
    ok_zero = loser_count == 0 and loser_ctl.adapter.side_effect_count == 0
    suite.add(
        Result(
            "DC-02",
            ok_zero,
            detail=f"loser={loser} side_effect_count={loser_count} local={loser_ctl.local_state}",
        )
    )


def case_dc_03(suite: Suite) -> None:
    """Zombie owner_gen cannot CAS-advance or bump."""
    with db.session(dsn_for(SU)) as su:
        abort_live(su)
        ep = current_epoch(su)
        hid = db.q1(su, "SELECT holder_id FROM public.writer_lease WHERE lock_name='openbot_writer'")
        to_h = "node-b" if hid != "node-b" else "node-a"
        to_role = "openbot_app_b" if to_h == "node-b" else "openbot_app_a"

    c1 = Controller(cfg("controller-1", "az-a"), adapter=adapters.RecordingStubAdapter())
    with db.session(dsn_for("openbot_controller")) as conn:
        c1.heartbeat(conn)
        cr = c1.claim(conn, observed_epoch=ep, to_holder=to_h)
        if not cr.won:
            suite.add(Result("DC-03", False, "claim lost unexpectedly"))
            return
        eid = cr.execution_id
        assert eid
        real_gen = cr.owner_gen
        # Force state to VERIFIED with real gen
        for cur, nxt, step in [
            ("CLAIMED", "FENCING_APP", "FENCING_APP"),
            ("FENCING_APP", "DRAIN_WAIT", "DRAIN_WAIT"),
            ("DRAIN_WAIT", "FENCING_NETWORK", "FENCING_NETWORK"),
            ("FENCING_NETWORK", "TERMINATING_OLD_SESSIONS", "TERMINATING_OLD_SESSIONS"),
            ("TERMINATING_OLD_SESSIONS", "VERIFYING", "VERIFYING"),
            ("VERIFYING", "VERIFIED", "VERIFYING"),
        ]:
            c1.side_effect(eid, step, from_holder=hid, to_holder=to_h, owner_gen=real_gen)
            rc = c1.cas_transition(
                conn, execution_id=eid, owner_gen=real_gen, current=cur, next_state=nxt, step_name=step
            )
            if rc != 1:
                suite.add(Result("DC-03", False, f"setup CAS failed {cur}->{nxt}"))
                return

        # Zombie CAS with wrong owner_gen
        zombie = Controller(cfg("controller-1", "az-a"), adapter=adapters.RecordingStubAdapter())
        zombie.local_state = "VERIFIED"
        rc = zombie.cas_transition(
            conn,
            execution_id=eid,
            owner_gen=real_gen + 99,
            current="VERIFIED",
            next_state="LEASED",
            step_name="FAKE",
        )
        if rc != 0:
            suite.add(Result("DC-03", False, f"zombie CAS unexpectedly succeeded rc={rc}"))
            return

        # Zombie bump
        try:
            db.exec_sql(conn, "BEGIN")
            db.exec_sql(conn, "SET LOCAL lock_timeout = '5s'")
            db.q(
                conn,
                "SELECT public.openbot_ha_bump_epoch(%s::uuid, %s, %s, %s, %s::name)",
                (eid, real_gen + 99, ep, to_h, to_role),
            )
            conn.commit()
            suite.add(Result("DC-03", False, "zombie bump succeeded"))
            return
        except Exception as e:
            conn.rollback()
            st = db.sqlstate_of(e)
            if st != "OB010":
                suite.add(Result("DC-03", False, f"zombie bump want OB010 got {st}: {e}"))
                return

    suite.add(Result("DC-03", True, detail=f"CAS rc=0; bump OB010; eid={eid}"))


def case_dc_04(suite: Suite) -> None:
    """Takeover after owner_lease_until expiry."""
    with db.session(dsn_for(SU)) as su:
        abort_live(su)
        ep = current_epoch(su)
        hid = db.q1(su, "SELECT holder_id FROM public.writer_lease WHERE lock_name='openbot_writer'")
        to_h = "node-b" if hid != "node-b" else "node-a"

    c1 = Controller(cfg("controller-1", "az-a"), adapter=adapters.RecordingStubAdapter())
    c2 = Controller(cfg("controller-2", "az-b"), adapter=adapters.RecordingStubAdapter())

    with db.session(dsn_for("openbot_controller")) as conn:
        cr = c1.claim(conn, observed_epoch=ep, to_holder=to_h)
        if not cr.won:
            suite.add(Result("DC-04", False, "c1 claim lost"))
            return
        eid = cr.execution_id
        assert eid
        old_gen = cr.owner_gen
        # Expire owner lease so another controller may take over (§12.4.3).
        # Note: the still-living owner could renew even after expiry if nobody
        # has taken over yet; TAKEN_OVER is detected when renew rowcount=0
        # after ownership (owner_gen / controller_id) has changed.
        db.exec_sql(
            conn,
            """
            UPDATE public.ha_failover_execution
               SET owner_lease_until = now() - interval '1 second', updated_at=now()
             WHERE execution_id=%s::uuid
            """,
            (eid,),
        )
        conn.commit()

        new_gen = c2.takeover(conn, eid)
        if new_gen is None or new_gen != old_gen + 1:
            suite.add(Result("DC-04", False, f"takeover gen={new_gen} want {old_gen+1}"))
            return

        # Zombie (old gen) renew → TAKEN_OVER
        rr2 = c1.renew(conn, eid, old_gen)
        if not rr2.taken_over:
            suite.add(Result("DC-04", False, f"zombie renew after takeover should fail; rr={rr2}"))
            return

        # New owner can renew
        rr3 = c2.renew(conn, eid, new_gen)
        if not rr3.ok:
            suite.add(Result("DC-04", False, f"new owner renew failed; rr={rr3}"))
            return

        # Second takeover while lease still fresh must fail
        again = c1.takeover(conn, eid)
        if again is not None:
            suite.add(Result("DC-04", False, f"takeover while lease fresh returned gen={again}"))
            return

    suite.add(
        Result("DC-04", True, detail=f"eid={eid} gen {old_gen}->{new_gen}; zombie renew blocked")
    )


def case_dc_05(suite: Suite) -> None:
    """Heartbeat upsert."""
    c1 = Controller(cfg("controller-1", "az-a"))
    c1.heartbeat()
    time.sleep(0.05)
    c1.cfg  # noqa
    # Second heartbeat updates timestamp / domain
    c1b = Controller(
        ControllerConfig(
            controller_id="controller-1",
            failure_domain="az-a-updated",
            version="stage-c-test-2",
            database_url=dsn_for("openbot_controller"),
            mode="manual",
        )
    )
    c1b.heartbeat()
    with db.session(dsn_for(SU)) as su:
        row = db.q(
            su,
            "SELECT * FROM public.ha_controller_instance WHERE controller_id='controller-1'",
        )[0]
    ok = (
        row["failure_domain"] == "az-a-updated"
        and row["version"] == "stage-c-test-2"
        and row["last_heartbeat"] is not None
    )
    suite.add(Result("DC-05", ok, detail=f"domain={row['failure_domain']} ver={row['version']}"))


def case_dc_06(suite: Suite) -> None:
    """Winner drives manual path through DONE with stubs (skip compute)."""
    with db.session(dsn_for(SU)) as su:
        abort_live(su)
        ep = current_epoch(su)
        hid = db.q1(su, "SELECT holder_id FROM public.writer_lease WHERE lock_name='openbot_writer'")
        # Choose opposite holder/role
        if hid == "bootstrap":
            to_h, to_role = "node-a", "openbot_app_a"
        else:
            to_h = "node-b" if hid != "node-b" else "node-a"
            to_role = "openbot_app_b" if to_h.endswith("b") else "openbot_app_a"

    ctl = Controller(cfg("controller-1", "az-a"), adapter=adapters.RecordingStubAdapter())
    result = ctl.run_manual_failover(
        to_holder=to_h,
        to_db_role=to_role,
        observed_epoch=ep,
        skip_compute=True,
    )
    ok = result.outcome == "DONE" and result.side_effect_count > 0
    suite.add(
        Result(
            "DC-06",
            ok,
            detail=f"outcome={result.outcome} effects={result.side_effect_count} steps={result.steps} {result.detail}",
        )
    )


def case_dc_07(suite: Suite) -> None:
    """Recovery scan yields resume_fence for pre-VERIFIED row."""
    with db.session(dsn_for(SU)) as su:
        abort_live(su)
        ep = current_epoch(su)
        hid = db.q1(su, "SELECT holder_id FROM public.writer_lease WHERE lock_name='openbot_writer'")
        to_h = "node-b" if hid != "node-b" else "node-a"

    ctl = Controller(cfg("controller-2", "az-b"), adapter=adapters.RecordingStubAdapter())
    with db.session(dsn_for("openbot_controller")) as conn:
        cr = ctl.claim(conn, observed_epoch=ep, to_holder=to_h)
        if not cr.won:
            suite.add(Result("DC-07", False, "claim lost"))
            return
        plans = ctl.recover_scan(conn)
    match = [p for p in plans if p.execution_id == cr.execution_id]
    ok = len(match) == 1 and match[0].action == "resume_fence"
    suite.add(
        Result(
            "DC-07",
            ok,
            detail=f"plans={[ (p.execution_id[:8], p.action, p.state) for p in plans ]}",
        )
    )


def main() -> int:
    print(f"== HA Dual Controller Stage C on {HOST}:{PORT}/{DBNAME} ==")
    with db.session(dsn_for(SU)) as su:
        ver = db.q1(su, "SHOW server_version")
        print(f"   server={ver}")

    suite = Suite()
    for name, fn in [
        ("DC-01/02", case_dc_01_02),
        ("DC-03", case_dc_03),
        ("DC-04", case_dc_04),
        ("DC-05", case_dc_05),
        ("DC-06", case_dc_06),
        ("DC-07", case_dc_07),
    ]:
        try:
            fn(suite)
        except Exception:
            suite.add(Result(name, False, traceback.format_exc()))

    print(f"-- {suite.failed} failed / {len(suite.results)} total "
          f"({sum(1 for r in suite.results if r.ok)} passed)")
    return 1 if suite.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
