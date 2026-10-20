"""Cloudflare cutover: remove-old → add-new; epoch refuse-overwrite (§12.5)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional, Protocol

from fence.http_util import HttpError, http_json

_EPOCH_RE = re.compile(r"epoch\s*=\s*(\d+)", re.IGNORECASE)
_EXEC_RE = re.compile(r"execution\s*=\s*([0-9a-fA-F-]{8,})", re.IGNORECASE)


class EpochOverwriteRefused(RuntimeError):
    """§12.5: CF description epoch > local to_epoch → refuse overwrite."""


def parse_origin_description(desc: str) -> dict[str, Any]:
    ep = None
    m = _EPOCH_RE.search(desc or "")
    if m:
        ep = int(m.group(1))
    eid = None
    m2 = _EXEC_RE.search(desc or "")
    if m2:
        eid = m2.group(1)
    return {"epoch": ep, "execution_id": eid, "raw": desc or ""}


def format_origin_description(*, to_epoch: int, execution_id: str) -> str:
    return f"epoch={to_epoch}; execution={execution_id}"


def check_refuse_overwrite(*, current_desc: str, to_epoch: int) -> None:
    parsed = parse_origin_description(current_desc)
    cur = parsed.get("epoch")
    if cur is not None and int(cur) > int(to_epoch):
        raise EpochOverwriteRefused(
            f"§12.5 refuse overwrite: CF origin epoch={cur} > to_epoch={to_epoch}"
        )


class CloudflareCutoverClient(Protocol):
    def cutover(
        self,
        *,
        execution_id: str,
        to_epoch: int,
        to_holder: str,
        old_origin: str,
        new_origin: str,
        lease_epoch: Optional[int] = None,
        lease_holder: Optional[str] = None,
    ) -> dict[str, Any]: ...


@dataclass
class MockCloudflareCutoverClient:
    """In-memory CF pool: tracks origins + description; enforces §12.5."""

    pool_id: str = "mock-pool"
    origins: dict[str, str] = field(default_factory=dict)  # name -> description
    force_fail: bool = False
    calls: list[dict[str, Any]] = field(default_factory=list)

    def cutover(
        self,
        *,
        execution_id: str,
        to_epoch: int,
        to_holder: str,
        old_origin: str,
        new_origin: str,
        lease_epoch: Optional[int] = None,
        lease_holder: Optional[str] = None,
    ) -> dict[str, Any]:
        key = f"{execution_id}:CF_CUTOVER"
        # §12.5 pre-check against lease truth
        if lease_epoch is not None and int(lease_epoch) != int(to_epoch):
            raise RuntimeError(
                f"§12.5 CF refuse: writer_lease.epoch={lease_epoch} != to_epoch={to_epoch}"
            )
        if lease_holder is not None and lease_holder != to_holder:
            raise RuntimeError(
                f"§12.5 CF refuse: writer_lease.holder_id={lease_holder!r} != to_holder={to_holder!r}"
            )

        # Refuse overwrite if any tracked origin already has higher epoch
        for name, desc in list(self.origins.items()):
            check_refuse_overwrite(current_desc=desc, to_epoch=to_epoch)

        intended = {
            "execution_id": execution_id,
            "to_epoch": to_epoch,
            "to_holder": to_holder,
            "old_origin": old_origin,
            "new_origin": new_origin,
            "idempotency_key": key,
            "pool_id": self.pool_id,
        }
        self.calls.append(intended)
        if self.force_fail:
            raise RuntimeError("MockCloudflareCutoverClient: forced failure")

        # remove-old → add-new
        removed = False
        if old_origin in self.origins:
            del self.origins[old_origin]
            removed = True
        new_desc = format_origin_description(to_epoch=to_epoch, execution_id=execution_id)
        self.origins[new_origin] = new_desc
        return {
            "ok": True,
            "provider": "mock",
            "removed_old": removed or bool(old_origin),
            "added_new": True,
            "description": new_desc,
            "pool_origins": dict(self.origins),
            **intended,
        }


@dataclass
class HttpCloudflareCutoverClient:
    """Cloudflare Load Balancer pool HTTP client. Token from env only."""

    api_base: str
    api_token: str
    account_id: str
    pool_id: str
    timeout_s: float = 30.0

    def _headers(self, idem_key: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
            "X-Idempotency-Key": idem_key,
        }

    def _pool_url(self) -> str:
        return (
            f"{self.api_base.rstrip('/')}/accounts/{self.account_id}"
            f"/load_balancers/pools/{self.pool_id}"
        )

    def get_pool(self) -> dict[str, Any]:
        return http_json(
            "GET",
            self._pool_url(),
            headers=self._headers("probe"),
            timeout_s=self.timeout_s,
        )

    def cutover(
        self,
        *,
        execution_id: str,
        to_epoch: int,
        to_holder: str,
        old_origin: str,
        new_origin: str,
        lease_epoch: Optional[int] = None,
        lease_holder: Optional[str] = None,
    ) -> dict[str, Any]:
        key = f"{execution_id}:CF_CUTOVER"
        if lease_epoch is not None and int(lease_epoch) != int(to_epoch):
            raise RuntimeError(
                f"§12.5 CF refuse: writer_lease.epoch={lease_epoch} != to_epoch={to_epoch}"
            )
        if lease_holder is not None and lease_holder != to_holder:
            raise RuntimeError(
                f"§12.5 CF refuse: holder_id={lease_holder!r} != to_holder={to_holder!r}"
            )
        if not self.api_token:
            raise RuntimeError("HA_CF_API_TOKEN missing")

        # Fetch pool; refuse overwrite if origin desc epoch > to_epoch
        try:
            pool = self.get_pool()
        except HttpError as e:
            raise RuntimeError(f"CF get pool failed: {e}") from e
        result = pool.get("result") or pool
        origins = result.get("origins") or []
        for o in origins:
            desc = o.get("description") or o.get("name") or ""
            check_refuse_overwrite(current_desc=str(desc), to_epoch=to_epoch)

        new_desc = format_origin_description(to_epoch=to_epoch, execution_id=execution_id)
        # Stage D: shape the intended PATCH body; live mutate still needs operator enable.
        # We PATCH only when explicitly allowed via env HA_CF_LIVE_MUTATE=1.
        import os

        live = os.environ.get("HA_CF_LIVE_MUTATE", "0").strip() in ("1", "true", "yes")
        body = {
            "comment": f"ha-cutover {key}",
            "origins_intended": {
                "remove": old_origin,
                "add": new_origin,
                "description": new_desc,
            },
        }
        if not live:
            return {
                "ok": True,
                "dry_skeleton": True,
                "note": "CF HTTP client — HA_CF_LIVE_MUTATE!=1; no pool mutate",
                "idempotency_key": key,
                "to_epoch": to_epoch,
                "description": new_desc,
                "pool_id": self.pool_id,
                "intended": body,
            }
        # Live mutate path: replace origins list carefully (operator-approved only).
        new_origins = []
        for o in origins:
            name = o.get("name") or o.get("address") or ""
            if name == old_origin or o.get("address") == old_origin:
                continue
            new_origins.append(o)
        new_origins.append(
            {
                "name": new_origin,
                "address": new_origin,
                "enabled": True,
                "description": new_desc,
            }
        )
        try:
            resp = http_json(
                "PUT",
                self._pool_url(),
                headers=self._headers(key),
                body={**result, "origins": new_origins},
                timeout_s=self.timeout_s,
            )
        except HttpError as e:
            raise RuntimeError(f"CF cutover PUT failed: {e}") from e
        return {
            "ok": True,
            "live": True,
            "idempotency_key": key,
            "to_epoch": to_epoch,
            "description": new_desc,
            "response": resp,
        }
