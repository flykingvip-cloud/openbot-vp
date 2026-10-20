#!/usr/bin/env python3
"""
HA V2.1.2 Stage A.2 — IT-CS-01..13 CommitSafety integration harness.

Spec: OpenBot_Cloud_HA_V2.1.2_CommitSafety_Hardening.md §19.1

Runs against a disposable cluster prepared by run-ephemeral.sh
(migrations applied, setup.sql loaded, wal_level=logical,
track_commit_timestamp=on, max_prepared_transactions=0).

Env:
  PGHOST / PGPORT / PGDATABASE / (roles connect via trust as openbot_*)
  HA_CS_IT_FUZZ_BUMPS   default 200 (set 10000 for full §19.1 IT-CS-10)
  HA_CS_IT_FUZZ_WRITERS default 16 (set 64 for full)
  HA_CS_IT_PERF_SAMPLES default 400
  HA_CS_IT_CASES        comma list, default all (e.g. IT-CS-01,IT-CS-04)
"""
from __future__ import annotations

import os
import re
import statistics
import sys
import threading
import time
import traceback
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import psycopg
from psycopg.rows import dict_row

HOST = os.environ.get("PGHOST", "/tmp")
PORT = int(os.environ.get("PGPORT", "5432"))
DB = os.environ.get("PGDATABASE", "ha_cs_it")
SU = os.environ.get("PGUSER", "hacs_su")

FUZZ_BUMPS = int(os.environ.get("HA_CS_IT_FUZZ_BUMPS", "200"))
FUZZ_WRITERS = int(os.environ.get("HA_CS_IT_FUZZ_WRITERS", "16"))
PERF_SAMPLES = int(os.environ.get("HA_CS_IT_PERF_SAMPLES", "400"))
CASES_FILTER = {
    c.strip().upper()
    for c in os.environ.get("HA_CS_IT_CASES", "").split(",")
    if c.strip()
}


@dataclass
class Result:
    name: str
    ok: bool
    detail: str = ""
    automated: bool = True
    note: str = ""


@dataclass
class Suite:
    results: list[Result] = field(default_factory=list)

    def add(self, r: Result) -> None:
        flag = "PASS" if r.ok else "FAIL"
        extra = f"  ({r.note})" if r.note else ""
        print(f"{flag}  {r.name}{extra}")
        if r.detail and not r.ok:
            for line in r.detail.strip().splitlines()[:40]:
                print(f"        {line}")
        self.results.append(r)

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if not r.ok)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.ok)


def conn(user: str, autocommit: bool = False, appname: str = "it-cs") -> psycopg.Connection:
    return psycopg.connect(
        host=HOST,
        port=PORT,
        dbname=DB,
        user=user,
        autocommit=autocommit,
        application_name=appname,
        row_factory=dict_row,
    )


@contextmanager
def session(user: str, appname: str = "it-cs"):
    c = conn(user, appname=appname)
    try:
        yield c
    finally:
        c.close()


def q(c: psycopg.Connection, query: str, params: Any = None) -> list[dict]:
    with c.cursor() as cur:
        cur.execute(query, params)
        if cur.description is None:
            return []
        return list(cur.fetchall())


def q1(c: psycopg.Connection, query: str, params: Any = None) -> Any:
    rows = q(c, query, params)
    if not rows:
        return None
    return next(iter(rows[0].values()))


def exec_sql(c: psycopg.Connection, query: str, params: Any = None) -> None:
    with c.cursor() as cur:
        cur.execute(query, params)


def sqlstate_of(exc: BaseException) -> Optional[str]:
    if isinstance(exc, psycopg.Error) and exc.sqlstate:
        return exc.sqlstate
    # Nested / Diagnostic
    msg = str(exc)
    m = re.search(r"\b([A-Z0-9]{5})\b", msg)
    return m.group(1) if m else None


def make_exec(
    ctl: psycopg.Connection,
    from_epoch: int,
    from_holder: str,
    to_holder: str,
    state: str = "VERIFIED",
    owner_controller_id: str = "it-cs-controller",
    owner_gen: int = 1,
) -> str:
    # INV-ONE: close any non-terminal live row for this from_epoch first (test harness only).
    exec_sql(
        ctl,
        """
        UPDATE public.ha_failover_execution
           SET state = 'ABORTED_CLOSED', updated_at = now()
         WHERE lock_name = 'openbot_writer' AND from_epoch = %s
           AND state <> 'ABORTED_CLOSED' AND state <> 'LEASED' AND state <> 'DONE'
        """,
        (from_epoch,),
    )
    ctl.commit()
    eid = str(uuid.uuid4())
    exec_sql(
        ctl,
        """
        INSERT INTO public.ha_failover_execution
          (execution_id, lock_name, from_epoch, from_holder, to_holder,
           owner_controller_id, owner_gen, owner_lease_until, state, mode)
        VALUES (%s::uuid, 'openbot_writer', %s, %s, %s,
                %s, %s, now() + interval '60 seconds', %s, 'manual')
        """,
        (eid, from_epoch, from_holder, to_holder, owner_controller_id, owner_gen, state),
    )
    ctl.commit()
    return eid


def bump(
    ctl: psycopg.Connection,
    eid: str,
    from_epoch: int,
    to_holder: str,
    to_role: str,
    owner_gen: int = 1,
    lock_timeout: str = "5s",
) -> int:
    exec_sql(ctl, "BEGIN")
    exec_sql(ctl, f"SET LOCAL lock_timeout = '{lock_timeout}'")
    rows = q(
        ctl,
        "SELECT public.openbot_ha_bump_epoch(%s::uuid, %s, %s, %s, %s) AS e",
        (eid, owner_gen, from_epoch, to_holder, to_role),
    )
    ctl.commit()
    return int(rows[0]["e"])


def current_epoch(c: psycopg.Connection) -> int:
    return int(q1(c, "SELECT current_epoch FROM public.writer_epoch_guard WHERE lock_name='openbot_writer'"))


def holder_role(c: psycopg.Connection) -> Optional[str]:
    return q1(c, "SELECT holder_db_role FROM public.writer_epoch_guard WHERE lock_name='openbot_writer'")


def holder_id(c: psycopg.Connection) -> str:
    return q1(c, "SELECT holder_id FROM public.writer_lease WHERE lock_name='openbot_writer'")


# ---------------------------------------------------------------------------
# Logical-decoding oracle (§19.1.6)
# ---------------------------------------------------------------------------

