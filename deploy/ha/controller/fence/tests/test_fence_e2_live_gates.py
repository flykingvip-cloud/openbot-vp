"""E2a AWS + E2b-C Aliyun live gates + preflight (no cloud calls)."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

_CTL = str(Path(__file__).resolve().parents[2])
if _CTL not in sys.path:
    sys.path.insert(0, _CTL)

from fence.compute_fence import AliyunComputeFenceClient, AwsComputeFenceClient
from fence.config import FenceCfConfig
from fence.factory import build_adapter
from fence.network_fence import AliyunNetworkFenceClient, AwsNetworkFenceClient
from fence.preflight import main as preflight_main
from fence.preflight import run_preflight


class TestAwsLiveMutateConfig(unittest.TestCase):
    def test_default_aws_live_mutate_off(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            cfg = FenceCfConfig.from_env(database_url="postgresql://x/y")
            self.assertFalse(cfg.aws_live_mutate)
            self.assertEqual(cfg.aws_live_target, "")

    def test_live_mutate_requires_staging_target_on_real(self):
        cfg = FenceCfConfig(
            backend="real",
            database_url="postgresql://x/y",
            controller_mode="manual",
            enable_network=True,
            cloud_provider="aws",
            aws_region="ap-east-1",
            aws_sg_id="sg-test",
            aws_live_mutate=True,
            aws_live_target="",  # empty → refuse
        )
        with self.assertRaises(SystemExit) as cm:
            cfg.require_real_ready()
        self.assertIn("HA_AWS_LIVE_TARGET=staging", str(cm.exception))

    def test_live_mutate_ok_with_staging(self):
        cfg = FenceCfConfig(
            backend="real",
            database_url="postgresql://x/y",
            controller_mode="manual",
            enable_network=True,
            cloud_provider="aws",
            aws_region="ap-east-1",
            aws_sg_id="sg-test",
            aws_live_mutate=True,
            aws_live_target="staging",
        )
        cfg.require_real_ready()  # no raise

    def test_live_mutate_refuses_non_aws_provider(self):
        cfg = FenceCfConfig(
            backend="real",
            database_url="postgresql://x/y",
            controller_mode="manual",
            enable_network=True,
            cloud_provider="mock",
            aws_live_mutate=True,
            aws_live_target="staging",
        )
        with self.assertRaises(SystemExit) as cm:
            cfg.require_real_ready()
        self.assertIn("HA_CLOUD_PROVIDER=aws", str(cm.exception))


class TestFactoryWiresLiveFlag(unittest.TestCase):
    def test_aws_clients_live_false_by_default(self):
        cfg = FenceCfConfig(
            backend="real",
            database_url="postgresql://x/y",
            controller_mode="manual",
            enable_network=True,
            enable_compute=True,
            cloud_provider="aws",
            aws_region="ap-east-1",
            aws_sg_id="sg-test",
            aws_instance_id="i-test",
            aws_live_mutate=False,
        )
        ad = build_adapter(cfg)
        self.assertFalse(ad.network_client.live)  # type: ignore[attr-defined]
        self.assertFalse(ad.compute_client.live)  # type: ignore[attr-defined]

    def test_aws_clients_live_true_when_flag(self):
        cfg = FenceCfConfig(
            backend="real",
            database_url="postgresql://x/y",
            controller_mode="manual",
            enable_network=True,
            cloud_provider="aws",
            aws_region="ap-east-1",
            aws_sg_id="sg-test",
            aws_live_mutate=True,
            aws_live_target="staging",
        )
        ad = build_adapter(cfg)
        self.assertTrue(ad.network_client.live)  # type: ignore[attr-defined]

    def test_live_true_still_refuses_boto3(self):
        client = AwsNetworkFenceClient(region="ap-east-1", sg_id="sg-x", live=True)
        with self.assertRaises(RuntimeError) as cm:
            client.isolate_old_primary(
                execution_id="e1", from_holder="a", to_holder="b"
            )
        self.assertIn("E2a", str(cm.exception))

        c2 = AwsComputeFenceClient(region="ap-east-1", instance_id="i-x", live=True)
        with self.assertRaises(RuntimeError) as cm2:
            c2.stop_or_isolate(execution_id="e1", from_holder="a")
        self.assertIn("E2a", str(cm2.exception))

    def test_live_false_dry_skeleton(self):
        client = AwsNetworkFenceClient(region="ap-east-1", sg_id="sg-x", live=False)
        out = client.isolate_old_primary(
            execution_id="e1", from_holder="a", to_holder="b"
        )
        self.assertTrue(out.get("dry_skeleton"))
        self.assertTrue(out.get("ok"))


class TestPreflight(unittest.TestCase):
    def test_default_env_passes(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            report = run_preflight()
            self.assertTrue(report.ok)
            codes = {c.code for c in report.checks}
            self.assertIn("aws_live_off", codes)
            self.assertIn("aliyun_live_off", codes)
            self.assertIn("no_cloud_calls", codes)

    def test_auto_mode_cli_exit_2(self):
        with mock.patch.dict(os.environ, {"HA_CONTROLLER_MODE": "auto"}, clear=True):
            rc = preflight_main([])
            self.assertEqual(rc, 2)

    def test_live_mutate_without_staging_fails(self):
        env = {
            "HA_CONTROLLER_MODE": "manual",
            "HA_FENCE_BACKEND": "lab",
            "HA_AWS_LIVE_MUTATE": "1",
            "HA_CLOUD_PROVIDER": "aws",
            "HA_FENCE_ENABLE_NETWORK": "1",
            "HA_AWS_REGION": "ap-east-1",
            "HA_AWS_SG_ID": "sg-test",
            # missing HA_AWS_LIVE_TARGET
        }
        with mock.patch.dict(os.environ, env, clear=True):
            report = run_preflight()
            self.assertFalse(report.ok)
            self.assertTrue(any(c.code == "aws_live_target" for c in report.checks))

    def test_live_mutate_staging_warns_boto3(self):
        env = {
            "HA_CONTROLLER_MODE": "manual",
            "HA_FENCE_BACKEND": "lab",
            "HA_AWS_LIVE_MUTATE": "1",
            "HA_AWS_LIVE_TARGET": "staging",
            "HA_CLOUD_PROVIDER": "aws",
            "HA_FENCE_ENABLE_NETWORK": "1",
            "HA_AWS_REGION": "ap-east-1",
            "HA_AWS_SG_ID": "sg-test",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            report = run_preflight()
            self.assertTrue(report.ok)
            self.assertTrue(any(c.code == "aws_live_boto3" for c in report.checks))



class TestAliyunProviderConfig(unittest.TestCase):
    def test_aliyun_provider_accepted(self):
        cfg = FenceCfConfig(
            backend="lab",
            controller_mode="manual",
            cloud_provider="aliyun",
        )
        self.assertEqual(cfg.cloud_provider, "aliyun")

    def test_default_aliyun_live_mutate_off(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            cfg = FenceCfConfig.from_env(database_url="postgresql://x/y")
            self.assertFalse(cfg.aliyun_live_mutate)
            self.assertEqual(cfg.aliyun_live_target, "")

    def test_live_mutate_requires_staging_target_on_real(self):
        cfg = FenceCfConfig(
            backend="real",
            database_url="postgresql://x/y",
            controller_mode="manual",
            enable_network=True,
            cloud_provider="aliyun",
            aliyun_region="cn-hongkong",
            aliyun_sg_id="sg-test",
            aliyun_live_mutate=True,
            aliyun_live_target="",
        )
        with self.assertRaises(SystemExit) as cm:
            cfg.require_real_ready()
        self.assertIn("HA_ALIYUN_LIVE_TARGET=staging", str(cm.exception))

    def test_live_mutate_ok_with_staging(self):
        cfg = FenceCfConfig(
            backend="real",
            database_url="postgresql://x/y",
            controller_mode="manual",
            enable_network=True,
            cloud_provider="aliyun",
            aliyun_region="cn-hongkong",
            aliyun_sg_id="sg-test",
            aliyun_live_mutate=True,
            aliyun_live_target="staging",
        )
        cfg.require_real_ready()  # no raise

    def test_live_mutate_refuses_non_aliyun_provider(self):
        cfg = FenceCfConfig(
            backend="real",
            database_url="postgresql://x/y",
            controller_mode="manual",
            enable_network=True,
            cloud_provider="mock",
            aliyun_live_mutate=True,
            aliyun_live_target="staging",
        )
        with self.assertRaises(SystemExit) as cm:
            cfg.require_real_ready()
        self.assertIn("HA_CLOUD_PROVIDER=aliyun", str(cm.exception))

    def test_real_network_requires_aliyun_ids(self):
        cfg = FenceCfConfig(
            backend="real",
            database_url="postgresql://x/y",
            controller_mode="manual",
            enable_network=True,
            cloud_provider="aliyun",
            aliyun_region="",
            aliyun_sg_id="",
        )
        with self.assertRaises(SystemExit) as cm:
            cfg.require_real_ready()
        self.assertIn("HA_ALIYUN_REGION", str(cm.exception))


class TestAliyunFactoryAndClients(unittest.TestCase):
    def test_factory_wires_aliyun_clients_live_false(self):
        cfg = FenceCfConfig(
            backend="real",
            database_url="postgresql://x/y",
            controller_mode="manual",
            enable_network=True,
            enable_compute=True,
            cloud_provider="aliyun",
            aliyun_region="cn-hongkong",
            aliyun_sg_id="sg-test",
            aliyun_instance_id="i-test",
            aliyun_live_mutate=False,
        )
        ad = build_adapter(cfg)
        self.assertIsInstance(ad.network_client, AliyunNetworkFenceClient)
        self.assertIsInstance(ad.compute_client, AliyunComputeFenceClient)
        self.assertFalse(ad.network_client.live)  # type: ignore[attr-defined]
        self.assertFalse(ad.compute_client.live)  # type: ignore[attr-defined]

    def test_factory_wires_live_true_when_flag(self):
        cfg = FenceCfConfig(
            backend="real",
            database_url="postgresql://x/y",
            controller_mode="manual",
            enable_network=True,
            cloud_provider="aliyun",
            aliyun_region="cn-hongkong",
            aliyun_sg_id="sg-test",
            aliyun_live_mutate=True,
            aliyun_live_target="staging",
        )
        ad = build_adapter(cfg)
        self.assertTrue(ad.network_client.live)  # type: ignore[attr-defined]

    def test_live_true_refuses_openapi(self):
        client = AliyunNetworkFenceClient(
            region="cn-hongkong", sg_id="sg-x", live=True
        )
        # live=True without HA_ALIYUN_LIVE_TARGET=staging → refuse (E2b-O1 gated)
        with self.assertRaises(RuntimeError) as cm:
            client.isolate_old_primary(
                execution_id="e1", from_holder="a", to_holder="b"
            )
        self.assertIn("E2b-O1", str(cm.exception))
        self.assertIn("OpenAPI", str(cm.exception))
        self.assertIsNone(client.openapi)  # never built → no OpenAPI call

        c2 = AliyunComputeFenceClient(
            region="cn-hongkong", instance_id="i-x", live=True
        )
        with self.assertRaises(RuntimeError) as cm2:
            c2.stop_or_isolate(execution_id="e1", from_holder="a")
        self.assertIn("E2b-C", str(cm2.exception))

    def test_live_false_dry_skeleton(self):
        client = AliyunNetworkFenceClient(
            region="cn-hongkong", sg_id="sg-x", live=False
        )
        out = client.isolate_old_primary(
            execution_id="e1", from_holder="a", to_holder="b"
        )
        self.assertTrue(out.get("dry_skeleton"))
        self.assertTrue(out.get("ok"))
        self.assertEqual(out.get("provider"), "aliyun")

    def test_mock_unchanged_when_provider_mock(self):
        cfg = FenceCfConfig(
            backend="real",
            database_url="postgresql://x/y",
            controller_mode="manual",
            enable_network=True,
            cloud_provider="mock",
        )
        ad = build_adapter(cfg)
        self.assertEqual(type(ad.network_client).__name__, "MockNetworkFenceClient")


class TestAliyunPreflight(unittest.TestCase):
    def test_live_mutate_without_staging_fails(self):
        env = {
            "HA_CONTROLLER_MODE": "manual",
            "HA_FENCE_BACKEND": "lab",
            "HA_ALIYUN_LIVE_MUTATE": "1",
            "HA_CLOUD_PROVIDER": "aliyun",
            "HA_FENCE_ENABLE_NETWORK": "1",
            "HA_ALIYUN_REGION": "cn-hongkong",
            "HA_ALIYUN_SG_ID": "sg-test",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            report = run_preflight()
            self.assertFalse(report.ok)
            self.assertTrue(
                any(c.code == "aliyun_live_target" for c in report.checks)
            )

    def test_live_mutate_staging_warns_openapi(self):
        env = {
            "HA_CONTROLLER_MODE": "manual",
            "HA_FENCE_BACKEND": "lab",
            "HA_ALIYUN_LIVE_MUTATE": "1",
            "HA_ALIYUN_LIVE_TARGET": "staging",
            "HA_CLOUD_PROVIDER": "aliyun",
            "HA_FENCE_ENABLE_NETWORK": "1",
            "HA_ALIYUN_REGION": "cn-hongkong",
            "HA_ALIYUN_SG_ID": "sg-test",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            report = run_preflight()
            self.assertTrue(report.ok)
            self.assertTrue(
                any(c.code == "aliyun_live_openapi" for c in report.checks)
            )
            self.assertTrue(
                any(c.code == "no_cloud_calls" for c in report.checks)
            )


if __name__ == "__main__":
    unittest.main()
