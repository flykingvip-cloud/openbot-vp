"""Concurrent writers for Stage B lab drills (pause-before-gate / pause-before-commit)."""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

import psycopg
from psycopg.rows import dict_row


def app_name(holder_id: str, tag: str) -> str:
    return f"openbot:{holder_id}:writer:{tag}"


@dataclass
class InjectStats:
    started: int = 0
    committed: int = 0
    rejected: int = 0
    errors: list[str] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def inc(self, field_name: str, n: int = 1) -> None:
        with self.lock:
            setattr(self, field_name, getattr(self, field_name) + n)

    def add_err(self, msg: str) -> None:
        with self.lock:
            if len(self.errors) < 20:
                self.errors.append(msg)


def _connect(dsn: str, user: str, holder_id: str, tag: str) -> psycopg.Connection:
    # dsn may already include user=; rebuild for openbot_app_* role.
    # Prefer host/port/dbname from env-style dsn keywords.
    parts = dict(p.split("=", 1) for p in dsn.split() if "=" in p)
    return psycopg.connect(
        host=parts.get("host", "/tmp"),
        port=int(parts.get("port", "5432")),
        dbname=parts.get("dbname", "ha_drill_it"),
        user=user,
        application_name=app_name(holder_id, tag),
        row_factory=dict_row,
    )


def spawn_pause_before_commit(
    *,
    dsn: str,
    role: str,
    holder_id: str,
    epoch: int,
    n: int,
    go_commit: threading.Event,
    ready: threading.Event,
    stats: InjectStats,
    table: str = "cs_probe",
    note_prefix: str = "pbc",
) -> list[threading.Thread]:
    """N writers: INSERT then pause until go_commit, then COMMIT (gate runs at commit)."""
    barrier = threading.Barrier(n + 1)  # +1 for caller flush
    threads: list[threading.Thread] = []

    def one(i: int) -> None:
        tag = f"{note_prefix}-{i}"
        try:
            with _connect(dsn, role, holder_id, tag) as a:
                with a.cursor() as cur:
                    cur.execute("BEGIN ISOLATION LEVEL READ COMMITTED")
                    cur.execute(
                        "SELECT set_config('openbot.expected_epoch', %s, true)",
                        (str(epoch),),
                    )
                    rid = f"{note_prefix}-{uuid.uuid4().hex[:10]}"
                    if table == "cs_probe":
                        cur.execute(
                            "INSERT INTO public.cs_probe(id, written_epoch, note) VALUES (%s,%s,%s)",
                            (rid, epoch, note_prefix),
                        )
                    else:
                        cur.execute(
                            """
                            INSERT INTO public.ha_rpo_probe
                              (run_id, seq, client_sent_at, payload_sha256, written_epoch)
                            VALUES (%s::uuid, %s, now(), %s, %s)
                            """,
                            (str(uuid.uuid4()), i + 1, f"pbc-{i}", epoch),
                        )
                stats.inc("started")
                try:
                    barrier.wait(60)
                except threading.BrokenBarrierError:
                    pass
                ready.set()
                if not go_commit.wait(120):
                    stats.add_err(f"{tag}: go_commit timeout")
                    a.rollback()
                    return
                try:
                    a.commit()
                    stats.inc("committed")
                except Exception as e:
                    stats.inc("rejected")
                    try:
                        a.rollback()
                    except Exception:
                        pass
                    # Expected post-bump: OB002
                    st = getattr(e, "sqlstate", None) or ""
                    if st and st not in ("OB002", "40001", "57P01", "08006"):
                        stats.add_err(f"{tag}: unexpected {st}: {e}")
        except Exception as e:
            stats.add_err(f"{tag}: setup {e}")
            stats.inc("rejected")

    for i in range(n):
        t = threading.Thread(target=one, args=(i,), daemon=True)
        threads.append(t)
        t.start()
    # Wait until all have inserted (or timed out)
    try:
        barrier.wait(90)
    except threading.BrokenBarrierError:
        stats.add_err("pause-before-commit barrier broken")
    ready.set()
    return threads


