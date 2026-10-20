"""Stage D Fence / CF adapters (default backend=lab; Auto FO OFF).

Real cloud / Cloudflare clients are **opt-in** via HA_FENCE_BACKEND + enable
flags. Unit tests use Mock / DryRun only — no live credentials required.

Import ``fence.factory.build_adapter`` / ``fence.config.FenceCfConfig`` directly
to avoid pulling SQL deps until needed.
"""
from __future__ import annotations

__version__ = "0.1.0-stage-d"

__all__ = ["__version__"]


def build_adapter(*args, **kwargs):
    from fence.factory import build_adapter as _ba

    return _ba(*args, **kwargs)
