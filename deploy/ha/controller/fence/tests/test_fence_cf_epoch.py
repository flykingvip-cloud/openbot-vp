"""§12.5 CF epoch refuse-overwrite + lease pre-check."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

_CTL = str(Path(__file__).resolve().parents[2])
if _CTL not in sys.path:
    sys.path.insert(0, _CTL)

from fence.cloudflare_cutover import (
    EpochOverwriteRefused,
    MockCloudflareCutoverClient,
    check_refuse_overwrite,
    format_origin_description,
    parse_origin_description,
)


class TestCfEpoch(unittest.TestCase):
    def test_parse_and_format(self):
        desc = format_origin_description(to_epoch=5, execution_id="abc-def")
        self.assertIn("epoch=5", desc)
        parsed = parse_origin_description(desc)
        self.assertEqual(parsed["epoch"], 5)

    def test_refuse_when_current_greater(self):
        with self.assertRaises(EpochOverwriteRefused):
            check_refuse_overwrite(
                current_desc="epoch=9; execution=zzzz",
                to_epoch=5,
            )

    def test_allow_when_equal_or_lower(self):
        check_refuse_overwrite(current_desc="epoch=5; execution=x", to_epoch=5)
        check_refuse_overwrite(current_desc="epoch=3; execution=x", to_epoch=5)
        check_refuse_overwrite(current_desc="", to_epoch=5)

    def test_mock_cutover_refuses_higher_origin_epoch(self):
        cf = MockCloudflareCutoverClient()
        cf.origins["node-z"] = "epoch=10; execution=older-higher"
        with self.assertRaises(EpochOverwriteRefused):
            cf.cutover(
                execution_id="e1",
                to_epoch=4,
                to_holder="node-b",
                old_origin="node-a",
                new_origin="node-b",
                lease_epoch=4,
                lease_holder="node-b",
            )

    def test_mock_cutover_lease_mismatch(self):
        cf = MockCloudflareCutoverClient()
        with self.assertRaises(RuntimeError) as cm:
            cf.cutover(
                execution_id="e1",
                to_epoch=4,
                to_holder="node-b",
                old_origin="node-a",
                new_origin="node-b",
                lease_epoch=3,  # mismatch
                lease_holder="node-b",
            )
        self.assertIn("§12.5", str(cm.exception))

    def test_happy_remove_old_add_new(self):
        cf = MockCloudflareCutoverClient()
        cf.origins["node-a"] = "epoch=2; execution=old"
        out = cf.cutover(
            execution_id="e1",
            to_epoch=3,
            to_holder="node-b",
            old_origin="node-a",
            new_origin="node-b",
            lease_epoch=3,
            lease_holder="node-b",
        )
        self.assertTrue(out["ok"])
        self.assertNotIn("node-a", cf.origins)
        self.assertIn("node-b", cf.origins)
        self.assertIn("epoch=3", cf.origins["node-b"])


if __name__ == "__main__":
    unittest.main()