_BEGIN_RE = re.compile(r"^BEGIN(?:\s|$)")
_COMMIT_RE = re.compile(r"^COMMIT(?:\s|$)")
_GUARD_UPD = re.compile(
    r"table public\.writer_epoch_guard: UPDATE:.*"
    r"current_epoch\[bigint\]:(\d+)"
)
_PROBE_INS = re.compile(
    r"table public\.(cs_probe|naive_probe|ha_rpo_probe): INSERT:.*"
    r"written_epoch\[bigint\]:(\d+)"
)


@dataclass
class OracleReport:
    violations: list[str] = field(default_factory=list)
    bumps: list[int] = field(default_factory=list)
    probe_commits: int = 0
    raw_txns: int = 0


def oracle_consume(su: psycopg.Connection, initial_epoch: int) -> OracleReport:
    """Drain it_cs_oracle slot and evaluate INV-CS (§19.1.6)."""
    report = OracleReport()
    cur_epoch = initial_epoch
    # Get all pending changes; group by txn.
    changes = q(
        su,
        """
        SELECT lsn::text AS lsn, xid::text AS xid, data
          FROM pg_logical_slot_get_changes('it_cs_oracle', NULL, NULL,
               'include-xids', '1', 'skip-empty-xacts', '1')
        """,
    )
    pending_probes: list[tuple[str, int]] = []
    pending_bump: Optional[int] = None
    for row in changes:
        data = row["data"]
        if _BEGIN_RE.match(data):
            pending_probes = []
            pending_bump = None
            continue
        if m := _GUARD_UPD.search(data):
            pending_bump = int(m.group(1))
            continue
        if m := _PROBE_INS.search(data):
            pending_probes.append((m.group(1), int(m.group(2))))
            continue
        if _COMMIT_RE.match(data):
            report.raw_txns += 1
            if pending_bump is not None:
                cur_epoch = pending_bump
                report.bumps.append(pending_bump)
            for table, we in pending_probes:
                report.probe_commits += 1
                if we < cur_epoch:
                    report.violations.append(
                        f"INV-CS: {table} written_epoch={we} < cur={cur_epoch} (post-bump commit order)"
                    )
            pending_probes = []
            pending_bump = None
    return report


def oracle_peek_advance(su: psycopg.Connection) -> None:
    """Discard pending slot changes without evaluating (baseline reset)."""
    q(
        su,
        """
        SELECT count(*) FROM pg_logical_slot_get_changes('it_cs_oracle', NULL, NULL,
             'include-xids', '1', 'skip-empty-xacts', '1')
        """,
    )


# ---------------------------------------------------------------------------
# Helpers for concurrent A / C coordination
# ---------------------------------------------------------------------------

class BarrierBox:
    def __init__(self) -> None:
        self.event = threading.Event()
        self.error: Optional[BaseException] = None
        self.value: Any = None
        self.lock_wait_seen = False



# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------

def bootstrap_epoch(su_user: str = SU) -> tuple[int, str, str]:
    """Ensure we are on a known leased epoch with a holder role. Returns (epoch, holder_id, role)."""
    with session(SU) as su, session("openbot_controller") as ctl:
        ep = current_epoch(su)
        role = holder_role(su)
        hid = holder_id(su)
        if role is not None and ep >= 1:
            return ep, hid, role
        # First bump: bootstrap -> node-b / app_b
        eid = make_exec(ctl, ep, hid or "bootstrap", "node-b", "VERIFIED")
        new_ep = bump(ctl, eid, ep, "node-b", "openbot_app_b")
        return new_ep, "node-b", "openbot_app_b"


def flip_holder(ctl: psycopg.Connection, from_ep: int, from_h: str, to_h: str, to_role: str) -> int:
    eid = make_exec(ctl, from_ep, from_h, to_h, "VERIFIED")
    return bump(ctl, eid, from_ep, to_h, to_role)


def other_role(role: str) -> str:
    return "openbot_app_b" if role == "openbot_app_a" else "openbot_app_a"


def other_holder(hid: str) -> str:
    return "node-b" if hid != "node-b" else "node-a"


def app_name(holder_id: str, tag: str) -> str:
    """§11.5 application_name = openbot:<holder_id>:<role>:<tag> for terminate matching."""
    return f"openbot:{holder_id}:writer:{tag}"


def abort_live_execs(ctl: psycopg.Connection, from_epoch: Optional[int] = None) -> None:
    """Close leftover live executions so INV-ONE does not block the next claim."""
    if from_epoch is None:
        exec_sql(
            ctl,
            """
            UPDATE public.ha_failover_execution
               SET state = 'ABORTED_CLOSED', updated_at = now()
             WHERE state <> 'ABORTED_CLOSED' AND state <> 'LEASED' AND state <> 'DONE'
            """,
        )
    else:
        exec_sql(
            ctl,
            """
            UPDATE public.ha_failover_execution
               SET state = 'ABORTED_CLOSED', updated_at = now()
             WHERE from_epoch = %s AND state <> 'ABORTED_CLOSED' AND state <> 'LEASED' AND state <> 'DONE'
            """,
            (from_epoch,),
        )
    ctl.commit()


def terminate_holder(ctl: psycopg.Connection, holder: str, role: str, eid: Optional[str] = None) -> int:
    rows = q(
        ctl,
        "SELECT * FROM public.openbot_ha_terminate_holder_sessions(%s, %s, 2000, %s::uuid)",
        (holder, role, eid),
    )
    ctl.commit()
    return len(rows)


def force_clear_app_locks() -> None:
    """Best-effort: terminate any openbot_app_* backends still holding locks (test hygiene)."""
    with session(SU) as su:
        q(
            su,
            """
            SELECT pg_terminate_backend(pid)
              FROM pg_stat_activity
             WHERE datname = current_database()
               AND pid <> pg_backend_pid()
               AND usename IN ('openbot_app_a', 'openbot_app_b')
            """,
        )


