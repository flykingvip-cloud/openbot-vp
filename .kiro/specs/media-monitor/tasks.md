# Media Monitor (MediaCrawler sidecar MVP)

## Agents

- cursor-media-monitor · role: owner · scope: MediaCrawler sidecar connector MVP (read-only social monitor) · paths: extensions/media-monitor/**, .kiro/specs/media-monitor/**, src/plugin-sdk/media-monitor.ts · since: 2026-08-09

## License assumption

- MediaCrawler uses NON-COMMERCIAL LEARNING LICENSE 1.1.
- OpenBot MUST NOT vendor MediaCrawler source or ship it as a production built-in dependency.
- External adapter command is operator-supplied; commercial use requires written authorization from MediaCrawler copyright owner (or a replaceable commercially-licensed crawler).

## Tasks

- [x] Loom register + path ownership for media-monitor MVP. — cursor-media-monitor
- [x] Adapter contract (versioned JSONL), process-runner, fake fixture. — cursor-media-monitor
- [x] Store: targets/events/outbox/leases + cursor/dedupe/baseline. — cursor-media-monitor
- [x] Scheduler/lease/job-runner + outbox notify via existing channels. — cursor-media-monitor
- [x] Plugin entry, plugin-sdk surface, gateway methods/tool. — cursor-media-monitor
- [x] Tests + scoped check; pause after MVP (no multi-platform/dashboard/auto-post). — cursor-media-monitor

## MVP delivered

- Plugin: `extensions/media-monitor/`
- SDK surface: `src/plugin-sdk/media-monitor.ts`
- Fake adapter fixture for e2e without real platform accounts
- Events: `content.created`, `comment.created`, `monitor.failed`, `monitor.reauth_required`, `monitor.rate_limited`
- Persistence under `~/.openbot/plugins/media-monitor/store.json` (JSON, not shared MediaCrawler DB)

## Clean-room adapter (sibling repo)

- Path: `../openbot-media-adapter` (Apache-2.0; Phase C `256e36d`)
- Integration: `extensions/media-monitor/docs/ADAPTER_INTEGRATION.md`
- Phase C: HttpTransport + `XHS_*_URL_TEMPLATE` (operator clean-room captures)
- Next human input: real sanitized URL templates + response samples for production live

## Explicitly not in MVP

- Multi-platform rollout beyond xhs
- Web dashboard / MediaCrawler WebUI
- Auto comment / like / follow / DM / posting
- AI analysis / draft generation
- Redis / APScheduler UI
- Multi-instance shared JSON store / production DB migration (documented upgrade path only)
- Full platform cursor pagination recovery
- Auto-watch newly discovered content comments

## Acceptance rework (2026-08-10)

- [x] process-runner: correct stdio typing + already-aborted signal path + regression test. — cursor-media-monitor
- [x] bridge smoke `event.eventType` fix + default-on fake-adapter e2e. — cursor-media-monitor
- [x] outbox atomic claim (`sending` + claimOwner/claimUntil) + concurrent flush test. — cursor-media-monitor
- [x] Gateway/tool auth helper (no identity → forbidden; admin capability for full-store). — cursor-media-monitor
- [x] Docs: SecretRef=env only, baseline dedupe, JSON store single-instance, comment watch scope, staggerMs caveat. — cursor-media-monitor
- [x] Store soft caps (events/outbox/audit). — cursor-media-monitor
