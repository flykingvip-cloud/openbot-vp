"""Controller configuration (§12.3). Default mode=manual; Auto FO OFF."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class ControllerConfig:
    controller_id: str
    failure_domain: str
    version: str
    database_url: str
    # §13.1 Auto Failover is NOT APPROVED for this stage. Default is manual.
    mode: str = "manual"
    lock_name: str = "openbot_writer"
    owner_lease_ttl_s: int = 20
    owner_lease_renew_s: int = 5
    heartbeat_interval_s: int = 5
    # Role used for DB connections (lab / Managed PG).
    db_user: str = "openbot_controller"

    def __post_init__(self) -> None:
        if self.mode not in ("manual", "auto"):
            raise ValueError(f"mode must be manual|auto, got {self.mode!r}")
        if self.mode == "auto":
            # Soft guard: allow constructing for future drills, but CLI refuses to run auto.
            pass

    @classmethod
    def from_env(cls) -> "ControllerConfig":
        cid = os.environ.get("HA_CONTROLLER_ID", "").strip()
        domain = os.environ.get("HA_FAILURE_DOMAIN", "").strip()
        version = os.environ.get("HA_CONTROLLER_VERSION", "stage-c-dev").strip()
        dsn = os.environ.get("DATABASE_URL", "").strip()
        mode = os.environ.get("HA_CONTROLLER_MODE", "manual").strip().lower() or "manual"
        if not cid or not domain or not dsn:
            raise SystemExit(
                "HA_CONTROLLER_ID, HA_FAILURE_DOMAIN, and DATABASE_URL are required"
            )
        return cls(
            controller_id=cid,
            failure_domain=domain,
            version=version,
            database_url=dsn,
            mode=mode,
            owner_lease_ttl_s=int(os.environ.get("HA_OWNER_LEASE_TTL_S", "20")),
            owner_lease_renew_s=int(os.environ.get("HA_OWNER_LEASE_RENEW_S", "5")),
            heartbeat_interval_s=int(os.environ.get("HA_HEARTBEAT_INTERVAL_S", "5")),
        )