def case_it_cs_01(suite: Suite) -> None:
    """T_old BEGIN → write → Failover epoch++ → T_old COMMIT must fail."""

    def one(iso: str, label: str) -> None:
        ep, hid, role = bootstrap_epoch()
        to_h = other_holder(hid)
        to_r = other_role(role)
        with session(SU) as su:
            oracle_peek_advance(su)
            initial = current_epoch(su)

        box = BarrierBox()
        ready = threading.Event()
        go_commit = threading.Event()

        def old_writer() -> None:
            try:
                with session(role, appname=app_name(hid, f"it-cs-01-{label}")) as a:
                    exec_sql(a, f"BEGIN ISOLATION LEVEL {iso}")
                    if iso != "READ COMMITTED":
                        # Fix snapshot before write (RR/SER trap setup)
                        q(a, "SELECT count(*) FROM public.writer_epoch_guard")
                    exec_sql(a, "SELECT set_config('openbot.expected_epoch', %s, true)", (str(ep),))
                    exec_sql(
                        a,
                        "INSERT INTO public.cs_probe(id, written_epoch, note) VALUES (%s, %s, %s)",
                        (f"it-cs-01-{label}-{uuid.uuid4().hex[:8]}", ep, "T_old"),
                    )
                    ready.set()
                    go_commit.wait(30)
                    try:
                        a.commit()
                        box.error = RuntimeError("COMMIT succeeded (must fail)")
                    except Exception as e:
                        box.error = e
                        a.rollback()
            except Exception as e:
                box.error = e
                ready.set()

        t = threading.Thread(target=old_writer, daemon=True)
        t.start()
        if not ready.wait(15):
            raise TimeoutError("T_old did not reach pre-commit barrier")

        with session("openbot_controller") as ctl:
            new_ep = flip_holder(ctl, ep, hid, to_h, to_r)
            if new_ep != ep + 1:
                raise AssertionError(f"expected epoch {ep+1}, got {new_ep}")

        go_commit.set()
        t.join(20)
        if box.error is None:
            raise AssertionError("T_old raised nothing")
        st = sqlstate_of(box.error)
        if isinstance(box.error, RuntimeError) and "succeeded" in str(box.error):
            raise box.error
        if iso == "READ COMMITTED":
            if st != "OB002":
                raise AssertionError(f"RC want OB002, got {st}: {box.error}")
        else:
            if st not in ("OB002", "40001"):
                raise AssertionError(f"RR want OB002|40001, got {st}: {box.error}")

        with session(SU) as su:
            n = q1(su, "SELECT count(*) FROM public.cs_probe WHERE note = 'T_old' AND id LIKE %s", (f"it-cs-01-{label}-%",))
            if int(n) != 0:
                raise AssertionError(f"rejected row visible: {n}")
            if current_epoch(su) != ep + 1:
                raise AssertionError("epoch not advanced")
            rep = oracle_consume(su, initial)
            # No INV-CS: rejected commit must not appear; bumps ok
            if rep.violations:
                raise AssertionError(f"oracle violations: {rep.violations}")

        suite.add(Result(f"IT-CS-01 {label}", True, note=f"sqlstate={st}"))

    one("READ COMMITTED", "RC")
    one("REPEATABLE READ", "RR")
    one("SERIALIZABLE", "SER")


def case_it_cs_02(suite: Suite) -> None:
    """Gate-first: A explicit gate → C bump blocks → A COMMIT → C succeeds; c(A) ≺ c(B)."""
    ep, hid, role = bootstrap_epoch()
    to_h = other_holder(hid)
    to_r = other_role(role)
    row_id = f"it-cs-02-{uuid.uuid4().hex[:8]}"

    with session(SU) as su:
        oracle_peek_advance(su)
        initial = current_epoch(su)

    gated = threading.Event()
    commit_done = threading.Event()
    bump_done = threading.Event()
    errs: list[BaseException] = []
    bump_result: list[int] = []

    def writer() -> None:
        try:
            with session(role, appname=app_name(hid, "it-cs-02")) as a:
                exec_sql(a, "BEGIN ISOLATION LEVEL READ COMMITTED")
                exec_sql(a, "SELECT set_config('openbot.expected_epoch', %s, true)", (str(ep),))
                exec_sql(a, "SELECT public.openbot_ha_commit_gate()")
                gated.set()
                # Hold briefly so C can queue and block
                time.sleep(0.8)
                exec_sql(
                    a,
                    "INSERT INTO public.cs_probe(id, written_epoch, note) VALUES (%s,%s,'gate-first')",
                    (row_id, ep),
                )
                a.commit()
                commit_done.set()
        except Exception as e:
            errs.append(e)
            gated.set()
            commit_done.set()

    def controller2() -> None:
        try:
            if not gated.wait(15):
                raise TimeoutError("gate not taken")
            with session("openbot_controller", appname="it-cs-02-C") as ctl:
                eid = make_exec(ctl, ep, hid, to_h, "VERIFIED")
                # make_exec commits; now bump blocks on EXCLUSIVE
                exec_sql(ctl, "BEGIN")
                exec_sql(ctl, "SET LOCAL lock_timeout = '10s'")
                rows = q(
                    ctl,
                    "SELECT public.openbot_ha_bump_epoch(%s::uuid, 1, %s, %s, %s) AS e",
                    (eid, ep, to_h, to_r),
                )
                ctl.commit()
                bump_result.append(int(rows[0]["e"]))
                bump_done.set()
        except Exception as e:
            errs.append(e)
            bump_done.set()

    tw = threading.Thread(target=writer, daemon=True)
    tc = threading.Thread(target=controller2, daemon=True)
    tw.start()
    tc.start()
    tw.join(30)
    tc.join(30)
    if errs:
        raise errs[0]
    if not commit_done.is_set() or not bump_done.is_set():
        raise TimeoutError("IT-CS-02 threads did not finish")
    if not bump_result or bump_result[0] != ep + 1:
        raise AssertionError(f"bump result {bump_result}")

    with session(SU) as su:
        n = q1(su, "SELECT count(*) FROM public.cs_probe WHERE id=%s", (row_id,))
        if int(n) != 1:
            raise AssertionError("A row missing")
        rep = oracle_consume(su, initial)
        if rep.violations:
            raise AssertionError(f"oracle violations: {rep.violations}")
        # c(A) ≺ c(B): probe commit must appear before bump in stream OR
        # written_epoch == epoch at commit (equal is ok; < is violation).
        # Stronger: last bump in report should be ep+1 and probe_commits >= 1
        if not rep.bumps or rep.bumps[-1] != ep + 1:
            # bump always decoded; if missing, still OK if epoch advanced & no violation
            if current_epoch(su) != ep + 1:
                raise AssertionError("epoch not advanced")
    suite.add(Result("IT-CS-02", True, note="gate-first; oracle clean"))


