"""Network Fence — Protocol + Mock + AWS SG/NACL skeleton + Aliyun SG (E2b-O1 OpenAPI wiring + E2b-O2 dry paths)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional, Protocol


class NetworkFenceClient(Protocol):
    def isolate_old_primary(
        self,
        *,
        execution_id: str,
        from_holder: str,
        to_holder: str,
    ) -> dict[str, Any]: ...


@dataclass
class MockNetworkFenceClient:
    """Records intended SG/NACL isolates; returns versioned receipts."""

    rule_version: int = 1
    force_fail: bool = False
    calls: list[dict[str, Any]] = field(default_factory=list)

    def isolate_old_primary(
        self,
        *,
        execution_id: str,
        from_holder: str,
        to_holder: str,
    ) -> dict[str, Any]:
        key = f"{execution_id}:FENCING_NETWORK"
        payload = {
            "execution_id": execution_id,
            "from_holder": from_holder,
            "to_holder": to_holder,
            "idempotency_key": key,
            "provider": "mock",
        }
        self.calls.append(payload)
        if self.force_fail:
            raise RuntimeError("MockNetworkFenceClient: forced failure")
        self.rule_version += 1
        return {
            "ok": True,
            "provider": "mock",
            "action": "isolate_pg_write_path",
            "rule_version": self.rule_version,
            "idempotency_key": key,
            "from_holder": from_holder,
        }


@dataclass
class AwsNetworkFenceClient:
    """AWS SG / NACL skeleton. Live boto3 calls require HA_CLOUD_PROVIDER=aws + creds.

    Call shape + dry_skeleton when ``live=False`` (default). ``live=True`` is
    wired only via ``HA_AWS_LIVE_MUTATE=1`` + ``HA_AWS_LIVE_TARGET=staging``;
    E2a still refuses boto3 rather than fake a cloud call.
    """

    region: str
    sg_id: str = ""
    nacl_id: str = ""
    live: bool = False  # must be explicitly True + enable flag to hit AWS
    calls: list[dict[str, Any]] = field(default_factory=list)

    def isolate_old_primary(
        self,
        *,
        execution_id: str,
        from_holder: str,
        to_holder: str,
    ) -> dict[str, Any]:
        key = f"{execution_id}:FENCING_NETWORK"
        intended = {
            "provider": "aws",
            "region": self.region,
            "sg_id": self.sg_id or None,
            "nacl_id": self.nacl_id or None,
            "action": "deny_old_primary_to_pg",
            "from_holder": from_holder,
            "to_holder": to_holder,
            "idempotency_key": key,
            "live": self.live,
        }
        self.calls.append(intended)
        if not self.live:
            return {
                "ok": True,
                "dry_skeleton": True,
                "note": "AWS client skeleton — live=False; no API call issued",
                **intended,
            }
        # Live boto3 mutate is intentionally not shipped here (E2a = gates only).
        # Refuse rather than half-call or fake success. Owner/Ops must run an
        # approved staging session after boto3 path lands (E2 live session).
        raise RuntimeError(
            "AwsNetworkFenceClient live=True refused: boto3 SG/NACL mutate not "
            "implemented in E2a (gates/preflight only). Keep HA_AWS_LIVE_MUTATE=0 "
            "for dry_skeleton receipts, or wait for Owner-approved E2 live path."
        )


@dataclass
class AliyunNetworkFenceClient:
    """Aliyun ECS Security Group client (PRIMARY path; E2b-O1 wiring + E2b-O2 dry paths).

    * ``live=False`` (default; ``HA_ALIYUN_LIVE_MUTATE=0``): dry_skeleton receipt,
      **zero OpenAPI calls**, credentials never resolved. O2 adds versioned
      ``snapshot_sg`` / ``isolate`` / ``restore`` receipts (``fence.aliyun_sg``) built
      from an optional offline snapshot (``offline_permissions`` / local file).
    * ``live=True`` **without** gates (``live_target != "staging"``): RuntimeError
      refuse before any credential lookup / OpenAPI call (all three ops).
    * ``live=True`` **with** gates: ``snapshot_sg`` issues only the read-only
      ``DescribeSecurityGroupAttribute``; ``isolate`` / ``restore`` compute the
      intended Revoke/Authorize plan from that snapshot and then refuse honestly
      (``AliyunNetworkMutateNotImplemented``) — real SG mutate is **O3**
      (Owner-approved staging window). Mutate actions remain outside the OpenAPI
      client allowlist, so they cannot be signed/sent even by mistake.

    Credentials: env (secret-store injected) or ECS RAM role *name* only — see
    ``fence.aliyun_openapi.resolve_aliyun_credentials``. Auto FO OFF / NOT APPROVED.
    """

    region: str
    sg_id: str = ""
    live: bool = False  # must be explicitly True + enable flag to hit Aliyun
    live_target: str = ""  # HA_ALIYUN_LIVE_TARGET; must be "staging" when live
    endpoint: str = ""  # optional HA_ALIYUN_ECS_ENDPOINT (e.g. VPC endpoint)
    openapi: Optional[Any] = None  # AliyunEcsRpcClient; lazily built when live+gated
    # E2b-O2 dry paths
    isolate_policy: Optional[Any] = None  # fence.aliyun_sg.IsolatePolicy (default PG 5432; SSH 22 protected)
    snapshot_dir: str = ""  # HA_ALIYUN_SG_SNAPSHOT_DIR — local, outside git; optional
    offline_permissions: Optional[list[dict[str, Any]]] = None  # dry snapshot input (no OpenAPI)
    calls: list[dict[str, Any]] = field(default_factory=list)
    receipts: list[dict[str, Any]] = field(default_factory=list)

    PROBE_ACTION = "DescribeSecurityGroupAttribute"
    DEFERRED_MUTATE_ACTIONS = ("RevokeSecurityGroup", "AuthorizeSecurityGroup")

    def _gates_green(self) -> bool:
        return bool(self.live) and self.live_target.strip().lower() == "staging"

    def _openapi_client(self) -> Any:
        if self.openapi is None:
            from fence.aliyun_openapi import build_default_ecs_client

            self.openapi = build_default_ecs_client(self.region, endpoint=self.endpoint)
        return self.openapi

    def _policy(self) -> Any:
        from fence.aliyun_sg import IsolatePolicy

        if self.isolate_policy is None:
            self.isolate_policy = IsolatePolicy()
        return self.isolate_policy

    def _refuse_if_live_ungated(self, op: str) -> None:
        if self.live and not self._gates_green():
            raise RuntimeError(
                f"AliyunNetworkFenceClient live=True refused ({op}): gates not green "
                "(HA_ALIYUN_LIVE_TARGET=staging required with HA_ALIYUN_LIVE_MUTATE=1). "
                "E2b-O1/O2 OpenAPI path stays gated; no OpenAPI call issued."
            )
        if self.live and not (self.region and self.sg_id):
            raise RuntimeError(
                f"AliyunNetworkFenceClient live=True refused ({op}): HA_ALIYUN_REGION and "
                "HA_ALIYUN_SG_ID required; no OpenAPI call issued."
            )

    # ------------------------------------------------------------------ O2 ops

    def snapshot_sg(self, *, execution_id: str) -> dict[str, Any]:
        """Capture (gated live: read-only Describe) or describe (dry) the SG rule set."""
        from fence import aliyun_sg as sgm

        self._refuse_if_live_ungated("snapshot_sg")
        issued: list[str] = []
        probe: dict[str, Any] = {}
        if self.live:  # gates green (checked above)
            resp = self._openapi_client().call(
                self.PROBE_ACTION, {"SecurityGroupId": self.sg_id, "Direction": "all"}
            )
            issued.append(self.PROBE_ACTION)
            perms = sgm.permissions_from_describe(resp)
            snap = sgm.build_snapshot(
                sg_id=str(resp.get("SecurityGroupId") or self.sg_id),
                region=self.region,
                permissions=perms,
                source="openapi_describe",
                request_id=str(resp.get("RequestId") or ""),
            )
            probe = {
                "action": self.PROBE_ACTION,
                "request_id": resp.get("RequestId"),
                "security_group_id": resp.get("SecurityGroupId") or self.sg_id,
                "permission_count": len(perms),
            }
            note = "gated live: read-only DescribeSecurityGroupAttribute snapshot; no mutate"
        elif self.offline_permissions is not None:
            snap = sgm.build_snapshot(
                sg_id=self.sg_id or "sg-unset",
                region=self.region,
                permissions=self.offline_permissions,
                source="offline_input",
            )
            note = "E2b-O2 dry: snapshot from offline input; no OpenAPI call issued"
        else:
            snap = sgm.build_snapshot(
                sg_id=self.sg_id or "sg-unset",
                region=self.region,
                permissions=None,
                source="not_captured",
            )
            note = (
                "E2b-O2 dry: live=False — SG not described (zero OpenAPI calls); "
                "provide offline snapshot to plan rules"
            )
        path = ""
        if self.snapshot_dir:
            path = sgm.write_snapshot_file(snap, self.snapshot_dir, execution_id)
        receipt = sgm.build_receipt(
            "snapshot_sg",
            execution_id=execution_id,
            region=self.region,
            sg_id=self.sg_id,
            live=self.live,
            live_target=self.live_target,
            snapshot=snap,
            openapi_calls_issued=issued,
            snapshot_path=path,
            note=note,
        )
        self.receipts.append(receipt)
        return {"receipt": receipt, "snapshot": snap, "snapshot_path": path or None, "probe": probe}

    def isolate(
        self,
        *,
        execution_id: str,
        snapshot: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        """Plan SG isolate (Revoke) from a snapshot. O2: dry receipt / gated refuse."""
        from fence import aliyun_sg as sgm

        self._refuse_if_live_ungated("isolate")
        probe: dict[str, Any] = {}
        issued: list[str] = []
        if snapshot is None:
            snap_out = self.snapshot_sg(execution_id=execution_id)
            snapshot, probe = snap_out["snapshot"], snap_out["probe"]
            issued = list(snap_out["receipt"]["openapi_calls_issued"])
        plan = sgm.plan_isolate(snapshot, self._policy())
        receipt = sgm.build_receipt(
            "isolate",
            execution_id=execution_id,
            region=self.region,
            sg_id=self.sg_id,
            live=self.live,
            live_target=self.live_target,
            snapshot=snapshot,
            plan=plan,
            openapi_calls_issued=issued,
            note="E2b-O2 isolate plan only — RevokeSecurityGroup NOT issued",
        )
        self.receipts.append(receipt)
        if self.live:  # gates green
            raise AliyunNetworkMutateNotImplemented(
                "AliyunNetworkFenceClient live=True: isolate plan built "
                f"({receipt['revoke_count']} RevokeSecurityGroup intended) but SG mutate "
                "is NOT enabled in E2b-O2 (dry paths only); real isolate is O3 "
                "(Owner-approved staging window). Refusing rather than faking success.",
                probe=probe,
                receipt=receipt,
            )
        return receipt

    def restore(
        self,
        *,
        execution_id: str,
        snapshot: dict[str, Any],
        revoke_fingerprints: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """Plan SG restore (Authorize) from the pre-mutate snapshot. O2: dry / refuse."""
        from fence import aliyun_sg as sgm

        self._refuse_if_live_ungated("restore")
        if snapshot is None:
            raise sgm.AliyunSgPlanError("restore requires the pre-mutate snapshot")
        plan = sgm.plan_restore(snapshot, revoke_fingerprints, self._policy())
        receipt = sgm.build_receipt(
            "restore",
            execution_id=execution_id,
            region=self.region,
            sg_id=self.sg_id,
            live=self.live,
            live_target=self.live_target,
            snapshot=snapshot,
            plan=plan,
            note="E2b-O2 restore plan only — AuthorizeSecurityGroup NOT issued",
        )
        self.receipts.append(receipt)
        if self.live:  # gates green
            raise AliyunNetworkMutateNotImplemented(
                "AliyunNetworkFenceClient live=True: restore plan built "
                f"({receipt['restore_count']} AuthorizeSecurityGroup intended) but SG "
                "mutate is NOT enabled in E2b-O2 (dry paths only); real restore is O3. "
                "Refusing rather than faking success.",
                receipt=receipt,
            )
        return receipt

    # ------------------------------------------------- NetworkFenceClient API

    def isolate_old_primary(
        self,
        *,
        execution_id: str,
        from_holder: str,
        to_holder: str,
    ) -> dict[str, Any]:
        key = f"{execution_id}:FENCING_NETWORK"
        intended = {
            "provider": "aliyun",
            "region": self.region,
            "sg_id": self.sg_id or None,
            "action": "deny_old_primary_to_pg",
            "from_holder": from_holder,
            "to_holder": to_holder,
            "idempotency_key": key,
            "live": self.live,
            "openapi_wired": True,
            "openapi_probe_action": self.PROBE_ACTION,
            "openapi_mutate_actions_deferred": list(self.DEFERRED_MUTATE_ACTIONS),
            "o2_dry_paths": True,
        }
        self.calls.append(intended)
        if not self.live:
            snap_out = self.snapshot_sg(execution_id=execution_id)
            iso = self.isolate(execution_id=execution_id, snapshot=snap_out["snapshot"])
            return {
                "ok": True,
                "dry_skeleton": True,
                "note": "Aliyun client (E2b-O2) — live=False; no OpenAPI call issued",
                **intended,
                "o2_receipts": {"snapshot_sg": snap_out["receipt"], "isolate": iso},
            }
        if not self._gates_green():
            # live=True without gates → refuse before creds / signing / transport.
            raise RuntimeError(
                "AliyunNetworkFenceClient live=True refused: gates not green "
                "(HA_ALIYUN_LIVE_TARGET=staging required with HA_ALIYUN_LIVE_MUTATE=1). "
                "E2b-O1/O2 OpenAPI path stays gated; no OpenAPI call issued."
            )
        if not (self.region and self.sg_id):
            raise RuntimeError(
                "AliyunNetworkFenceClient live=True refused: HA_ALIYUN_REGION and "
                "HA_ALIYUN_SG_ID required; no OpenAPI call issued."
            )
        # Gates green: read-only snapshot + isolate plan, then honest refuse (O3 mutate).
        self.isolate(execution_id=execution_id)
        raise AssertionError("unreachable: gated isolate must refuse in O2")  # pragma: no cover


class AliyunNetworkMutateNotImplemented(RuntimeError):
    """O1/O2: gated OpenAPI path reached; SG mutate deliberately not shipped (O3)."""

    def __init__(
        self,
        message: str,
        *,
        probe: Optional[dict[str, Any]] = None,
        receipt: Optional[dict[str, Any]] = None,
    ) -> None:
        self.probe = dict(probe or {})
        self.receipt = dict(receipt or {})
        super().__init__(message)
