"""Mock vendor HTTP via urllib stub (stdlib; no live network)."""
from __future__ import annotations

import io
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

_CTL = str(Path(__file__).resolve().parents[2])
if _CTL not in sys.path:
    sys.path.insert(0, _CTL)

from fence.app_fence import HttpAppFenceClient
from fence.cloudflare_cutover import HttpCloudflareCutoverClient
from fence.http_util import HttpError, http_json
from fence.network_fence import AwsNetworkFenceClient


FIXTURES = Path(__file__).resolve().parent / "fixtures"


class _FakeResp:
    def __init__(self, payload: dict, status: int = 200):
        self._raw = json.dumps(payload).encode()
        self.status = status

    def read(self):
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class TestHttpMock(unittest.TestCase):
    def test_app_fence_http_uses_fixture_shape(self):
        ack = json.loads((FIXTURES / "app_fence_ack.json").read_text())
        client = HttpAppFenceClient(base_url="https://node-a.test/internal/fence")
        with mock.patch("fence.http_util.urllib.request.urlopen", return_value=_FakeResp(ack)):
            out = client.fence(
                execution_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                from_holder="node-a",
                to_holder="node-b",
                owner_gen=1,
            )
        self.assertTrue(out.get("acked"))
        self.assertEqual(out.get("role"), "FENCED")

    def test_cf_http_dry_skeleton_no_mutate(self):
        pool = json.loads((FIXTURES / "cf_pool_get.json").read_text())
        client = HttpCloudflareCutoverClient(
            api_base="https://api.cloudflare.test/client/v4",
            api_token="test-token-not-real",
            account_id="acct",
            pool_id="pool-fixture-1",
        )
        with mock.patch.dict("os.environ", {"HA_CF_LIVE_MUTATE": "0"}):
            with mock.patch(
                "fence.cloudflare_cutover.http_json", return_value=pool
            ) as hj:
                out = client.cutover(
                    execution_id="e1",
                    to_epoch=3,
                    to_holder="node-b",
                    old_origin="node-a.example",
                    new_origin="node-b.example",
                    lease_epoch=3,
                    lease_holder="node-b",
                )
        self.assertTrue(out["ok"])
        self.assertTrue(out.get("dry_skeleton"))
        # Only GET pool — no PUT when LIVE_MUTATE off
        self.assertEqual(hj.call_count, 1)

    def test_cf_refuse_overwrite_from_pool_desc(self):
        pool = json.loads((FIXTURES / "cf_pool_get.json").read_text())
        # fixture has epoch=2; to_epoch=1 must refuse
        client = HttpCloudflareCutoverClient(
            api_base="https://api.cloudflare.test/client/v4",
            api_token="test-token-not-real",
            account_id="acct",
            pool_id="pool-fixture-1",
        )
        with mock.patch("fence.cloudflare_cutover.http_json", return_value=pool):
            with self.assertRaises(Exception) as cm:
                client.cutover(
                    execution_id="e1",
                    to_epoch=1,
                    to_holder="node-b",
                    old_origin="node-a.example",
                    new_origin="node-b.example",
                    lease_epoch=1,
                    lease_holder="node-b",
                )
        self.assertIn("refuse overwrite", str(cm.exception).lower())

    def test_aws_network_skeleton_no_live_call(self):
        aws = AwsNetworkFenceClient(region="ap-east-1", sg_id="sg-test", live=False)
        out = aws.isolate_old_primary(
            execution_id="e1", from_holder="node-a", to_holder="node-b"
        )
        self.assertTrue(out["dry_skeleton"])
        self.assertEqual(len(aws.calls), 1)

    def test_http_json_error(self):
        import urllib.error

        err = urllib.error.HTTPError(
            "https://x", 500, "err", hdrs=None, fp=io.BytesIO(b"boom")
        )
        with mock.patch("fence.http_util.urllib.request.urlopen", side_effect=err):
            with self.assertRaises(HttpError) as cm:
                http_json("GET", "https://x")
        self.assertEqual(cm.exception.status, 500)


if __name__ == "__main__":
    unittest.main()
