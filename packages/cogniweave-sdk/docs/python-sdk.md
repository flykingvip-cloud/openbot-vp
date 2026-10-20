# Python SDK (v0.1)

This package includes a minimal Python client under `packages/cogniweave-sdk/python`.

## Scope

The Python client maps 1:1 to the REST surface for the core runtime loop:

- `frame_task`
- `reason` / `reason_with_debug`
- `ingest` / `distill` / `write_back`
- `trace` / `trace_package` / `trace_reasoning_session`
- `resolve_evidence` / `get_evidence_refs`
- `repair_indexes` / `rebuild_from_truth` / `get_write_journal`

## Local Usage

```bash
cd packages/cogniweave-sdk/python
python3 -m unittest discover -s tests -p "test_*.py"
```

```python
from cogniweave_sdk import CogniWeaveClient, Scope

scope = Scope(
    workspace_id="ws_1",
    project_id="proj_1",
    agent_id="agent_main",
)

client = CogniWeaveClient(
    base_url="http://127.0.0.1:8787",
    default_scope=scope,
)

task = client.frame_task("当前吞吐下降，外部 API 很慢，是否应该加同步重试？")
package = client.reason(task)
result = client.write_back(
    raw_input="当前吞吐下降，外部 API 很慢，是否应该加同步重试？",
    source_type="chat",
)
```

## Scope Enforcement

Cold-read APIs require scope (`trace`, `trace_package`, `trace_reasoning_session`, `resolve_evidence`, `get_evidence_refs`, `get_write_journal`).
You can pass scope per call or configure `default_scope` on client init.

## Idempotency

`write_back(..., idempotency_key="...")` sends HTTP `Idempotency-Key`.
Server-side journal/replay semantics follow Technical Spec v1.4.
