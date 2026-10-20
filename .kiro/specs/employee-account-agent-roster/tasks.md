# Tasks: Employee Account Agent Roster

## Agents

- cursor-composer · role: owner · scope: employee account agent roster SoT (expert revision) · paths: .kiro/specs/employee-account-agent-roster/**, src/gateway/tenant-agent-catalog.ts, src/gateway/employee-agent-roster.ts, src/gateway/control-plane/**, src/gateway/protocol/schema/agents-models-skills.ts, src/shared/session-types.ts, scripts/migrate-local-agents-to-catalog.ts · since: 2026-07-20

## Status

Expert review (2026-07-20): product direction OK; prior “Phase 1 done” claim **withdrawn**. Local catalog file = adapter scaffolding only.

## Checklist

### R0 — Spec (revised baseline)

- [x] requirements.md — iron rules + hard acceptance gates
- [x] design.md — CatalogPort / EntitlementPort / integrity / runtime semantics
- [x] tasks.md — this file

### P0 blockers before claiming Phase 1

- [x] Protocol: `runtimeStatus` on `AgentSummarySchema` + contract test
- [x] Fail-closed when tenantId missing (no `"001"` fallback in projection)
- [x] Control-plane CatalogPort as **sole** roster catalog dependency
- [x] Adapters: memory / local-file / remote (shared file SoT; not per-CONFIG_DIR)
- [x] Shared memory + shared remote-file: two gateways → same roster IDs/names
- [x] runtimeStatus uses `disabled` + `runtimeBinding` (Phase 1; not full heartbeat)
- [ ] Remote HTTP client for `http(s)://` OPENBOT_CONTROL_PLANE_URL (still needs companion catalog path)
- [ ] E2E two Gateway **processes** + two clients
- [ ] Bootstrap exposes `controlPlaneId` / `runtimeId` to all native shells
- [ ] Migration `--apply` only via remote CatalogPort write
- [ ] Phase 2 runtime registry / heartbeat (not local inventory alone)

**R1/R2 not complete** until HTTP remote + real multi-process E2E pass.

### Already useful scaffolding (not Phase 1 complete)

- [x] Local file catalog adapter + unit tests
- [x] Employee `agents.list` projection entrypoint
- [x] Client filter soften + pending label
- [x] Native cloud/self-host caption (UI only; env contract still incomplete)

## Acceptance gate (expert)

1. Two Gateways, different local cfg, same control plane → identical roster IDs/names/entitlements
2. Fail-closed: missing tenant / revoked ownership / expired seat / catalog policy
3. Schema + TS + clients agree on `runtimeStatus`
4. Runtime status from bind/health (Phase 2)
5. Migration apply → control-plane write; second run unchanged
6. Real E2E, not unit-only
