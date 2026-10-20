"""Aliyun OpenAPI (ECS RPC) signed-HTTP helper — E2b-O1 client wiring (stdlib only).

Scope (O1):
  * RPC signature v1 (HMAC-SHA1) for ECS ``2014-05-26`` — no SDK dependency.
  * Credentials resolved **lazily** from env (secret-store injected at runtime)
    or an ECS **RAM role name** (instance metadata STS). Nothing is read from
    git, nothing is logged; ``repr`` redacts secrets.
  * Action allowlist: **read-only** actions only. Mutate actions
    (``RevokeSecurityGroup`` / ``AuthorizeSecurityGroup`` / ``StopInstance`` …)
    are refused *before* signing / transport — real isolate/restore is O2/O3.
  * Transport is injectable so unit tests run fully mocked (no real OpenAPI).

Auto Failover: OFF / NOT APPROVED. This module is not Auto FO admission.
"""
from __future__ import annotations

import base64
import datetime as _dt
import hashlib
import hmac
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Optional

ECS_API_VERSION = "2014-05-26"

# O1: only read-only actions may be signed/sent. Mutate = O2/O3 (Owner window).
READ_ONLY_ACTIONS: frozenset[str] = frozenset(
    {
        "DescribeSecurityGroupAttribute",
        "DescribeSecurityGroups",
        "DescribeInstances",
    }
)
# Known mutate actions planned for later slices — always refused in O1.
MUTATE_ACTIONS_DEFERRED: frozenset[str] = frozenset(
    {
        "RevokeSecurityGroup",
        "RevokeSecurityGroupEgress",
        "AuthorizeSecurityGroup",
        "AuthorizeSecurityGroupEgress",
        "ModifySecurityGroupRule",
        "StopInstance",
        "StopInstances",
    }
)

# ECS instance metadata (RAM role STS). Link-local; never proxied.
ECS_METADATA_BASE = "http://100.100.100.200"
ECS_METADATA_ROLE_PATH = "/latest/meta-data/ram/security-credentials/"
ECS_METADATA_TOKEN_PATH = "/latest/api/token"

# Env names (values come from secret store at runtime — never committed).
ENV_AK_ID = "ALIBABA_CLOUD_ACCESS_KEY_ID"
ENV_AK_SECRET = "ALIBABA_CLOUD_ACCESS_KEY_SECRET"
ENV_STS_TOKEN = "ALIBABA_CLOUD_SECURITY_TOKEN"
ENV_RAM_ROLE = "HA_ALIYUN_RAM_ROLE_NAME"  # preferred (role *name* only)
ENV_RAM_ROLE_SDK = "ALIBABA_CLOUD_ECS_METADATA"  # SDK-standard alias


