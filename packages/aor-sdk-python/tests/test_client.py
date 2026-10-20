import json
import unittest
from urllib.error import HTTPError

from aor_sdk.client import AorClient


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._body = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class AorClientTest(unittest.TestCase):
    def test_run_parses_chat_completion(self) -> None:
        def fake_urlopen(req, timeout=0):
            self.assertTrue(req.full_url.endswith("/v1/chat/completions"))
            body = json.loads(req.data.decode("utf-8"))
            self.assertEqual(body["model"], "anthropic/claude-opus-4-6")
            return _FakeResponse(
                {
                    "choices": [{"message": {"content": "- finding: example\n- suggest: fix"}}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
                }
            )

        import urllib.request

        original = urllib.request.urlopen
        urllib.request.urlopen = fake_urlopen  # type: ignore[assignment]
        try:
            client = AorClient(base_url="http://gateway.test:9999")
            result = client.run("review auth module", task_type="coding.review")
            self.assertIn("finding", result.text)
            self.assertEqual(result.usage["total_tokens"], 30)
            self.assertEqual(result.task_type, "coding.review")
        finally:
            urllib.request.urlopen = original

    def test_run_raises_on_http_error(self) -> None:
        def fake_urlopen(req, timeout=0):
            raise HTTPError(req.full_url, 503, "down", hdrs=None, fp=None)

        import urllib.request

        original = urllib.request.urlopen
        urllib.request.urlopen = fake_urlopen  # type: ignore[assignment]
        try:
            client = AorClient(base_url="http://gateway.test:9999")
            with self.assertRaises(RuntimeError):
                client.run("hello")
        finally:
            urllib.request.urlopen = original

    def test_dry_run_skips_http(self) -> None:
        client = AorClient(base_url="http://gateway.test:9999")
        result = client.run("review module", task_type="coding.review", dry_run=True)
        self.assertIn("dry-run", result.text)
        self.assertEqual(result.task_type, "coding.review")
        self.assertEqual(result.usage["total_tokens"], 0)


if __name__ == "__main__":
    unittest.main()
