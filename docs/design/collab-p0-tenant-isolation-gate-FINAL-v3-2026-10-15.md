# Collab P0 — Tenant isolation gate before gray enable (FINAL v3)

| Field | Value |
| --- | --- |
| Date | 2026-10-15 Asia/Shanghai |
| Status | **Blocking gate** — do not open production gray writes until this passes |
| Spec | `openbot-collab-self-run-FINAL-v3-2026-10-15.md` §3 P0 |
| Code | `gray-group-allowlist.ts`, claim/wake allowlist matchers, vitest `collab-p0-tenant-isolation-gate.test.ts` |

## Why

Runtime path helpers / `RuntimeAuthority` existing ≠ production data already isolated.
`collaboration.runtimeNamespace` defaults **false**; N2 cutover is **not** signed in this PR.
Gray allowlists that accept bare `groupId` can authorize the same group id under the wrong tenant.

## Gate requirements

1. **Allowlist key** for managed_enterprise gray = `{tenantId, groupId}` encoded as `tenantId/groupId` (or `*/groupId`). Bare `groupId` **never** matches a caller with non-empty `tenantId`. Personal_local (no tenant) may still use bare entries.
2. **Paths** under flag ON: `board-claims`, `executor-todolists`, `wake-events`, `group-task-heartbeat`, `challenge-windows` resolve under `tenants/<tid>/collaboration/groups/<enc(groupId)>/runtime/…`. Cross-tenant read / write / enumerate of the same groupId must not see the other tenant’s facts. Managed + flag ON must **not** fall back to host legacy `collaboration/groups`.
3. **`collaboration.runtimeWriteFreeze`** rejects writes to those stores (and shared assert helper).
4. This PR does **not** set `runtimeNamespace` / `claimContract` / `wakeContract` / Floor / LIVE defaults to true, and does **not** run N2 `--apply` against production.

## Acceptance

- Vitest: `gray-group-allowlist.test.ts` + `collab-p0-tenant-isolation-gate.test.ts` green.
- Tip/ops configs for managed gray must list `001/grp-…` (example), not bare `grp-…`.
- **Until this gate is proven on tip with the intended gray config, keep production gray writes closed.**

## Out of scope (later stages)

S1 challenge wiring on tip, S2 plan-gate on all exec entries, S3–S5, Floor live, multi-beat, N2 production namespace cutover.
