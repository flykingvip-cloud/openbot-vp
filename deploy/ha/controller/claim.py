"""Claim-first DB arbitration (§12.4.1). LOST_CLAIM → zero side effects."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Optional

import psycopg

import db


@dataclass
class ClaimResult:
    won: bool
    execution_id: Optional[str]
    owner_gen: int
    from_epoch: Optional[int]
    from_holder: Optional[str]
    to_holder: Optional[str]
    state: str  # CLAIMED | LOST_CLAIM


CLAIM_SQL = """
INSERT INTO public.ha_failover_execution
       (execution_id, lock_name, from_epoch, from_holder, to_holder,
        owner_controller_id, owner_gen, owner_lease_until, state, mode)
SELECT %(execution_id)s::uuid, g.lock_name, g.current_epoch, l.holder_id, %(to_holder)s,
       %(controller_id)s, 1, now() + (%(ttl_s)s || ' seconds')::interval, 'CLAIMED', %(mode)s
  FROM public.writer_epoch_guard g
  JOIN public.writer_lease l USING (lock_name)
 WHERE g.lock_name = %(lock_name)s
   AND g.current_epoch = %(observed_epoch)s
ON CONFLICT (lock_name, from_epoch) WHERE (state <> 'ABORTED_CLOSED')
DO NOTHING
RETURNING execution_id::text, owner_gen, from_epoch, from_holder, to_holder, state
"""


def claim(
    conn: psycopg.Connection,
    *,
    controller_id: str,
    observed_epoch: int,
    to_holder: str,
    mode: str = "manual",
    lock_name: str = "openbot_writer",
    ttl_s: int = 20,
    execution_id: Optional[str] = None,
) -> ClaimResult:
    """Attempt Claim. Returns LOST_CLAIM when INSERT yields 0 rows (INV-ONE / epoch moved)."""
    eid = execution_id or str(uuid.uuid4())
    rows = db.q(
        conn,
        CLAIM_SQL,
        {
            "execution_id": eid,
            "to_holder": to_holder,
            "controller_id": controller_id,
            "ttl_s": ttl_s,
            "mode": mode,
            "lock_name": lock_name,
            "observed_epoch": observed_epoch,
        },
    )
    if not rows:
        conn.commit()
        return ClaimResult(
            won=False,
            execution_id=None,
            owner_gen=0,
            from_epoch=observed_epoch,
            from_holder=None,
            to_holder=to_holder,
            state="LOST_CLAIM",
        )
    row = rows[0]
    conn.commit()
    return ClaimResult(
        won=True,
        execution_id=row["execution_id"],
        owner_gen=int(row["owner_gen"]),
        from_epoch=int(row["from_epoch"]),
        from_holder=row["from_holder"],
        to_holder=row["to_holder"],
        state="CLAIMED",
    )
