"""python -m controller  (run with PYTHONPATH=deploy/ha)."""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys

# Allow `python /path/to/controller/...` and `PYTHONPATH=deploy/ha python -m controller`
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=os.environ.get("HA_CONTROLLER_LOG", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    p = argparse.ArgumentParser(
        description="OpenBot HA Dual Controller (Stage C/D). Default mode=manual; Auto FO OFF; fence backend=lab."
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("heartbeat", help="Upsert ha_controller_instance once")
    sp.add_argument("--controller-id", default=os.environ.get("HA_CONTROLLER_ID"))
    sp.add_argument("--failure-domain", default=os.environ.get("HA_FAILURE_DOMAIN"))
    sp.add_argument("--version", default=os.environ.get("HA_CONTROLLER_VERSION", "stage-c-dev"))
    sp.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))

    sp = sub.add_parser(
        "heartbeat-loop",
        help="Production sidecar: heartbeat forever (manual mode only; Auto FO still OFF)",
    )
    sp.add_argument("--controller-id", default=os.environ.get("HA_CONTROLLER_ID"))
    sp.add_argument("--failure-domain", default=os.environ.get("HA_FAILURE_DOMAIN"))
    sp.add_argument("--version", default=os.environ.get("HA_CONTROLLER_VERSION", "stage-c-dev"))
    sp.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    sp.add_argument(
        "--mode",
        default=os.environ.get("HA_CONTROLLER_MODE", "manual"),
        help="Must remain manual in production (auto refused)",
    )
    sp.add_argument(
        "--interval-sec",
        type=float,
        default=float(os.environ.get("HA_CONTROLLER_HEARTBEAT_INTERVAL_SEC", "5")),
    )

    sp = sub.add_parser("run-once", help="Manual failover once (Claim→…→DONE or LOST_CLAIM)")
    sp.add_argument("--controller-id", default=os.environ.get("HA_CONTROLLER_ID"))
    sp.add_argument("--failure-domain", default=os.environ.get("HA_FAILURE_DOMAIN"))
    sp.add_argument("--version", default=os.environ.get("HA_CONTROLLER_VERSION", "stage-c-dev"))
    sp.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    sp.add_argument("--mode", default=os.environ.get("HA_CONTROLLER_MODE", "manual"))
    sp.add_argument("--to-holder", required=True)
    sp.add_argument("--to-db-role", required=True, help="openbot_app_a or openbot_app_b")
    sp.add_argument("--observed-epoch", type=int, default=None)
    sp.add_argument("--skip-compute", action="store_true")
    sp.add_argument("--stop-after", default=None)

    sp = sub.add_parser("recover", help="Scan non-terminal executions and print §12.6 plans")
    sp.add_argument("--controller-id", default=os.environ.get("HA_CONTROLLER_ID", "probe"))
    sp.add_argument("--failure-domain", default=os.environ.get("HA_FAILURE_DOMAIN", "lab"))
    sp.add_argument("--version", default=os.environ.get("HA_CONTROLLER_VERSION", "stage-c-dev"))
    sp.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))

    args = p.parse_args(argv)

    def cfg_from(a):
        # Lazy imports so --help / mode=auto refusal work without psycopg installed.
        from config import ControllerConfig

        if not a.database_url:
            raise SystemExit("DATABASE_URL / --database-url required")
        if not a.controller_id or not a.failure_domain:
            raise SystemExit("--controller-id and --failure-domain required")
        mode = getattr(a, "mode", "manual")
        if mode == "auto":
            raise SystemExit(
                "Production Auto Failover is NOT APPROVED. Use --mode manual."
            )
        return ControllerConfig(
            controller_id=a.controller_id,
            failure_domain=a.failure_domain,
            version=a.version,
            database_url=a.database_url,
            mode=mode,
        )

    def _ctl(cfg):
        from runtime import Controller

        try:
            from fence.factory import adapter_factory_from_env
        except ImportError:  # pragma: no cover — path edge
            adapter_factory_from_env = None  # type: ignore
        factory = adapter_factory_from_env() if adapter_factory_from_env else None
        return Controller(cfg, adapter_factory=factory)

    if args.cmd == "heartbeat":
        ctl = _ctl(cfg_from(args))
        ctl.heartbeat()
        print(json.dumps({"ok": True, "controller_id": args.controller_id}))
        return 0

    if args.cmd == "heartbeat-loop":
        import time

        ctl = _ctl(cfg_from(args))
        interval = max(1.0, float(args.interval_sec))
        logging.getLogger("controller").info(
            "heartbeat-loop start controller_id=%s interval_sec=%s mode=%s",
            args.controller_id,
            interval,
            getattr(args, "mode", "manual"),
        )
        while True:
            ctl.heartbeat()
            time.sleep(interval)

    if args.cmd == "recover":
        ctl = _ctl(cfg_from(args))
        import db

        with db.session(args.database_url) as conn:
            plans = ctl.recover_scan(conn)
        print(
            json.dumps(
                [
                    {
                        "execution_id": x.execution_id,
                        "state": x.state,
                        "owner_gen": x.owner_gen,
                        "action": x.action,
                        "detail": x.detail,
                    }
                    for x in plans
                ],
                indent=2,
            )
        )
        return 0

    if args.cmd == "run-once":
        ctl = _ctl(cfg_from(args))
        result = ctl.run_manual_failover(
            to_holder=args.to_holder,
            to_db_role=args.to_db_role,
            observed_epoch=args.observed_epoch,
            skip_compute=args.skip_compute,
            stop_after=args.stop_after,
        )
        print(
            json.dumps(
                {
                    "outcome": result.outcome,
                    "execution_id": result.execution_id,
                    "owner_gen": result.owner_gen,
                    "local_state": result.local_state,
                    "side_effect_count": result.side_effect_count,
                    "steps": result.steps,
                    "detail": result.detail,
                },
                indent=2,
            )
        )
        return 0 if result.outcome in ("DONE", "LOST_CLAIM", "WON") else 1

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
