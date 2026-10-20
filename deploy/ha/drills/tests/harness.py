#!/usr/bin/env python3
"""
HA V2.1.2 Stage B — lab drills 16L–19L harness.

Lab form only. Production Auto Failover remains OFF / NOT APPROVED.
Real Network Fence / CF / Managed PG vendor FO → Stage D.

Env: PGHOST/PGPORT/PGDATABASE/PGUSER from run-ephemeral.sh
"""
from __future__ import annotations

import os
import sys
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import psycopg
from psycopg.rows import dict_row

import adapters
import db
from config import ControllerConfig
from runtime import Controller

import injectors
import inv_cs_oracle
import lab_adapters
import report as report_mod
from rpo_ledger import ExternalAckLedger

HOST = os.environ.get("PGHOST", "/tmp")
PORT = int(os.environ.get("PGPORT", "5432"))
DBNAME = os.environ.get("PGDATABASE", "ha_drill_it")
SU = os.environ.get("PGUSER", "hacs_su")
RESULTS = Path(os.environ.get("HA_DRILL_RESULTS", Path(__file__).resolve().parent / "results"))

# Lab inject counts (spec ≥100 each). Override with HA_DRILL_INJECT_N for faster local loops.
INJECT_N = int(os.environ.get("HA_DRILL_INJECT_N", "100"))
# 17L T_wait — use short lab wait by default so suite finishes; still counted in T_old_txn_drain.
# Spec upper bound is 5s; set HA_DRILL_T_WAIT_S=5 for full-budget soak.
T_WAIT_S = float(os.environ.get("HA_DRILL_T_WAIT_S", "0.5"))


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
            for line in r.detail.strip().splitlines()[:40]:
                print(f"        {line}")
        self.results.append(r)

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if not r.ok)


def dsn_for(user: str) -> str:
    return f"dbname={DBNAME} user={user} host={HOST} port={PORT}"


