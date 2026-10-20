"""§19.4 drill report helpers (markdown + JSON)."""
from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional


@dataclass
class DrillReport:
    drill_id: str
    execution_id: Optional[str] = None
    form: str = "lab"
    auto_failover: str = "OFF / NOT APPROVED"
    started_at_utc8: str = ""
    finished_at_utc8: str = ""
    timeline: list[str] = field(default_factory=list)
    t_components: dict[str, float] = field(default_factory=dict)
    fence_level: str = "lab Network/CF stubs + real terminate/VERIFY"
    drain_evidence: dict[str, Any] = field(default_factory=dict)
    verify_evidence: dict[str, Any] = field(default_factory=dict)
    inv_cs: dict[str, Any] = field(default_factory=dict)
    rpo: dict[str, Any] = field(default_factory=dict)
    verdict: str = "FAIL"
    deviations: list[str] = field(default_factory=list)
    stage_d_deferred: list[str] = field(default_factory=list)
    signer: str = "lab-harness"
    extra: dict[str, Any] = field(default_factory=dict)

    def add(self, line: str) -> None:
        self.timeline.append(line)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_markdown(self) -> str:
        lines = [
            f"# Drill Report — {self.drill_id}",
            "",
            f"- form: **{self.form}**",
            f"- Production Auto Failover: **{self.auto_failover}**",
            f"- execution_id: `{self.execution_id or 'n/a'}`",
            f"- started (UTC+8): {self.started_at_utc8}",
            f"- finished (UTC+8): {self.finished_at_utc8}",
            f"- Fence level: {self.fence_level}",
            f"- Verdict: **{self.verdict}**",
            "",
            "## Timeline",
        ]
        for t in self.timeline:
            lines.append(f"- {t}")
        if self.t_components:
            lines += ["", "## T_* components"]
            for k, v in self.t_components.items():
                lines.append(f"- `{k}`: {v}")
        if self.drain_evidence:
            lines += ["", "## Drain evidence", "```json", json.dumps(self.drain_evidence, indent=2), "```"]
        if self.verify_evidence:
            lines += ["", "## VERIFY evidence", "```json", json.dumps(self.verify_evidence, indent=2), "```"]
        if self.inv_cs:
            lines += ["", "## INV-CS audit", "```json", json.dumps(self.inv_cs, indent=2), "```"]
        if self.rpo:
            lines += ["", "## RPO metrics", "```json", json.dumps(self.rpo, indent=2), "```"]
        if self.deviations:
            lines += ["", "## Deviations"] + [f"- {d}" for d in self.deviations]
        if self.stage_d_deferred:
            lines += ["", "## Deferred to Stage D"] + [f"- {d}" for d in self.stage_d_deferred]
        lines += ["", f"Signer: {self.signer}"]
        return "\n".join(lines) + "\n"


def now_utc8_label() -> str:
    # Box/host already Asia/Shanghai for this user.
    return time.strftime("%Y-%m-%d %H:%M:%S %z") + " (UTC+8)"


def write_reports(out_dir: Path, report: DrillReport) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    md = out_dir / f"{report.drill_id}.md"
    js = out_dir / f"{report.drill_id}.json"
    md.write_text(report.to_markdown(), encoding="utf-8")
    js.write_text(json.dumps(report.to_dict(), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return md, js