def spawn_pause_before_gate(
    *,
    dsn: str,
    role: str,
    holder_id: str,
    epoch: int,
    n: int,
    go_gate: threading.Event,
    ready: threading.Event,
    stats: InjectStats,
    note_prefix: str = "pbg",
) -> list[threading.Thread]:
    """N writers: BEGIN + set epoch, pause, then explicit gate + INSERT + COMMIT."""
    barrier = threading.Barrier(n + 1)
    threads: list[threading.Thread] = []

    def one(i: int) -> None:
        tag = f"{note_prefix}-{i}"
        try:
            with _connect(dsn, role, holder_id, tag) as a:
                with a.cursor() as cur:
                    cur.execute("BEGIN ISOLATION LEVEL READ COMMITTED")
                    cur.execute(
                        "SELECT set_config('openbot.expected_epoch', %s, true)",
                        (str(epoch),),
                    )
                stats.inc("started")
                try:
                    barrier.wait(60)
                except threading.BrokenBarrierError:
                    pass
                ready.set()
                if not go_gate.wait(120):
                    stats.add_err(f"{tag}: go_gate timeout")
                    a.rollback()
                    return
                try:
                    with a.cursor() as cur:
                        cur.execute("SELECT public.openbot_ha_commit_gate()")
                        rid = f"{note_prefix}-{uuid.uuid4().hex[:10]}"
                        cur.execute(
                            "INSERT INTO public.cs_probe(id, written_epoch, note) VALUES (%s,%s,%s)",
                            (rid, epoch, note_prefix),
                        )
                    a.commit()
                    stats.inc("committed")
                except Exception as e:
                    stats.inc("rejected")
                    try:
                        a.rollback()
                    except Exception:
                        pass
                    st = getattr(e, "sqlstate", None) or ""
                    if st and st not in ("OB002", "40001", "55P03", "57P01", "08006"):
                        stats.add_err(f"{tag}: unexpected {st}: {e}")
        except Exception as e:
            stats.add_err(f"{tag}: setup {e}")
            stats.inc("rejected")

    for i in range(n):
        t = threading.Thread(target=one, args=(i,), daemon=True)
        threads.append(t)
        t.start()
    try:
        barrier.wait(90)
    except threading.BrokenBarrierError:
        stats.add_err("pause-before-gate barrier broken")
    ready.set()
    return threads


def spawn_long_writers(
    *,
    dsn: str,
    role: str,
    holder_id: str,
    epoch: int,
    row_ids: list[str],
    gated: threading.Event,
    stats: InjectStats,
) -> list[threading.Thread]:
    """Hold ROW SHARE via explicit gate + row lock, then sleep until terminated."""
    threads: list[threading.Thread] = []
    ready_n = {"n": 0}
    lock = threading.Lock()

    def one(rid: str, i: int) -> None:
        tag = f"long-{i}"
        try:
            with _connect(dsn, role, holder_id, tag) as a:
                with a.cursor() as cur:
                    cur.execute("SET statement_timeout = 0")
                    cur.execute("SET lock_timeout = 0")
                    cur.execute("SET idle_in_transaction_session_timeout = 0")
                    cur.execute("BEGIN")
                    cur.execute(
                        "SELECT set_config('openbot.expected_epoch', %s, true)",
                        (str(epoch),),
                    )
                    # Ensure row exists under current epoch (seeded by harness)
                    cur.execute(
                        "SELECT id FROM public.cs_probe WHERE id=%s FOR UPDATE",
                        (rid,),
                    )
                    cur.execute("SELECT public.openbot_ha_commit_gate()")
                stats.inc("started")
                with lock:
                    ready_n["n"] += 1
                    if ready_n["n"] >= len(row_ids):
                        gated.set()
                try:
                    with a.cursor() as cur:
                        cur.execute("SELECT pg_sleep(60)")
                    a.commit()
                    stats.inc("committed")
                except Exception:
                    stats.inc("rejected")
                    try:
                        a.rollback()
                    except Exception:
                        pass
        except Exception as e:
            stats.add_err(f"{tag}: {e}")
            gated.set()

    for i, rid in enumerate(row_ids):
        t = threading.Thread(target=one, args=(rid, i), daemon=True)
        threads.append(t)
        t.start()
    return threads
