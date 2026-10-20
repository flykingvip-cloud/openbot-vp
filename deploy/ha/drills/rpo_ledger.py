"""External ACK ledger for RPO drill 18L (§19.3) — PG-external append + fsync."""
from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional


@dataclass
class AckRecord:
    run_id: str
    seq: int
    payload_sha256: str
    client_sent_at: float
    acked_at: Optional[float] = None
    status: str = "sent"  # sent | acked | in_doubt | rejected_by_gate


@dataclass
class RpoMetrics:
    run_id: str
    sent: int = 0
    acked: int = 0
    recovered: int = 0
    lost: int = 0
    lost_w100: int = 0
    lost_w1000: int = 0
    in_doubt: int = 0
    in_doubt_recovered: int = 0
    rejected_by_gate: int = 0
    phantom: int = 0
    t_f: Optional[float] = None
    last_acked_recovered_lag_ms: Optional[float] = None
    db_unavailable_s: Optional[float] = None
    verdict: str = "FAIL"
    notes: str = ""
    fault: str = "lab-partial"
    load_tps: float = 0.0
    profile: str = "lab"


class ExternalAckLedger:
    """Append-only JSONL ledger outside PG; each ack line is fsync'd."""

    def __init__(self, path: Path, run_id: Optional[str] = None) -> None:
        self.path = path
        self.run_id = run_id or str(uuid.uuid4())
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._records: dict[int, AckRecord] = {}
        self._fh = open(self.path, "a", encoding="utf-8")

    def close(self) -> None:
        try:
            self._fh.flush()
            os.fsync(self._fh.fileno())
        finally:
            self._fh.close()

    def _append(self, obj: dict[str, Any]) -> None:
        self._fh.write(json.dumps(obj, sort_keys=True) + "\n")
        self._fh.flush()
        os.fsync(self._fh.fileno())

    def note_sent(self, seq: int, payload: str) -> AckRecord:
        sha = hashlib.sha256(payload.encode()).hexdigest()
        rec = AckRecord(
            run_id=self.run_id,
            seq=seq,
            payload_sha256=sha,
            client_sent_at=time.time(),
            status="sent",
        )
        self._records[seq] = rec
        self._append(
            {
                "event": "sent",
                "run_id": self.run_id,
                "seq": seq,
                "payload_sha256": sha,
                "client_sent_at": rec.client_sent_at,
            }
        )
        return rec

    def note_acked(self, seq: int) -> None:
        rec = self._records[seq]
        rec.acked_at = time.time()
        rec.status = "acked"
        self._append(
            {
                "event": "acked",
                "run_id": self.run_id,
                "seq": seq,
                "acked_at": rec.acked_at,
            }
        )

    def note_in_doubt(self, seq: int) -> None:
        rec = self._records[seq]
        rec.status = "in_doubt"
        self._append({"event": "in_doubt", "run_id": self.run_id, "seq": seq})

    def note_rejected(self, seq: int) -> None:
        rec = self._records[seq]
        rec.status = "rejected_by_gate"
        self._append({"event": "rejected_by_gate", "run_id": self.run_id, "seq": seq})

    def reconcile(
        self,
        *,
        recovered_seqs: set[int],
        t_f: float,
        fault: str = "lab-partial",
        load_tps: float = 0.0,
        profile: str = "lab",
        db_unavailable_s: float = 0.0,
        notes: str = "",
    ) -> RpoMetrics:
        sent = set(self._records)
        acked = {s for s, r in self._records.items() if r.status == "acked"}
        in_doubt = {s for s, r in self._records.items() if r.status == "in_doubt"}
        rejected = {s for s, r in self._records.items() if r.status == "rejected_by_gate"}

        lost_set = acked - recovered_seqs
        # Windows: last N acked before T_f
        acked_before = sorted(
            (
                s
                for s, r in self._records.items()
                if r.status == "acked" and (r.acked_at or 0) <= t_f
            ),
            key=lambda s: self._records[s].acked_at or 0,
        )
        w100 = set(acked_before[-100:])
        w1000 = set(acked_before[-1000:])
        phantom = recovered_seqs - sent

        # Last acked & recovered lag
        lag = None
        for s in reversed(acked_before):
            if s in recovered_seqs:
                lag = ((self._records[s].acked_at or t_f) - t_f) * 1000.0
                break

        m = RpoMetrics(
            run_id=self.run_id,
            sent=len(sent),
            acked=len(acked),
            recovered=len(recovered_seqs & sent),
            lost=len(lost_set),
            lost_w100=len(lost_set & w100),
            lost_w1000=len(lost_set & w1000),
            in_doubt=len(in_doubt),
            in_doubt_recovered=len(in_doubt & recovered_seqs),
            rejected_by_gate=len(rejected),
            phantom=len(phantom),
            t_f=t_f,
            last_acked_recovered_lag_ms=lag,
            db_unavailable_s=db_unavailable_s,
            fault=fault,
            load_tps=load_tps,
            profile=profile,
            notes=notes,
        )
        # Lab-partial: Lost may be >0; Phantom must be 0. Sync/full Managed PG Lost=0 is Stage D.
        m.verdict = "PASS" if m.phantom == 0 else "FAIL"
        if m.phantom > 0:
            m.notes = (m.notes + "; ").lstrip("; ") + "Phantom>0 data-corruption event"
        return m
