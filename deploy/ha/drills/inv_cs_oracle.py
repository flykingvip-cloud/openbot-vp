"""Logical-decoding INV-CS oracle for Stage B drills (§19.1.6 / §19.2-16)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

import psycopg

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

SLOT = "ha_drill_oracle"


@dataclass
class OracleReport:
    violations: list[str] = field(default_factory=list)
    bumps: list[int] = field(default_factory=list)
    probe_commits: int = 0
    raw_txns: int = 0


def ensure_slot(su: psycopg.Connection) -> None:
    with su.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM pg_replication_slots WHERE slot_name = %s
            """,
            (SLOT,),
        )
        if cur.fetchone() is None:
            cur.execute(
                "SELECT pg_create_logical_replication_slot(%s, 'test_decoding')",
                (SLOT,),
            )
        su.commit()


def peek_advance(su: psycopg.Connection) -> None:
    with su.cursor() as cur:
        cur.execute(
            f"""
            SELECT count(*) FROM pg_logical_slot_get_changes(%s, NULL, NULL,
                 'include-xids', '1', 'skip-empty-xacts', '1')
            """,
            (SLOT,),
        )
        cur.fetchone()
    su.commit()


def consume(su: psycopg.Connection, initial_epoch: int) -> OracleReport:
    report = OracleReport()
    cur_epoch = initial_epoch
    with su.cursor() as cur:
        cur.execute(
            """
            SELECT lsn::text AS lsn, xid::text AS xid, data
              FROM pg_logical_slot_get_changes(%s, NULL, NULL,
                   'include-xids', '1', 'skip-empty-xacts', '1')
            """,
            (SLOT,),
        )
        changes = list(cur.fetchall())
    su.commit()

    pending_probes: list[tuple[str, int]] = []
    pending_bump: Optional[int] = None
    for row in changes:
        data = row["data"] if isinstance(row, dict) else row[2]
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
                        f"INV-CS: {table} written_epoch={we} < cur={cur_epoch}"
                    )
            pending_probes = []
            pending_bump = None
    return report
