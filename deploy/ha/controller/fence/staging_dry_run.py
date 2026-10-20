"""Print intended staging Fence/CF actions from env — no Aliyun/AWS/CF mutate.

Runs FenceCfConfig preflight, prints a redacted plan, and exercises
DryRunFenceAdapter receipts for enabled steps. Zero cloud HTTP calls.

Usage:
  cd deploy/ha/controller && python -m fence.staging_dry_run
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

_CTL = Path(__file__).resolve().parents[1]
if str(_CTL) not in sys.path:
    sys.path.insert(0, str(_CTL))

from fence.config import FenceCfConfig  # noqa: E402
from fence.dry_run import DryRunFenceAdapter  # noqa: E402
from fence.preflight import run_preflight  # noqa: E402


def _plan(cfg: FenceCfConfig) -> dict[str, Any]:
    if cfg.cloud_provider == "aliyun":
        net_region = bool(cfg.aliyun_region)
        net_sg = bool(cfg.aliyun_sg_id)
        net_nacl = False
        net_live = bool(cfg.aliyun_live_mutate)
        net_note = (
            "dry_skeleton + E2b-O2 snapshot_sg/isolate/restore dry receipts; OpenAPI "
            "client wired (read-only Describe when gated); real SG mutate lands O3"
        )
        comp_instance = bool(cfg.aliyun_instance_id)
        comp_live = bool(cfg.aliyun_live_mutate)
        comp_note = "StopInstance not called by this script"
    else:
        # aws | mock — AWS-shaped fields (lab-compat)
        net_region = bool(cfg.aws_region)
        net_sg = bool(cfg.aws_sg_id)
        net_nacl = bool(cfg.aws_nacl_id)
        net_live = bool(cfg.aws_live_mutate)
        net_note = (
            "dry_skeleton only unless HA_AWS_LIVE_MUTATE=1 and boto3 path lands"
        )
        comp_instance = bool(cfg.aws_instance_id)
        comp_live = bool(cfg.aws_live_mutate)
        comp_note = "StopInstances not called by this script"

    return {
        "auto_fo": "OFF / NOT APPROVED",
        "backend": cfg.backend,
        "cloud_provider": cfg.cloud_provider,
        "aws_live_mutate": cfg.aws_live_mutate,
        "aws_live_target": cfg.aws_live_target or None,
        "aliyun_live_mutate": cfg.aliyun_live_mutate,
        "aliyun_live_target": cfg.aliyun_live_target or None,
        "cf_live_mutate": os.environ.get("HA_CF_LIVE_MUTATE", "0"),
        "would_enable": {
            "app": cfg.enable_app,
            "network": cfg.enable_network,
            "compute": cfg.enable_compute,
            "cf": cfg.enable_cf,
            "promote": cfg.enable_promote,
        },
        "intended_network": (
            {
                "provider": cfg.cloud_provider,
                "region_set": net_region,
                "sg_set": net_sg,
                "nacl_set": net_nacl,
                "live": net_live,
                "note": net_note,
            }
            if cfg.enable_network
            else None
        ),
        "intended_compute": (
            {
                "provider": cfg.cloud_provider,
                "instance_set": comp_instance,
                "live": comp_live,
                "note": comp_note,
            }
            if cfg.enable_compute
            else None
        ),
        "intended_cf": (
            {
                "account_set": bool(cfg.cf_account_id),
                "pool_set": bool(cfg.cf_pool_id),
                "old_origin_set": bool(cfg.cf_old_origin),
                "new_origin_set": bool(cfg.cf_new_origin),
                "token_set": bool(cfg.cf_api_token),
                "live_mutate": os.environ.get("HA_CF_LIVE_MUTATE", "0"),
                "note": "No CF API call from staging_dry_run",
            }
            if cfg.enable_cf
            else None
        ),
        "intended_app": (
            {
                "url_set": bool(cfg.app_fence_url),
                "mtls_cert_set": bool(cfg.app_mtls_cert),
                "note": "No HTTP call from staging_dry_run",
            }
            if cfg.enable_app
            else None
        ),
    }


def main() -> int:
    mode = os.environ.get("HA_CONTROLLER_MODE", "manual").strip().lower() or "manual"
    if mode == "auto":
        print(
            "REFUSED: HA_CONTROLLER_MODE=auto — Auto Failover NOT APPROVED",
            file=sys.stderr,
        )
        return 2

    pre = run_preflight()
    if not pre.ok:
        print("Preflight FAIL — abort dry-run plan", file=sys.stderr)
        for c in pre.checks:
            if c.level == "fail":
                print(f"  [FAIL] {c.code}: {c.message}", file=sys.stderr)
        return 1

    cfg = FenceCfConfig.from_env()
    plan = _plan(cfg)

    dry = DryRunFenceAdapter()
    demo_exec = "00000000-0000-4000-8000-0000000000e2"
    ctx = {
        "from_holder": "old-primary",
        "to_holder": "new-primary",
        "to_epoch": 2,
        "owner_gen": 1,
    }
    steps: list[str] = []
    if cfg.enable_app:
        steps.append("FENCING_APP")
    if cfg.enable_network:
        steps.append("FENCING_NETWORK")
    if cfg.enable_compute:
        steps.append("FENCING_COMPUTE")
    if cfg.enable_cf:
        steps.append("CF_CUTOVER")
    if not steps:
        # Always show a sample network would-do so empty env still documents shape
        steps = ["FENCING_NETWORK"]

    receipts = []
    for step in steps:
        r = dry.run(demo_exec, step, **ctx)
        receipts.append(
            {
                "step": r.step,
                "ok": r.ok,
                "detail": r.detail,
            }
        )

    out = {"plan": plan, "dry_run_receipts": receipts, "cloud_api_calls": 0}
    print(json.dumps(out, indent=2, default=str))
    print(
        "\n# staging_dry_run: zero AWS/CF HTTP calls; Auto FO OFF / NOT APPROVED",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
