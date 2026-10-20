"""Minimal AOR client over OpenBot public HTTP `/v1/chat/completions`."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass
class AorRunResult:
    text: str
    model: str
    task_type: str
    usage: dict[str, int]


class AorClient:
    """Describe a task; POST to Gateway OpenAI-compatible chat completions."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        *,
        timeout_sec: float = 120.0,
    ) -> None:
        resolved = (base_url or os.environ.get("AOR_GATEWAY_URL") or "http://127.0.0.1:18789").rstrip(
            "/"
        )
        self.base_url = resolved
        self.api_key = api_key
        self.timeout_sec = timeout_sec

    def run(
        self,
        goal: str,
        *,
        task_type: str = "coding.review",
        model: str = "anthropic/claude-opus-4-6",
        dry_run: bool = False,
    ) -> AorRunResult:
        if dry_run:
            return AorRunResult(
                text=f"[dry-run] {self._build_prompt(goal, task_type)}",
                model=model,
                task_type=task_type,
                usage={"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
            )
        prompt = self._build_prompt(goal, task_type)
        body = {
            "model": model,
            "stream": False,
            "messages": [{"role": "user", "content": prompt}],
        }
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        req = urllib.request.Request(
            f"{self.base_url}/v1/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
                payload: dict[str, Any] = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"Gateway returned {err.code}: {detail}") from err

        choices = payload.get("choices") or []
        message = (choices[0] or {}).get("message") if choices else {}
        text = message.get("content") if isinstance(message, dict) else ""
        if not isinstance(text, str):
            text = str(text or "")

        usage_raw = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
        usage = {
            "input_tokens": int(usage_raw.get("prompt_tokens") or 0),
            "output_tokens": int(usage_raw.get("completion_tokens") or 0),
            "total_tokens": int(usage_raw.get("total_tokens") or 0),
        }
        return AorRunResult(text=text, model=model, task_type=task_type, usage=usage)

    @staticmethod
    def _build_prompt(goal: str, task_type: str) -> str:
        if task_type == "summarization":
            return f"Summarize the following concisely:\n\n{goal}"
        if task_type == "coding.security":
            return f"Perform a security review. Goal: {goal}"
        return f"Perform a code review. Goal: {goal}"