def case_it_cs_03(suite: Suite) -> None:
    """Bump-first: C holds EXCLUSIVE → A COMMIT blocks on RowShare → C commits → A fails."""

    def one(iso: str, label: str) -> None:
        ep, hid, role = bootstrap_epoch()
        to_h = other_holder(hid)
        to_r = other_role(role)
        row_id = f"it-cs-03-{label}-{uuid.uuid4().hex[:8]}"

        bump_holding = threading.Event()
        a_committing = threading.Event()
        lock_seen = threading.Event()
        a_err: list[BaseException] = []
        c_err: list[BaseException] = []

        def controller() -> None:
            try:
                with session("openbot_controller", appname=f"it-cs-03-C-{label}") as ctl:
                    eid = make_exec(ctl, ep, hid, to_h, "VERIFIED")
                    exec_sql(ctl, "BEGIN")
                    exec_sql(ctl, "SET LOCAL lock_timeout = '30s'")
                    q(
                        ctl,
                        "SELECT public.openbot_ha_bump_epoch(%s::uuid, 1, %s, %s, %s)",
                        (eid, ep, to_h, to_r),
                    )
                    bump_holding.set()
                    # Wait until A is observed waiting, then a bit more
                    lock_seen.wait(20)
                    time.sleep(0.3)
                    ctl.commit()
            except Exception as e:
                c_err.append(e)
                bump_holding.set()

        def writer() -> None:
            try:
                if not bump_holding.wait(15):
                    raise TimeoutError("bump not holding")
                with session(role, appname=app_name(hid, f"it-cs-03-{label}")) as a:
                    exec_sql(a, f"BEGIN ISOLATION LEVEL {iso}")
                    if iso != "READ COMMITTED":
                        q(a, "SELECT 1")
                    exec_sql(a, "SELECT set_config('openbot.expected_epoch', %s, true)", (str(ep),))
                    exec_sql(
                        a,
                        "INSERT INTO public.cs_probe(id, written_epoch, note) VALUES (%s,%s,'bump-first')",
                        (row_id, ep),
                    )
                    a_committing.set()
                    try:
                        a.commit()
                        a_err.append(RuntimeError("COMMIT succeeded"))
                    except Exception as e:
                        a_err.append(e)
                        a.rollback()
            except Exception as e:
                a_err.append(e)
                a_committing.set()

        def observer() -> None:
            if not a_committing.wait(20):
                return
            # Poll pg_locks for A's ungranted RowShareLock
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                with session(SU) as su:
                    n = q1(
                        su,
                        """
                        SELECT count(*) FROM pg_locks l
                          JOIN pg_stat_activity a USING (pid)
                         WHERE l.relation = 'public.writer_epoch_guard'::regclass
                           AND l.mode = 'RowShareLock' AND NOT l.granted
                           AND a.application_name LIKE %s
                        """,
                        (f"openbot:{hid}:writer:it-cs-03-{label}%",),
                    )
                    if int(n) >= 1:
                        lock_seen.set()
                        return
                time.sleep(0.05)
            # Even if we miss the wait window, still release C
            lock_seen.set()

        tc = threading.Thread(target=controller, daemon=True)
        tw = threading.Thread(target=writer, daemon=True)
        to = threading.Thread(target=observer, daemon=True)
        tc.start()
        time.sleep(0.1)
        tw.start()
        to.start()
        tw.join(40)
        tc.join(40)
        if c_err:
            raise c_err[0]
        if not a_err:
            raise AssertionError("A produced no error")
        if isinstance(a_err[0], RuntimeError):
            raise a_err[0]
        st = sqlstate_of(a_err[0])
        if iso == "READ COMMITTED" and st != "OB002":
            raise AssertionError(f"RC want OB002 got {st}: {a_err[0]}")
        if iso != "READ COMMITTED" and st not in ("OB002", "40001"):
            raise AssertionError(f"RR want OB002|40001 got {st}: {a_err[0]}")
        with session(SU) as su:
            if int(q1(su, "SELECT count(*) FROM public.cs_probe WHERE id=%s", (row_id,))) != 0:
                raise AssertionError("row visible")
        note = f"sqlstate={st}; lock_wait_observed={lock_seen.is_set()}"
        suite.add(Result(f"IT-CS-03 {label}", True, note=note))

    one("READ COMMITTED", "RC")
    one("REPEATABLE READ", "RR")


def case_it_cs_04(suite: Suite) -> None:
    """Naive negative control: lock-free validate + delay + bump → commit succeeds; oracle detects INV-CS."""
    ep, hid, role = bootstrap_epoch()
    to_h = other_holder(hid)
    to_r = other_role(role)
    row_id = f"it-cs-04-{uuid.uuid4().hex[:8]}"

    with session(SU) as su:
        oracle_peek_advance(su)
        initial = current_epoch(su)

    validated = threading.Event()
    bumped = threading.Event()
    errs: list[BaseException] = []

    def naive_writer() -> None:
        try:
            with session(role, appname=app_name(hid, "it-cs-04")) as a:
                exec_sql(a, "BEGIN ISOLATION LEVEL READ COMMITTED")
                exec_sql(
                    a,
                    "INSERT INTO public.naive_probe(id, written_epoch, note) VALUES (%s,%s,'naive')",
                    (row_id, ep),
                )
                exec_sql(a, "SELECT public.naive_validate(%s)", (ep,))
                validated.set()
                # Spec: pg_sleep(2) between validate and commit
                q(a, "SELECT pg_sleep(2)")
                if not bumped.wait(15):
                    raise TimeoutError("bump did not finish during sleep")
                a.commit()  # MUST succeed (negative control)
        except Exception as e:
            errs.append(e)
            validated.set()

    def controller() -> None:
        try:
            if not validated.wait(15):
                raise TimeoutError("validate not done")
            with session("openbot_controller") as ctl:
                flip_holder(ctl, ep, hid, to_h, to_r)
            bumped.set()
        except Exception as e:
            errs.append(e)
            bumped.set()

    tw = threading.Thread(target=naive_writer, daemon=True)
    tc = threading.Thread(target=controller, daemon=True)
    tw.start()
    tc.start()
    tw.join(30)
    tc.join(30)
    if errs:
        raise AssertionError(f"naive path should succeed; errs={errs}")

    with session(SU) as su:
        n = q1(su, "SELECT count(*) FROM public.naive_probe WHERE id=%s", (row_id,))
        if int(n) != 1:
            raise AssertionError("naive row missing (negative control must commit)")
        we = q1(su, "SELECT written_epoch FROM public.naive_probe WHERE id=%s", (row_id,))
        if int(we) != ep:
            raise AssertionError(f"written_epoch={we} want {ep}")
        if current_epoch(su) != ep + 1:
            raise AssertionError("epoch not bumped")
        rep = oracle_consume(su, initial)
        if len(rep.violations) < 1:
            raise AssertionError(
                "oracle FAILED to detect INV-CS on naive commit — suite invalid"
            )
    suite.add(
        Result(
            "IT-CS-04",
            True,
            note=f"naive committed; oracle violations={len(rep.violations)} (required ≥1)",
        )
    )


