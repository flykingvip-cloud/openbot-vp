"""build_adapter(cfg) → Lab | DryRun | CompositeReal (default lab)."""
from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path
from typing import Any

import adapters
from fence.app_fence import HttpAppFenceClient, MockAppFenceClient
from fence.cloudflare_cutover import HttpCloudflareCutoverClient, MockCloudflareCutoverClient
from fence.compute_fence import (
    AliyunComputeFenceClient,
    AwsComputeFenceClient,
    MockComputeFenceClient,
)
from fence.config import FenceCfConfig
from fence.dry_run import DryRunFenceAdapter
from fence.network_fence import (
    AliyunNetworkFenceClient,
    AwsNetworkFenceClient,
    MockNetworkFenceClient,
)
from fence.promote import MockPromoteClient

_DRILLS = str(Path(__file__).resolve().parent.parent.parent / "drills")


def build_adapter(cfg: FenceCfConfig | None = None, **overrides: Any) -> Any:
    """Construct the SideEffectAdapter selected by HA_FENCE_BACKEND.

    Defaults to **lab** (LabFenceAdapter) so Stage B drills stay unchanged.
    ``backend=real`` refuses to start unless enable flags + required env pass
    ``FenceCfConfig.require_real_ready()``.
    """
    cfg = cfg or FenceCfConfig.from_env()
    if overrides:
        cfg = replace(cfg, **{k: v for k, v in overrides.items() if hasattr(cfg, k)})

    if cfg.controller_mode == "auto":
        raise SystemExit(
            "Production Auto Failover is NOT APPROVED. HA_CONTROLLER_MODE=manual required."
        )

    if cfg.backend == "lab":
        return _lab_adapter(cfg)

    if cfg.backend == "dry_run":
        return DryRunFenceAdapter()

    if cfg.backend == "real":
        cfg.require_real_ready()
        return _composite_real(cfg)

    raise SystemExit(f"unknown HA_FENCE_BACKEND={cfg.backend!r}")


def _lab_adapter(cfg: FenceCfConfig) -> Any:
    if not cfg.database_url:
        # No DSN → recording stub (DC unit paths / config probe)
        return adapters.RecordingStubAdapter()
    if _DRILLS not in sys.path:
        sys.path.insert(0, _DRILLS)
    import lab_adapters  # type: ignore

    return lab_adapters.LabFenceAdapter(
        cfg.database_url,
        app_fence_acked=cfg.app_fence_acked,
        t_wait_s=cfg.t_wait_s,
        t_confirm_s=cfg.t_confirm_s,
        terminate_timeout_ms=cfg.terminate_timeout_ms,
        skip_compute_documented=cfg.skip_compute_documented,
    )


def _composite_real(cfg: FenceCfConfig):
    from fence.composite import CompositeFenceAdapter

    # App
    if cfg.enable_app:
        if cfg.app_fence_url:
            app = HttpAppFenceClient(
                base_url=cfg.app_fence_url,
                timeout_s=cfg.app_fence_timeout_s,
                mtls_cert=cfg.app_mtls_cert,
                mtls_key=cfg.app_mtls_key,
                mtls_ca=cfg.app_mtls_ca,
            )
        else:
            app = MockAppFenceClient()
    else:
        app = None

    # Network
    if cfg.enable_network:
        if cfg.cloud_provider == "aws":
            net = AwsNetworkFenceClient(
                region=cfg.aws_region,
                sg_id=cfg.aws_sg_id,
                nacl_id=cfg.aws_nacl_id,
                live=bool(cfg.aws_live_mutate),  # default False; needs HA_AWS_LIVE_MUTATE=1
            )
        elif cfg.cloud_provider == "aliyun":
            net = AliyunNetworkFenceClient(
                region=cfg.aliyun_region,
                sg_id=cfg.aliyun_sg_id,
                live=bool(cfg.aliyun_live_mutate),  # default False; needs HA_ALIYUN_LIVE_MUTATE=1
                live_target=cfg.aliyun_live_target,  # client re-checks == staging
                endpoint=cfg.aliyun_ecs_endpoint,
                # openapi client built lazily only on live+gated path (E2b-O1)
                # E2b-O2 dry paths: blast-radius policy + local snapshot dir (not git)
                isolate_policy=cfg.aliyun_isolate_policy(),
                snapshot_dir=cfg.aliyun_sg_snapshot_dir,
            )
        else:
            net = MockNetworkFenceClient()
    else:
        net = None

    # Compute
    if cfg.enable_compute:
        if cfg.cloud_provider == "aws":
            comp = AwsComputeFenceClient(
                region=cfg.aws_region,
                instance_id=cfg.aws_instance_id,
                live=bool(cfg.aws_live_mutate),
            )
        elif cfg.cloud_provider == "aliyun":
            comp = AliyunComputeFenceClient(
                region=cfg.aliyun_region,
                instance_id=cfg.aliyun_instance_id,
                live=bool(cfg.aliyun_live_mutate),
            )
        else:
            comp = MockComputeFenceClient()
    else:
        comp = None

    # CF
    if cfg.enable_cf:
        if cfg.cf_api_token and cfg.cf_account_id and cfg.cf_pool_id:
            cf = HttpCloudflareCutoverClient(
                api_base=cfg.cf_api_base,
                api_token=cfg.cf_api_token,
                account_id=cfg.cf_account_id,
                pool_id=cfg.cf_pool_id,
                timeout_s=cfg.cf_timeout_s,
            )
        else:
            cf = MockCloudflareCutoverClient(pool_id=cfg.cf_pool_id or "mock-pool")
    else:
        cf = None

    promote = MockPromoteClient() if cfg.enable_promote else None

    return CompositeFenceAdapter(
        cfg.database_url,
        app_client=app,
        network_client=net,
        compute_client=comp,
        cf_client=cf,
        promote_client=promote,
        enable_app=cfg.enable_app,
        enable_network=cfg.enable_network,
        enable_compute=cfg.enable_compute,
        enable_cf=cfg.enable_cf,
        enable_promote=cfg.enable_promote,
        app_fence_acked=cfg.app_fence_acked,
        t_wait_s=cfg.t_wait_s,
        t_confirm_s=cfg.t_confirm_s,
        terminate_timeout_ms=cfg.terminate_timeout_ms,
        skip_compute_documented=cfg.skip_compute_documented,
        cf_old_origin=cfg.cf_old_origin,
        cf_new_origin=cfg.cf_new_origin,
    )


def adapter_factory_from_env(**overrides: Any):
    """Callable suitable for Controller(adapter_factory=...)."""

    def _factory() -> Any:
        return build_adapter(FenceCfConfig.from_env(), **overrides)

    return _factory
