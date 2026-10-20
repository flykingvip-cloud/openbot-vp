# tencent-meeting scripts

## OpenBot primary config

| Env                     | Required | Purpose                                             |
| ----------------------- | -------- | --------------------------------------------------- |
| `TENCENT_MEETING_TOKEN` | yes      | Bearer/token for Tencent Meeting MCP (`primaryEnv`) |

- Configure via 平台能力 → tencent-meeting → 主配置项; never paste full tokens in chat.
- Token portal: https://meeting.tencent.com/ai-skill
- MCP base URL: see `../config.json` → `baseUrl` (`https://mcp.meeting.tencent.com/mcp/wemeet-open/v1`)

## Entry

```bash
python3 {baseDir}/scripts/tencent_meeting.py tools/list
python3 {baseDir}/scripts/tencent_meeting.py tools/call '{"name":"<tool>","arguments":{...}}'
```

Modules: `tencent_meeting.py` (CLI), `mcp_proxy.py`, `local_tools.py`, `update_state.py`, `utils.py`.