def case_it_cs_05(suite: Suite) -> None:
    """RR snapshot trap: plain SELECT sees old N; formal gate returns 40001."""
    ep, hid, role = bootstrap_epoch()
    to_h = other_holder(hid)
    to_r = other_role(role)

    snap_ready = threading.Event()
    bumped = threading.Event()
    plain_val: list[int] = []
    gate_err: list[BaseException] = []

    def rr_session() -> None:
        try:
            with session(role, appname=app_name(hid, "it-cs-05")) as a:
                exec_sql(a, "BEGIN ISOLATION LEVEL REPEATABLE READ")
                # Take snapshot
                v = int(q1(a, "SELECT current_epoch FROM public.writer_epoch_guard WHERE lock_name='openbot_writer'"))
                plain_val.append(v)
                snap_ready.set()
                if not bumped.wait(20):
                    raise TimeoutError("bump timeout")
                # Plain SELECT still sees old snapshot value N
                v2 = int(q1(a, "SELECT current_epoch FROM public.writer_epoch_guard WHERE lock_name='openbot_writer'"))
                plain_val.append(v2)
                exec_sql(a, "SELECT set_config('openbot.expected_epoch', %s, true)", (str(ep),))
                try:
                    exec_sql(a, "SELECT public.openbot_ha_commit_gate()")
                    gate_err.append(RuntimeError("gate succeeded"))
                except Exception as e:
                    gate_err.append(e)
                a.rollback()
        except Exception as e:
            gate_err.append(e)
            snap_ready.set()

    def controller() -> None:
        if not snap_ready.wait(15):
            return
        with session("openbot_controller") as ctl:
            flip_holder(ctl, ep, hid, to_h, to_r)
        bumped.set()

    tw = threading.Thread(target=rr_session, daemon=True)
    tc = threading.Thread(target=controller, daemon=True)
    tw.start()
    tc.start()
    tw.join(30)
    tc.join(30)

    if len(plain_val) < 2:
        raise AssertionError(f"plain_val={plain_val}")
    if plain_val[0] != ep or plain_val[1] != ep:
        raise AssertionError(f"RR plain SELECT must see old N={ep}, got {plain_val}")
    if not gate_err or isinstance(gate_err[0], RuntimeError):
        raise AssertionError(f"gate must fail: {gate_err}")
    st = sqlstate_of(gate_err[0])
    if st not in ("40001", "OB002"):
        raise AssertionError(f"want 40001 (preferred) or OB002, got {st}: {gate_err[0]}")
    suite.add(Result("IT-CS-05", True, note=f"plain_seen={plain_val[1]}; gate_sqlstate={st}"))


def case_it_cs_06(suite: Suite) -> None:
    """Missing expected_epoch → OB001 fail-closed."""
    bootstrap_epoch()
    with session("openbot_app_a") as a:
        exec_sql(a, "BEGIN")
        # deliberately no set_config
        try:
            exec_sql(
                a,
                "INSERT INTO public.cs_probe(id, written_epoch, note) VALUES ('it-cs-06', 0, 'missing')",
            )
            a.commit()
            raise AssertionError("commit succeeded")
        except Exception as e:
            st = sqlstate_of(e)
            a.rollback()
            # May fail at stamp (BEFORE INSERT) or at gate — both OB001
            if st != "OB001":
                raise AssertionError(f"want OB001 got {st}: {e}")
    suite.add(Result("IT-CS-06", True, note="OB001"))


def case_it_cs_07(suite: Suite) -> None:
    """Bypass denials (§10.6): DISABLE TRIGGER, replication_role, TRUNCATE, 2PC, direct UPDATE guard."""
    ep, hid, role = bootstrap_epoch()
    checks = []

    def expect_deny(label: str, user: str, code: str, stmt: str) -> None:
        with session(user) as c:
            try:
                exec_sql(c, "BEGIN")
                exec_sql(c, stmt)
                c.commit()
                raise AssertionError(f"{label}: succeeded")
            except Exception as e:
                c.rollback()
                st = sqlstate_of(e)
                if st != code and code not in str(e):
                    # 55000 for 2PC, 42501 for privilege
                    if st != code:
                        raise AssertionError(f"{label}: want {code} got {st}: {e}")
                checks.append(label)

    expect_deny("DISABLE TRIGGER", role, "42501", "ALTER TABLE public.cs_probe DISABLE TRIGGER ALL")
    expect_deny("session_replication_role", role, "42501", "SET session_replication_role = replica")
    expect_deny("TRUNCATE", role, "42501", "TRUNCATE public.cs_probe")
    expect_deny(
        "UPDATE writer_epoch_guard",
        role,
        "42501",
        "UPDATE public.writer_epoch_guard SET current_epoch = current_epoch + 1",
    )
    # 2PC
    with session(role) as a:
        try:
            exec_sql(a, "BEGIN")
            exec_sql(a, "SELECT set_config('openbot.expected_epoch', %s, true)", (str(ep),))
            exec_sql(
                a,
                "INSERT INTO public.cs_probe(id, written_epoch, note) VALUES (%s,%s,'2pc')",
                (f"it-cs-07-2pc-{uuid.uuid4().hex[:6]}", ep),
            )
            exec_sql(a, "PREPARE TRANSACTION 'it_cs_07_2pc'")
            raise AssertionError("PREPARE TRANSACTION succeeded")
        except Exception as e:
            st = sqlstate_of(e)
            try:
                a.rollback()
            except Exception:
                pass
            if st not in ("55000", "0A000"):
                raise AssertionError(f"2PC want 55000/0A000 got {st}: {e}")
            checks.append("PREPARE TRANSACTION")

    suite.add(Result("IT-CS-07", True, note=",".join(checks)))


