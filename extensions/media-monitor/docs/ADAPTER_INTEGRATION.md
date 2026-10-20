# Connecting OpenBot media-monitor → openbot-media-adapter

This plugin never vendors MediaCrawler. Use the sibling clean-room repo
**openbot-media-adapter** (Apache-2.0).

Assumed layout:

```
AI项目/
  openbot/                 # this monorepo
  openbot-media-adapter/   # clean-room sidecar
```

## 1. Install the adapter

```bash
cd ../openbot-media-adapter
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest -q
```

## 2. Choose a run mode

| Mode                                  | When                                         | Env                                                                                                                                     |
| ------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **fixture**                           | OpenBot / CI without platform access         | `OPENBOT_MEDIA_ADAPTER_MODE=fixture` + optional `OPENBOT_MEDIA_ADAPTER_FIXTURE`                                                         |
| **replay**                            | Validate normalize against sanitized samples | `OPENBOT_MEDIA_ADAPTER_MODE=live`, `OPENBOT_MEDIA_XHS_TRANSPORT=replay`, `OPENBOT_MEDIA_XHS_REPLAY=…`, `OPENBOT_MEDIA_COOKIE=synthetic` |
| **bridge + Chrome 扩展（推荐 live）** | 普通用户 / 真实账号只读监测                  | `OPENBOT_MEDIA_XHS_TRANSPORT=bridge` + `XHS_BRIDGE_URL` + 扩展收割缓存                                                                  |
| **live HTTP**                         | Phase C 实验性 Cookie GET                    | `OPENBOT_MEDIA_XHS_TRANSPORT=http` + URL 模板 + Cookie（常因缺签名失败）                                                                |

### Fixture smoke (adapter only)

```bash
cd ../openbot-media-adapter
source .venv/bin/activate
export OPENBOT_MEDIA_ADAPTER_MODE=fixture
export OPENBOT_MEDIA_ADAPTER_FIXTURE=new_content
python -m openbot_media_adapter crawl \
  --platform xhs \
  --account-id demo \
  --account-url 'https://example.invalid/profile' \
  --mode creator \
  --output jsonl
```

### Replay smoke (adapter only)

```bash
export OPENBOT_MEDIA_ADAPTER_MODE=live
export OPENBOT_MEDIA_COOKIE=synthetic
export OPENBOT_MEDIA_XHS_TRANSPORT=replay
export OPENBOT_MEDIA_XHS_REPLAY=creator_page0.json
python -m openbot_media_adapter crawl \
  --platform xhs \
  --account-id demo \
  --account-url 'https://example.invalid/profile' \
  --mode creator \
  --output jsonl
```

## 3. OpenBot plugin config

`plugins.entries.media-monitor` (paths are examples — use absolute paths on your host):

```json
{
  "enabled": true,
  "adapterCommand": [
    "/ABS/PATH/openbot-media-adapter/.venv/bin/python",
    "-m",
    "openbot_media_adapter"
  ],
  "adapterCwd": "/ABS/PATH/openbot-media-adapter",
  "defaultPollIntervalSeconds": 1800,
  "timeoutMs": 120000,
  "notifyChannel": "telegram",
  "notifyTo": "<chat-id>",
  "cookieSecret": {
    "source": "env",
    "provider": "default",
    "id": "XHS_COOKIE"
  }
}
```

Gateway process environment (for fixture/replay while developing):

```bash
export OPENBOT_MEDIA_ADAPTER_MODE=fixture
export OPENBOT_MEDIA_ADAPTER_FIXTURE=baseline   # first run: establish baseline
# later: new_content / new_comment / rate_limit / reauth / captcha
```

For replay instead of fixture:

```bash
export OPENBOT_MEDIA_ADAPTER_MODE=live
export OPENBOT_MEDIA_XHS_TRANSPORT=replay
export OPENBOT_MEDIA_XHS_REPLAY=creator_page0.json
export XHS_COOKIE=synthetic   # or whatever cookieSecret.id points to
```

### Bridge + Chrome extension (recommended live)

On the adapter host (see `openbot-media-adapter/browser-extension/xhs-harvest/README.md`):

```bash
# Terminal A
cd ../openbot-media-adapter
.venv/bin/python scripts/local_bridge.py --listen 127.0.0.1:8765

# Chrome: load unpacked extension → open Xiaohongshu creator page (logged in)
# Verify: curl -s http://127.0.0.1:8765/v1/health   # cache length >= 1
```

Gateway / plugin environment:

```bash
export OPENBOT_MEDIA_ADAPTER_MODE=live
export OPENBOT_MEDIA_XHS_TRANSPORT=bridge
export XHS_BRIDGE_URL=http://127.0.0.1:8765
export XHS_COOKIE=bridge
export XHS_CREATOR_URL_TEMPLATE='https://edith.xiaohongshu.com/api/sns/web/v1/user_posted?num=30&cursor={cursor}&user_id={account_id}&image_formats=jpg,webp,avif&xsec_token={xsec_token}&xsec_source=pc_search'
export XHS_COMMENTS_URL_TEMPLATE='https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id={content_id}&cursor={cursor}&top_comment_id=&image_formats=jpg,webp,avif&xsec_token={xsec_token}'
```

`add_target.accountId` must match the cached `creator:<accountId>` key (from `/v1/health`).

For Phase C live HTTP (operator-supplied templates only — see adapter
`docs/design/xhs-phase-c-http.md`):

```bash
export OPENBOT_MEDIA_ADAPTER_MODE=live
export OPENBOT_MEDIA_XHS_TRANSPORT=http
export XHS_COOKIE='…'
export XHS_CREATOR_URL_TEMPLATE='https://…/{account_id}?page={page}'
export XHS_COMMENTS_URL_TEMPLATE='https://…/{content_id}?page={page}'
export XHS_MIN_INTERVAL_MS=2000
```

The plugin process-runner inherits `process.env`, so these variables reach the sidecar.

## 4. Operator flow (MVP)

1. Enable plugin + restart gateway.
2. Add one target via gateway method / tool `media_monitor` `add_target`:
   - `platform`: xhs (default)
   - `accountId` / `accountUrl`
   - `pollIntervalSeconds`: 1800
   - `notifyChannel` / `notifyTo`
3. First successful crawl: **baseline only** (no flood notifications).
4. Subsequent crawls: `content.created` / `comment.created` → outbox → channel.
5. On `reauth_required` / `rate_limited`: fix cookie or wait cooldown; cursor not advanced on failure.

## 5. Cron (optional)

```bash
openbot cron add \
  --name media-monitor-tick \
  --every 30m \
  --session main \
  --system-event "media-monitor: run media_monitor action=tick_due then flush_outbox"
```

## 6. What not to do

- Do not vendor MediaCrawler into OpenBot or this adapter.
- Do not point `adapterCommand` at MediaCrawler for commercial/hosted product use without written license.
- Do not enable auto-posting / engagement — out of scope and forbidden in MVP.
