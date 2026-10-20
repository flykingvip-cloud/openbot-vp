"""E1 App Fence server unit/integration tests (stdlib only)."""
from __future__ import annotations

import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

_HA = str(Path(__file__).resolve().parents[2])  # deploy/ha
_CTL = str(Path(__file__).resolve().parents[2] / "controller")
for p in (_HA, _CTL):
    if p not in sys.path:
        sys.path.insert(0, p)

from app_fence.http_server import create_server  # noqa: E402
from app_fence.state import AppFenceState, ROLE_FENCED  # noqa: E402
from fence.app_fence import HttpAppFenceClient  # noqa: E402


def _json_req(method: str, url: str, body: dict | None = None, headers: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"raw": raw}
        return e.code, parsed


class _ServerCase(unittest.TestCase):
    def setUp(self):
        self.state = AppFenceState(node_id="node-a-test")
        # port 0 → ephemeral
        self.httpd = create_server(host="127.0.0.1", port=0, state=self.state)
        self.port = self.httpd.server_address[1]
        self.base = f"http://127.0.0.1:{self.port}"
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self._thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def test_healthz_200_then_503_after_fence(self):
        st, body = _json_req("GET", f"{self.base}/healthz")
        self.assertEqual(st, 200)
        self.assertTrue(body.get("ok"))
        self.assertEqual(body.get("status"), "live")

        key = "e1-exec:FENCING_APP"
        st, ack = _json_req(
            "POST",
            f"{self.base}/internal/fence",
            body={
                "execution_id": "e1-exec",
                "from_holder": "node-a",
                "to_holder": "node-b",
                "owner_gen": 2,
                "to_epoch": 5,
                "action": "fence",
                "idempotency_key": key,
            },
            headers={"X-Idempotency-Key": key},
        )
        self.assertEqual(st, 200)
        self.assertTrue(ack.get("acked"))
        self.assertEqual(ack.get("role"), ROLE_FENCED)
        self.assertEqual(ack.get("healthz"), 503)
        self.assertFalse(ack.get("replay"))

        st, body = _json_req("GET", f"{self.base}/healthz")
        self.assertEqual(st, 503)
        self.assertFalse(body.get("ok"))
        self.assertEqual(body.get("role"), ROLE_FENCED)

        st, rbody = _json_req("GET", f"{self.base}/readyz")
        self.assertEqual(st, 503)
        self.assertFalse(rbody.get("ready"))

    def test_idempotent_replay_same_receipt(self):
        key = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:FENCING_APP"
        payload = {
            "execution_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "from_holder": "node-a",
            "to_holder": "node-b",
            "owner_gen": 1,
            "to_epoch": 3,
            "action": "fence",
            "idempotency_key": key,
        }
        st1, b1 = _json_req(
            "POST",
            f"{self.base}/internal/fence",
            body=payload,
            headers={"X-Idempotency-Key": key},
        )
        st2, b2 = _json_req(
            "POST",
            f"{self.base}/internal/fence",
            body=payload,
            headers={"X-Idempotency-Key": key},
        )
        self.assertEqual(st1, 200)
        self.assertEqual(st2, 200)
        self.assertTrue(b1.get("acked"))
        self.assertTrue(b2.get("acked"))
        self.assertTrue(b2.get("replay"))
        # Same core fields
        for k in (
            "role",
            "healthz",
            "execution_id",
            "idempotency_key",
            "from_holder",
            "to_holder",
            "owner_gen",
            "to_epoch",
        ):
            self.assertEqual(b1.get(k), b2.get(k), k)
        # Only one receipt stored; second apply does not double-fence side effects
        self.assertEqual(len(self.state.receipts), 1)

    def test_missing_idempotency_rejected(self):
        st, body = _json_req(
            "POST",
            f"{self.base}/internal/fence",
            body={
                "execution_id": "x",
                "from_holder": "a",
                "to_holder": "b",
                "owner_gen": 1,
                "action": "fence",
            },
        )
        self.assertEqual(st, 400)
        self.assertFalse(body.get("acked", True))
        self.assertIn("idempotency", body.get("error", "").lower())

    def test_header_body_key_mismatch_rejected(self):
        st, body = _json_req(
            "POST",
            f"{self.base}/internal/fence",
            body={
                "execution_id": "x",
                "from_holder": "a",
                "to_holder": "b",
                "owner_gen": 1,
                "action": "fence",
                "idempotency_key": "x:FENCING_APP",
            },
            headers={"X-Idempotency-Key": "other:FENCING_APP"},
        )
        self.assertEqual(st, 400)
        self.assertIn("mismatch", body.get("error", "").lower())

    def test_token_auth_when_configured(self):
        import os

        os.environ["HA_APP_FENCE_TOKEN"] = "lab-token-not-secret-fixture"
        try:
            st, body = _json_req(
                "POST",
                f"{self.base}/internal/fence",
                body={
                    "execution_id": "t1",
                    "from_holder": "a",
                    "to_holder": "b",
                    "owner_gen": 1,
                    "action": "fence",
                    "idempotency_key": "t1:FENCING_APP",
                },
                headers={"X-Idempotency-Key": "t1:FENCING_APP"},
            )
            self.assertEqual(st, 401)

            st, body = _json_req(
                "POST",
                f"{self.base}/internal/fence",
                body={
                    "execution_id": "t1",
                    "from_holder": "a",
                    "to_holder": "b",
                    "owner_gen": 1,
                    "action": "fence",
                    "idempotency_key": "t1:FENCING_APP",
                },
                headers={
                    "X-Idempotency-Key": "t1:FENCING_APP",
                    "Authorization": "Bearer lab-token-not-secret-fixture",
                },
            )
            self.assertEqual(st, 200)
            self.assertTrue(body.get("acked"))
        finally:
            os.environ.pop("HA_APP_FENCE_TOKEN", None)

    def test_http_client_against_live_server(self):
        """Controller HttpAppFenceClient → reference server end-to-end."""
        client = HttpAppFenceClient(base_url=f"{self.base}/internal/fence")
        out = client.fence(
            execution_id="cccccccc-dddd-eeee-ffff-000000000001",
            from_holder="node-a",
            to_holder="node-b",
            owner_gen=3,
            to_epoch=9,
        )
        self.assertTrue(out.get("acked"))
        self.assertEqual(out.get("role"), "FENCED")
        self.assertEqual(out.get("healthz"), 503)

        # Replay via client
        out2 = client.fence(
            execution_id="cccccccc-dddd-eeee-ffff-000000000001",
            from_holder="node-a",
            to_holder="node-b",
            owner_gen=3,
            to_epoch=9,
        )
        self.assertTrue(out2.get("acked"))
        self.assertTrue(out2.get("replay"))

        st, hz = _json_req("GET", f"{self.base}/healthz")
        self.assertEqual(st, 503)


if __name__ == "__main__":
    unittest.main()
