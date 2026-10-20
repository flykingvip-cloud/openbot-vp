"""CLI: PYTHONPATH=deploy/ha python -m app_fence --port 8443"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Allow ``python deploy/ha/app-fence/__main__.py`` and ``python -m app_fence``.
_HERE = Path(__file__).resolve().parent
_HA = _HERE.parent
if str(_HA) not in sys.path:
    sys.path.insert(0, str(_HA))

from app_fence.http_server import serve_forever  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="HA V2.1.2 E1 App Fence reference server")
    p.add_argument("--host", default=os.environ.get("HA_APP_FENCE_HOST", "127.0.0.1"))
    p.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("HA_APP_FENCE_PORT", "8443")),
    )
    p.add_argument(
        "--node-id",
        default=os.environ.get("HA_APP_FENCE_NODE_ID", "node-local"),
    )
    p.add_argument("--tls-cert", default=os.environ.get("HA_APP_FENCE_TLS_CERT", ""))
    p.add_argument("--tls-key", default=os.environ.get("HA_APP_FENCE_TLS_KEY", ""))
    p.add_argument(
        "--tls-ca",
        default=os.environ.get("HA_APP_FENCE_TLS_CA", ""),
        help="If set with cert/key, require client cert (mTLS)",
    )
    args = p.parse_args(argv)
    serve_forever(
        host=args.host,
        port=args.port,
        node_id=args.node_id,
        tls_cert=args.tls_cert,
        tls_key=args.tls_key,
        tls_ca=args.tls_ca,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
