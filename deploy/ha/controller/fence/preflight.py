"""E2 staging preflight — validate env / gates; never call Aliyun/AWS/CF APIs.

Exit codes:
  0 — OK (or OK with warnings printed to stderr)
  1 — gate / consistency failure
  2 — HA_CONTROLLER_MODE=auto (hard refuse)

Usage:
  cd deploy/ha/controller && python -m fence.preflight
  python -m fence.preflight --json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

# Allow `python -m fence.preflight` from controller dir or repo root.
_CTL = Path(__file__).resolve().parents[1]
if str(_CTL) not in sys.path:
    sys.path.insert(0, str(_CTL))

from fence.aliyun_openapi import describe_credential_source  # noqa: E402
from fence.aliyun_sg import check_snapshot_dir  # noqa: E402
from fence.config import FenceCfConfig  # noqa: E402


@dataclass
class CheckResult:
    ok: bool
    level: str  # ok | warn | fail
    code: str
    message: str


@dataclass
class PreflightReport:
    ok: bool
    auto_fo: str = "OFF / NOT APPROVED"
    checks: list[CheckResult] = field(default_factory=list)
    summary: dict[str, Any] = field(default_factory=dict)

    def add(self, level: str, code: str, message: str) -> None:
        self.checks.append(
            CheckResult(ok=(level != "fail"), level=level, code=code, message=message)
        )
        if level == "fail":
            self.ok = False


def _present(name: str) -> bool:
    return bool(os.environ.get(name, "").strip())


def run_preflight(*, cfg: FenceCfConfig | None = None) -> PreflightReport:
    """Inspect env + FenceCfConfig; no outbound network."""
    report = PreflightReport(ok=True)
    try:
        cfg = cfg or FenceCfConfig.from_env()
    except ValueError as exc:
        report.add("fail", "config_value_error", str(exc))
        report.summary = {"backend": os.environ.get("HA_FENCE_BACKEND", "lab")}
        return report

    report.summary = {
        "backend": cfg.backend,
        "controller_mode": cfg.controller_mode,
        "cloud_provider": cfg.cloud_provider,
        "enable_app": cfg.enable_app,
        "enable_network": cfg.enable_network,
        "enable_compute": cfg.enable_compute,
        "enable_cf": cfg.enable_cf,
        "aws_live_mutate": cfg.aws_live_mutate,
        "aws_live_target": cfg.aws_live_target or None,
        "aliyun_live_mutate": cfg.aliyun_live_mutate,
        "aliyun_live_target": cfg.aliyun_live_target or None,
        # Presence-only classification (env_ak|env_sts|ecs_ram_role|none); no values
        "aliyun_cred_source": describe_credential_source(),
        "aliyun_ecs_endpoint_set": bool(cfg.aliyun_ecs_endpoint),
        # E2b-O2: blast-radius policy (port ranges are config, not secrets)
        "aliyun_isolate_policy": cfg.aliyun_isolate_policy().as_dict(),
        "aliyun_sg_snapshot_dir_set": bool(cfg.aliyun_sg_snapshot_dir),
        "cf_live_mutate": os.environ.get("HA_CF_LIVE_MUTATE", "0").strip(),
        "has_database_url": bool(cfg.database_url),
        "has_cf_token": bool(cfg.cf_api_token),
        # Never echo secret values — only presence / paths existence flags
        "app_fence_url_set": bool(cfg.app_fence_url),
        "app_mtls_cert_path_set": bool(cfg.app_mtls_cert),
        "app_mtls_key_path_set": bool(cfg.app_mtls_key),
        "app_mtls_ca_path_set": bool(cfg.app_mtls_ca),
    }

    # --- hard refuses ---
    if cfg.controller_mode == "auto":
        report.add(
            "fail",
            "auto_fo_refused",
            "HA_CONTROLLER_MODE=auto refused — Production Auto Failover NOT APPROVED",
        )
        return report

    report.add(
        "ok",
        "auto_fo_off",
        "HA_CONTROLLER_MODE=manual; Auto Failover OFF / NOT APPROVED",
    )

    if cfg.backend == "lab":
        report.add("ok", "backend_lab", "HA_FENCE_BACKEND=lab (default; no cloud mutate)")
    elif cfg.backend == "dry_run":
        report.add("ok", "backend_dry_run", "HA_FENCE_BACKEND=dry_run (would-do only)")
    elif cfg.backend == "real":
        report.add("warn", "backend_real", "HA_FENCE_BACKEND=real — ensure enable flags + staging targets")
        try:
            cfg.require_real_ready()
            report.add("ok", "real_ready", "require_real_ready() passed (env presence only)")
        except SystemExit as exc:
            report.add("fail", "real_not_ready", str(exc))

    # --- AWS live gates ---
    if cfg.aws_live_mutate:
        if cfg.cloud_provider != "aws":
            report.add(
                "fail",
                "aws_live_needs_provider",
                "HA_AWS_LIVE_MUTATE=1 requires HA_CLOUD_PROVIDER=aws",
            )
        if cfg.aws_live_target.strip().lower() != "staging":
            report.add(
                "fail",
                "aws_live_target",
                "HA_AWS_LIVE_MUTATE=1 requires HA_AWS_LIVE_TARGET=staging",
            )
        else:
            report.add("ok", "aws_live_target", "HA_AWS_LIVE_TARGET=staging")
        if not (cfg.enable_network or cfg.enable_compute):
            report.add(
                "fail",
                "aws_live_enable",
                "HA_AWS_LIVE_MUTATE=1 needs ENABLE_NETWORK and/or ENABLE_COMPUTE",
            )
        # Presence of IDs — do not call AWS
        if cfg.enable_network:
            if not cfg.aws_region:
                report.add("fail", "aws_region", "HA_AWS_REGION missing")
            if not (cfg.aws_sg_id or cfg.aws_nacl_id):
                report.add("fail", "aws_sg_or_nacl", "need HA_AWS_SG_ID or HA_AWS_NACL_ID")
            else:
                report.add(
                    "ok",
                    "aws_network_ids",
                    "Network isolate IDs present (values not printed)",
                )
        if cfg.enable_compute:
            if not cfg.aws_instance_id:
                report.add("fail", "aws_instance", "HA_AWS_INSTANCE_ID missing")
            else:
                report.add("ok", "aws_instance", "HA_AWS_INSTANCE_ID present (not printed)")
        report.add(
            "warn",
            "aws_live_boto3",
            "E2a does not call AWS APIs; live=True still refuses until boto3 path lands",
        )
        # Cred presence hints (standard AWS env / role) — no values
        has_key = _present("AWS_ACCESS_KEY_ID") or _present("AWS_PROFILE")
        report.add(
            "warn" if not has_key else "ok",
            "aws_cred_hint",
            "AWS_ACCESS_KEY_ID/AWS_PROFILE presence checked only — prefer instance role; "
            f"key_or_profile_set={has_key}",
        )
    else:
        report.add("ok", "aws_live_off", "HA_AWS_LIVE_MUTATE=0 (default; dry_skeleton only)")

    # --- Aliyun live gates (PRIMARY; zero OpenAPI calls) ---
    if cfg.aliyun_live_mutate:
        if cfg.cloud_provider != "aliyun":
            report.add(
                "fail",
                "aliyun_live_needs_provider",
                "HA_ALIYUN_LIVE_MUTATE=1 requires HA_CLOUD_PROVIDER=aliyun",
            )
        if cfg.aliyun_live_target.strip().lower() != "staging":
            report.add(
                "fail",
                "aliyun_live_target",
                "HA_ALIYUN_LIVE_MUTATE=1 requires HA_ALIYUN_LIVE_TARGET=staging",
            )
        else:
            report.add("ok", "aliyun_live_target", "HA_ALIYUN_LIVE_TARGET=staging")
        if not (cfg.enable_network or cfg.enable_compute):
            report.add(
                "fail",
                "aliyun_live_enable",
                "HA_ALIYUN_LIVE_MUTATE=1 needs ENABLE_NETWORK and/or ENABLE_COMPUTE",
            )
        if cfg.enable_network:
            if not cfg.aliyun_region:
                report.add("fail", "aliyun_region", "HA_ALIYUN_REGION missing")
            if not cfg.aliyun_sg_id:
                report.add("fail", "aliyun_sg", "HA_ALIYUN_SG_ID missing")
            else:
                report.add(
                    "ok",
                    "aliyun_network_ids",
                    "Aliyun Network isolate IDs present (values not printed)",
                )
        if cfg.enable_compute:
            if not cfg.aliyun_instance_id:
                report.add("fail", "aliyun_instance", "HA_ALIYUN_INSTANCE_ID missing")
            else:
                report.add(
                    "ok",
                    "aliyun_instance",
                    "HA_ALIYUN_INSTANCE_ID present (not printed)",
                )
        report.add(
            "warn",
            "aliyun_live_openapi",
            "E2b-O1/O2: signed Aliyun OpenAPI client wired; gated live=True issues only a "
            "read-only DescribeSecurityGroupAttribute snapshot, builds the isolate/restore "
            "plan + receipt, then refuses — real SG mutate lands in O3 (Owner window; "
            "preflight itself calls nothing)",
        )
        # Cred presence hints — no values echoed, no metadata fetch
        src = describe_credential_source()
        report.add(
            "warn" if src == "none" else "ok",
            "aliyun_cred_hint",
            "Aliyun credential source (presence only; env AK/STS or ECS RAM role name "
            f"via HA_ALIYUN_RAM_ROLE_NAME / ALIBABA_CLOUD_ECS_METADATA): source={src}",
        )
    else:
        report.add(
            "ok",
            "aliyun_live_off",
            "HA_ALIYUN_LIVE_MUTATE=0 (default; dry_skeleton only)",
        )

    # Aliyun ID presence when provider=aliyun even with LIVE_MUTATE=0 (hygiene)
    if cfg.cloud_provider == "aliyun" and not cfg.aliyun_live_mutate:
        if cfg.enable_network or cfg.enable_compute:
            if not cfg.aliyun_region:
                report.add("warn", "aliyun_region_hint", "HA_ALIYUN_REGION empty")
            elif cfg.enable_network and not cfg.aliyun_sg_id:
                report.add("warn", "aliyun_sg_hint", "HA_ALIYUN_SG_ID empty")
            elif cfg.enable_compute and not cfg.aliyun_instance_id:
                report.add("warn", "aliyun_instance_hint", "HA_ALIYUN_INSTANCE_ID empty")
            else:
                report.add(
                    "ok",
                    "aliyun_ids_present",
                    "Aliyun region/IDs present for enabled steps (not printed)",
                )

    # --- E2b-O2 Aliyun SG dry paths (presence / locality only; zero OpenAPI) ---
    if cfg.cloud_provider == "aliyun" and cfg.enable_network:
        pol = cfg.aliyun_isolate_policy()
        report.add(
            "ok",
            "aliyun_o2_dry_paths",
            "E2b-O2 snapshot_sg/isolate/restore = dry plans + receipts "
            f"(isolate={','.join(pol.isolate_port_ranges)} "
            f"protected={','.join(pol.protected_port_ranges) or 'none'}); "
            "RevokeSecurityGroup/AuthorizeSecurityGroup never issued in O2",
        )
        reason = check_snapshot_dir(cfg.aliyun_sg_snapshot_dir)
        if reason == "unset":
            report.add(
                "warn",
                "aliyun_sg_snapshot_dir",
                "HA_ALIYUN_SG_SNAPSHOT_DIR unset — required (local, not git) before O3 window",
            )
        elif reason == "inside_git_worktree":
            report.add(
                "fail",
                "aliyun_sg_snapshot_dir",
                "HA_ALIYUN_SG_SNAPSHOT_DIR is inside a git work tree — snapshots must stay out of git",
            )
        else:
            report.add(
                "ok",
                "aliyun_sg_snapshot_dir",
                "HA_ALIYUN_SG_SNAPSHOT_DIR set, outside git (path not printed)",
            )
        if not cfg.aliyun_live_mutate:
            src = describe_credential_source()
            report.add(
                "warn" if src == "none" else "ok",
                "aliyun_cred_presence",
                f"Aliyun credential source presence only (no fetch): source={src}",
            )

    # --- CF gates ---
    cf_live = os.environ.get("HA_CF_LIVE_MUTATE", "0").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    if cfg.enable_cf:
        missing = [
            n
            for n, v in (
                ("HA_CF_API_TOKEN", cfg.cf_api_token),
                ("HA_CF_ACCOUNT_ID", cfg.cf_account_id),
                ("HA_CF_POOL_ID", cfg.cf_pool_id),
                ("HA_CF_OLD_ORIGIN", cfg.cf_old_origin),
                ("HA_CF_NEW_ORIGIN", cfg.cf_new_origin),
            )
            if not v
        ]
        if missing:
            report.add("fail", "cf_env", "CF enable missing: " + ", ".join(missing))
        else:
            report.add("ok", "cf_env", "CF env IDs/token present (token not printed)")
        if cf_live:
            report.add(
                "warn",
                "cf_live_on",
                "HA_CF_LIVE_MUTATE=1 — GET+PUT possible; ensure staging pool + Owner approval",
            )
        else:
            report.add("ok", "cf_live_off", "HA_CF_LIVE_MUTATE=0 (GET/dry_skeleton only)")
    else:
        if cf_live:
            report.add(
                "warn",
                "cf_live_without_enable",
                "HA_CF_LIVE_MUTATE=1 but HA_FENCE_ENABLE_CF=0 — mutate path inactive",
            )
        else:
            report.add("ok", "cf_disabled", "HA_FENCE_ENABLE_CF=0")

    # --- App Fence ---
    if cfg.enable_app:
        if not cfg.app_fence_url:
            report.add("fail", "app_url", "HA_FENCE_ENABLE_APP=1 requires HA_APP_FENCE_URL")
        else:
            report.add("ok", "app_url", "HA_APP_FENCE_URL set (not printed)")
        for label, path in (
            ("cert", cfg.app_mtls_cert),
            ("key", cfg.app_mtls_key),
            ("ca", cfg.app_mtls_ca),
        ):
            if path:
                if Path(path).is_file():
                    report.add("ok", f"app_mtls_{label}", f"mTLS {label} path exists")
                else:
                    report.add(
                        "warn",
                        f"app_mtls_{label}",
                        f"mTLS {label} path set but file not found locally (may be remote)",
                    )
    else:
        report.add("ok", "app_off", "HA_FENCE_ENABLE_APP=0")

    # --- SQL ---
    if cfg.backend == "real" and not cfg.database_url:
        report.add("fail", "dsn", "DATABASE_URL required for backend=real")
    elif cfg.database_url:
        report.add("ok", "dsn", "DATABASE_URL present (not printed)")
    else:
        report.add("warn", "dsn", "DATABASE_URL empty — lab stub / dry_run may still work")

    report.add(
        "ok",
        "no_cloud_calls",
        "preflight performed zero Aliyun/AWS/CF API calls",
    )
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="HA E2 staging preflight (no cloud calls)")
    parser.add_argument("--json", action="store_true", help="Print JSON report")
    args = parser.parse_args(argv)

    # Detect auto mode before from_env raises
    mode = os.environ.get("HA_CONTROLLER_MODE", "manual").strip().lower() or "manual"
    if mode == "auto":
        if args.json:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "auto_fo": "OFF / NOT APPROVED",
                        "checks": [
                            {
                                "ok": False,
                                "level": "fail",
                                "code": "auto_fo_refused",
                                "message": "HA_CONTROLLER_MODE=auto refused",
                            }
                        ],
                    },
                    indent=2,
                )
            )
        else:
            print("FAIL: HA_CONTROLLER_MODE=auto — Auto Failover NOT APPROVED", file=sys.stderr)
        return 2

    report = run_preflight()
    if args.json:
        payload = {
            "ok": report.ok,
            "auto_fo": report.auto_fo,
            "summary": report.summary,
            "checks": [asdict(c) for c in report.checks],
        }
        print(json.dumps(payload, indent=2))
    else:
        print(f"HA E2 preflight — Auto FO: {report.auto_fo}")
        print(
            f"backend={report.summary.get('backend')} "
            f"provider={report.summary.get('cloud_provider')} "
            f"aws_live_mutate={report.summary.get('aws_live_mutate')} "
            f"aliyun_live_mutate={report.summary.get('aliyun_live_mutate')} "
            f"cf_live_mutate={report.summary.get('cf_live_mutate')}"
        )
        for c in report.checks:
            tag = c.level.upper()
            print(f"  [{tag}] {c.code}: {c.message}")
        print("PASS" if report.ok else "FAIL")
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
