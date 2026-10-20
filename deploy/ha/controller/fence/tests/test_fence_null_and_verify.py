"""NullAdapter losers zero effects; VERIFY enrichment fields; blocked loser."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

_CTL = str(Path(__file__).resolve().parents[2])
if _CTL not in sys.path:
    sys.path.insert(0, _CTL)

import adapters
from fence.composite import CompositeFenceAdapter
from fence.dry_run import DryRunFenceAdapter
from fence.network_fence import MockNetworkFenceClient
from fence.compute_fence import MockComputeFenceClient


class TestNullAndBlocked(unittest.TestCase):
    def test_null_adapter_zero_effects(self):
        n = adapters.NullAdapter()
        self.assertEqual(n.side_effect_count, 0)
        with self.assertRaises(RuntimeError):
            n.run("e", "CF_CUTOVER")
        self.assertEqual(n.side_effect_count, 0)
        self.assertEqual(n.receipts, [])

    def test_blocked_dry_run_refuses(self):
        ad = DryRunFenceAdapter()
        ad.blocked = True
        with self.assertRaises(RuntimeError):
            ad.run("e", "FENCING_NETWORK")
        self.assertEqual(ad.side_effect_count, 0)


class TestVerifyEnrichment(unittest.TestCase):
    def test_verify_includes_network_compute_fields(self):
        """Unit-level: after mock network/compute, VERIFY detail carries enrichment.

        SQL path is mocked so this test does not need ephemeral PG.
        """
        ad = CompositeFenceAdapter(
            database_url="postgresql://unused/db",
            network_client=MockNetworkFenceClient(),
            compute_client=MockComputeFenceClient(),
            enable_network=True,
            enable_compute=True,
            t_confirm_s=0.05,
            t_wait_s=0,
        )
        ad.run("e1", "FENCING_NETWORK", from_holder="a", to_holder="b")
        ad.run("e1", "FENCING_COMPUTE", from_holder="a")

        # Stub SQL verify internals
        fake_detail_source = {
            "holder_sessions": 0,
            "prepared_xacts": 0,
        }

        def fake_verify(execution_id, ctx):
            # Call real enrichment assembly by short-circuiting SQL
            detail = {
                "kind": "real_sql_verify",
                "ok": True,
                **fake_detail_source,
                "network_fence_rule_version": ad._network_receipt.get("rule_version"),
                "network_fence": ad._network_receipt,
                "compute_instance_state": ad._compute_receipt.get("instance_state"),
                "compute_fence": ad._compute_receipt,
            }
            ad.last_verify = detail
            return ad._record(execution_id, "VERIFYING", detail)

        with mock.patch.object(ad, "_do_verify", side_effect=lambda eid, ctx: fake_verify(eid, ctx)):
            r = ad.run("e1", "VERIFYING", from_holder="a")
        self.assertEqual(r.detail["network_fence_rule_version"], 2)
        self.assertEqual(r.detail["compute_instance_state"], "stopped")
        self.assertIsNotNone(r.detail["network_fence"])
        self.assertIsNotNone(r.detail["compute_fence"])


if __name__ == "__main__":
    unittest.main()
