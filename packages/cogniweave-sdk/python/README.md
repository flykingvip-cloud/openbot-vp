# CogniWeave Python SDK

Minimal Python client for CogniWeave REST API.

## Run tests

```bash
cd packages/cogniweave-sdk/python
python3 -m unittest discover -s tests -p "test_*.py"
```

## Example

```python
from cogniweave_sdk import CogniWeaveClient, Scope

client = CogniWeaveClient(
    base_url="http://127.0.0.1:8787",
    default_scope=Scope("ws_1", "proj_1", "agent_main"),
)

task = client.frame_task("当前吞吐下降，外部 API 很慢，是否应该加同步重试？")
package = client.reason(task)
client.write_back(
    raw_input="当前吞吐下降，外部 API 很慢，是否应该加同步重试？",
    source_type="chat",
)
```
