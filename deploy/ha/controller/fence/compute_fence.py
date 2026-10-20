"""Compute Fence — Protocol + Mock + AWS/Aliyun stop/isolate client skeletons."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


class ComputeFenceClient(Protocol):
    def stop_or_isolate(
        self,
        *,
        execution_id: str,
        from_holder: str,
        instance_id: str = "",
    ) -> dict[str, Any]: ...


@dataclass
class MockComputeFenceClient:
    force_fail: bool = False
    calls: list[dict[str, Any]] = field(default_factory=list)

    def stop_or_isolate(
        self,
        *,
        execution_id: str,
        from_holder: str,
        instance_id: str = "",
    ) -> dict[str, Any]:
        key = f"{execution_id}:FENCING_COMPUTE"
        payload = {
            "execution_id": execution_id,
            "from_holder": from_holder,
            "instance_id": instance_id or from_holder,
            "idempotency_key": key,
            "provider": "mock",
        }
        self.calls.append(payload)
        if self.force_fail:
            raise RuntimeError("MockComputeFenceClient: forced failure")
        return {
            "ok": True,
            "provider": "mock",
            "action": "stop",
            "instance_state": "stopped",
            "idempotency_key": key,
            "instance_id": payload["instance_id"],
        }


@dataclass
class AwsComputeFenceClient:
    """AWS EC2 StopInstances / isolate skeleton. live default False."""

    region: str
    instance_id: str = ""
    live: bool = False
    calls: list[dict[str, Any]] = field(default_factory=list)

    def stop_or_isolate(
        self,
        *,
        execution_id: str,
        from_holder: str,
        instance_id: str = "",
    ) -> dict[str, Any]:
        key = f"{execution_id}:FENCING_COMPUTE"
        iid = instance_id or self.instance_id or from_holder
        intended = {
            "provider": "aws",
            "region": self.region,
            "instance_id": iid,
            "action": "StopInstances",
            "from_holder": from_holder,
            "idempotency_key": key,
            "live": self.live,
        }
        self.calls.append(intended)
        if not self.live:
            return {
                "ok": True,
                "dry_skeleton": True,
                "note": "AWS compute skeleton — live=False; no API call issued",
                "instance_state": "intended-stop",
                **intended,
            }
        raise RuntimeError(
            "AwsComputeFenceClient live=True refused: boto3 StopInstances not "
            "implemented in E2a (gates/preflight only). Keep HA_AWS_LIVE_MUTATE=0 "
            "for dry_skeleton receipts, or wait for Owner-approved E2 live path."
        )


@dataclass
class AliyunComputeFenceClient:
    """Aliyun ECS StopInstance / isolate skeleton. live default False."""

    region: str
    instance_id: str = ""
    live: bool = False
    calls: list[dict[str, Any]] = field(default_factory=list)

    def stop_or_isolate(
        self,
        *,
        execution_id: str,
        from_holder: str,
        instance_id: str = "",
    ) -> dict[str, Any]:
        key = f"{execution_id}:FENCING_COMPUTE"
        iid = instance_id or self.instance_id or from_holder
        intended = {
            "provider": "aliyun",
            "region": self.region,
            "instance_id": iid,
            "action": "StopInstance",
            "from_holder": from_holder,
            "idempotency_key": key,
            "live": self.live,
        }
        self.calls.append(intended)
        if not self.live:
            return {
                "ok": True,
                "dry_skeleton": True,
                "note": "Aliyun compute skeleton — live=False; no OpenAPI call issued",
                "instance_state": "intended-stop",
                **intended,
            }
        raise RuntimeError(
            "AliyunComputeFenceClient live=True refused: Aliyun OpenAPI StopInstance not "
            "implemented in E2b-C slice 1 (gates/preflight only). Keep "
            "HA_ALIYUN_LIVE_MUTATE=0 for dry_skeleton receipts, or wait for "
            "Owner-approved E2b live path."
        )
