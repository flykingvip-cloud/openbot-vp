# Media Monitor (MVP)

Read-only social media monitoring connector for OpenBot. MediaCrawler (or any compatible crawler) runs as an **external bounded sidecar process**. OpenBot owns targets, leases, baseline/dedupe state, events, outbox notifications, and audit.

## License

See [LICENSE-NOTES.md](./LICENSE-NOTES.md). MediaCrawler is **NON-COMMERCIAL LEARNING LICENSE 1.1**. Do not vendor its source into OpenBot.

**Recommended executor:** sibling clean-room repo `openbot-media-adapter` (Apache-2.0), not MediaCrawler. Point `adapterCommand` / `adapterCwd` at that checkout.

## MVP scope

- Platform: `xhs` only (adapter interface is extensible)
- Single-account read-only creator content + **explicit** `watchedContentIds` comments
- **MVP baseline dedupe** (not a full platform cursor / incremental sync protocol)
- Health: `monitor.failed` / `monitor.reauth_required` / `monitor.rate_limited`
- OpenBot channel notifications via outbox (claim / retry / dead-letter)
- No auto-comment, like, follow, DM, or posting
- No MediaCrawler WebUI / shared DB / Redis / APScheduler UI

### Product choices (explicit)

| Topic       | MVP behavior                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Cursor      | Baseline flag + event `dedupeKey` history. `contentWatermark` is reserved, not a platform pager cursor.            |
| Comments    | Only content IDs in `watchedContentIds`. New `content.created` does **not** auto-join the watch list.              |
| Secrets     | `cookieSecret` MVP resolves **plaintext** or `{ source: "env", id }`. Other SecretRef sources are not implemented. |
| Storage     | JSON file store is **single Gateway / single state dir / small-scale**. Not multi-instance production storage.     |
| `staggerMs` | Reserved; current tick selects `limit: 1` due target, so multi-account stagger does not fire yet.                  |

## Config (`plugins.entries.media-monitor`)

```json
{
  "enabled": true,
  "adapterCommand": ["python3", "-m", "openbot_media_adapter"],
  "adapterCwd": "/path/to/openbot-media-adapter",
  "defaultPollIntervalSeconds": 1800,
  "notifyChannel": "telegram",
  "notifyTo": "<chat-id>",
  "cookieSecret": { "source": "env", "provider": "default", "id": "XHS_COOKIE" }
}
```

Full fixture / replay / cron wiring: [docs/ADAPTER_INTEGRATION.md](./docs/ADAPTER_INTEGRATION.md).

## Auth (Gateway / tool)

- Tenant callers must pass `tenantId` + `agentId` (session `sessionTenantId` is authoritative when present).
- Missing identity → `forbidden` (no unfiltered store dump).
- Cross-tenant param forging → `forbidden`.
- Full-store ops (`tickDue` / `flushOutbox` gateway methods, `admin: true` status/list) require a trusted admin client (`operator.admin` scope or platform/enterprise admin session kind).

## Storage limits (MVP JSON store)

Path: `~/.openbot/plugins/media-monitor/store.json`

- Soft caps: events ≤ 5000, outbox ≤ 2000, audit ≤ 2000 (oldest trimmed on write)
- File lock is single-host only; do not share one store across multiple Gateway replicas
- Production path: migrate to SQLite/Postgres with unique constraints + transactional outbox

## Cron integration

Prefer OpenBot native cron to call the gateway tick (no second user-facing scheduler):

```bash
openbot cron add \
  --name media-monitor-tick \
  --every 30m \
  --session main \
  --system-event "media-monitor: please run media_monitor action=tick_due then flush_outbox"
```

Or invoke gateway methods / the `media_monitor` tool from an agent turn. The plugin also runs a lightweight internal due-check interval (not APScheduler, not user-visible).

## Adapter contract

```bash
<adapterCommand...> crawl \
  --platform xhs \
  --account-id <id> \
  --mode creator|comments \
  --output jsonl
```

Stdout: schema_version=1 JSON/JSONL envelopes only. Stderr: diagnostics. See `src/contract.ts` and `fixtures/fake-adapter.mjs`.

## Tests

```bash
# Default suite (includes fake-adapter e2e; real bridge smoke stays opt-in)
OPENBOT_TEST_PROFILE=low pnpm test extensions/media-monitor

# Optional live bridge smoke (requires local bridge + harvest cache)
MEDIA_MONITOR_BRIDGE_SMOKE=1 OPENBOT_TEST_PROFILE=low pnpm test extensions/media-monitor/src/bridge-e2e.smoke.test.ts
```
