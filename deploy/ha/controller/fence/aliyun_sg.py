"""Aliyun ECS Security Group — E2b-O2 snapshot / isolate / restore **dry paths**.

Scope (O2, ``HA_ALIYUN_LIVE_MUTATE`` stays ``0``):
  * ``snapshot_sg`` / ``isolate`` / ``restore`` *planning* + a versioned
    **receipt schema** (``RECEIPT_SCHEMA``) shared by dry and (future, O3) live paths.
  * Pure functions only — this module never signs, never sends, never resolves
    credentials. OpenAPI calls are described as *intended* (action + param shape);
    the network client decides whether anything read-only is actually issued.
  * Isolate rule set (blast radius) is policy-driven: only ingress ``accept`` rules
    whose port range overlaps ``isolate_port_ranges`` (default PG ``5432/5432``)
    are planned for revoke; any rule that also overlaps ``protected_port_ranges``
    (default SSH ``22/22``) is **never** revoked (blocked + reported). Owner decision
    #2 (HK SG isolate rule set) still pending — defaults are placeholders.
  * Pre-mutate snapshot is written only to a **local** directory outside any git
    work tree (``HA_ALIYUN_SG_SNAPSHOT_DIR``); refused if inside a repo.
  * O2 receipt invariant: ``mutate_issued`` is always ``False``.

Auto Failover: OFF / NOT APPROVED. This module is not Auto FO admission.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping, Optional, Sequence

RECEIPT_SCHEMA = "ha.e2b.aliyun_sg_receipt/v1"
SNAPSHOT_SCHEMA = "ha.e2b.aliyun_sg_snapshot/v1"
OPS: tuple[str, ...] = ("snapshot_sg", "isolate", "restore")
AUTO_FO = "OFF / NOT APPROVED"

DEFAULT_ISOLATE_PORT_RANGES: tuple[str, ...] = ("5432/5432",)
DEFAULT_PROTECTED_PORT_RANGES: tuple[str, ...] = ("22/22",)

SNAPSHOT_ACTION = "DescribeSecurityGroupAttribute"  # read-only (O1 allowlist)
ISOLATE_ACTION = "RevokeSecurityGroup"  # mutate — intended only in O2
RESTORE_ACTION = "AuthorizeSecurityGroup"  # mutate — intended only in O2

SNAPSHOT_SOURCES = ("openapi_describe", "offline_input", "not_captured")

# Fields kept from DescribeSecurityGroupAttribute Permission entries.
_RULE_FIELDS: tuple[str, ...] = (
    "Direction",
    "IpProtocol",
    "PortRange",
    "SourceCidrIp",
    "Ipv6SourceCidrIp",
    "SourceGroupId",
    "SourceGroupOwnerAccount",
    "SourcePrefixListId",
    "SourcePortRange",
    "DestCidrIp",
    "Policy",
    "Priority",
    "NicType",
    "Description",
    "SecurityGroupRuleId",
)
# Fields that identify a rule (Description / rule id are cosmetic for matching).
_IDENTITY_FIELDS: tuple[str, ...] = tuple(
    f for f in _RULE_FIELDS if f not in ("Description", "SecurityGroupRuleId")
)
# Fields forwarded to Revoke/AuthorizeSecurityGroup (ingress, legacy single-rule form).
_OPENAPI_RULE_PARAMS: tuple[str, ...] = (
    "IpProtocol",
    "PortRange",
    "SourceCidrIp",
    "Ipv6SourceCidrIp",
    "SourceGroupId",
    "SourceGroupOwnerAccount",
    "SourcePrefixListId",
    "SourcePortRange",
    "DestCidrIp",
    "Policy",
    "Priority",
    "NicType",
    "Description",
)

_PORT_RE = re.compile(r"^(-?\d+)/(-?\d+)$")


class AliyunSgPlanError(ValueError):
    """Invalid snapshot / policy / receipt (never a cloud error)."""


# --------------------------------------------------------------------------- #
# Port ranges + policy
# --------------------------------------------------------------------------- #


def parse_port_ranges(spec: str | Sequence[str]) -> tuple[str, ...]:
    """Parse ``"5432/5432,6432/6432"`` (or a sequence) into validated ranges."""
    items = spec.split(",") if isinstance(spec, str) else list(spec)
    out: list[str] = []
    for raw in items:
        s = str(raw).strip()
        if not s:
            continue
        if "/" not in s:
            s = f"{s}/{s}"
        m = _PORT_RE.match(s)
        if not m:
            raise AliyunSgPlanError(f"invalid port range {raw!r} (want 'start/end')")
        lo, hi = int(m.group(1)), int(m.group(2))
        if (lo, hi) != (-1, -1) and not (1 <= lo <= hi <= 65535):
            raise AliyunSgPlanError(f"invalid port range {raw!r} (1..65535, start<=end)")
        out.append(f"{lo}/{hi}")
    return tuple(out)


def _bounds(port_range: str) -> tuple[int, int]:
    m = _PORT_RE.match(str(port_range or "").strip())
    if not m:
        return (1, 65535)  # unknown / empty → treat as all ports (conservative)
    lo, hi = int(m.group(1)), int(m.group(2))
    if (lo, hi) == (-1, -1):
        return (1, 65535)
    return (lo, hi)


def ranges_overlap(a: str, b: str) -> bool:
    alo, ahi = _bounds(a)
    blo, bhi = _bounds(b)
    return alo <= bhi and blo <= ahi


@dataclass(frozen=True)
class IsolatePolicy:
    """Blast-radius policy: which ingress rules isolate may revoke."""

    isolate_port_ranges: tuple[str, ...] = DEFAULT_ISOLATE_PORT_RANGES
    protected_port_ranges: tuple[str, ...] = DEFAULT_PROTECTED_PORT_RANGES

    def __post_init__(self) -> None:
        iso = parse_port_ranges(self.isolate_port_ranges)
        prot = parse_port_ranges(self.protected_port_ranges)
        if not iso:
            raise AliyunSgPlanError("isolate_port_ranges must not be empty")
        for i in iso:
            for p in prot:
                if ranges_overlap(i, p):
                    raise AliyunSgPlanError(
                        f"isolate range {i} overlaps protected range {p} — refuse "
                        "(would cut admin/SSH access)"
                    )
        object.__setattr__(self, "isolate_port_ranges", iso)
        object.__setattr__(self, "protected_port_ranges", prot)

    @classmethod
    def from_specs(cls, isolate: str = "", protected: Optional[str] = None) -> "IsolatePolicy":
        return cls(
            isolate_port_ranges=parse_port_ranges(isolate) or DEFAULT_ISOLATE_PORT_RANGES,
            protected_port_ranges=(
                DEFAULT_PROTECTED_PORT_RANGES if protected is None else parse_port_ranges(protected)
            ),
        )

    def classify(self, rule: Mapping[str, Any]) -> str:
        """``revoke`` | ``keep`` | ``blocked_protected_overlap``."""
        if str(rule.get("Direction") or "ingress").lower() != "ingress":
            return "keep"
        if str(rule.get("Policy") or "accept").lower() != "accept":
            return "keep"
        proto = str(rule.get("IpProtocol") or "").upper()
        if proto not in ("TCP", "ALL"):
            return "keep"
        pr = str(rule.get("PortRange") or "-1/-1")
        if not any(ranges_overlap(pr, i) for i in self.isolate_port_ranges):
            return "keep"
        if any(ranges_overlap(pr, p) for p in self.protected_port_ranges):
            return "blocked_protected_overlap"
        return "revoke"

    def as_dict(self) -> dict[str, Any]:
        return {
            "isolate_port_ranges": list(self.isolate_port_ranges),
            "protected_port_ranges": list(self.protected_port_ranges),
        }


# --------------------------------------------------------------------------- #
# Rules + snapshot
# --------------------------------------------------------------------------- #


def normalize_rule(perm: Mapping[str, Any]) -> dict[str, Any]:
    rule: dict[str, Any] = {}
    for f in _RULE_FIELDS:
        v = perm.get(f)
        if v is None or v == "":
            continue
        rule[f] = v
    rule["Direction"] = str(rule.get("Direction") or "ingress").lower()
    if "IpProtocol" in rule:
        rule["IpProtocol"] = str(rule["IpProtocol"]).upper()
    if "Policy" in rule:
        rule["Policy"] = str(rule["Policy"]).lower()
    return rule


def rule_fingerprint(rule: Mapping[str, Any]) -> str:
    ident = {f: str(rule[f]) for f in _IDENTITY_FIELDS if f in rule}
    blob = json.dumps(ident, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def _digest(rules: Iterable[Mapping[str, Any]]) -> str:
    fps = sorted(rule_fingerprint(r) for r in rules)
    return "sha256:" + hashlib.sha256("\n".join(fps).encode("utf-8")).hexdigest()


def permissions_from_describe(resp: Mapping[str, Any]) -> list[dict[str, Any]]:
    perms = (resp.get("Permissions") or {}).get("Permission") or []
    if not isinstance(perms, list):
        raise AliyunSgPlanError("DescribeSecurityGroupAttribute: Permissions.Permission not a list")
    return [p for p in perms if isinstance(p, Mapping)]


def _now_iso(now: Optional[_dt.datetime] = None) -> str:
    now = now or _dt.datetime.now(_dt.timezone.utc)
    return now.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_snapshot(
    *,
    sg_id: str,
    region: str,
    permissions: Optional[Iterable[Mapping[str, Any]]],
    source: str,
    request_id: str = "",
    captured_at: Optional[_dt.datetime] = None,
) -> dict[str, Any]:
    if source not in SNAPSHOT_SOURCES:
        raise AliyunSgPlanError(f"snapshot source must be one of {SNAPSHOT_SOURCES}")
    rules = [] if permissions is None else [normalize_rule(p) for p in permissions]
    if source == "not_captured" and rules:
        raise AliyunSgPlanError("not_captured snapshot must not carry rules")
    for r in rules:
        r["_fp"] = rule_fingerprint(r)
    return {
        "schema": SNAPSHOT_SCHEMA,
        "provider": "aliyun",
        "region": region,
        "sg_id": sg_id,
        "source": source,
        "captured": source != "not_captured",
        "request_id": request_id or None,
        "captured_at": _now_iso(captured_at),
        "rule_count": len(rules),
        "digest": _digest(rules),
        "rules": rules,
    }


def validate_snapshot(snap: Mapping[str, Any]) -> None:
    if snap.get("schema") != SNAPSHOT_SCHEMA:
        raise AliyunSgPlanError(f"snapshot schema must be {SNAPSHOT_SCHEMA!r}")
    if snap.get("source") not in SNAPSHOT_SOURCES:
        raise AliyunSgPlanError("snapshot source invalid")
    rules = snap.get("rules")
    if not isinstance(rules, list):
        raise AliyunSgPlanError("snapshot rules must be a list")
    if snap.get("rule_count") != len(rules):
        raise AliyunSgPlanError("snapshot rule_count mismatch")
    if snap.get("digest") != _digest(rules):
        raise AliyunSgPlanError("snapshot digest mismatch (tampered or corrupt)")
    if not snap.get("sg_id"):
        raise AliyunSgPlanError("snapshot sg_id missing")


# --------------------------------------------------------------------------- #
# Plans (intended OpenAPI calls; never issued here)
# --------------------------------------------------------------------------- #


def rule_to_openapi_params(sg_id: str, rule: Mapping[str, Any]) -> dict[str, str]:
    params = {"SecurityGroupId": sg_id}
    for f in _OPENAPI_RULE_PARAMS:
        if f in rule and rule[f] not in (None, ""):
            params[f] = str(rule[f])
    return params


def plan_isolate(snapshot: Mapping[str, Any], policy: IsolatePolicy) -> dict[str, Any]:
    validate_snapshot(snapshot)
    sg_id = str(snapshot["sg_id"])
    revoke: list[dict[str, Any]] = []
    blocked: list[str] = []
    keep = 0
    for r in snapshot["rules"]:
        cls = policy.classify(r)
        if cls == "revoke":
            revoke.append(dict(r))
        elif cls == "blocked_protected_overlap":
            blocked.append(rule_fingerprint(r))
        else:
            keep += 1
    return {
        "policy": policy.as_dict(),
        "snapshot_digest": snapshot["digest"],
        "snapshot_captured": bool(snapshot.get("captured")),
        "revoke_rules": revoke,
        "revoke_fingerprints": [rule_fingerprint(r) for r in revoke],
        "keep_count": keep,
        "blocked_protected_overlap": blocked,
        "intended_openapi_calls": [
            {"action": ISOLATE_ACTION, "params": rule_to_openapi_params(sg_id, r)} for r in revoke
        ],
    }


def plan_restore(
    snapshot: Mapping[str, Any],
    revoke_fingerprints: Optional[Sequence[str]] = None,
    policy: Optional[IsolatePolicy] = None,
) -> dict[str, Any]:
    """Re-authorize revoked rules from the pre-mutate snapshot (exact fields)."""
    validate_snapshot(snapshot)
    sg_id = str(snapshot["sg_id"])
    by_fp = {rule_fingerprint(r): r for r in snapshot["rules"]}
    if revoke_fingerprints is None:
        revoke_fingerprints = plan_isolate(snapshot, policy or IsolatePolicy())["revoke_fingerprints"]
    missing = [fp for fp in revoke_fingerprints if fp not in by_fp]
    if missing:
        raise AliyunSgPlanError(
            f"restore refused: {len(missing)} revoked rule(s) not in snapshot "
            f"{snapshot['digest']} (wrong snapshot?)"
        )
    rules = [by_fp[fp] for fp in revoke_fingerprints]
    return {
        "snapshot_digest": snapshot["digest"],
        "snapshot_captured": bool(snapshot.get("captured")),
        "restore_fingerprints": list(revoke_fingerprints),
        "intended_openapi_calls": [
            {"action": RESTORE_ACTION, "params": rule_to_openapi_params(sg_id, r)} for r in rules
        ],
    }


# --------------------------------------------------------------------------- #
# Receipt schema
# --------------------------------------------------------------------------- #

_RECEIPT_REQUIRED = (
    "schema",
    "op",
    "provider",
    "region",
    "sg_id",
    "execution_id",
    "idempotency_key",
    "dry_run",
    "live",
    "live_target",
    "mutate_issued",
    "openapi_calls_issued",
    "intended_openapi_calls",
    "snapshot_digest",
    "auto_fo",
    "created_at",
)


def build_receipt(
    op: str,
    *,
    execution_id: str,
    region: str,
    sg_id: str,
    live: bool,
    live_target: str,
    snapshot: Mapping[str, Any],
    plan: Optional[Mapping[str, Any]] = None,
    openapi_calls_issued: Sequence[str] = (),
    snapshot_path: str = "",
    note: str = "",
    created_at: Optional[_dt.datetime] = None,
) -> dict[str, Any]:
    if op not in OPS:
        raise AliyunSgPlanError(f"op must be one of {OPS}")
    issued = list(openapi_calls_issued)
    from fence.aliyun_openapi import READ_ONLY_ACTIONS  # local: keep module pure

    bad = [a for a in issued if a not in READ_ONLY_ACTIONS]
    if bad:
        raise AliyunSgPlanError(f"O2 receipt cannot record mutate calls as issued: {bad}")
    plan = dict(plan or {})
    intended = list(plan.get("intended_openapi_calls") or [])
    if op == "snapshot_sg":
        intended = [{"action": SNAPSHOT_ACTION, "params": {"SecurityGroupId": sg_id, "Direction": "all"}}]
    r: dict[str, Any] = {
        "schema": RECEIPT_SCHEMA,
        "op": op,
        "provider": "aliyun",
        "region": region,
        "sg_id": sg_id or None,
        "execution_id": execution_id,
        "idempotency_key": f"{execution_id}:FENCING_NETWORK:{op}",
        "dry_run": True,  # O2: every isolate/restore is would-do only
        "live": bool(live),
        "live_target": live_target or None,
        "mutate_issued": False,  # O2 invariant
        "openapi_calls_issued": issued,
        "intended_openapi_calls": intended,
        "snapshot_digest": snapshot.get("digest"),
        "snapshot_source": snapshot.get("source"),
        "snapshot_rule_count": snapshot.get("rule_count"),
        "snapshot_path_set": bool(snapshot_path),
        "auto_fo": AUTO_FO,
        "created_at": _now_iso(created_at),
        "note": note,
    }
    if op == "isolate":
        r["revoke_count"] = len(plan.get("revoke_rules") or [])
        r["revoke_fingerprints"] = list(plan.get("revoke_fingerprints") or [])
        r["keep_count"] = plan.get("keep_count", 0)
        r["blocked_protected_overlap"] = list(plan.get("blocked_protected_overlap") or [])
        r["policy"] = plan.get("policy")
    elif op == "restore":
        r["restore_count"] = len(plan.get("restore_fingerprints") or [])
        r["restore_fingerprints"] = list(plan.get("restore_fingerprints") or [])
    validate_receipt(r)
    return r


def validate_receipt(r: Mapping[str, Any]) -> None:
    missing = [k for k in _RECEIPT_REQUIRED if k not in r]
    if missing:
        raise AliyunSgPlanError(f"receipt missing keys: {missing}")
    if r["schema"] != RECEIPT_SCHEMA:
        raise AliyunSgPlanError(f"receipt schema must be {RECEIPT_SCHEMA!r}")
    if r["op"] not in OPS:
        raise AliyunSgPlanError("receipt op invalid")
    if r["mutate_issued"] is not False or r["dry_run"] is not True:
        raise AliyunSgPlanError("O2 receipt must be dry_run=True, mutate_issued=False")
    if r["auto_fo"] != AUTO_FO:
        raise AliyunSgPlanError("receipt auto_fo must be 'OFF / NOT APPROVED'")
    if r["idempotency_key"] != f"{r['execution_id']}:FENCING_NETWORK:{r['op']}":
        raise AliyunSgPlanError("receipt idempotency_key mismatch")
    for c in r["intended_openapi_calls"]:
        if not isinstance(c, Mapping) or "action" not in c or "params" not in c:
            raise AliyunSgPlanError("intended_openapi_calls entries need action+params")
    blob = json.dumps(r, default=str)
    for needle in ("AccessKeySecret", "SecurityToken", "Signature"):
        if needle in blob:
            raise AliyunSgPlanError(f"receipt must not contain {needle}")


# --------------------------------------------------------------------------- #
# Local snapshot file (never git)
# --------------------------------------------------------------------------- #


def _inside_git_worktree(path: Path) -> bool:
    p = path.resolve()
    for cand in (p, *p.parents):
        if (cand / ".git").exists():
            return True
    return False


def check_snapshot_dir(directory: str) -> str:
    """``""`` if usable, else a reason string (presence/locality only)."""
    if not directory:
        return "unset"
    p = Path(directory).expanduser()
    if _inside_git_worktree(p if p.exists() else p.parent):
        return "inside_git_worktree"
    return ""


def write_snapshot_file(snapshot: Mapping[str, Any], directory: str, execution_id: str) -> str:
    validate_snapshot(snapshot)
    reason = check_snapshot_dir(directory)
    if reason:
        raise AliyunSgPlanError(f"snapshot dir refused: {reason} (must be local, outside git)")
    d = Path(directory).expanduser()
    d.mkdir(parents=True, exist_ok=True)
    safe_exec = re.sub(r"[^A-Za-z0-9_-]", "_", execution_id)[:80] or "exec"
    safe_sg = re.sub(r"[^A-Za-z0-9_-]", "_", str(snapshot["sg_id"]))[:64]
    path = d / f"aliyun-sg-snapshot-{safe_sg}-{safe_exec}.json"
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(snapshot, fh, indent=2, sort_keys=True)
    return str(path)


def load_snapshot_file(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        snap = json.load(fh)
    validate_snapshot(snap)
    return snap
