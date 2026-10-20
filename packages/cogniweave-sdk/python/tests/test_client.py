import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from cogniweave_sdk import ApiError, CogniWeaveClient, CogniWeaveError, Scope


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self._payload).encode("utf-8")


class CogniWeaveClientTest(unittest.TestCase):
    def setUp(self):
        self.scope = Scope(
            workspace_id="ws_1",
            project_id="proj_1",
            agent_id="agent_main",
            visibility="private",
        )
        self.client = CogniWeaveClient(
            base_url="http://127.0.0.1:8787",
            default_scope=self.scope,
        )

    @patch("cogniweave_sdk.client.urlopen")
    def test_frame_task_sends_expected_payload(self, mock_urlopen):
        mock_urlopen.return_value = _FakeResponse({"id": "tf_1"})
        result = self.client.frame_task("throughput dropped")
        self.assertEqual(result["id"], "tf_1")

        request = mock_urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "http://127.0.0.1:8787/v1/tasks/frame")
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["rawInput"], "throughput dropped")
        self.assertEqual(payload["scope"]["workspaceId"], "ws_1")
        self.assertEqual(payload["scope"]["projectId"], "proj_1")
        self.assertEqual(payload["scope"]["agentId"], "agent_main")

    @patch("cogniweave_sdk.client.urlopen")
    def test_trace_sends_scope_headers(self, mock_urlopen):
        mock_urlopen.return_value = _FakeResponse({"atom": {"id": "a_1"}})
        self.client.trace("a_1")
        request = mock_urlopen.call_args.args[0]
        self.assertEqual(request.get_header("X-cogniweave-workspace-id"), "ws_1")
        self.assertEqual(request.get_header("X-cogniweave-project-id"), "proj_1")
        self.assertEqual(request.get_header("X-cogniweave-agent-id"), "agent_main")
        self.assertEqual(request.get_header("X-cogniweave-visibility"), "private")

    @patch("cogniweave_sdk.client.urlopen")
    def test_write_back_supports_idempotency_key(self, mock_urlopen):
        mock_urlopen.return_value = _FakeResponse({"status": "COMPLETED"})
        self.client.write_back(
            raw_input="input",
            source_type="chat",
            idempotency_key="idem_1",
        )
        request = mock_urlopen.call_args.args[0]
        self.assertEqual(request.get_header("Idempotency-key"), "idem_1")

    def test_requires_scope_when_not_configured(self):
        client = CogniWeaveClient(base_url="http://127.0.0.1:8787")
        with self.assertRaises(CogniWeaveError):
            client.trace("a_1")

    @patch("cogniweave_sdk.client.urlopen")
    def test_wraps_http_error(self, mock_urlopen):
        error = HTTPError(
            url="http://127.0.0.1:8787/v1/reason",
            code=400,
            msg="Bad Request",
            hdrs=None,
            fp=io.BytesIO(b'{"error":"bad_request"}'),
        )
        mock_urlopen.side_effect = error
        with self.assertRaises(ApiError) as ctx:
            self.client.reason({"id": "tf_1", "taskType": "debugging"})
        self.assertEqual(ctx.exception.status, 400)


if __name__ == "__main__":
    unittest.main()