def cfg(cid: str, domain: str = "lab-a") -> ControllerConfig:
    return ControllerConfig(
        controller_id=cid,
        failure_domain=domain,
        version="stage-b-drill",
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


def holder_id(conn) -> str:
    return str(db.q1(conn, "SELECT holder_id FROM public.writer_lease WHERE lock_name='openbot_writer'"))


def holder_role(conn) -> Optional[str]:
    return db.q1(
        conn,
        "SELECT holder_db_role FROM public.writer_epoch_guard WHERE lock_name='openbot_writer'",
    )


def abort_live(conn) -> None:
    db.exec_sql(
        conn,
        """
        UPDATE public.ha_failover_execution
           SET state='ABORTED_CLOSED', updated_at=now()
         WHERE state NOT IN ('DONE','ABORTED_CLOSED','LEASED')
        """,
    )
    conn.commit()


def bootstrap_holder(su_dsn: str, ctl_dsn: str) -> tuple[int, str, str]:
    """Ensure a leased epoch with a real openbot_app_* holder (like IT-CS)."""
    with db.session(su_dsn) as su, db.session(ctl_dsn) as ctl:
        ep = current_epoch(su)
        role = holder_role(su)
        hid = holder_id(su)
        if role is not None and ep >= 1:
            return ep, hid, role
        # First bump bootstrap -> node-a
        eid = str(uuid.uuid4())
        abort_live(ctl)
        db.exec_sql(
            ctl,
            """
            INSERT INTO public.ha_failover_execution
              (execution_id, lock_name, from_epoch, from_holder, to_holder,
               owner_controller_id, owner_gen, owner_lease_until, state, mode)
            VALUES (%s::uuid, 'openbot_writer', %s, %s, 'node-a',
                    'bootstrap', 1, now() + interval '60 seconds', 'VERIFIED', 'manual')
            """,
            (eid, ep, hid or "bootstrap"),
        )
        ctl.commit()
        db.exec_sql(ctl, "BEGIN")
        db.exec_sql(ctl, "SET LOCAL lock_timeout = '5s'")
        rows = db.q(
            ctl,
            "SELECT public.openbot_ha_bump_epoch(%s::uuid, 1, %s, %s, %s::name) AS e",
            (eid, ep, "node-a", "openbot_app_a"),
        )
        ctl.commit()
        return int(rows[0]["e"]), "node-a", "openbot_app_a"


def other_holder(hid: str) -> str:
    return "node-b" if hid != "node-b" else "node-a"


def other_role(role: str) -> str:
    return "openbot_app_b" if role == "openbot_app_a" else "openbot_app_a"


def make_lab_adapter(
    *,
    app_fence_acked: bool = False,
    t_wait_s: float = T_WAIT_S,
) -> lab_adapters.LabFenceAdapter:
    return lab_adapters.LabFenceAdapter(
        dsn_for("openbot_controller"),
        app_fence_acked=app_fence_acked,
        t_wait_s=t_wait_s,
        skip_compute_documented=True,
    )


def force_clear_app_sessions() -> None:
    with db.session(dsn_for(SU)) as su:
        db.q(
            su,
            """
            SELECT pg_terminate_backend(pid)
              FROM pg_stat_activity
             WHERE datname = current_database()
               AND pid <> pg_backend_pid()
               AND usename IN ('openbot_app_a', 'openbot_app_b')
            """,
        )
        su.commit()


# ---------------------------------------------------------------------------
# DRILL-16L
# ---------------------------------------------------------------------------

def case_16l(suite: Suite) -> None:
    """CommitSafety race under ephemeral FO; INV-CS = 0 (lab Network)."""
    rep = report_mod.DrillReport(
        drill_id="DRILL-16L",
        form="lab",
        started_at_utc8=report_mod.now_utc8_label(),
        stage_d_deferred=[
            "production-form real Network Fence (SG/NACL)",
            "real Cloudflare Origin / pool API",
            "≥50% production write peak sustained soak",
        ],
    )
    force_clear_app_sessions()
    ep, hid, role = bootstrap_holder(dsn_for(SU), dsn_for("openbot_controller"))
    to_h, to_r = other_holder(hid), other_role(role)

    with db.session(dsn_for(SU)) as su:
        abort_live(su)
        inv_cs_oracle.ensure_slot(su)
        inv_cs_oracle.peek_advance(su)
        initial = current_epoch(su)

    go_commit = threading.Event()
    go_gate = threading.Event()
    ready_pbc = threading.Event()
    ready_pbg = threading.Event()
    stats_pbc = injectors.InjectStats()
    stats_pbg = injectors.InjectStats()

    su_dsn = dsn_for(SU)
    # Use controller DSN shape for host/port; injectors rebuild user.
    base_dsn = dsn_for(SU)

    t_pbc = injectors.spawn_pause_before_commit(
        dsn=base_dsn,
        role=role,
        holder_id=hid,
        epoch=ep,
        n=INJECT_N,
        go_commit=go_commit,
        ready=ready_pbc,
        stats=stats_pbc,
        note_prefix="pbc16",
    )
    t_pbg = injectors.spawn_pause_before_gate(
        dsn=base_dsn,
        role=role,
        holder_id=hid,
        epoch=ep,
        n=INJECT_N,
        go_gate=go_gate,
        ready=ready_pbg,
        stats=stats_pbg,
        note_prefix="pbg16",
    )
    if not ready_pbc.wait(120) or not ready_pbg.wait(120):
        suite.add(Result("DRILL-16L", False, "injectors not ready"))
        return
    if stats_pbc.started < INJECT_N or stats_pbg.started < INJECT_N:
        suite.add(
            Result(
                "DRILL-16L",
                False,
                f"inject started pbc={stats_pbc.started} pbg={stats_pbg.started} want ≥{INJECT_N}",
            )
        )
        return

    rep.add(f"injected pause-before-commit={stats_pbc.started} pause-before-gate={stats_pbg.started}")

    adapter = make_lab_adapter(app_fence_acked=False, t_wait_s=0)
    ctl = Controller(
        cfg("controller-1", "az-a"),
        adapter=adapter,
        adapter_factory=lambda: make_lab_adapter(app_fence_acked=False, t_wait_s=0),
    )
    t0 = time.monotonic()
    result = ctl.run_manual_failover(
        to_holder=to_h,
        to_db_role=to_r,
        observed_epoch=ep,
        skip_compute=True,
    )
    fo_s = time.monotonic() - t0
    rep.execution_id = result.execution_id
    rep.add(f"failover outcome={result.outcome} elapsed={fo_s:.3f}s steps={result.steps}")

    # Release injectors after FO (epoch bumped or failed)
    go_commit.set()
    go_gate.set()
    for t in t_pbc + t_pbg:
        t.join(30)

    with db.session(dsn_for(SU)) as su:
        oracle = inv_cs_oracle.consume(su, initial)
        new_ep = current_epoch(su)

    inv = {
        "violations": len(oracle.violations),
        "probe_commits": oracle.probe_commits,
        "bumps": oracle.bumps,
        "samples": oracle.violations[:5],
        "pbc_committed": stats_pbc.committed,
        "pbc_rejected": stats_pbc.rejected,
        "pbg_committed": stats_pbg.committed,
        "pbg_rejected": stats_pbg.rejected,
    }
    rep.inv_cs = inv
    rep.verify_evidence = dict(adapter.last_verify)
    rep.drain_evidence = {
        "timings": {
            "t_scan": adapter.timings.t_scan,
            "t_wait": adapter.timings.t_wait,
            "t_terminate": adapter.timings.t_terminate,
            "t_confirm": adapter.timings.t_confirm,
            "t_old_txn_drain": adapter.timings.t_old_txn_drain,
        },
        "terminated": adapter.timings.terminated,
    }
    rep.t_components = {"failover_wall_s": round(fo_s, 4), **rep.drain_evidence["timings"]}
    rep.finished_at_utc8 = report_mod.now_utc8_label()

    ok = (
        result.outcome == "DONE"
        and new_ep == ep + 1
        and len(oracle.violations) == 0
        and stats_pbc.started >= INJECT_N
        and stats_pbg.started >= INJECT_N
    )
    if stats_pbc.errors or stats_pbg.errors:
        rep.deviations.append(f"injector notes: {(stats_pbc.errors + stats_pbg.errors)[:5]}")
    rep.verdict = "PASS" if ok else "FAIL"
    report_mod.write_reports(RESULTS, rep)

    detail = (
        f"outcome={result.outcome} epoch {ep}->{new_ep} "
        f"INV-CS={len(oracle.violations)} "
        f"pbc={stats_pbc.started}/{stats_pbc.rejected}rej "
        f"pbg={stats_pbg.started}/{stats_pbg.rejected}rej "
        f"T_drain={adapter.timings.t_old_txn_drain:.3f}s"
    )
    suite.add(Result("DRILL-16L", ok, detail))


# ---------------------------------------------------------------------------
# DRILL-17L
# ---------------------------------------------------------------------------

def case_17l(suite: Suite) -> None:
    """Long txn across FO; order wait→Network→terminate→epoch++; T_old_txn_drain ≤ 8.5s."""
    rep = report_mod.DrillReport(
        drill_id="DRILL-17L",
        form="lab",
        started_at_utc8=report_mod.now_utc8_label(),
        stage_d_deferred=[
            "real Network Fence before terminate",
            "real Compute Fence",
            "full RTO path with CF propagation",
        ],
    )
    force_clear_app_sessions()
    ep, hid, role = bootstrap_holder(dsn_for(SU), dsn_for("openbot_controller"))
    to_h, to_r = other_holder(hid), other_role(role)

    row_ids = [f"long17-{i}-{uuid.uuid4().hex[:6]}" for i in range(3)]
    # Seed rows under current epoch so FOR UPDATE works
    with psycopg.connect(dsn_for(role), application_name=injectors.app_name(hid, "seed"), row_factory=dict_row) as a:
        with a.cursor() as cur:
            cur.execute("BEGIN")
            cur.execute("SELECT set_config('openbot.expected_epoch', %s, true)", (str(ep),))
            for rid in row_ids:
                cur.execute(
                    "INSERT INTO public.cs_probe(id, written_epoch, note) VALUES (%s,%s,'seed17')",
                    (rid, ep),
                )
            a.commit()

    with db.session(dsn_for("openbot_controller")) as ctl:
        abort_live(ctl)

    gated = threading.Event()
    stats = injectors.InjectStats()
    threads = injectors.spawn_long_writers(
        dsn=dsn_for(SU),
        role=role,
        holder_id=hid,
        epoch=ep,
        row_ids=row_ids,
        gated=gated,
        stats=stats,
    )
    if not gated.wait(30):
        suite.add(Result("DRILL-17L", False, "long writers did not gate"))
        return
    rep.add(f"long writers holding gate+row locks n={stats.started}")

    # App fence acked → exercise T_wait path (lab-shortened via HA_DRILL_T_WAIT_S)
    adapter = make_lab_adapter(app_fence_acked=True, t_wait_s=T_WAIT_S)
    ctl = Controller(
        cfg("controller-1", "az-a"),
        adapter=adapter,
        adapter_factory=lambda: make_lab_adapter(app_fence_acked=True, t_wait_s=T_WAIT_S),
    )

    # Measure drain around FO (adapter timings cover wait+terminate+confirm)
    t0 = time.monotonic()
    result = ctl.run_manual_failover(
        to_holder=to_h,
        to_db_role=to_r,
        observed_epoch=ep,
        skip_compute=True,  # Compute skip documented in lab receipt
    )
    wall = time.monotonic() - t0
    drain = adapter.timings.t_old_txn_drain
    rep.execution_id = result.execution_id
    rep.add(
        f"order: FENCING_APP→DRAIN_WAIT(wait={adapter.timings.t_wait}s)→"
        f"FENCING_NETWORK(lab)→TERMINATE→VERIFY→epoch++"
    )
    rep.add(f"outcome={result.outcome} steps={result.steps}")

    for t in threads:
        t.join(15)

    # New writer must write same rows under new epoch
    with db.session(dsn_for(SU)) as su:
        new_ep = current_epoch(su)
        new_role = holder_role(su)
        new_hid = holder_id(su)

    write_ok = False
    write_err = ""
    if result.outcome == "DONE" and new_role:
        try:
            with psycopg.connect(
                dsn_for(new_role),
                application_name=injectors.app_name(new_hid, "post17"),
                row_factory=dict_row,
            ) as a:
                with a.cursor() as cur:
                    cur.execute("BEGIN")
                    cur.execute(
                        "SELECT set_config('openbot.expected_epoch', %s, true)",
                        (str(new_ep),),
                    )
                    for rid in row_ids:
                        # UPDATE note (written_epoch immutable) — proves row lock released
                        cur.execute(
                            "UPDATE public.cs_probe SET note='post-fo-17' WHERE id=%s",
                            (rid,),
                        )
                    a.commit()
                write_ok = True
        except Exception as e:
            write_err = str(e)

    rep.drain_evidence = {
        "t_old_txn_drain": drain,
        "timings": {
            "t_scan": adapter.timings.t_scan,
            "t_wait": adapter.timings.t_wait,
            "t_terminate": adapter.timings.t_terminate,
            "t_confirm": adapter.timings.t_confirm,
        },
        "terminated": adapter.timings.terminated,
        "wall_s": wall,
    }
    rep.verify_evidence = dict(adapter.last_verify)
    rep.t_components = {"T_old_txn_drain": round(drain, 4), "failover_wall_s": round(wall, 4)}
    rep.finished_at_utc8 = report_mod.now_utc8_label()

    ok = (
        result.outcome == "DONE"
        and drain <= 8.5
        and write_ok
        and new_ep == ep + 1
        and "FENCING_NETWORK" in (result.steps or [])
        and "TERMINATING_OLD_SESSIONS" in (result.steps or [])
    )
    if not write_ok:
        rep.deviations.append(f"new writer failed: {write_err}")
    rep.verdict = "PASS" if ok else "FAIL"
    report_mod.write_reports(RESULTS, rep)
    suite.add(
        Result(
            "DRILL-17L",
            ok,
            f"outcome={result.outcome} T_old_txn_drain={drain:.3f}s≤8.5 "
            f"wait={adapter.timings.t_wait:.3f}s write_ok={write_ok} epoch {ep}->{new_ep}",
        )
    )


# ---------------------------------------------------------------------------
# DRILL-18L
# ---------------------------------------------------------------------------

def case_18l(suite: Suite) -> None:
    """RPO harness: ha_rpo_probe + external ACK ledger; lab-partial fault."""
    rep = report_mod.DrillReport(
        drill_id="DRILL-18L",
        form="lab",
        started_at_utc8=report_mod.now_utc8_label(),
        stage_d_deferred=[
            "Managed PG vendor-forced primary kill",
            "synchronous_commit=on multi-AZ Lost=0 proof",
            "production peak TPS ×1.0–1.5 multi-run matrix",
        ],
    )
    force_clear_app_sessions()
    ep, hid, role = bootstrap_holder(dsn_for(SU), dsn_for("openbot_controller"))
    to_h, to_r = other_holder(hid), other_role(role)

    with db.session(dsn_for("openbot_controller")) as ctl:
        abort_live(ctl)

    ledger_path = RESULTS / f"rpo-ledger-{uuid.uuid4().hex[:8]}.jsonl"
    ledger = ExternalAckLedger(ledger_path)
    run_id = ledger.run_id
    n_pre = int(os.environ.get("HA_DRILL_RPO_PRE", "40"))
    n_post = int(os.environ.get("HA_DRILL_RPO_POST", "20"))

    def write_one(seq: int, expect_ep: int, mark_ack: bool = True) -> str:
        payload = f"{run_id}:{seq}"
        rec = ledger.note_sent(seq, payload)
        try:
            with psycopg.connect(
                dsn_for(role),
                application_name=injectors.app_name(hid, f"rpo-{seq}"),
                row_factory=dict_row,
            ) as a:
                with a.cursor() as cur:
                    cur.execute("BEGIN")
                    cur.execute(
                        "SELECT set_config('openbot.expected_epoch', %s, true)",
                        (str(expect_ep),),
                    )
                    cur.execute(
                        """
                        INSERT INTO public.ha_rpo_probe
                          (run_id, seq, client_sent_at, payload_sha256, written_epoch)
                        VALUES (%s::uuid, %s, now(), %s, %s)
                        """,
                        (run_id, seq, rec.payload_sha256, expect_ep),
                    )
                a.commit()
            if mark_ack:
                ledger.note_acked(seq)
            return "acked"
        except Exception as e:
            st = getattr(e, "sqlstate", None) or ""
            if st in ("OB002", "40001"):
                ledger.note_rejected(seq)
                return "rejected_by_gate"
            ledger.note_in_doubt(seq)
            return "in_doubt"

    # Steady lab load before fault
    t_load0 = time.monotonic()
    for seq in range(1, n_pre + 1):
        write_one(seq, ep)
    load_s = max(time.monotonic() - t_load0, 1e-6)
    load_tps = n_pre / load_s
    rep.add(f"pre-fault writes={n_pre} ~{load_tps:.1f} TPS (lab)")

    # LAB-PARTIAL fault: drive Dual Controller FO (not vendor PG kill)
    fault_label = "lab-partial: Dual Controller manual FO (NOT Managed PG vendor kill)"
    t_f = time.monotonic()
    # Freeze wall-clock approx for ledger (use time.time aligned)
    t_f_wall = time.time()

    adapter = make_lab_adapter(app_fence_acked=False, t_wait_s=0)
    # Capture old role for post-FO retries
    old_role, old_hid, old_ep = role, hid, ep
    ctl = Controller(
        cfg("controller-1", "az-a"),
        adapter=adapter,
        adapter_factory=lambda: make_lab_adapter(app_fence_acked=False, t_wait_s=0),
    )
    result = ctl.run_manual_failover(
        to_holder=to_h,
        to_db_role=to_r,
        observed_epoch=ep,
        skip_compute=True,
    )
    rep.execution_id = result.execution_id
    rep.add(f"fault={fault_label} outcome={result.outcome}")

    with db.session(dsn_for(SU)) as su:
        new_ep = current_epoch(su)
        new_role = holder_role(su) or to_r
        new_hid = holder_id(su)

    # Continue client retries after FO (some may hit gate on stale epoch)
    role, hid, ep = new_role, new_hid, new_ep
    for seq in range(n_pre + 1, n_pre + n_post + 1):
        # Post-FO: write under new epoch (lab client reconnect). A separate stale
        # probe uses high seq offset to exercise Rejected-by-gate without PK clash.
        write_one(seq, new_ep, mark_ack=True)
    # Stale-epoch probes (unique seqs) → expect Rejected-by-gate
    for i, seq in enumerate(range(n_pre + n_post + 1, n_pre + n_post + 6)):
        write_one(seq, old_ep, mark_ack=True)

    # Recovered set from PG
    with db.session(dsn_for(SU)) as su:
        rows = db.q(
            su,
            "SELECT seq FROM public.ha_rpo_probe WHERE run_id=%s::uuid",
            (run_id,),
        )
        recovered = {int(r["seq"]) for r in rows}

    metrics = ledger.reconcile(
        recovered_seqs=recovered,
        t_f=t_f_wall,
        fault=fault_label,
        load_tps=round(load_tps, 2),
        profile="lab",
        db_unavailable_s=0.0,
        notes=(
            "LAB-PARTIAL only. Managed PG vendor FO with sync replication Lost=0 "
            "is Stage D. Phantom must be 0."
        ),
    )
    ledger.close()

    rep.rpo = {
        "run_id": metrics.run_id,
        "Sent": metrics.sent,
        "Acknowledged": metrics.acked,
        "Recovered": metrics.recovered,
        "Lost": metrics.lost,
        "Lost@W100": metrics.lost_w100,
        "Lost@W1000": metrics.lost_w1000,
        "In-doubt": metrics.in_doubt,
        "In-doubt-recovered": metrics.in_doubt_recovered,
        "Rejected-by-gate": metrics.rejected_by_gate,
        "Phantom": metrics.phantom,
        "fault": metrics.fault,
        "verdict": metrics.verdict,
        "ledger_path": str(ledger_path),
    }
    rep.finished_at_utc8 = report_mod.now_utc8_label()
    ok = (
        result.outcome == "DONE"
        and metrics.phantom == 0
        and metrics.verdict == "PASS"
        and new_ep == old_ep + 1
    )
    rep.verdict = "PASS" if ok else "FAIL"
    report_mod.write_reports(RESULTS, rep)

    # Also emit §19.3 text template snippet
    template = RESULTS / f"DRILL-18L-rpo-template.txt"
    template.write_text(
        f"""RPO-HA Drill Report — Drill 18L (LAB FORM)
Run ID: {metrics.run_id}    Date: {rep.finished_at_utc8}    Operator: lab-harness
Vendor / Plan / HA mode: lab-ephemeral (NOT Managed PG)    synchronous_commit: n/a (single node lab)
Load: {metrics.load_tps} TPS (profile: lab)    Fault injected: {fault_label}    T_f: {t_f_wall}

Sent (|S|):                {metrics.sent}
Acknowledged (|A|):        {metrics.acked}
Recovered (|R ∩ S|):       {metrics.recovered}
Lost: N confirmed transactions      N = {metrics.lost}
  Lost@W100  (last 100 acked before T_f):   {metrics.lost_w100}
  Lost@W1000 (last 1000 acked before T_f):  {metrics.lost_w1000}
In-doubt (|D|):            {metrics.in_doubt}   (of which recovered: {metrics.in_doubt_recovered})
Rejected-by-gate:          {metrics.rejected_by_gate}
Phantom (|R \\ S|):         {metrics.phantom}   (must be 0)
DB unavailable window:     {metrics.db_unavailable_s}s
Verdict: {metrics.verdict}      Notes: {metrics.notes}
Stage D deferred: Managed PG vendor FO with sync Lost=0
""",
        encoding="utf-8",
    )

    suite.add(
        Result(
            "DRILL-18L",
            ok,
            f"outcome={result.outcome} Lost={metrics.lost} Phantom={metrics.phantom} "
            f"Rejected={metrics.rejected_by_gate} ledger={ledger_path.name}",
        )
    )


# ---------------------------------------------------------------------------
# DRILL-19L
# ---------------------------------------------------------------------------

def case_19l(suite: Suite) -> None:
    """Dual controller: domain kill, mid-run takeover, zombie no writes."""
    rep = report_mod.DrillReport(
        drill_id="DRILL-19L",
        form="lab",
        started_at_utc8=report_mod.now_utc8_label(),
        stage_d_deferred=[
            "real failure-domain network partition of Controller host",
            "production multi-AZ controller deployment soak",
        ],
    )
    force_clear_app_sessions()
    notes: list[str] = []

    # --- 19L-a: C1 "domain kill" → C2 completes FO alone ---
    ep, hid, role = bootstrap_holder(dsn_for(SU), dsn_for("openbot_controller"))
    to_h, to_r = other_holder(hid), other_role(role)
    with db.session(dsn_for("openbot_controller")) as c:
        abort_live(c)

    # Simulate C1 domain dead: only C2 runs
    adapter2 = make_lab_adapter(app_fence_acked=False, t_wait_s=0)
    c2 = Controller(
        cfg("controller-2", "az-b"),
        adapter=adapter2,
        adapter_factory=lambda: make_lab_adapter(app_fence_acked=False, t_wait_s=0),
    )
    r_a = c2.run_manual_failover(
        to_holder=to_h,
        to_db_role=to_r,
        observed_epoch=ep,
        skip_compute=True,
    )
    ok_a = r_a.outcome == "DONE"
    notes.append(f"19L-a C2 alone: outcome={r_a.outcome} eid={r_a.execution_id}")
    rep.add(notes[-1])

    # --- 19L-b: winner dies mid-run → loser takeover after lease expiry ---
    force_clear_app_sessions()
    ep, hid, role = bootstrap_holder(dsn_for(SU), dsn_for("openbot_controller"))
    to_h, to_r = other_holder(hid), other_role(role)
    with db.session(dsn_for("openbot_controller")) as c:
        abort_live(c)

    a1 = make_lab_adapter(app_fence_acked=False, t_wait_s=0)
    a2 = make_lab_adapter(app_fence_acked=False, t_wait_s=0)
    c1 = Controller(
        cfg("controller-1", "az-a"),
        adapter=a1,
        adapter_factory=lambda: make_lab_adapter(app_fence_acked=False, t_wait_s=0),
    )
    c2 = Controller(
        cfg("controller-2", "az-b"),
        adapter=a2,
        adapter_factory=lambda: make_lab_adapter(app_fence_acked=False, t_wait_s=0),
    )

    # C1 wins claim and advances to DRAIN_WAIT then "dies" (stop renewing)
    with db.session(dsn_for("openbot_controller")) as conn:
        c1.heartbeat(conn)
        cr = c1.claim(conn, observed_epoch=ep, to_holder=to_h)
        if not cr.won:
            suite.add(Result("DRILL-19L", False, "19L-b c1 claim lost"))
            return
        eid = cr.execution_id
        assert eid
        gen = cr.owner_gen
        from_holder = cr.from_holder or hid
        from_epoch = int(cr.from_epoch)  # type: ignore[arg-type]
        from_db_role = holder_role(conn)
        for cur, nxt, step in [
            ("CLAIMED", "FENCING_APP", "FENCING_APP"),
            ("FENCING_APP", "DRAIN_WAIT", "DRAIN_WAIT"),
        ]:
            c1.side_effect(
                eid, step, from_holder=from_holder, to_holder=to_h, owner_gen=gen,
                from_db_role=from_db_role, to_db_role=to_r,
            )
            rc = c1.cas_transition(
                conn, execution_id=eid, owner_gen=gen, current=cur, next_state=nxt, step_name=step
            )
            if rc != 1:
                suite.add(Result("DRILL-19L", False, f"19L-b setup CAS {cur}->{nxt} rc={rc}"))
                return
        # Expire owner lease (simulate domain death without renew)
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
        if new_gen is None:
            suite.add(Result("DRILL-19L", False, "19L-b takeover failed"))
            return

    # C2 resumes from DRAIN_WAIT
    r_b = c2.resume_failover(
        execution_id=eid,
        owner_gen=new_gen,
        to_holder=to_h,
        to_db_role=to_r,
        from_holder=from_holder,
        from_epoch=from_epoch,
        from_db_role=from_db_role,
        start_state="DRAIN_WAIT",
        skip_compute=True,
    )
    ok_b = r_b.outcome == "DONE"
    notes.append(
        f"19L-b takeover gen {gen}->{new_gen}; resume from DRAIN_WAIT → {r_b.outcome}"
    )
    rep.add(notes[-1])
    rep.execution_id = eid

    with db.session(dsn_for(SU)) as su:
        ep_after_b = current_epoch(su)

    # --- 19L-c: zombie (old gen) resume → no DB writes / epoch change ---
    ep_before_zombie = ep_after_b
    zombie = Controller(
        cfg("controller-1", "az-a"),
        adapter=make_lab_adapter(app_fence_acked=False, t_wait_s=0),
    )
    zombie.local_state = "DRAIN_WAIT"
    zombie.allow_side_effects = True
    # Attempt CAS with stale owner_gen
    with db.session(dsn_for("openbot_controller")) as conn:
        rc = zombie.cas_transition(
            conn,
            execution_id=eid,
            owner_gen=gen,  # stale
            current="DRAIN_WAIT",
            next_state="FENCING_NETWORK",
            step_name="FENCING_NETWORK",
        )
        zombie_cas_blocked = rc == 0
        # Attempt bump with stale gen
        bump_blocked = False
        try:
            db.exec_sql(conn, "BEGIN")
            db.exec_sql(conn, "SET LOCAL lock_timeout = '5s'")
            db.q(
                conn,
                "SELECT public.openbot_ha_bump_epoch(%s::uuid, %s, %s, %s, %s::name)",
                (eid, gen, from_epoch, to_h, to_r),
            )
            conn.commit()
        except Exception as e:
            conn.rollback()
            st = db.sqlstate_of(e)
            bump_blocked = st == "OB010" or "owner_gen" in str(e).lower() or st is not None
            # openbot_ha_bump_epoch raises OB010 on gen mismatch
            if st == "OB010":
                bump_blocked = True

        # Renew with stale gen → TAKEN_OVER
        rr = zombie.renew(conn, eid, gen)
        zombie_renew_taken = rr.taken_over

    with db.session(dsn_for(SU)) as su:
        ep_after_zombie = current_epoch(su)
        # Ensure zombie adapter did not terminate further (optional)
        n_live = int(
            db.q1(
                su,
                """
                SELECT count(*) FROM public.ha_failover_execution
                 WHERE execution_id=%s::uuid AND state='DONE'
                """,
                (eid,),
            )
        )

    ok_c = (
        zombie_cas_blocked
        and bump_blocked
        and zombie_renew_taken
        and ep_after_zombie == ep_before_zombie
        and n_live == 1
    )
    notes.append(
        f"19L-c zombie: cas_blocked={zombie_cas_blocked} bump_blocked={bump_blocked} "
        f"renew_taken_over={zombie_renew_taken} epoch_unchanged={ep_after_zombie == ep_before_zombie}"
    )
    rep.add(notes[-1])

    ok = ok_a and ok_b and ok_c
    rep.extra = {"notes": notes, "ok_a": ok_a, "ok_b": ok_b, "ok_c": ok_c}
    rep.finished_at_utc8 = report_mod.now_utc8_label()
    rep.verdict = "PASS" if ok else "FAIL"
    report_mod.write_reports(RESULTS, rep)
    suite.add(Result("DRILL-19L", ok, "; ".join(notes)))


def main() -> int:
    print(f"== HA Stage B lab drills 16L–19L on {HOST}:{PORT}/{DBNAME} ==")
    print(f"   Auto Failover: OFF / NOT APPROVED | form=lab | INJECT_N={INJECT_N} T_WAIT_S={T_WAIT_S}")
    RESULTS.mkdir(parents=True, exist_ok=True)
    with db.session(dsn_for(SU)) as su:
        ver = db.q1(su, "SHOW server_version")
        print(f"   server={ver}")

    suite = Suite()
    for name, fn in [
        ("DRILL-16L", case_16l),
        ("DRILL-17L", case_17l),
        ("DRILL-18L", case_18l),
        ("DRILL-19L", case_19l),
    ]:
        try:
            fn(suite)
        except Exception:
            suite.add(Result(name, False, traceback.format_exc()))
        finally:
            force_clear_app_sessions()

    print(
        f"-- {suite.failed} failed / {len(suite.results)} total "
        f"({sum(1 for r in suite.results if r.ok)} passed)"
    )
    return 1 if suite.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
