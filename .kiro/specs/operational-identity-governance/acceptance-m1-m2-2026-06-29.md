# M1/M2 Acceptance: Enterprise Operational Identity

Date: 2026-06-29
Session: `019f12e0-ddf4-7751-9ab4-ab663e8c36ed`
Agent: `codex-oig`

## Scope

This acceptance pass checks the M1/M2 criteria from
`docs/design/openbot-enterprise-operational-identity-v1-work-breakdown-2026-06-06.md`:

- M1: enterprise operational identity directory, credential reuse, Seat-first usage policy, and enterprise audit.
- M2: Operational Identity Access for Agent/DataSource linkage, DataSource binding summaries, enterprise-data governance boundary, and usage/denial audit replay.

## M1 Verdict

Status: accepted with one explicit boundary.

- Enterprise admins can manage the enterprise operational identity directory via the enterprise settings identity surface and the HTTP/RPC controller path (`ui/src/ui/controllers/enterprise-operational-identity.ts`, `src/gateway/enterprise-operational-identity.ts`).
- Identities reference existing `credentialBindingId` records and duplicate active credential reuse is rejected; no credential secret copy is added to the identity model.
- `IdentityUsagePolicy` requires at least one `seatId`; `allowedAgentIds` is an additional consumer constraint and cannot authorize without a Seat path.
- Enterprise audit events are recorded for the documented event family: `identity.registered`, `identity.reauthorized`, `identity.revoked`, `identity.bound`, `identity.unbound`, `identity.used`, and `identity.usage_denied`.

Boundary: the M1 work breakdown names the audit event family above, but there is no separate `identity.updated` audit event for metadata-only edits such as display-name changes. This pass treats the documented event family as the acceptance target.

## M2 Verdict

Status: accepted.

- Agent-side exposure is `Operational Identity Access`, surfaced through resolver/list APIs and runtime prompt text that explicitly says it does not grant enterprise data invoke elevation.
- DataSource identity bindings support `source_authentication`, `source_collection`, and `source_sync`; DataSource governance detail returns `boundOperationalIdentities` with identity name, provider, purpose, and status.
- Enterprise operational identity fields are rejected from enterprise-data invoke params/context, so operational identity cannot become a client-supplied execution or data-access identity.
- Binding/unbinding and usage success/denial are written into enterprise audit events; DataSource bindings do not create seat action grants.

## Verification Commands

- `pnpm exec vitest run src/gateway/enterprise-operational-identity.test.ts src/gateway/enterprise-operational-identity-access.test.ts src/gateway/enterprise-operational-identity-runtime.test.ts src/gateway/enterprise-operational-identity-enrollment.test.ts src/gateway/server-methods/enterprise-data-m2.test.ts`
  - Result: 5 files passed, 34 tests passed.
- `pnpm exec vitest run src/gateway/enterprise-operational-identity-providers.test.ts src/gateway/platform-auth/session-domain.test.ts src/gateway/user-operational-identity-domain-guard.test.ts`
  - Result: 3 files passed, 22 tests passed.
- `pnpm exec vitest run ui/src/ui/ports/enterprise/views/enterprise-surfaces.browser.test.ts ui/src/ui/ports/platform/dashboard/page.test.ts -t "operational identity"`
  - Result: 2 files passed, 5 tests passed, 58 unrelated tests skipped by filter.
- `pnpm exec vitest run ui/src/ui/views/operational-identity-governance-panel.browser.test.ts`
  - Result: 1 file passed, 4 tests passed.

## Notes

- The working tree contains unrelated WIP owned by other task streams; this pass did not edit runtime/UI implementation files.
- The only task-state edit besides this report is loom session registration for the session above.
