"""Crash recovery / reconcile on start or takeover (§12.6)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import psycopg

import db
from states import PRE_VERIFIED, TERMINAL


@dataclass
class RecoveryPlan:
    execution_id: str
    state: str
    owner_gen: int
    from_epoch: int
    to_epoch: Optional[int]
    action: str  # resume_fence | bump_after_drain | redo_bump | continue_promote | observe | none
    detail: str


def read_truth(conn: psycopg.Connection, lock_name: str = "openbot_writer") -> dict:
    g = db.q(
        conn,
        "SELECT * FROM public.writer_epoch_guard WHERE lock_name = %s",
        (lock_name,),
    )
    l = db.q(
        conn,
        "SELECT * FROM public.writer_lease WHERE lock_name = %s",
        (lock_name,),
    )
    return {"guard": g[0] if g else None, "lease": l[0] if l else None}


def plan_for_execution(conn: psycopg.Connection, row: dict) -> RecoveryPlan:
    """Decide resume point from execution row + guard/lease truth (§12.6)."""
    eid = str(row["execution_id"])
    state = row["state"]
    owner_gen = int(row["owner_gen"])
    from_epoch = int(row["from_epoch"])
    to_epoch = int(row["to_epoch"]) if row.get("to_epoch") is not None else None
    truth = read_truth(conn, row["lock_name"])
    guard_epoch = int(truth["guard"]["current_epoch"]) if truth["guard"] else None

    if state in TERMINAL:
        return RecoveryPlan(eid, state, owner_gen, from_epoch, to_epoch, "none", "terminal")

    if state in PRE_VERIFIED or state == "CLAIMED":
        return RecoveryPlan(
            eid, state, owner_gen, from_epoch, to_epoch,
            "resume_fence",
            "state < VERIFIED: idempotent redo Fence/Drain; must NOT bump",
        )

    if state == "VERIFIED":
        if guard_epoch == from_epoch:
            return RecoveryPlan(
                eid, state, owner_gen, from_epoch, to_epoch,
                "bump_after_drain",
                "VERIFIED and guard still from_epoch: drain confirm then bump",
            )
        if guard_epoch == (from_epoch + 1):
            return RecoveryPlan(
                eid, state, owner_gen, from_epoch, to_epoch,
                "continue_promote",
                "guard already advanced; treat as post-bump and continue Promote/CF",
            )
        return RecoveryPlan(
            eid, state, owner_gen, from_epoch, to_epoch,
            "observe",
            f"unexpected guard_epoch={guard_epoch}",
        )

    if state == "LEASED":
        expected = to_epoch if to_epoch is not None else from_epoch + 1
        if guard_epoch != expected:
            return RecoveryPlan(
                eid, state, owner_gen, from_epoch, to_epoch,
                "redo_bump",
                "LEASED but guard != to_epoch (E6): re-drain and redo bump",
            )
        return RecoveryPlan(
            eid, state, owner_gen, from_epoch, to_epoch,
            "continue_promote",
            "LEASED consistent: continue Promote/CF",
        )

    if state in ("PROMOTING", "CF_CUTOVER", "OBSERVING"):
        return RecoveryPlan(
            eid, state, owner_gen, from_epoch, to_epoch,
            "continue_promote",
            "post-lease path: continue Promote/CF/OBSERVING→DONE",
        )

    return RecoveryPlan(eid, state, owner_gen, from_epoch, to_epoch, "observe", f"unhandled state {state}")


def scan_recoverable(conn: psycopg.Connection, lock_name: str = "openbot_writer") -> list[RecoveryPlan]:
    rows = db.q(
        conn,
        """
        SELECT * FROM public.ha_failover_execution
         WHERE lock_name = %s
           AND state NOT IN ('DONE','ABORTED_MANUAL','ABORTED_CLOSED')
         ORDER BY created_at
        """,
        (lock_name,),
    )
    return [plan_for_execution(conn, r) for r in rows]
