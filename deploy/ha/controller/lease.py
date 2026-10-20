"""Owner lease renew / takeover (§12.4.2–12.4.3)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import psycopg
from psycopg.types.json import Json

import db


@dataclass
class RenewResult:
    ok: bool
    taken_over: bool
    rowcount: int


def heartbeat(
    conn: psycopg.Connection,
    *,
    controller_id: str,
    failure_domain: str,
    version: str,
) -> None:
    """Upsert ha_controller_instance (§12.3)."""
    db.exec_sql(
        conn,
        """
        INSERT INTO public.ha_controller_instance
            (controller_id, failure_domain, version, last_heartbeat)
        VALUES (%s, %s, %s, now())
        ON CONFLICT (controller_id) DO UPDATE
           SET failure_domain = EXCLUDED.failure_domain,
               version = EXCLUDED.version,
               last_heartbeat = now()
        """,
        (controller_id, failure_domain, version),
    )
    conn.commit()


def renew_owner_lease(
    conn: psycopg.Connection,
    *,
    execution_id: str,
    controller_id: str,
    owner_gen: int,
    ttl_s: int = 20,
) -> RenewResult:
    """Winner renew every ~5s. rowcount 0 → TAKEN_OVER (§12.4.2)."""
    rc = db.exec_sql(
        conn,
        """
        UPDATE public.ha_failover_execution
           SET owner_lease_until = now() + (%s || ' seconds')::interval,
               updated_at = now()
         WHERE execution_id = %s::uuid
           AND owner_controller_id = %s
           AND owner_gen = %s
           AND state NOT IN ('DONE','ABORTED_MANUAL','ABORTED_CLOSED')
        """,
        (ttl_s, execution_id, controller_id, owner_gen),
    )
    conn.commit()
    if rc == 0:
        return RenewResult(ok=False, taken_over=True, rowcount=0)
    return RenewResult(ok=True, taken_over=False, rowcount=rc)


def transition(
    conn: psycopg.Connection,
    *,
    execution_id: str,
    owner_gen: int,
    current: str,
    next_state: str,
    step: dict,
) -> int:
    """CAS state transition with owner_gen (§12.4.2). Returns rowcount."""
    rc = db.exec_sql(
        conn,
        """
        UPDATE public.ha_failover_execution
           SET state = %s,
               steps = coalesce(steps, '[]'::jsonb) || %s::jsonb,
               updated_at = now()
         WHERE execution_id = %s::uuid
           AND owner_gen = %s
           AND state = %s
        """,
        (next_state, Json([step]), execution_id, owner_gen, current),
    )
    conn.commit()
    return rc


def takeover(
    conn: psycopg.Connection,
    *,
    execution_id: str,
    controller_id: str,
    ttl_s: int = 20,
) -> Optional[int]:
    """Take over when owner_lease_until < now() (§12.4.3). Returns new owner_gen or None."""
    rows = db.q(
        conn,
        """
        UPDATE public.ha_failover_execution
           SET owner_controller_id = %s,
               owner_gen = owner_gen + 1,
               owner_lease_until = now() + (%s || ' seconds')::interval,
               updated_at = now()
         WHERE execution_id = %s::uuid
           AND owner_lease_until < now()
           AND state NOT IN ('DONE','ABORTED_MANUAL','ABORTED_CLOSED')
     RETURNING owner_gen
        """,
        (controller_id, ttl_s, execution_id),
    )
    conn.commit()
    if not rows:
        return None
    return int(rows[0]["owner_gen"])


def load_execution(conn: psycopg.Connection, execution_id: str) -> Optional[dict]:
    rows = db.q(
        conn,
        "SELECT * FROM public.ha_failover_execution WHERE execution_id = %s::uuid",
        (execution_id,),
    )
    return rows[0] if rows else None


def list_nonterminal(conn: psycopg.Connection, lock_name: str = "openbot_writer") -> list[dict]:
    return db.q(
        conn,
        """
        SELECT * FROM public.ha_failover_execution
         WHERE lock_name = %s
           AND state NOT IN ('DONE','ABORTED_MANUAL','ABORTED_CLOSED')
         ORDER BY created_at
        """,
        (lock_name,),
    )


