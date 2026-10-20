# Collab S4 — Heartbeat scheduler with observe-first defaults (FINAL v3)

| Field | Value |
| --- | --- |
| Date | 2026-10-15 Asia/Shanghai |
| Status | Code ready; **schedulerEnabled default false**, **mode default observe** |
| Spec | `openbot-collab-self-run-FINAL-v3-2026-10-15.md` §S4 + expert dual acceptance |
| Depends | **P0 #731**, **S1 #734**, **S2 #735**, **S3 #737** (tip `43ef44f1a6…`) |
| Code | `group-task-heartbeat.ts` (observe/emit), `group-task-heartbeat-scheduler.ts`, `group-task-heartbeat-scheduler-boot.ts`, `collab-s4-heartbeat-scheduler.test.ts` |

## Scope

1. **Reliable timer wiring** (inventory-first on existing cron-shaped tick): gateway boots `startGatewayGroupTaskHeartbeatScheduler`; `schedulerEnabled` default **false** → dormant until tip arms it.
2. **Observe-first**: default `mode=observe` plans + persists state/scan JSONL **without** wake nudge/escalate. Real emits require Wake Contract for the group **and** (`mode=emit` **or** `emitGroupAllowlist`).
3. **Scheduling reliability**: restart recovery via persisted `lastScanAt`; in-flight dedup; scan interval gate; exception → `consecutiveFailures` + next tick retries.
4. **Task behavior**: only non-terminal actionable statuses; anti-spam after escalate (same fingerprint → skip); consecutive no-response escalate (default 2, configurable); terminal `accepted`/`cancelled` no remind.
5. **「无响应」≠无聊天**: fingerprint is board/交卷 only (`status`, claimant, timestamps, `submissionId`, `artifactVersion`). Chat "正在处理" does **not** reset stall.

## Config (defaults stay safe)

| Key | Default | Tip gray |
| --- | --- | --- |
| `groupTaskHeartbeat.schedulerEnabled` | **false** | true to arm timer |
| `groupTaskHeartbeat.mode` | **observe** | keep observe until emit authorized |
| `groupTaskHeartbeat.emitGroupAllowlist` | `[]` | scoped `001/grp-…` + wake allowlist |
| `groupTaskHeartbeat.scanIntervalMs` | 1_800_000 (30min) | configurable |
| `groupTaskHeartbeat.escalateAfterConsecutiveNoResponse` | 2 | configurable |
| `wakeContract` / allowlist | false / `[]` | required for emit path |
| `claimContract` / challenge / self_advance / LIVE / Floor | unchanged OFF | **not** opened here |

**Does not** open production gray writes. LIVE / Floor untouched. No second orchestrator.

## Acceptance

- Vitest: `collab-s4-heartbeat-scheduler.test.ts` + updated `group-task-heartbeat.test.ts` green
- LIVE_touched = false
- Dual groups covered: scheduler reliability + task behavior

## Out of scope

S5 enabling `botMaySelfAdvanceWithoutHuman`, Floor live, multi-beat, tip production gray writes / default emit.
