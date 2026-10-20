"""E2b-O2 CLI: Aliyun SG snapshot_sg / isolate / restore **dry** receipts — zero OpenAPI.

Always runs ``AliyunNetworkFenceClient(live=False)`` regardless of
``HA_ALIYUN_LIVE_MUTATE`` (O2 ships dry paths only; real mutate is O3). Rules come
from an *offline* DescribeSecurityGroupAttribute-shaped JSON (or a bare permission
list); nothing is described from the cloud by this script.

Usage:
  cd deploy/ha/controller
  python -m fence.aliyun_sg_dry_run --permissions-json fence/tests/fixtures/aliyun_sg_describe.json
  python -m fence.aliyun_sg_dry_run --snapshot-file /local/aliyun-sg-snapshot-....json

Auto Failover: OFF / NOT APPROVED.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

_CTL = Path(__file__).resolve().parents[1]
if str(_CTL) not in sys.path:
    sys.path.insert(0, str(_CTL))

from fence import aliyun_sg as sgm  # noqa: E402
from fence.config import FenceCfConfig  # noqa: E402
from fence.network_fence import AliyunNetworkFenceClient  # noqa: E402


def _load_permissions(path: str) -> tuple[list[dict[str, Any]], str]:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, list):
        return data, ""
    return sgm.permissions_from_describe(data), str(data.get("SecurityGroupId") or "")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="E2b-O2 Aliyun SG dry receipts (zero OpenAPI)")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--permissions-json", help="offline Describe JSON / permission list")
    src.add_argument("--snapshot-file", help="local snapshot written by snapshot_sg")
    ap.add_argument("--execution-id", default="00000000-0000-4000-8000-0000000000e2")
    args = ap.parse_args(argv)

    mode = os.environ.get("HA_CONTROLLER_MODE", "manual").strip().lower() or "manual"
    if mode == "auto":
        print("REFUSED: HA_CONTROLLER_MODE=auto — Auto Failover NOT APPROVED", file=sys.stderr)
        return 2
    try:
        cfg = FenceCfConfig.from_env()
    except ValueError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 1

    perms = None
    sg_id = cfg.aliyun_sg_id
    snapshot = None
    if args.permissions_json:
        perms, fixture_sg = _load_permissions(args.permissions_json)
        sg_id = sg_id or fixture_sg
    elif args.snapshot_file:
        snapshot = sgm.load_snapshot_file(args.snapshot_file)
        sg_id = sg_id or str(snapshot["sg_id"])

    client = AliyunNetworkFenceClient(
        region=cfg.aliyun_region or "cn-hongkong",
        sg_id=sg_id,
        live=False,  # O2: forced dry regardless of HA_ALIYUN_LIVE_MUTATE
        isolate_policy=cfg.aliyun_isolate_policy(),
        snapshot_dir=cfg.aliyun_sg_snapshot_dir,
        offline_permissions=perms,
    )
    ex = args.execution_id
    if snapshot is None:
        snap_out = client.snapshot_sg(execution_id=ex)
        snapshot, snap_receipt = snap_out["snapshot"], snap_out["receipt"]
    else:
        snap_receipt = None
    iso = client.isolate(execution_id=ex, snapshot=snapshot)
    rst = client.restore(
        execution_id=ex, snapshot=snapshot, revoke_fingerprints=iso["revoke_fingerprints"]
    )
    assert client.openapi is None, "O2 dry CLI must never build an OpenAPI client"
    out = {
        "auto_fo": sgm.AUTO_FO,
        "aliyun_live_mutate_env": cfg.aliyun_live_mutate,
        "forced_dry": True,
        "openapi_calls": 0,
        "receipts": {"snapshot_sg": snap_receipt, "isolate": iso, "restore": rst},
    }
    print(json.dumps(out, indent=2, default=str))
    print("\n# aliyun_sg_dry_run: zero Aliyun OpenAPI calls; Auto FO OFF / NOT APPROVED",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
