"""Fence / CF configuration from env. Defaults: backend=lab, real OFF."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional


def _flag(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class FenceCfConfig:
    """Env-driven fence/CF contract. Secrets stay in env — never in git."""

    backend: str = "lab"  # lab | dry_run | real
    enable_app: bool = False
    enable_network: bool = False
    enable_compute: bool = False
    enable_cf: bool = False
    enable_promote: bool = False

    # App Fence HTTP client
    app_fence_url: str = ""  # e.g. https://node-a:8443/internal/fence
    app_fence_timeout_s: float = 10.0
    app_mtls_cert: str = ""
    app_mtls_key: str = ""
    app_mtls_ca: str = ""

    # Cloud provider for Network / Compute
    # PRIMARY topology = Aliyun; AWS retained as lab-compat only (E2b-C hybrid).
    cloud_provider: str = "mock"  # mock | aws | aliyun
    aws_region: str = ""
    aws_sg_id: str = ""
    aws_nacl_id: str = ""
    aws_instance_id: str = ""  # old primary for compute stop
    # AWS credentials: use standard AWS_* env / instance role — never commit
    aws_live_mutate: bool = False  # HA_AWS_LIVE_MUTATE; default OFF
    aws_live_target: str = ""  # must be "staging" when aws_live_mutate=1

    # Aliyun (PRIMARY) — IDs via env only; never commit secrets
    aliyun_region: str = ""  # e.g. cn-hongkong
    aliyun_sg_id: str = ""
    aliyun_instance_id: str = ""
    aliyun_live_mutate: bool = False  # HA_ALIYUN_LIVE_MUTATE; default OFF
    aliyun_live_target: str = ""  # must be "staging" when aliyun_live_mutate=1
    # E2b-O1: optional ECS OpenAPI endpoint override (e.g. VPC endpoint). Creds are
    # never config fields — resolved lazily from env / RAM role name at call time.
    aliyun_ecs_endpoint: str = ""
    # E2b-O2: SG isolate blast radius + local pre-mutate snapshot dir (not git).
    # Port ranges are config (not secrets). Owner decision #2 pending → placeholders.
    aliyun_isolate_ports: str = ""  # HA_ALIYUN_ISOLATE_PORTS; default 5432/5432
    aliyun_protect_ports: str = "22/22"  # HA_ALIYUN_PROTECT_PORTS; never revoked
    aliyun_sg_snapshot_dir: str = ""  # HA_ALIYUN_SG_SNAPSHOT_DIR; outside any git tree

    # Cloudflare
    cf_api_base: str = "https://api.cloudflare.com/client/v4"
    cf_api_token: str = ""  # from env only
    cf_account_id: str = ""
    cf_pool_id: str = ""
    cf_old_origin: str = ""
    cf_new_origin: str = ""
    cf_timeout_s: float = 30.0

    # Shared SQL path (terminate / VERIFY) — same DSN as controller
    database_url: str = ""
    terminate_timeout_ms: int = 2000
    t_wait_s: float = 5.0
    t_confirm_s: float = 1.0
    skip_compute_documented: bool = True
    app_fence_acked: bool = False

    # Controller mode (must stay manual — Auto FO NOT APPROVED)
    controller_mode: str = "manual"

    def __post_init__(self) -> None:
        if self.backend not in ("lab", "dry_run", "real"):
            raise ValueError(f"HA_FENCE_BACKEND must be lab|dry_run|real, got {self.backend!r}")
        if self.cloud_provider not in ("mock", "aws", "aliyun"):
            raise ValueError(
                f"HA_CLOUD_PROVIDER must be mock|aws|aliyun, got {self.cloud_provider!r}"
            )
        if self.controller_mode == "auto":
            raise ValueError(
                "Production Auto Failover is NOT APPROVED. "
                "HA_CONTROLLER_MODE must remain manual."
            )
        # E2b-O2: validate isolate/protect port specs early (ValueError subclass).
        self.aliyun_isolate_policy()

    def aliyun_isolate_policy(self):
        """E2b-O2 ``IsolatePolicy`` from HA_ALIYUN_ISOLATE_PORTS / HA_ALIYUN_PROTECT_PORTS."""
        from fence.aliyun_sg import IsolatePolicy

        return IsolatePolicy.from_specs(self.aliyun_isolate_ports, self.aliyun_protect_ports)

    def require_real_ready(self) -> None:
        """Refuse backend=real unless enable flags + required env are present."""
        if self.backend != "real":
            return
        enabled = [
            ("app", self.enable_app),
            ("network", self.enable_network),
            ("compute", self.enable_compute),
            ("cf", self.enable_cf),
            ("promote", self.enable_promote),
        ]
        if not any(v for _, v in enabled):
            raise SystemExit(
                "HA_FENCE_BACKEND=real requires at least one of "
                "HA_FENCE_ENABLE_{APP,NETWORK,COMPUTE,CF,PROMOTE}=1"
            )
        if not self.database_url:
            raise SystemExit("HA_FENCE_BACKEND=real requires DATABASE_URL (terminate/VERIFY SQL)")
        if self.enable_app and not self.app_fence_url:
            raise SystemExit("HA_FENCE_ENABLE_APP=1 requires HA_APP_FENCE_URL")
        if self.enable_network and self.cloud_provider == "aws":
            if not self.aws_region or not (self.aws_sg_id or self.aws_nacl_id):
                raise SystemExit(
                    "HA_FENCE_ENABLE_NETWORK=1 with HA_CLOUD_PROVIDER=aws "
                    "requires HA_AWS_REGION and HA_AWS_SG_ID or HA_AWS_NACL_ID"
                )
        if self.enable_compute and self.cloud_provider == "aws":
            if not self.aws_region or not self.aws_instance_id:
                raise SystemExit(
                    "HA_FENCE_ENABLE_COMPUTE=1 with HA_CLOUD_PROVIDER=aws "
                    "requires HA_AWS_REGION and HA_AWS_INSTANCE_ID"
                )
        if self.enable_network and self.cloud_provider == "aliyun":
            if not self.aliyun_region or not self.aliyun_sg_id:
                raise SystemExit(
                    "HA_FENCE_ENABLE_NETWORK=1 with HA_CLOUD_PROVIDER=aliyun "
                    "requires HA_ALIYUN_REGION and HA_ALIYUN_SG_ID"
                )
        if self.enable_compute and self.cloud_provider == "aliyun":
            if not self.aliyun_region or not self.aliyun_instance_id:
                raise SystemExit(
                    "HA_FENCE_ENABLE_COMPUTE=1 with HA_CLOUD_PROVIDER=aliyun "
                    "requires HA_ALIYUN_REGION and HA_ALIYUN_INSTANCE_ID"
                )
        if self.aws_live_mutate:
            if self.cloud_provider != "aws":
                raise SystemExit(
                    "HA_AWS_LIVE_MUTATE=1 requires HA_CLOUD_PROVIDER=aws"
                )
            if self.aws_live_target.strip().lower() != "staging":
                raise SystemExit(
                    "HA_AWS_LIVE_MUTATE=1 requires HA_AWS_LIVE_TARGET=staging "
                    "(refuse non-staging / empty targets)"
                )
            if not (self.enable_network or self.enable_compute):
                raise SystemExit(
                    "HA_AWS_LIVE_MUTATE=1 requires HA_FENCE_ENABLE_NETWORK=1 "
                    "and/or HA_FENCE_ENABLE_COMPUTE=1"
                )
        if self.aliyun_live_mutate:
            if self.cloud_provider != "aliyun":
                raise SystemExit(
                    "HA_ALIYUN_LIVE_MUTATE=1 requires HA_CLOUD_PROVIDER=aliyun"
                )
            if self.aliyun_live_target.strip().lower() != "staging":
                raise SystemExit(
                    "HA_ALIYUN_LIVE_MUTATE=1 requires HA_ALIYUN_LIVE_TARGET=staging "
                    "(refuse non-staging / empty targets)"
                )
            if not (self.enable_network or self.enable_compute):
                raise SystemExit(
                    "HA_ALIYUN_LIVE_MUTATE=1 requires HA_FENCE_ENABLE_NETWORK=1 "
                    "and/or HA_FENCE_ENABLE_COMPUTE=1"
                )
        if self.enable_cf:
            missing = [
                n
                for n, v in (
                    ("HA_CF_API_TOKEN", self.cf_api_token),
                    ("HA_CF_ACCOUNT_ID", self.cf_account_id),
                    ("HA_CF_POOL_ID", self.cf_pool_id),
                    ("HA_CF_OLD_ORIGIN", self.cf_old_origin),
                    ("HA_CF_NEW_ORIGIN", self.cf_new_origin),
                )
                if not v
            ]
            if missing:
                raise SystemExit(
                    "HA_FENCE_ENABLE_CF=1 requires: " + ", ".join(missing)
                )

    @classmethod
    def from_env(cls, *, database_url: Optional[str] = None) -> "FenceCfConfig":
        dsn = (database_url or os.environ.get("DATABASE_URL", "")).strip()
        return cls(
            backend=(os.environ.get("HA_FENCE_BACKEND", "lab").strip().lower() or "lab"),
            enable_app=_flag("HA_FENCE_ENABLE_APP"),
            enable_network=_flag("HA_FENCE_ENABLE_NETWORK"),
            enable_compute=_flag("HA_FENCE_ENABLE_COMPUTE"),
            enable_cf=_flag("HA_FENCE_ENABLE_CF"),
            enable_promote=_flag("HA_FENCE_ENABLE_PROMOTE"),
            app_fence_url=os.environ.get("HA_APP_FENCE_URL", "").strip(),
            app_fence_timeout_s=float(os.environ.get("HA_APP_FENCE_TIMEOUT_S", "10")),
            app_mtls_cert=os.environ.get("HA_APP_MTLS_CERT", "").strip(),
            app_mtls_key=os.environ.get("HA_APP_MTLS_KEY", "").strip(),
            app_mtls_ca=os.environ.get("HA_APP_MTLS_CA", "").strip(),
            cloud_provider=(os.environ.get("HA_CLOUD_PROVIDER", "mock").strip().lower() or "mock"),
            aws_region=os.environ.get("HA_AWS_REGION", "").strip(),
            aws_sg_id=os.environ.get("HA_AWS_SG_ID", "").strip(),
            aws_nacl_id=os.environ.get("HA_AWS_NACL_ID", "").strip(),
            aws_instance_id=os.environ.get("HA_AWS_INSTANCE_ID", "").strip(),
            aws_live_mutate=_flag("HA_AWS_LIVE_MUTATE"),
            aws_live_target=os.environ.get("HA_AWS_LIVE_TARGET", "").strip(),
            aliyun_region=os.environ.get("HA_ALIYUN_REGION", "").strip(),
            aliyun_sg_id=os.environ.get("HA_ALIYUN_SG_ID", "").strip(),
            aliyun_instance_id=os.environ.get("HA_ALIYUN_INSTANCE_ID", "").strip(),
            aliyun_live_mutate=_flag("HA_ALIYUN_LIVE_MUTATE"),
            aliyun_live_target=os.environ.get("HA_ALIYUN_LIVE_TARGET", "").strip(),
            aliyun_ecs_endpoint=os.environ.get("HA_ALIYUN_ECS_ENDPOINT", "").strip(),
            aliyun_isolate_ports=os.environ.get("HA_ALIYUN_ISOLATE_PORTS", "").strip(),
            aliyun_protect_ports=os.environ.get("HA_ALIYUN_PROTECT_PORTS", "22/22").strip(),
            aliyun_sg_snapshot_dir=os.environ.get("HA_ALIYUN_SG_SNAPSHOT_DIR", "").strip(),
            cf_api_base=os.environ.get(
                "HA_CF_API_BASE", "https://api.cloudflare.com/client/v4"
            ).strip(),
            cf_api_token=os.environ.get("HA_CF_API_TOKEN", "").strip(),
            cf_account_id=os.environ.get("HA_CF_ACCOUNT_ID", "").strip(),
            cf_pool_id=os.environ.get("HA_CF_POOL_ID", "").strip(),
            cf_old_origin=os.environ.get("HA_CF_OLD_ORIGIN", "").strip(),
            cf_new_origin=os.environ.get("HA_CF_NEW_ORIGIN", "").strip(),
            cf_timeout_s=float(os.environ.get("HA_CF_TIMEOUT_S", "30")),
            database_url=dsn,
            terminate_timeout_ms=int(os.environ.get("HA_TERMINATE_TIMEOUT_MS", "2000")),
            t_wait_s=float(os.environ.get("HA_DRILL_T_WAIT_S", os.environ.get("HA_FENCE_T_WAIT_S", "5"))),
            t_confirm_s=float(os.environ.get("HA_FENCE_T_CONFIRM_S", "1")),
            skip_compute_documented=_flag("HA_FENCE_SKIP_COMPUTE_DOCUMENTED", "1"),
            app_fence_acked=_flag("HA_APP_FENCE_ACKED"),
            controller_mode=(
                os.environ.get("HA_CONTROLLER_MODE", "manual").strip().lower() or "manual"
            ),
        )
