"""Config defaults + factory backend selection + real-ready refuse."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

# PYTHONPATH: controller dir
_CTL = str(Path(__file__).resolve().parents[2])
if _CTL not in sys.path:
    sys.path.insert(0, _CTL)

from fence.config import FenceCfConfig
from fence.dry_run import DryRunFenceAdapter
from fence.factory import build_adapter


class TestFenceConfig(unittest.TestCase):
    def test_defaults_lab_and_flags_off(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            # from_env with empty env — mode manual, backend lab
            cfg = FenceCfConfig.from_env(database_url="postgresql://x/y")
            self.assertEqual(cfg.backend, "lab")
            self.assertFalse(cfg.enable_app)
            self.assertFalse(cfg.enable_network)
            self.assertFalse(cfg.enable_compute)
            self.assertFalse(cfg.enable_cf)
            self.assertEqual(cfg.controller_mode, "manual")

    def test_auto_mode_refused_at_config(self):
        with self.assertRaises(ValueError):
            FenceCfConfig(backend="lab", controller_mode="auto", database_url="x")

    def test_real_refuses_without_enable_flags(self):
        cfg = FenceCfConfig(
            backend="real",
            database_url="postgresql://x/y",
            controller_mode="manual",
        )
        with self.assertRaises(SystemExit):
            cfg.require_real_ready()

    def test_real_refuses_cf_without_token(self):
        cfg = FenceCfConfig(
            backend="real",
            database_url="postgresql://x/y",
            enable_cf=True,
            controller_mode="manual",
        )
        with self.assertRaises(SystemExit) as cm:
            cfg.require_real_ready()
        self.assertIn("HA_CF_API_TOKEN", str(cm.exception))

    def test_aliyun_provider_accepted(self):
        cfg = FenceCfConfig(
            backend="lab", controller_mode="manual", cloud_provider="aliyun"
        )
        self.assertEqual(cfg.cloud_provider, "aliyun")

    def test_unknown_provider_refused(self):
        with self.assertRaises(ValueError) as cm:
            FenceCfConfig(
                backend="lab", controller_mode="manual", cloud_provider="gcp"
            )
        self.assertIn("mock|aws|aliyun", str(cm.exception))



class TestFactory(unittest.TestCase):
    def test_default_lab_without_dsn_is_stub(self):
        cfg = FenceCfConfig(backend="lab", database_url="", controller_mode="manual")
        ad = build_adapter(cfg)
        self.assertEqual(type(ad).__name__, "RecordingStubAdapter")

    def test_dry_run(self):
        cfg = FenceCfConfig(backend="dry_run", controller_mode="manual")
        ad = build_adapter(cfg)
        self.assertIsInstance(ad, DryRunFenceAdapter)

    def test_real_requires_flags(self):
        cfg = FenceCfConfig(
            backend="real", database_url="postgresql://x/y", controller_mode="manual"
        )
        with self.assertRaises(SystemExit):
            build_adapter(cfg)


if __name__ == "__main__":
    unittest.main()
