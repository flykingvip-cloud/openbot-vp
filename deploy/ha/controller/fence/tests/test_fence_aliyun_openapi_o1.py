"""E2b-O1: Aliyun OpenAPI client wiring — fully mocked (zero real OpenAPI calls).

Auto Failover OFF / NOT APPROVED. HA_ALIYUN_LIVE_MUTATE stays 0 by default.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import unittest
import urllib.parse
from pathlib import Path
from unittest import mock

_CTL = str(Path(__file__).resolve().parents[2])
if _CTL not in sys.path:
    sys.path.insert(0, _CTL)

from fence import aliyun_openapi as ao
from fence.aliyun_openapi import (
    AliyunCredentialError,
    AliyunCredentials,
    AliyunEcsRpcClient,
    AliyunMutateRefused,
    AliyunOpenApiError,
    describe_credential_source,
    percent_encode,
    resolve_aliyun_credentials,
    sign_rpc,
)
from fence.config import FenceCfConfig
from fence.factory import build_adapter
from fence.network_fence import (
    AliyunNetworkFenceClient,
    AliyunNetworkMutateNotImplemented,
)
from fence.preflight import run_preflight

FAKE_CREDS = AliyunCredentials(
    access_key_id="LTAI-test-not-real",
    access_key_secret="secret-test-not-real",
    source="env_ak",
)
SG_ATTR_OK = {
    "RequestId": "REQ-MOCK-1",
    "SecurityGroupId": "sg-test",
    "RegionId": "cn-hongkong",
    "Permissions": {"Permission": [{"IpProtocol": "TCP", "PortRange": "5432/5432"}]},
}


def _no_network(*_a, **_k):
    raise AssertionError("real network call attempted in O1 unit test")


class _Transport:
    """Records (url, form, headers); returns canned (status, body)."""

    def __init__(self, status: int = 200, payload: dict | None = None):
        self.status = status
        self.payload = SG_ATTR_OK if payload is None else payload
        self.requests: list[dict] = []

    def __call__(self, url, body, headers, timeout_s):
        form = dict(urllib.parse.parse_qsl(body.decode("utf-8")))
        self.requests.append({"url": url, "form": form, "headers": dict(headers)})
        return self.status, json.dumps(self.payload)


def _rpc(transport, creds=FAKE_CREDS, **kw) -> AliyunEcsRpcClient:
    return AliyunEcsRpcClient(
        region="cn-hongkong",
        credentials_provider=lambda: creds,
        transport=transport,
        clock=lambda: dt.datetime(2026, 10, 6, 0, 0, 0, tzinfo=dt.timezone.utc),
        nonce=lambda: "nonce-fixed",
        **kw,
    )


class TestSignature(unittest.TestCase):
    def test_percent_encode_rfc3986(self):
        self.assertEqual(percent_encode("a b*c~d/e"), "a%20b%2Ac~d%2Fe")
        self.assertEqual(percent_encode("-_.~"), "-_.~")

    def test_documented_vector(self):
        # Aliyun ECS RPC signature doc example (GET, testsecret).
        params = {
            "AccessKeyId": "testid",
            "Action": "DescribeRegions",
            "Format": "XML",
            "SignatureMethod": "HMAC-SHA1",
            "SignatureNonce": "3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf",
            "SignatureVersion": "1.0",
            "Timestamp": "2016-02-23T12:46:24Z",
            "Version": "2014-05-26",
        }
        self.assertEqual(sign_rpc(params, "testsecret", "GET"), "OLeaidS1JvxuMvnyHOwuJ+uX5qY=")

    def test_signed_params_verify(self):
        t = _Transport()
        rpc = _rpc(t)
        rpc.call("DescribeSecurityGroupAttribute", {"SecurityGroupId": "sg-test"})
        form = t.requests[0]["form"]
        sig = form.pop("Signature")
        self.assertEqual(sig, sign_rpc(form, FAKE_CREDS.access_key_secret, "POST"))
        self.assertEqual(form["Timestamp"], "2026-10-06T00:00:00Z")
        self.assertEqual(form["Version"], "2014-05-26")
        self.assertEqual(form["RegionId"], "cn-hongkong")
        self.assertEqual(form["Format"], "JSON")
        self.assertNotIn("SecurityToken", form)
        self.assertEqual(t.requests[0]["url"], "https://ecs.cn-hongkong.aliyuncs.com/")


class TestCredentials(unittest.TestCase):
    def test_env_ak(self):
        env = {ao.ENV_AK_ID: "ak", ao.ENV_AK_SECRET: "sk"}
        c = resolve_aliyun_credentials(env)
        self.assertEqual(c.source, "env_ak")
        self.assertEqual(describe_credential_source(env), "env_ak")

    def test_env_sts(self):
        env = {ao.ENV_AK_ID: "ak", ao.ENV_AK_SECRET: "sk", ao.ENV_STS_TOKEN: "tok"}
        c = resolve_aliyun_credentials(env)
        self.assertEqual(c.source, "env_sts")
        self.assertEqual(c.security_token, "tok")

    def test_partial_ak_refused(self):
        with self.assertRaises(AliyunCredentialError):
            resolve_aliyun_credentials({ao.ENV_AK_ID: "ak"})

    def test_ram_role_name_uses_metadata_fetcher(self):
        seen = []

        def fetch(role):
            seen.append(role)
            return {
                "Code": "Success",
                "AccessKeyId": "STS.ak",
                "AccessKeySecret": "sts-sk",
                "SecurityToken": "sts-tok",
            }

        for var in (ao.ENV_RAM_ROLE, ao.ENV_RAM_ROLE_SDK):
            env = {var: "ha-fence-staging-role"}
            self.assertEqual(describe_credential_source(env), "ecs_ram_role")
            c = resolve_aliyun_credentials(env, metadata_fetcher=fetch)
            self.assertEqual(c.source, "ecs_ram_role")
            self.assertEqual(c.security_token, "sts-tok")
        self.assertEqual(seen, ["ha-fence-staging-role"] * 2)

    def test_ram_role_bad_response(self):
        with self.assertRaises(AliyunCredentialError):
            resolve_aliyun_credentials(
                {ao.ENV_RAM_ROLE: "r"}, metadata_fetcher=lambda r: {"Code": "Failed"}
            )

    def test_ram_role_fetch_error_hides_payload(self):
        def boom(_r):
            raise OSError("connect refused secret-ish-detail")

        with self.assertRaises(AliyunCredentialError) as cm:
            resolve_aliyun_credentials({ao.ENV_RAM_ROLE: "r"}, metadata_fetcher=boom)
        self.assertNotIn("secret-ish-detail", str(cm.exception))

    def test_none(self):
        self.assertEqual(describe_credential_source({}), "none")
        with self.assertRaises(AliyunCredentialError):
            resolve_aliyun_credentials({})

    def test_repr_redacts(self):
        c = AliyunCredentials("LTAIabcdef", "SUPERSECRET", "TOKENVAL", "env_sts")
        self.assertNotIn("SUPERSECRET", repr(c))
        self.assertNotIn("TOKENVAL", repr(c))
        self.assertNotIn("LTAIabcdef", str(c))


class TestRpcClient(unittest.TestCase):
    def test_sts_token_sent(self):
        t = _Transport()
        creds = AliyunCredentials("ak", "sk", "tok", "env_sts")
        _rpc(t, creds=creds).call("DescribeSecurityGroups", {})
        self.assertEqual(t.requests[0]["form"]["SecurityToken"], "tok")

    def test_mutate_actions_refused_before_transport(self):
        provider = mock.Mock(side_effect=AssertionError("creds must not be resolved"))
        t = _Transport()
        rpc = AliyunEcsRpcClient(region="cn-hongkong", credentials_provider=provider, transport=t)
        for action in sorted(ao.MUTATE_ACTIONS_DEFERRED):
            with self.assertRaises(AliyunMutateRefused):
                rpc.call(action, {"SecurityGroupId": "sg-test"})
        self.assertEqual(t.requests, [])
        provider.assert_not_called()
        self.assertTrue(ao.READ_ONLY_ACTIONS.isdisjoint(ao.MUTATE_ACTIONS_DEFERRED))

    def test_error_body_raises_honestly(self):
        t = _Transport(
            status=403,
            payload={"Code": "Forbidden.RAM", "Message": "denied", "RequestId": "REQ-E"},
        )
        with self.assertRaises(AliyunOpenApiError) as cm:
            _rpc(t).call("DescribeSecurityGroupAttribute", {"SecurityGroupId": "sg-test"})
        self.assertEqual(cm.exception.code, "Forbidden.RAM")
        self.assertEqual(cm.exception.request_id, "REQ-E")
        self.assertEqual(cm.exception.http_status, 403)

    def test_calls_record_no_secrets(self):
        t = _Transport()
        rpc = _rpc(t)
        rpc.call("DescribeSecurityGroupAttribute", {"SecurityGroupId": "sg-test"})
        blob = json.dumps(rpc.calls)
        self.assertNotIn(FAKE_CREDS.access_key_secret, blob)
        self.assertNotIn("Signature\"", blob)

    def test_default_transport_via_mocked_urlopen(self):
        class _Resp:
            status = 200

            def read(self):
                return json.dumps(SG_ATTR_OK).encode()

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        rpc = AliyunEcsRpcClient(
            region="cn-hongkong",
            endpoint="ecs-vpc.cn-hongkong.aliyuncs.com",
            credentials_provider=lambda: FAKE_CREDS,
        )
        with mock.patch("fence.aliyun_openapi.urllib.request.urlopen", return_value=_Resp()) as uo:
            out = rpc.call("DescribeSecurityGroupAttribute", {"SecurityGroupId": "sg-test"})
        self.assertEqual(out["RequestId"], "REQ-MOCK-1")
        req = uo.call_args[0][0]
        self.assertEqual(req.full_url, "https://ecs-vpc.cn-hongkong.aliyuncs.com/")
        self.assertEqual(req.get_method(), "POST")


class TestNetworkClientGating(unittest.TestCase):
    def setUp(self):
        p1 = mock.patch("fence.aliyun_openapi.urllib.request.urlopen", side_effect=_no_network)
        p2 = mock.patch("fence.aliyun_openapi._default_metadata_fetcher", side_effect=_no_network)
        p1.start()
        p2.start()
        self.addCleanup(p1.stop)
        self.addCleanup(p2.stop)

    def test_live_false_no_openapi(self):
        t = _Transport()
        c = AliyunNetworkFenceClient(region="cn-hongkong", sg_id="sg-test", openapi=_rpc(t))
        out = c.isolate_old_primary(execution_id="e1", from_holder="a", to_holder="b")
        self.assertTrue(out["dry_skeleton"])
        self.assertTrue(out["openapi_wired"])
        self.assertEqual(t.requests, [])

    def test_live_without_staging_refuses_before_creds(self):
        for target in ("", "prod", "production", "stage"):
            t = _Transport()
            provider = mock.Mock(side_effect=AssertionError("no creds"))
            rpc = AliyunEcsRpcClient(region="cn-hongkong", credentials_provider=provider, transport=t)
            c = AliyunNetworkFenceClient(
                region="cn-hongkong", sg_id="sg-test", live=True, live_target=target, openapi=rpc
            )
            with self.assertRaises(RuntimeError) as cm:
                c.isolate_old_primary(execution_id="e1", from_holder="a", to_holder="b")
            self.assertNotIsInstance(cm.exception, AliyunNetworkMutateNotImplemented)
            self.assertIn("gates not green", str(cm.exception))
            self.assertEqual(t.requests, [])
            provider.assert_not_called()

    def test_live_gated_missing_sg_refuses(self):
        t = _Transport()
        c = AliyunNetworkFenceClient(
            region="cn-hongkong", sg_id="", live=True, live_target="staging", openapi=_rpc(t)
        )
        with self.assertRaises(RuntimeError):
            c.isolate_old_primary(execution_id="e1", from_holder="a", to_holder="b")
        self.assertEqual(t.requests, [])

    def test_live_gated_reaches_call_path_readonly_then_refuses(self):
        t = _Transport()
        c = AliyunNetworkFenceClient(
            region="cn-hongkong", sg_id="sg-test", live=True, live_target="staging", openapi=_rpc(t)
        )
        with self.assertRaises(AliyunNetworkMutateNotImplemented) as cm:
            c.isolate_old_primary(execution_id="e1", from_holder="a", to_holder="b")
        self.assertIsInstance(cm.exception, RuntimeError)
        self.assertIn("O3", str(cm.exception))
        self.assertEqual(cm.exception.probe["request_id"], "REQ-MOCK-1")
        self.assertEqual(cm.exception.probe["permission_count"], 1)
        actions = [r["form"]["Action"] for r in t.requests]
        self.assertEqual(actions, ["DescribeSecurityGroupAttribute"])
        self.assertEqual(t.requests[0]["form"]["SecurityGroupId"], "sg-test")

    def test_live_gated_openapi_error_propagates(self):
        t = _Transport(status=404, payload={"Code": "InvalidSecurityGroupId.NotFound", "RequestId": "R"})
        c = AliyunNetworkFenceClient(
            region="cn-hongkong", sg_id="sg-test", live=True, live_target="staging", openapi=_rpc(t)
        )
        with self.assertRaises(AliyunOpenApiError) as cm:
            c.isolate_old_primary(execution_id="e1", from_holder="a", to_holder="b")
        self.assertEqual(cm.exception.code, "InvalidSecurityGroupId.NotFound")

    def test_live_gated_default_client_no_creds_refuses(self):
        c = AliyunNetworkFenceClient(
            region="cn-hongkong", sg_id="sg-test", live=True, live_target="staging"
        )
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(AliyunCredentialError):
                c.isolate_old_primary(execution_id="e1", from_holder="a", to_holder="b")
        self.assertIsInstance(c.openapi, AliyunEcsRpcClient)
        self.assertEqual(c.openapi.calls, [])


class TestFactoryAndPreflightO1(unittest.TestCase):
    def _cfg(self, **kw):
        base = dict(
            backend="real",
            database_url="postgresql://x/y",
            controller_mode="manual",
            enable_network=True,
            cloud_provider="aliyun",
            aliyun_region="cn-hongkong",
            aliyun_sg_id="sg-test",
        )
        base.update(kw)
        return FenceCfConfig(**base)

    def test_default_env_live_mutate_zero(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            cfg = FenceCfConfig.from_env()
        self.assertFalse(cfg.aliyun_live_mutate)
        self.assertEqual(cfg.aliyun_ecs_endpoint, "")

    def test_factory_passes_target_and_endpoint_lazily(self):
        ad = build_adapter(
            self._cfg(
                aliyun_live_mutate=True,
                aliyun_live_target="staging",
                aliyun_ecs_endpoint="ecs-vpc.cn-hongkong.aliyuncs.com",
            )
        )
        net = ad.network_client
        self.assertTrue(net.live)
        self.assertEqual(net.live_target, "staging")
        self.assertEqual(net.endpoint, "ecs-vpc.cn-hongkong.aliyuncs.com")
        self.assertIsNone(net.openapi)  # not built until gated live call

    def test_factory_default_dry(self):
        ad = build_adapter(self._cfg())
        with mock.patch("fence.aliyun_openapi.urllib.request.urlopen", side_effect=_no_network):
            out = ad.network_client.isolate_old_primary(
                execution_id="e1", from_holder="a", to_holder="b"
            )
        self.assertTrue(out["dry_skeleton"])
        self.assertIsNone(ad.network_client.openapi)

    def test_preflight_reports_cred_source_without_calls(self):
        env = {
            "HA_CONTROLLER_MODE": "manual",
            "HA_ALIYUN_LIVE_MUTATE": "1",
            "HA_ALIYUN_LIVE_TARGET": "staging",
            "HA_CLOUD_PROVIDER": "aliyun",
            "HA_FENCE_ENABLE_NETWORK": "1",
            "HA_ALIYUN_REGION": "cn-hongkong",
            "HA_ALIYUN_SG_ID": "sg-test",
            "HA_ALIYUN_RAM_ROLE_NAME": "ha-fence-staging-role",
        }
        with mock.patch.dict(os.environ, env, clear=True), mock.patch(
            "fence.aliyun_openapi.urllib.request.urlopen", side_effect=_no_network
        ), mock.patch(
            "fence.aliyun_openapi._default_metadata_fetcher", side_effect=_no_network
        ):
            report = run_preflight()
        self.assertTrue(report.ok)
        self.assertEqual(report.summary["aliyun_cred_source"], "ecs_ram_role")
        hint = [c for c in report.checks if c.code == "aliyun_cred_hint"][0]
        self.assertEqual(hint.level, "ok")
        self.assertNotIn("ha-fence-staging-role", json.dumps(report.summary))

    def test_preflight_default_cred_source_none(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            report = run_preflight()
        self.assertTrue(report.ok)
        self.assertEqual(report.summary["aliyun_cred_source"], "none")


if __name__ == "__main__":
    unittest.main()