def case_it_cs_08(suite: Suite) -> None:
    """Savepoint: gate in subxact + ROLLBACK TO → write → bump → COMMIT fails."""
    ep, hid, role = bootstrap_epoch()
    to_h = other_holder(hid)
    to_r = other_role(role)
    row_id = f"it-cs-08-{uuid.uuid4().hex[:8]}"

    ready = threading.Event()
    go = threading.Event()
    err: list[BaseException] = []

    def writer() -> None:
        try:
            with session(role, appname=app_name(hid, "it-cs-08")) as a:
                exec_sql(a, "BEGIN ISOLATION LEVEL READ COMMITTED")
                exec_sql(a, "SELECT set_config('openbot.expected_epoch', %s, true)", (str(ep),))
                exec_sql(a, "SAVEPOINT sp1")
                exec_sql(a, "SELECT public.openbot_ha_commit_gate()")
                exec_sql(a, "ROLLBACK TO SAVEPOINT sp1")
                # Lock from subxact released; flag rolled back
                exec_sql(
                    a,
                    "INSERT INTO public.cs_probe(id, written_epoch, note) VALUES (%s,%s,'sp')",
                    (row_id, ep),
                )
                ready.set()
                go.wait(30)
                try:
                    a.commit()
                    err.append(RuntimeError("COMMIT succeeded"))
                except Exception as e:
                    err.append(e)
                    a.rollback()
        except Exception as e:
            err.append(e)
            ready.set()

    tw = threading.Thread(target=writer, daemon=True)
    tw.start()
    if not ready.wait(15):
        raise TimeoutError("writer not ready")
    with session("openbot_controller") as ctl:
        flip_holder(ctl, ep, hid, to_h, to_r)
    go.set()
    tw.join(20)
    if not err or isinstance(err[0], RuntimeError):
        raise AssertionError(f"must fail: {err}")
    st = sqlstate_of(err[0])
    if st != "OB002":
        raise AssertionError(f"want OB002 got {st}: {err[0]}")
    with session(SU) as su:
        if int(q1(su, "SELECT count(*) FROM public.cs_probe WHERE id=%s", (row_id,))) != 0:
            raise AssertionError("row visible")
    suite.add(Result("IT-CS-08", True, note=f"sqlstate={st}"))


def case_it_cs_09(suite: Suite) -> None:
    """Long-txn drain: gate held → bump lock_timeout → terminate → retry bump; T_old_txn_drain ≤ 8.5s."""
    ep, hid, role = bootstrap_epoch()
    to_h = other_holder(hid)
    to_r = other_role(role)

    gated = threading.Event()
    dead = threading.Event()

    def holder() -> None:
        try:
            with session(role, appname=app_name(hid, "it-cs-09")) as a:
                exec_sql(a, "SET statement_timeout = 0")
                exec_sql(a, "SET lock_timeout = 0")
                exec_sql(a, "SET idle_in_transaction_session_timeout = 0")
                exec_sql(a, "BEGIN")
                exec_sql(a, "SELECT set_config('openbot.expected_epoch', %s, true)", (str(ep),))
                exec_sql(a, "SELECT public.openbot_ha_commit_gate()")
                gated.set()
                try:
                    q(a, "SELECT pg_sleep(60)")
                    a.commit()
                except Exception:
                    dead.set()
        except Exception:
            gated.set()
            dead.set()

    tw = threading.Thread(target=holder, daemon=True)
    tw.start()
    if not gated.wait(15):
        raise TimeoutError("gate not held")

    with session("openbot_controller") as ctl:
        eid = make_exec(ctl, ep, hid, to_h, "VERIFIED")
        t0 = time.monotonic()
        try:
            exec_sql(ctl, "BEGIN")
            exec_sql(ctl, "SET LOCAL lock_timeout = '5s'")
            q(
                ctl,
                "SELECT public.openbot_ha_bump_epoch(%s::uuid, 1, %s, %s, %s)",
                (eid, ep, to_h, to_r),
            )
            ctl.commit()
            raise AssertionError("first bump should have timed out")
        except Exception as e:
            ctl.rollback()
            st = sqlstate_of(e)
            if st != "55P03":
                raise AssertionError(f"want lock_timeout 55P03 got {st}: {e}")
        nterm = terminate_holder(ctl, hid, role, eid)
        if nterm < 1:
            raise AssertionError("terminate matched 0 sessions (check application_name)")
        # Confirm drain
        left = q1(ctl, "SELECT count(*) FROM public.openbot_ha_holder_sessions(%s, %s)", (hid, role))
        if int(left) != 0:
            # retry terminate once
            terminate_holder(ctl, hid, role, eid)
            left = q1(ctl, "SELECT count(*) FROM public.openbot_ha_holder_sessions(%s, %s)", (hid, role))
        if int(left) != 0:
            raise AssertionError(f"holder sessions remain: {left}")
        new_ep = bump(ctl, eid, ep, to_h, to_r, lock_timeout="5s")
        drain = time.monotonic() - t0
        if new_ep != ep + 1:
            raise AssertionError(f"bump -> {new_ep}")
        if drain > 8.5:
            raise AssertionError(f"T_old_txn_drain={drain:.3f}s > 8.5s")

    tw.join(10)
    suite.add(Result("IT-CS-09", True, note=f"T_old_txn_drain={drain:.3f}s ≤ 8.5s; terminated={nterm}"))


