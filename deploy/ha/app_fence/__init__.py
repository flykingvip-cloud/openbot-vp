"""HA V2.1.2 E1 — App Fence reference server (POST /internal/fence).

Matches Controller client ``fence.app_fence.HttpAppFenceClient``.
Default: lab-safe (no secrets; auth optional). Production Auto Failover
remains OFF / NOT APPROVED — this package is not Auto FO admission.
"""
from __future__ import annotations

__version__ = "0.1.0-e1"

__all__ = ["__version__"]
