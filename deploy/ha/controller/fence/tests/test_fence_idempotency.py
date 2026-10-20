"""Idempotency key = execution_id + step; replay returns same receipt."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

_CTL = str(Path(__file__).resolve().parents[2])
if _CTL not in sys.path:
    sys.path.insert(0, _CTL)

from fence.app_fence import MockAppFenceClient
from fence.cloudflare_cutover import MockCloudflareCutoverClient
from fence.composite import CompositeFenceAdapter
from fence.compute_fence import MockComputeFenceClient
from fence.dry_run import DryRunFenceAdapter
from fence.network_fence import MockNetworkFenceClient
from fence.promote import MockPromoteClient


EID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


class TestIdempotency(unittest.TestCase):
    def test_dry_run_idempotent(self):
        ad = DryRunFenceAdapter()
        r1 = ad.run(EID, "FENCING_NETWORK", from_holder="a", to_holder="b")
        r2 = ad.run(EID, "FENCING_NETWORK", from_holder="a", to_holder="b")
        self.assertIs(r1, r2)
        self.assertEqual(r1.detail["idempotency_key"], f"{EID}:FENCING_NETWORK")
        self.assertEqual(ad.side_effect_count, 1)

    def test_composite_mock_idempotent_and_keys(self):
        ad = CompositeFenceAdapter(
            database_url="postgresql://unused/db",  # not hit for non-SQL steps
            app_client=MockAppFenceClient(),
            network_client=MockNetworkFenceClient(),
            compute_client=MockComputeFenceClient(),
            cf_client=MockCloudflareCutoverClient(),
            promote_client=MockPromoteClient(),
            enable_app=True,
            enable_network=True,
            enable_compute=True,
            enable_cf=True,
            enable_promote=True,
            cf_old_origin="old",
            cf_new_origin="new",
            t_wait_s=0,
        )
        for step in (
            "FENCING_APP",
            "DRAIN_WAIT",
            "FENCING_NETWORK",
            "FENCING_COMPUTE",
            "PROMOTING",
            "CF_CUTOVER",
        ):
            r1 = ad.run(
                EID,
                step,
                from_holder="node-a",
                to_holder="node-b",
                to_epoch=3,
                owner_gen=1,
                lease_epoch=3,
                lease_holder="node-b",
            )
            r2 = ad.run(
                EID,
                step,
                from_holder="node-a",
                to_holder="node-b",
                to_epoch=3,
                owner_gen=1,
                lease_epoch=3,
                lease_holder="node-b",
            )
            self.assertIs(r1, r2)
            self.assertEqual(r1.detail["idempotency_key"], f"{EID}:{step}")
        self.assertEqual(ad.side_effect_count, 6)
        # Mock clients saw one call each (idempotent replay does not re-call)
        self.assertEqual(len(ad.app_client.calls), 1)
        self.assertEqual(len(ad.network_client.calls), 1)
        self.assertEqual(len(ad.cf_client.calls), 1)


if __name__ == "__main__":
    unittest.main()