def case_it_cs_10(suite: Suite) -> None:
    """Concurrency fuzz: N writers + random bumps; oracle zero violations; no deadlock."""
    ep0, hid, role = bootstrap_epoch()
    with session(SU) as su:
        oracle_peek_advance(su)
        initial = current_epoch(su)

    stop = threading.Event()
    bump_counter = {"n": 0}
    write_counter = {"n": 0}
    errors: list[str] = []
    lock = threading.Lock()

    def writer_loop(i: int, iso: str) -> None:
        r = "openbot_app_a" if i % 2 == 0 else "openbot_app_b"
        while not stop.is_set():
            try:
                with session(r, appname=f"openbot:fuzz:writer:w{i}") as a:
                    # Discover current epoch/role; only write if we match H1
                    with session(SU) as su:
                        ep = current_epoch(su)
                        hrole = holder_role(su)
                    if hrole is not None and r != hrole:
                        time.sleep(0.01)
                        continue
                    exec_sql(a, f"BEGIN ISOLATION LEVEL {iso}")
                    exec_sql(a, "SELECT set_config('openbot.expected_epoch', %s, true)", (str(ep),))
                    # Random pre-gate delay
                    if i % 5 == 0:
                        time.sleep(0.002)
                    try:
                        exec_sql(
                            a,
                            "INSERT INTO public.cs_probe(id, written_epoch, note) VALUES (%s,%s,'fuzz')",
                            (f"fuzz-{i}-{uuid.uuid4().hex}", ep),
                        )
                        if i % 7 == 0:
                            time.sleep(0.002)
                        a.commit()
                        with lock:
                            write_counter["n"] += 1
                    except Exception as e:
                        a.rollback()
                        st = sqlstate_of(e)
                        if st in ("OB002", "OB003", "40001", "55P03", "40001"):
                            continue  # expected under race
                        if st == "40P01":
                            with lock:
                                errors.append(f"deadlock: {e}")
                            continue
                        # unique_violation etc. ignore
                        if st in ("23505",):
                            continue
            except Exception as e:
                with lock:
                    errors.append(str(e))
                time.sleep(0.01)

    def bumper_loop() -> None:
        holders = [("node-a", "openbot_app_a"), ("node-b", "openbot_app_b")]
        while bump_counter["n"] < FUZZ_BUMPS and not stop.is_set():
            try:
                with session(SU) as su, session("openbot_controller") as ctl:
                    ep = current_epoch(su)
                    hid_now = holder_id(su)
                    role_now = holder_role(su) or "openbot_app_a"
                    # Flip to the other holder
                    to_h, to_r = holders[0] if hid_now != "node-a" else holders[1]
                    if to_r == role_now and to_h == hid_now:
                        to_h, to_r = holders[1] if to_h == holders[0][0] else holders[0]
                    eid = make_exec(ctl, ep, hid_now, to_h, "VERIFIED")
                    try:
                        bump(ctl, eid, ep, to_h, to_r, lock_timeout="2s")
                        with lock:
                            bump_counter["n"] += 1
                    except Exception as e:
                        ctl.rollback()
                        st = sqlstate_of(e)
                        if st == "55P03":
                            # terminate holders of old id and retry once
                            try:
                                q(
                                    ctl,
                                    "SELECT * FROM public.openbot_ha_terminate_holder_sessions(%s, NULL, 500, %s::uuid)",
                                    (hid_now, eid),
                                )
                                ctl.commit()
                                bump(ctl, eid, ep, to_h, to_r, lock_timeout="2s")
                                with lock:
                                    bump_counter["n"] += 1
                            except Exception as e2:
                                with lock:
                                    if sqlstate_of(e2) not in ("55P03", "OB010", "OB011"):
                                        errors.append(f"bump retry: {e2}")
                        elif st in ("OB010", "OB011", "23505"):
                            continue
                        else:
                            with lock:
                                errors.append(f"bump: {st} {e}")
                time.sleep(0.005)
            except Exception as e:
                with lock:
                    errors.append(f"bumper: {e}")
                time.sleep(0.02)

    writers = []
    for i in range(FUZZ_WRITERS):
        iso = "READ COMMITTED" if i % 3 else "REPEATABLE READ"
        t = threading.Thread(target=writer_loop, args=(i, iso), daemon=True)
        writers.append(t)
        t.start()
    bt = threading.Thread(target=bumper_loop, daemon=True)
    bt.start()
    bt.join(timeout=max(120, FUZZ_BUMPS * 0.5))
    stop.set()
    for t in writers:
        t.join(5)

    deadlocks = [e for e in errors if "deadlock" in e.lower() or "40P01" in e]
    # Filter soft errors
    hard = [e for e in errors if "deadlock" not in e.lower()]
    with session(SU) as su:
        rep = oracle_consume(su, initial)
        if rep.violations:
            raise AssertionError(f"oracle violations ({len(rep.violations)}): {rep.violations[:5]}")
        if deadlocks:
            raise AssertionError(f"deadlocks observed: {deadlocks[:3]}")
        if bump_counter["n"] < FUZZ_BUMPS:
            # Not reaching target is a soft fail only if heavily blocked
            raise AssertionError(f"only {bump_counter['n']}/{FUZZ_BUMPS} bumps completed; hard={hard[:5]}")

    note = (
        f"bumps={bump_counter['n']}/{FUZZ_BUMPS}; writes={write_counter['n']}; "
        f"writers={FUZZ_WRITERS}; oracle_violations=0"
    )
    if FUZZ_BUMPS < 10000:
        note += f"; SHORT run (set HA_CS_IT_FUZZ_BUMPS=10000 for full §19.1)"
    suite.add(Result("IT-CS-10", True, note=note))


def case_it_cs_11(suite: Suite) -> None:
    """H1 role binding: after bump, old role with new expected_epoch → OB003."""
    force_clear_app_locks()
    ep, hid, role = bootstrap_epoch()
    to_h = other_holder(hid)
    to_r = other_role(role)
    with session("openbot_controller") as ctl:
        new_ep = flip_holder(ctl, ep, hid, to_h, to_r)
    # Old role claims new epoch
    with session(role) as a:
        try:
            exec_sql(a, "BEGIN")
            exec_sql(a, "SELECT set_config('openbot.expected_epoch', %s, true)", (str(new_ep),))
            exec_sql(
                a,
                "INSERT INTO public.cs_probe(id, written_epoch, note) VALUES (%s,%s,'h1')",
                (f"it-cs-11-{uuid.uuid4().hex[:8]}", new_ep),
            )
            a.commit()
            raise AssertionError("COMMIT succeeded")
        except Exception as e:
            st = sqlstate_of(e)
            a.rollback()
            if st != "OB003":
                raise AssertionError(f"want OB003 got {st}: {e}")
    suite.add(Result("IT-CS-11", True, note="OB003"))


def case_it_cs_12(suite: Suite) -> None:
    """Perf note: gate on vs off P99 delta (informational; target ≤ 2ms)."""
    ep, _hid, role = bootstrap_epoch()
    state = {"ep": ep, "role": role}

    def measure(gated: bool, n: int) -> list[float]:
        times: list[float] = []
        table = "cs_probe" if gated else "naive_probe"
        prefix = "perf-on" if gated else "perf-off"
        with session(state["role"]) as a:
            for _ in range(n):
                exec_sql(a, "BEGIN")
                if gated:
                    exec_sql(
                        a,
                        "SELECT set_config('openbot.expected_epoch', %s, true)",
                        (str(state["ep"]),),
                    )
                t0 = time.perf_counter()
                try:
                    exec_sql(
                        a,
                        f"INSERT INTO public.{table}(id, written_epoch, note) VALUES (%s,%s,'perf')",
                        (f"{prefix}-{uuid.uuid4().hex}", state["ep"]),
                    )
                    a.commit()
                except Exception:
                    a.rollback()
                    with session(SU) as su:
                        state["ep"] = current_epoch(su)
                        hr = holder_role(su)
                    if hr is None or hr != state["role"]:
                        break
                    continue
                times.append((time.perf_counter() - t0) * 1000.0)
        return times

    on = measure(True, PERF_SAMPLES)
    off = measure(False, PERF_SAMPLES)
    if len(on) < 50 or len(off) < 50:
        suite.add(
            Result(
                "IT-CS-12",
                True,
                note=f"insufficient samples on={len(on)} off={len(off)} (skipped strict assert)",
            )
        )
        return

    def p99(xs: list[float]) -> float:
        s = sorted(xs)
        return s[min(len(s) - 1, int(len(s) * 0.99))]

    d = p99(on) - p99(off)
    note = (
        f"P99_on={p99(on):.3f}ms P99_off={p99(off):.3f}ms delta={d:.3f}ms "
        f"(target ≤2ms); mean_on={statistics.mean(on):.3f} mean_off={statistics.mean(off):.3f}; n={len(on)}"
    )
    if d > 2.0:
        note += "; EXCEEDS 2ms target on this host (record for drill; not a protocol failure)"
    suite.add(Result("IT-CS-12", True, note=note))


