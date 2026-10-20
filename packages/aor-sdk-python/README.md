# AOR Python SDK

Minimal Python client for the Agent Orchestration Runtime. Talks to OpenBot only through the public **`/v1/chat/completions`** HTTP endpoint (same contract as `@openbot/aor-backend-openbot` OpenAI compat client).

## Install (dev)

```bash
cd packages/aor-sdk-python
pip install -e ".[dev]"
pytest
```

## Usage

```python
from aor_sdk import AorClient

client = AorClient(base_url="http://127.0.0.1:18789")
result = client.run("review this module", task_type="coding.review")
print(result.text)

# Offline / CI dry-run (no gateway required)
dry = client.run("review this module", dry_run=True)
```

Environment: `AOR_GATEWAY_URL` (optional).

## vs Node SDK

| Capability             | Node `@openbot/aor-sdk-node` | Python `aor-sdk`                     |
| ---------------------- | ---------------------------- | ------------------------------------ |
| Task parsing / routing | Full Orchestrator            | Prompt template by `task_type` (MVP) |
| Bandit learning        | Yes                          | Not yet                              |
| Gateway RPC            | Yes                          | HTTP only (MVP)                      |
| Billing ingest         | Yes                          | Not yet                              |
| Dry-run                | `--dry-run` CLI              | `dry_run=True`                       |