class AliyunOpenApiError(RuntimeError):
    """OpenAPI returned an error body / non-2xx (honest failure, never faked)."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "",
        request_id: str = "",
        http_status: int = 0,
        action: str = "",
    ) -> None:
        self.code = code
        self.request_id = request_id
        self.http_status = http_status
        self.action = action
        super().__init__(message)


class AliyunCredentialError(RuntimeError):
    """No usable credential source (env AK / STS / RAM role name)."""


class AliyunMutateRefused(RuntimeError):
    """O1 refuses mutate actions before signing / transport."""


# --------------------------------------------------------------------------- #
# Credentials
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class AliyunCredentials:
    access_key_id: str
    access_key_secret: str = field(repr=False)
    security_token: str = field(default="", repr=False)
    source: str = "env_ak"  # env_ak | env_sts | ecs_ram_role

    def __repr__(self) -> str:  # never leak secret / token
        ak = self.access_key_id
        masked = (ak[:4] + "…") if len(ak) > 4 else "…"
        return (
            f"AliyunCredentials(access_key_id={masked!r}, source={self.source!r}, "
            f"has_security_token={bool(self.security_token)})"
        )

    __str__ = __repr__


def _env_get(env: Mapping[str, str], name: str) -> str:
    return (env.get(name) or "").strip()


def ram_role_name_from_env(env: Optional[Mapping[str, str]] = None) -> str:
    env = os.environ if env is None else env
    return _env_get(env, ENV_RAM_ROLE) or _env_get(env, ENV_RAM_ROLE_SDK)


def describe_credential_source(env: Optional[Mapping[str, str]] = None) -> str:
    """Presence-only classification (no network, no values). For preflight."""
    env = os.environ if env is None else env
    if _env_get(env, ENV_AK_ID) and _env_get(env, ENV_AK_SECRET):
        return "env_sts" if _env_get(env, ENV_STS_TOKEN) else "env_ak"
    if ram_role_name_from_env(env):
        return "ecs_ram_role"
    return "none"


MetadataFetcher = Callable[[str], dict[str, Any]]


def _default_metadata_fetcher(role_name: str, *, timeout_s: float = 2.0) -> dict[str, Any]:
    """Fetch STS creds for ``role_name`` from ECS metadata (direct; no proxy)."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    headers: dict[str, str] = {}
    # Hardened (IMDSv2-style) mode: best-effort token; fall back to normal mode.
    try:
        treq = urllib.request.Request(
            ECS_METADATA_BASE + ECS_METADATA_TOKEN_PATH,
            method="PUT",
            headers={"X-aliyun-ecs-metadata-token-ttl-seconds": "60"},
        )
        with opener.open(treq, timeout=timeout_s) as resp:
            tok = resp.read().decode("utf-8").strip()
            if tok:
                headers["X-aliyun-ecs-metadata-token"] = tok
    except (urllib.error.URLError, OSError):
        pass
    url = ECS_METADATA_BASE + ECS_METADATA_ROLE_PATH + urllib.parse.quote(role_name, safe="")
    req = urllib.request.Request(url, method="GET", headers=headers)
    with opener.open(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")


def resolve_aliyun_credentials(
    env: Optional[Mapping[str, str]] = None,
    *,
    metadata_fetcher: Optional[MetadataFetcher] = None,
) -> AliyunCredentials:
    """Resolve creds: env AK(+STS) → ECS RAM role name → error.

    Values are only ever taken from process env (injected from the secret store
    at runtime) or the ECS metadata service for a RAM role *name*.
    """
    env = os.environ if env is None else env
    ak = _env_get(env, ENV_AK_ID)
    sk = _env_get(env, ENV_AK_SECRET)
    if ak and sk:
        tok = _env_get(env, ENV_STS_TOKEN)
        return AliyunCredentials(
            access_key_id=ak,
            access_key_secret=sk,
            security_token=tok,
            source="env_sts" if tok else "env_ak",
        )
    if ak or sk:
        raise AliyunCredentialError(
            f"{ENV_AK_ID} and {ENV_AK_SECRET} must both be set (partial AK in env)"
        )
    role = ram_role_name_from_env(env)
    if role:
        fetch = metadata_fetcher or _default_metadata_fetcher
        try:
            data = fetch(role)
        except Exception as exc:  # honest: surface type only, not payload
            raise AliyunCredentialError(
                f"ECS RAM role credential fetch failed ({type(exc).__name__})"
            ) from exc
        if str(data.get("Code", "Success")) != "Success" or not (
            data.get("AccessKeyId") and data.get("AccessKeySecret")
        ):
            raise AliyunCredentialError(
                "ECS RAM role credential response missing AccessKeyId/AccessKeySecret"
            )
        return AliyunCredentials(
            access_key_id=str(data["AccessKeyId"]),
            access_key_secret=str(data["AccessKeySecret"]),
            security_token=str(data.get("SecurityToken") or ""),
            source="ecs_ram_role",
        )
    raise AliyunCredentialError(
        "No Aliyun credential source: set "
        f"{ENV_AK_ID}/{ENV_AK_SECRET} (+{ENV_STS_TOKEN}) from the secret store, or "
        f"{ENV_RAM_ROLE} (ECS RAM role name). Never commit keys."
    )


# --------------------------------------------------------------------------- #
# RPC signature v1
# --------------------------------------------------------------------------- #


def percent_encode(value: str) -> str:
    """Aliyun RPC percent-encoding (RFC 3986 unreserved: A-Z a-z 0-9 - _ . ~)."""
    return urllib.parse.quote(str(value), safe="-_.~")


def canonicalized_query(params: Mapping[str, Any]) -> str:
    return "&".join(
        f"{percent_encode(k)}={percent_encode(params[k])}" for k in sorted(params)
    )


def string_to_sign(params: Mapping[str, Any], method: str = "POST") -> str:
    return (
        method.upper()
        + "&"
        + percent_encode("/")
        + "&"
        + percent_encode(canonicalized_query(params))
    )


def sign_rpc(params: Mapping[str, Any], access_key_secret: str, method: str = "POST") -> str:
    """Return base64 HMAC-SHA1 signature for RPC-style OpenAPI params."""
    sts = string_to_sign(params, method)
    digest = hmac.new(
        (access_key_secret + "&").encode("utf-8"), sts.encode("utf-8"), hashlib.sha1
    ).digest()
    return base64.b64encode(digest).decode("ascii")


# --------------------------------------------------------------------------- #
# Transport + client
# --------------------------------------------------------------------------- #

# transport(url, body_bytes, headers, timeout_s) -> (http_status, body_text)
Transport = Callable[[str, bytes, dict[str, str], float], "tuple[int, str]"]


def default_transport(
    url: str, body: bytes, headers: dict[str, str], timeout_s: float
) -> tuple[int, str]:
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            return int(getattr(resp, "status", 200) or 200), resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return int(e.code), e.read().decode("utf-8", errors="replace")


def default_ecs_endpoint(region: str) -> str:
    return f"ecs.{region}.aliyuncs.com" if region else "ecs.aliyuncs.com"


@dataclass
class AliyunEcsRpcClient:
    """Minimal ECS RPC client. Read-only allowlist in O1; mutate refused."""

    region: str
    endpoint: str = ""  # default ecs.<region>.aliyuncs.com (VPC endpoint via env)
    version: str = ECS_API_VERSION
    timeout_s: float = 10.0
    credentials_provider: Optional[Callable[[], AliyunCredentials]] = None
    transport: Optional[Transport] = None
    clock: Callable[[], _dt.datetime] = field(
        default=lambda: _dt.datetime.now(_dt.timezone.utc)
    )
    nonce: Callable[[], str] = field(default=lambda: uuid.uuid4().hex)
    allowed_actions: frozenset[str] = READ_ONLY_ACTIONS
    calls: list[dict[str, Any]] = field(default_factory=list)

    def _endpoint(self) -> str:
        return self.endpoint or default_ecs_endpoint(self.region)

    def build_signed_params(
        self, action: str, params: Mapping[str, Any], creds: AliyunCredentials
    ) -> dict[str, str]:
        ts = self.clock().astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        p: dict[str, str] = {
            "Action": action,
            "Format": "JSON",
            "Version": self.version,
            "AccessKeyId": creds.access_key_id,
            "SignatureMethod": "HMAC-SHA1",
            "SignatureVersion": "1.0",
            "SignatureNonce": self.nonce(),
            "Timestamp": ts,
        }
        if self.region:
            p["RegionId"] = self.region
        if creds.security_token:
            p["SecurityToken"] = creds.security_token
        for k, v in params.items():
            if v is None:
                continue
            p[str(k)] = str(v)
        p["Signature"] = sign_rpc({k: v for k, v in p.items() if k != "Signature"},
                                  creds.access_key_secret, "POST")
        return p

    def call(self, action: str, params: Optional[Mapping[str, Any]] = None) -> dict[str, Any]:
        if action not in self.allowed_actions:
            # Refuse before credentials / signing / transport.
            raise AliyunMutateRefused(
                f"Aliyun OpenAPI action {action!r} refused in E2b-O1: only read-only "
                f"{sorted(self.allowed_actions)} allowed. Real isolate/restore mutate "
                "is O2/O3 (Owner-approved staging window)."
            )
        if self.credentials_provider is None:
            raise AliyunCredentialError("AliyunEcsRpcClient: no credentials_provider wired")
        creds = self.credentials_provider()
        signed = self.build_signed_params(action, params or {}, creds)
        body = canonicalized_query(signed).encode("utf-8")
        url = f"https://{self._endpoint()}/"
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "x-acs-action": action,
            "x-acs-version": self.version,
        }
        # Record call shape only — never the signature / AK / token.
        self.calls.append(
            {
                "action": action,
                "endpoint": self._endpoint(),
                "region": self.region,
                "param_keys": sorted(k for k in signed if k not in ("Signature",)),
                "cred_source": creds.source,
            }
        )
        transport = self.transport or default_transport
        status, text = transport(url, body, headers, self.timeout_s)
        try:
            data = json.loads(text) if (text or "").strip() else {}
        except ValueError:
            data = {"_raw": (text or "")[:200]}
        if not isinstance(data, dict):
            data = {"_raw": str(data)[:200]}
        if status >= 400:
            raise AliyunOpenApiError(
                f"Aliyun OpenAPI {action} failed: HTTP {status} "
                f"Code={data.get('Code', '')} Message={str(data.get('Message', ''))[:200]} "
                f"RequestId={data.get('RequestId', '')}",
                code=str(data.get("Code", "")),
                request_id=str(data.get("RequestId", "")),
                http_status=status,
                action=action,
            )
        return data


def build_default_ecs_client(
    region: str, *, endpoint: str = "", timeout_s: float = 10.0
) -> AliyunEcsRpcClient:
    """Production wiring: lazy env/RAM-role credentials + urllib transport."""
    return AliyunEcsRpcClient(
        region=region,
        endpoint=endpoint,
        timeout_s=timeout_s,
        credentials_provider=resolve_aliyun_credentials,
    )
