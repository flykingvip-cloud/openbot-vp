"""DB helpers for Dual Controller (psycopg, openbot_controller role)."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator, Optional

import psycopg
from psycopg.rows import dict_row


def connect(dsn: str, *, autocommit: bool = False, appname: str = "ha-controller") -> psycopg.Connection:
    return psycopg.connect(dsn, autocommit=autocommit, application_name=appname, row_factory=dict_row)


@contextmanager
def session(dsn: str, *, appname: str = "ha-controller") -> Iterator[psycopg.Connection]:
    conn = connect(dsn, appname=appname)
    try:
        yield conn
    finally:
        conn.close()


def q(conn: psycopg.Connection, sql: str, params: Any = None) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        if cur.description is None:
            return []
        return list(cur.fetchall())


def q1(conn: psycopg.Connection, sql: str, params: Any = None) -> Any:
    rows = q(conn, sql, params)
    if not rows:
        return None
    return next(iter(rows[0].values()))


def exec_sql(conn: psycopg.Connection, sql: str, params: Any = None) -> int:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.rowcount if cur.rowcount is not None else 0


def sqlstate_of(exc: BaseException) -> Optional[str]:
    if isinstance(exc, psycopg.Error) and exc.sqlstate:
        return exc.sqlstate
    return None
