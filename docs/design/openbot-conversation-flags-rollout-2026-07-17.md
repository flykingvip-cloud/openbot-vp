# Conversation lifecycle — production flags & tenant rollout

Date: 2026-07-17

Related: [implementation plan §14.4](./openbot-conversation-lifecycle-implementation-plan-2026-07-16.md), `src/conversations/flags.ts`

## Config shape

```json5
{
  conversation: {
    catalog: { enabled: true, lazyBackfill: true },
    ui: { enabled: false },
    history: { cursorEnabled: true },
    sourceIdentity: { enabled: true },
    sourceLifecycle: { enabled: true },
    projection: { enabled: true },
    contextPlanner: { enabled: true },
    search: { semanticEnabled: false },
    retention: { enforceEnabled: false },
    rollout: {
      // Pilot: only these tenants get product surface (UI / semantic / enforce)
      tenantAllowlist: ["acme-pilot", "beta-corp"],
      // Optional canary: 10% of remaining tenants (hash bucket)
      // tenantPercent: 10,
      // tenantBlocklist: ["do-not-touch"],
      // principalAllowlist: ["user_ops_1"],
      // seatAllowlist: ["seat_pilot_1"],
    },
  },
}
```

## Env overrides

| Variable                                        | Effect                  |
| ----------------------------------------------- | ----------------------- |
| `OPENBOT_CONVERSATION_HISTORY_CURSOR`           | default true            |
| `OPENBOT_CONVERSATION_PROJECTION`               | default true            |
| `OPENBOT_CONVERSATION_CONTEXT_PLANNER`          | default true            |
| `OPENBOT_CONVERSATION_SEMANTIC_SEARCH`          | default false           |
| `OPENBOT_CONVERSATION_RETENTION_ENFORCE`        | default false           |
| `OPENBOT_CONVERSATION_ROLLOUT_TENANT_IDS`       | CSV tenant allowlist    |
| `OPENBOT_CONVERSATION_ROLLOUT_TENANT_BLOCKLIST` | CSV tenant blocklist    |
| `OPENBOT_CONVERSATION_ROLLOUT_PRINCIPAL_IDS`    | CSV principal allowlist |
| `OPENBOT_CONVERSATION_ROLLOUT_SEAT_IDS`         | CSV seat allowlist      |
| `OPENBOT_CONVERSATION_ROLLOUT_PERCENT`          | 0–100 canary            |

## Rollout gate behavior

When a request subject is **outside** the rollout window:

| Flag                              | Outside rollout                    |
| --------------------------------- | ---------------------------------- |
| `catalogEnabled` / `lazyBackfill` | keep config value (compat mapping) |
| `uiEnabled`                       | forced **false**                   |
| `searchSemanticEnabled`           | forced **false**                   |
| `retentionEnforceEnabled`         | forced **false**                   |
| projection / context planner      | keep config (local, non-product)   |

`resolveConversationFlags(cfg, { tenantId, principalId, seatId })` returns `rolloutActive` + `rolloutReason` for metrics.

## Recommended pilot stages

1. **Stage 0 — dark**: `ui.enabled=false`, `retention.enforceEnabled=false`, no allowlist (or `tenantPercent: 0` with empty allowlist for global kill of product).
2. **Stage 1 — internal tenants**: `tenantAllowlist: ["internal-qa"]`, enable UI only.
3. **Stage 2 — canary**: add `tenantPercent: 5` (or expand allowlist).
4. **Stage 3 — enforce retention**: only after dry-run scans look safe; set `retention.enforceEnabled=true` for allowlisted tenants.
5. **Stage 4 — semantic search**: `search.semanticEnabled=true` + embedding provider env.

## CI

```bash
pnpm test:conversation-lifecycle
```

GitHub Actions job: `.github/workflows/ci.yml` → matrix task `conversation-lifecycle` (P2 eval harness + P0–P4 gate suites + flags tests).