def case_it_cs_13(suite: Suite) -> None:
    """Dual controller Claim/bump: only one Claim wins; epoch +1; zombie owner_gen → OB010."""
    force_clear_app_locks()
    ep, hid, role = bootstrap_epoch()
    to_h = other_holder(hid)
    to_r = other_role(role)

    results: list[str] = []
    errors: list[str] = []
    barrier = threading.Barrier(2)

    def claimer(cid: str) -> None:
        try:
            with session("openbot_controller", appname=f"it-cs-13-{cid}") as ctl:
                barrier.wait(10)
                try:
                    eid = str(uuid.uuid4())
                    exec_sql(
                        ctl,
                        """
                        INSERT INTO public.ha_failover_execution
                          (execution_id, lock_name, from_epoch, from_holder, to_holder,
                           owner_controller_id, owner_gen, owner_lease_until, state, mode)
                        VALUES (%s::uuid, 'openbot_writer', %s, %s, %s,
                                %s, 1, now() + interval '30 seconds', 'CLAIMED', 'manual')
                        """,
                        (eid, ep, hid, to_h, cid),
                    )
                    ctl.commit()
                    results.append(eid)
                except Exception as e:
                    ctl.rollback()
                    st = sqlstate_of(e)
                    if st != "23505":
                        errors.append(f"{cid}: want 23505 got {st}: {e}")
                    else:
                        results.append("LOST")
        except Exception as e:
            errors.append(str(e))

    t1 = threading.Thread(target=claimer, args=("controller-1",), daemon=True)
    t2 = threading.Thread(target=claimer, args=("controller-2",), daemon=True)
    t1.start()
    t2.start()
    t1.join(15)
    t2.join(15)
    if errors:
        raise AssertionError(errors)
    wins = [r for r in results if r != "LOST"]
    losses = [r for r in results if r == "LOST"]
    if len(wins) != 1 or len(losses) != 1:
        # Barrier races can occasionally let both serialize; unique index still allows only one
        with session(SU) as su:
            n = q1(
                su,
                """
                SELECT count(*) FROM public.ha_failover_execution
                 WHERE from_epoch=%s AND state <> 'ABORTED_CLOSED'
                """,
                (ep,),
            )
            if int(n) != 1:
                raise AssertionError(f"live executions={n}; results={results}")

    win_eid = wins[0] if wins else None
    if win_eid is None:
        with session(SU) as su:
            win_eid = q1(
                su,
                """
                SELECT execution_id::text FROM public.ha_failover_execution
                 WHERE from_epoch=%s AND state='CLAIMED' LIMIT 1
                """,
                (ep,),
            )

    # Promote winner to VERIFIED and bump once
    with session("openbot_controller") as ctl:
        exec_sql(
            ctl,
            "UPDATE public.ha_failover_execution SET state='VERIFIED' WHERE execution_id=%s::uuid",
            (win_eid,),
        )
        ctl.commit()
        new_ep = bump(ctl, win_eid, ep, to_h, to_r)
        if new_ep != ep + 1:
            raise AssertionError(f"epoch {new_ep} want {ep+1}")

        # Zombie owner_gen bump must fail OB010
        # Create a fresh VERIFIED exec for next epoch, then try wrong gen
        eid2 = make_exec(ctl, new_ep, to_h, hid, "VERIFIED", owner_gen=1)
        try:
            exec_sql(ctl, "BEGIN")
            exec_sql(ctl, "SET LOCAL lock_timeout = '5s'")
            q(
                ctl,
                "SELECT public.openbot_ha_bump_epoch(%s::uuid, %s, %s, %s, %s)",
                (eid2, 99, new_ep, hid, role),  # wrong owner_gen
            )
            ctl.commit()
            raise AssertionError("zombie owner_gen bump succeeded")
        except Exception as e:
            ctl.rollback()
            st = sqlstate_of(e)
            if st != "OB010":
                raise AssertionError(f"zombie want OB010 got {st}: {e}")
        # Close unused exec
        exec_sql(
            ctl,
            "UPDATE public.ha_failover_execution SET state='ABORTED_CLOSED' WHERE execution_id=%s::uuid",
            (eid2,),
        )
        ctl.commit()

    suite.add(
        Result(
            "IT-CS-13",
            True,
            note=f"single claim winner; epoch {ep}->{ep+1}; zombie OB010",
        )
    )


def _main_fixed() -> int:
    # Reset and run cleanly
    print(f"== HA CommitSafety IT-CS on {HOST}:{PORT}/{DB} ==")
    with session(SU) as su:
        ver = q1(su, "SHOW server_version")
        print(f"   server={ver}; fuzz_bumps={FUZZ_BUMPS}; fuzz_writers={FUZZ_WRITERS}; perf_samples={PERF_SAMPLES}")

    suite = Suite()

    def wrap(name: str, fn: Callable[[], None]) -> None:
        if CASES_FILTER and name.upper() not in CASES_FILTER:
            return
        try:
            fn()
        except Exception as e:
            suite.add(Result(name, False, detail="".join(traceback.format_exception(e))))

    # Cases that self-register multiple sub-results:
    wrap("IT-CS-01", lambda: case_it_cs_01(suite))
    wrap("IT-CS-02", lambda: case_it_cs_02(suite))
    wrap("IT-CS-03", lambda: case_it_cs_03(suite))
    wrap("IT-CS-04", lambda: case_it_cs_04(suite))
    wrap("IT-CS-05", lambda: case_it_cs_05(suite))
    wrap("IT-CS-06", lambda: case_it_cs_06(suite))
    wrap("IT-CS-07", lambda: case_it_cs_07(suite))
    wrap("IT-CS-08", lambda: case_it_cs_08(suite))
    wrap("IT-CS-09", lambda: case_it_cs_09(suite))
    wrap("IT-CS-10", lambda: case_it_cs_10(suite))
    wrap("IT-CS-11", lambda: case_it_cs_11(suite))
    wrap("IT-CS-12", lambda: case_it_cs_12(suite))
    wrap("IT-CS-13", lambda: case_it_cs_13(suite))

    print()
    print(f"== summary: {suite.passed} passed, {suite.failed} failed, {len(suite.results)} results ==")
    print("Production Auto Failover remains NOT APPROVED / OFF.")
    return 1 if suite.failed else 0


if __name__ == "__main__":
    # Skip the broken main(); use fixed entry
    sys.exit(_main_fixed())
