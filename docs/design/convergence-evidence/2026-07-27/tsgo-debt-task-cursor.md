# Task: clear the cursor share of trunk type debt

**Scope:** 31 files, 69 `tsgo` errors on `origin/main`.
**Source of truth:** CI Gate run `30333105158`, job `check (types, lint, format)`, step `pnpm tsgo`, at `cc1bf25d38`.
**Full picture:** `docs/design/convergence-evidence/2026-07-27/tsgo-debt-buckets.md`

## Why this matters now

`pnpm check` is a serial chain of 20 gates. `tsgo` is gate 4, so **`lint` and the 16 lint gates behind
it have still never run on this trunk.** Every error in your bucket is blocking that, and blocking the
moment `check` can become a required status check.

These errors are not new carelessness. The repository had **zero completed CI runs for about two
months** because 30 of its 34 job definitions target a runner provider it never subscribed to. The gate
that should have caught these at commit time did not exist in practice. No blame attaches; the work
still has to be done.

### Expect this to be the slowest bucket

31 files, 69 errors, **no cluster**. There is no single high-leverage edit here: the debt is
assignability and property-existence drift spread across enterprise-data, knowledge sources, billing
and operational identity. Budget per-file, not per-cluster.

Largest single file is `src/gateway/server-methods/enterprise-data-m1.ts` at 9 errors; next is
`src/conversations/conversation-lifecycle.archive-cw-retry.test.ts` at 8.

**Nine of your files are low-confidence attributions** (marked `branch?:` below). They resolved via
`cursor-main-recovery/fold-forward-tier2`, a fold-forward branch that re-lands other agents' work, so
the vendor there is the lander and not necessarily the author. If you open one and it is clearly not
cursor's code, say so in the tracking issue and hand it back rather than guessing.

## Rules

1. **Fix root causes.** `@ts-nocheck` is forbidden. Do not disable `no-explicit-any`. Do not introduce
   `any`, and do not silence an error with a cast unless you can state why the cast is sound.
2. **Stay in your bucket.** If the root cause lives in a file belonging to another bucket, do **not**
   edit it. Record the cross-bucket dependency in the tracking issue and stop at your boundary.
3. **Work in an isolated worktree**, branched from `main`. Do not work in the shared main worktree - it
   currently carries ~200 dirty paths from other agents.
4. **Sign in before working:** `pnpm loom register --task <spec>:<owner> --owner <you> --session-id
$(uuidgen) --ide <ide> --agent <you>`, with `paths:` covering the files you will touch.
5. **Sign every commit** with `Task:` and `Agent:` trailers. Commit with
   `scripts/committer "<msg>" <file...>`; never `git add .`.
6. **One PR against `main`.** `main` accepts changes only through a pull request - direct pushes return
   `GH013` and the `POST /merges` API returns `409`.
7. **Run `pnpm format:fix` before committing.** The trunk was just brought to a clean `oxfmt` state; do
   not reintroduce drift.
8. **No behaviour changes.** This is a type-correctness task. If a fix requires changing runtime
   behaviour, that is a separate PR with its own justification.

## Reproduce locally

```bash
pnpm build:collaboration:packages   # required first: skipping it invents 64 phantom TS2307 errors
pnpm tsgo 2>&1 | tee /tmp/tsgo.txt
```

## Definition of done

Your bucket's files produce **zero** `tsgo` errors. `pnpm check` may still fail on the other buckets;
that is expected and is not your gate.

Save this list as `/tmp/cursor-files.txt`:

```
src/gateway/server-methods/enterprise-data-m1.ts
src/conversations/conversation-lifecycle.archive-cw-retry.test.ts
ui/src/ui/capability/ai-workforce-governance/pages/actions-page.browser.test.ts
ui/src/ui/app-render.ts
src/gateway/billing/phase2-payg-stages.test.ts
ui/src/ui/controllers/enterprise-organization-monthly-usage.node.test.ts
src/gateway/enterprise-operational-identity.ts
src/gateway/knowledge/agent-knowledge-generation-runtime.ts
src/gateway/knowledge/kb-ingest.test.ts
src/gateway/knowledge/sources/local-folder-watcher.test.ts
src/gateway/server-methods/model-entitlement-management.ts
src/gateway/server-methods/user-operational-identity.ts
ui/src/ui/controllers/knowledge-universe-passive-connector.ts
ui/src/ui/controllers/knowledge-universe-workspace.ts
src/gateway/auth.test.ts
src/gateway/collaboration-learning/collaboration-satisfaction.test.ts
src/gateway/evolution-governance/skill-auto-evolution.ts
src/gateway/knowledge/sources/cloud-drive/baidu-oauth-http.ts
src/gateway/knowledge/sources/local-folder-binding-store.ts
src/gateway/server-methods/billing.ts
src/gateway/server-methods/enterprise-data-m6.ts
src/gateway/server-methods/enterprise-memory-governance.test.ts
src/gateway/server-node-events.ts
src/gateway/user-operational-identity-oauth.test.ts
src/gateway/user-operational-identity-oauth.ts
src/organization/mention-task-converter.ts
ui/src/ui/controllers/knowledge-universe-vault-sync.ts
ui/src/ui/gateway-subscriptions/agent-growth.ts
ui/src/ui/ports/enterprise/views/enterprise-organization-activation.browser.test.ts
ui/src/ui/ports/enterprise/views/enterprise-organization-surface.ts
ui/src/ui/ports/platform/pricing/plan-form-helpers.node.test.ts
```

Then:

```bash
pnpm build:collaboration:packages && pnpm tsgo 2>&1 \
  | grep -F -f /tmp/cursor-files.txt \
  | grep -c 'error TS'   # must print 0
```

Also required before opening the PR:

- `pnpm format:check` clean
- tests covering the files you changed pass (`pnpm vitest run <paths>`; use
  `OPENBOT_TEST_PROFILE=low` if memory-constrained)
- the error count for the **other** buckets has not increased

## Your files

| errors | file                                                                                  | attribution                                       |
| ------ | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 9      | `src/gateway/server-methods/enterprise-data-m1.ts`                                    | `branch?:cursor-main-recovery/fold-forward-tier2` |
| 8      | `src/conversations/conversation-lifecycle.archive-cw-retry.test.ts`                   | `trailer:cursor-conversation-lifecycle`           |
| 7      | `ui/src/ui/capability/ai-workforce-governance/pages/actions-page.browser.test.ts`     | `trailer:cursor-evolution-closure`                |
| 5      | `ui/src/ui/app-render.ts`                                                             | `loom:cursor-builder`                             |
| 4      | `src/gateway/billing/phase2-payg-stages.test.ts`                                      | `loom:cursor-main-recovery`                       |
| 3      | `ui/src/ui/controllers/enterprise-organization-monthly-usage.node.test.ts`            | `branch?:cursor-main-recovery/fold-forward-tier2` |
| 2      | `src/gateway/enterprise-operational-identity.ts`                                      | `branch?:cursor-main-recovery/fold-forward-tier2` |
| 2      | `src/gateway/knowledge/agent-knowledge-generation-runtime.ts`                         | `trailer:cursor-fable`                            |
| 2      | `src/gateway/knowledge/kb-ingest.test.ts`                                             | `branch?:cursor-main-recovery/fold-forward-tier2` |
| 2      | `src/gateway/knowledge/sources/local-folder-watcher.test.ts`                          | `branch?:cursor-main-recovery/fold-forward-tier2` |
| 2      | `src/gateway/server-methods/model-entitlement-management.ts`                          | `trailer:cursor-enterprise-model-gov`             |
| 2      | `src/gateway/server-methods/user-operational-identity.ts`                             | `trailer:cursor-auth-ui`                          |
| 2      | `ui/src/ui/controllers/knowledge-universe-passive-connector.ts`                       | `branch?:cursor-main-recovery/fold-forward-tier2` |
| 2      | `ui/src/ui/controllers/knowledge-universe-workspace.ts`                               | `trailer:cursor-vault-sync`                       |
| 1      | `src/gateway/auth.test.ts`                                                            | `trailer:cursor-canvas`                           |
| 1      | `src/gateway/collaboration-learning/collaboration-satisfaction.test.ts`               | `trailer:cursor-evolution-closure`                |
| 1      | `src/gateway/evolution-governance/skill-auto-evolution.ts`                            | `trailer:cursor-evolution-closure`                |
| 1      | `src/gateway/knowledge/sources/cloud-drive/baidu-oauth-http.ts`                       | `trailer:cursor-conversation-lifecycle`           |
| 1      | `src/gateway/knowledge/sources/local-folder-binding-store.ts`                         | `branch?:cursor-main-recovery/fold-forward-tier2` |
| 1      | `src/gateway/server-methods/billing.ts`                                               | `loom:cursor-phase5`                              |
| 1      | `src/gateway/server-methods/enterprise-data-m6.ts`                                    | `trailer:cursor-fable`                            |
| 1      | `src/gateway/server-methods/enterprise-memory-governance.test.ts`                     | `trailer:cursor-conversation-lifecycle`           |
| 1      | `src/gateway/server-node-events.ts`                                                   | `trailer:cursor-fable`                            |
| 1      | `src/gateway/user-operational-identity-oauth.test.ts`                                 | `branch?:cursor-main-recovery/fold-forward-tier2` |
| 1      | `src/gateway/user-operational-identity-oauth.ts`                                      | `trailer:cursor-auth-ui`                          |
| 1      | `src/organization/mention-task-converter.ts`                                          | `branch?:cursor-main-recovery/fold-forward-tier2` |
| 1      | `ui/src/ui/controllers/knowledge-universe-vault-sync.ts`                              | `trailer:cursor-vault-sync`                       |
| 1      | `ui/src/ui/gateway-subscriptions/agent-growth.ts`                                     | `trailer:cursor-evolution-closure`                |
| 1      | `ui/src/ui/ports/enterprise/views/enterprise-organization-activation.browser.test.ts` | `loom:cursor-composer`                            |
| 1      | `ui/src/ui/ports/enterprise/views/enterprise-organization-surface.ts`                 | `loom:cursor-composer`                            |
| 1      | `ui/src/ui/ports/platform/pricing/plan-form-helpers.node.test.ts`                     | `loom:cursor-agent`                               |

Entries marked `branch?:` are **low-confidence** attributions: they resolved through a fold-forward
branch, which re-lands other agents' work, so the vendor is the lander rather than the author. If one
is clearly not yours, hand it back instead of guessing.

## Errors, verbatim

### `src/gateway/server-methods/enterprise-data-m1.ts` - 9

```
src/gateway/server-methods/enterprise-data-m1.ts(386,31): error TS2554: Expected 3 arguments, but got 2.
src/gateway/server-methods/enterprise-data-m1.ts(386,74): error TS7006: Parameter 'store' implicitly has an 'any' type.
src/gateway/server-methods/enterprise-data-m1.ts(548,30): error TS2554: Expected 3 arguments, but got 2.
src/gateway/server-methods/enterprise-data-m1.ts(548,73): error TS7006: Parameter 'store' implicitly has an 'any' type.
src/gateway/server-methods/enterprise-data-m1.ts(561,13): error TS18046: 'result' is of type 'unknown'.
src/gateway/server-methods/enterprise-data-m1.ts(567,52): error TS18046: 'result' is of type 'unknown'.
src/gateway/server-methods/enterprise-data-m1.ts(568,32): error TS18046: 'result' is of type 'unknown'.
src/gateway/server-methods/enterprise-data-m1.ts(568,54): error TS18046: 'result' is of type 'unknown'.
src/gateway/server-methods/enterprise-data-m1.ts(568,76): error TS18046: 'result' is of type 'unknown'.
```

### `src/conversations/conversation-lifecycle.archive-cw-retry.test.ts` - 8

```
src/conversations/conversation-lifecycle.archive-cw-retry.test.ts(116,23): error TS2352: Conversion of type 'undefined' to type '{ mode: string; operationId: string; }' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
src/conversations/conversation-lifecycle.archive-cw-retry.test.ts(116,53): error TS2493: Tuple type '[]' of length '0' has no element at index '0'.
src/conversations/conversation-lifecycle.archive-cw-retry.test.ts(131,24): error TS2352: Conversion of type 'undefined' to type '{ mode: string; operationId: string; }' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
src/conversations/conversation-lifecycle.archive-cw-retry.test.ts(131,54): error TS2493: Tuple type '[]' of length '0' has no element at index '0'.
src/conversations/conversation-lifecycle.archive-cw-retry.test.ts(162,23): error TS2352: Conversion of type 'undefined' to type '{ mode: string; operationId: string; }' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
src/conversations/conversation-lifecycle.archive-cw-retry.test.ts(162,53): error TS2493: Tuple type '[]' of length '0' has no element at index '0'.
src/conversations/conversation-lifecycle.archive-cw-retry.test.ts(181,24): error TS2352: Conversion of type 'undefined' to type '{ mode: string; operationId: string; }' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
src/conversations/conversation-lifecycle.archive-cw-retry.test.ts(181,54): error TS2493: Tuple type '[]' of length '0' has no element at index '0'.
```

### `ui/src/ui/capability/ai-workforce-governance/pages/actions-page.browser.test.ts` - 7

```
ui/src/ui/capability/ai-workforce-governance/pages/actions-page.browser.test.ts(83,16): error TS2339: Property 'updateComplete' does not exist on type 'HTMLElement'.
ui/src/ui/capability/ai-workforce-governance/pages/actions-page.browser.test.ts(93,16): error TS2339: Property 'updateComplete' does not exist on type 'HTMLElement'.
ui/src/ui/capability/ai-workforce-governance/pages/actions-page.browser.test.ts(130,16): error TS2339: Property 'updateComplete' does not exist on type 'HTMLElement'.
ui/src/ui/capability/ai-workforce-governance/pages/actions-page.browser.test.ts(142,16): error TS2339: Property 'updateComplete' does not exist on type 'HTMLElement'.
ui/src/ui/capability/ai-workforce-governance/pages/actions-page.browser.test.ts(165,7): error TS2322: Type '{ agentId: string; candidateId: string; suggestedName: string; suggestedSummary: string; overallConfidence: number; sampleCount: number; status: string; }' is not assignable to type 'never'.
ui/src/ui/capability/ai-workforce-governance/pages/actions-page.browser.test.ts(193,16): error TS2339: Property 'updateComplete' does not exist on type 'HTMLElement'.
ui/src/ui/capability/ai-workforce-governance/pages/actions-page.browser.test.ts(206,16): error TS2339: Property 'updateComplete' does not exist on type 'HTMLElement'.
```

### `ui/src/ui/app-render.ts` - 5

```
ui/src/ui/app-render.ts(854,68): error TS2345: Argument of type 'AppViewState' is not assignable to parameter of type 'AppPortState'.
ui/src/ui/app-render.ts(1017,38): error TS2345: Argument of type 'AppViewState' is not assignable to parameter of type 'AppPortState'.
ui/src/ui/app-render.ts(1017,84): error TS2339: Property 'requestUpdate' does not exist on type 'AppViewState'.
ui/src/ui/app-render.ts(1020,43): error TS2345: Argument of type 'AppViewState' is not assignable to parameter of type 'AppPortState'.
ui/src/ui/app-render.ts(1020,62): error TS2339: Property 'requestUpdate' does not exist on type 'AppViewState'.
```

### `src/gateway/billing/phase2-payg-stages.test.ts` - 4

```
src/gateway/billing/phase2-payg-stages.test.ts(156,7): error TS2353: Object literal may only specify known properties, and 'subscriptions' does not exist in type '{ plans?: string | undefined; entitlementSnapshot?: string | undefined; modelBinding?: string | undefined; runtimeSnapshots?: string | undefined; }'.
src/gateway/billing/phase2-payg-stages.test.ts(505,9): error TS2353: Object literal may only specify known properties, and 'subscriptions' does not exist in type '{ plans?: string | undefined; entitlementSnapshot?: string | undefined; modelBinding?: string | undefined; runtimeSnapshots?: string | undefined; }'.
src/gateway/billing/phase2-payg-stages.test.ts(617,9): error TS2353: Object literal may only specify known properties, and 'subscriptions' does not exist in type '{ plans?: string | undefined; entitlementSnapshot?: string | undefined; modelBinding?: string | undefined; runtimeSnapshots?: string | undefined; }'.
src/gateway/billing/phase2-payg-stages.test.ts(721,9): error TS2353: Object literal may only specify known properties, and 'subscriptions' does not exist in type '{ plans?: string | undefined; entitlementSnapshot?: string | undefined; modelBinding?: string | undefined; runtimeSnapshots?: string | undefined; }'.
```

### `ui/src/ui/controllers/enterprise-organization-monthly-usage.node.test.ts` - 3

```
ui/src/ui/controllers/enterprise-organization-monthly-usage.node.test.ts(104,7): error TS2741: Property 'users' is missing in type '{ tenantId: string; startDate: string; endDate: string; agents: never[]; seats: never[]; unmatchedAgentIds: never[]; }' but required in type '{ tenantId: string; startDate: string; endDate: string; agents: ({ agentId: string; } & OrganizationAgentUsageSlice)[]; users: OrganizationMonthlyUserUsageRow[]; seats: OrganizationMonthlySeatUsageRow[]; unmatchedAgentIds: string[]; }'.
ui/src/ui/controllers/enterprise-organization-monthly-usage.node.test.ts(130,7): error TS2741: Property 'users' is missing in type '{ tenantId: string; startDate: string; endDate: string; agents: never[]; seats: never[]; unmatchedAgentIds: never[]; }' but required in type '{ tenantId: string; startDate: string; endDate: string; agents: ({ agentId: string; } & OrganizationAgentUsageSlice)[]; users: OrganizationMonthlyUserUsageRow[]; seats: OrganizationMonthlySeatUsageRow[]; unmatchedAgentIds: string[]; }'.
ui/src/ui/controllers/enterprise-organization-monthly-usage.node.test.ts(158,7): error TS2741: Property 'users' is missing in type '{ tenantId: string; startDate: string; endDate: string; agents: never[]; seats: never[]; unmatchedAgentIds: never[]; }' but required in type '{ tenantId: string; startDate: string; endDate: string; agents: ({ agentId: string; } & OrganizationAgentUsageSlice)[]; users: OrganizationMonthlyUserUsageRow[]; seats: OrganizationMonthlySeatUsageRow[]; unmatchedAgentIds: string[]; }'.
```

### `src/gateway/enterprise-operational-identity.ts` - 2

```
src/gateway/enterprise-operational-identity.ts(256,59): error TS2304: Cannot find name 'context'.
src/gateway/enterprise-operational-identity.ts(376,79): error TS2304: Cannot find name 'context'.
```

### `src/gateway/knowledge/agent-knowledge-generation-runtime.ts` - 2

```
src/gateway/knowledge/agent-knowledge-generation-runtime.ts(52,22): error TS2554: Expected 1 arguments, but got 0.
src/gateway/knowledge/agent-knowledge-generation-runtime.ts(79,24): error TS2554: Expected 1 arguments, but got 0.
```

### `src/gateway/knowledge/kb-ingest.test.ts` - 2

```
src/gateway/knowledge/kb-ingest.test.ts(196,14): error TS18048: 'v2.chunkDelta.updated' is possibly 'undefined'.
src/gateway/knowledge/kb-ingest.test.ts(196,39): error TS18048: 'v2.chunkDelta.added' is possibly 'undefined'.
```

### `src/gateway/knowledge/sources/local-folder-watcher.test.ts` - 2

```
src/gateway/knowledge/sources/local-folder-watcher.test.ts(97,33): error TS2493: Tuple type '[]' of length '0' has no element at index '0'.
src/gateway/knowledge/sources/local-folder-watcher.test.ts(97,37): error TS2339: Property 'binding' does not exist on type 'never'.
```

### `src/gateway/server-methods/model-entitlement-management.ts` - 2

```
src/gateway/server-methods/model-entitlement-management.ts(325,11): error TS2322: Type 'RespondFn' is not assignable to type '(ok: boolean, payload?: unknown, error?: unknown) => void'.
src/gateway/server-methods/model-entitlement-management.ts(423,11): error TS2322: Type 'RespondFn' is not assignable to type '(ok: boolean, payload?: unknown, error?: unknown) => void'.
```

### `src/gateway/server-methods/user-operational-identity.ts` - 2

```
src/gateway/server-methods/user-operational-identity.ts(121,10): error TS2304: Cannot find name 'resolveTrustedUserOperationalIdentityAgentScope'.
src/gateway/server-methods/user-operational-identity.ts(1016,23): error TS18047: 'ctx' is possibly 'null'.
```

### `ui/src/ui/controllers/knowledge-universe-passive-connector.ts` - 2

```
ui/src/ui/controllers/knowledge-universe-passive-connector.ts(80,27): error TS2722: Cannot invoke an object which is possibly 'undefined'.
ui/src/ui/controllers/knowledge-universe-passive-connector.ts(103,36): error TS2554: Expected 1 arguments, but got 2.
```

### `ui/src/ui/controllers/knowledge-universe-workspace.ts` - 2

```
ui/src/ui/controllers/knowledge-universe-workspace.ts(1401,7): error TS2367: This comparison appears to be unintentional because the types '"note" | "url" | null' and '"dataset"' have no overlap.
ui/src/ui/controllers/knowledge-universe-workspace.ts(1421,7): error TS2367: This comparison appears to be unintentional because the types '"url" | null' and '"file"' have no overlap.
```

### `src/gateway/auth.test.ts` - 1

```
src/gateway/auth.test.ts(608,53): error TS2322: Type 'null' is not assignable to type 'string | undefined'.
```

### `src/gateway/collaboration-learning/collaboration-satisfaction.test.ts` - 1

```
src/gateway/collaboration-learning/collaboration-satisfaction.test.ts(189,63): error TS2741: Property 'title' is missing in type '{ deliverableId: string; groupId: string; status: "approved"; submittedBy: string; version: number; createdAtMs: number; updatedAtMs: number; }' but required in type 'Deliverable'.
```

### `src/gateway/evolution-governance/skill-auto-evolution.ts` - 1

```
src/gateway/evolution-governance/skill-auto-evolution.ts(568,66): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
```

### `src/gateway/knowledge/sources/cloud-drive/baidu-oauth-http.ts` - 1

```
src/gateway/knowledge/sources/cloud-drive/baidu-oauth-http.ts(191,11): error TS2353: Object literal may only specify known properties, and 'credentials' does not exist in type 'PassiveConnectorBindRequest'.
```

### `src/gateway/knowledge/sources/local-folder-binding-store.ts` - 1

```
src/gateway/knowledge/sources/local-folder-binding-store.ts(161,59): error TS18048: 'params.sourceDescriptorId' is possibly 'undefined'.
```

### `src/gateway/server-methods/billing.ts` - 1

```
src/gateway/server-methods/billing.ts(184,49): error TS2304: Cannot find name 'client'.
```

### `src/gateway/server-methods/enterprise-data-m6.ts` - 1

```
src/gateway/server-methods/enterprise-data-m6.ts(384,11): error TS2552: Cannot find name 'ensureConnectorPackage'. Did you mean 'ensureConnectorDemoPackage'?
```

### `src/gateway/server-methods/enterprise-memory-governance.test.ts` - 1

```
src/gateway/server-methods/enterprise-memory-governance.test.ts(38,5): error TS2322: Type '"active"' is not assignable to type 'EnterpriseSeatStatus'.
```

### `src/gateway/server-node-events.ts` - 1

```
src/gateway/server-node-events.ts(138,45): error TS2304: Cannot find name 'loadSessionEntry'.
```

### `src/gateway/user-operational-identity-oauth.test.ts` - 1

```
src/gateway/user-operational-identity-oauth.test.ts(192,5): error TS2322: Type '{ sessionId: string; state: string; ownerId: string; tenantId: string; provider: "github-personal"; mode: "github_authorization_code"; status: "pending"; createdAt: string; expiresAt: string; }' is not assignable to type 'UserOperationalIdentityOAuthSession'.
```

### `src/gateway/user-operational-identity-oauth.ts` - 1

```
src/gateway/user-operational-identity-oauth.ts(64,5): error TS2322: Type 'string | null' is not assignable to type 'string'.
```

### `src/organization/mention-task-converter.ts` - 1

```
src/organization/mention-task-converter.ts(48,5): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
```

### `ui/src/ui/controllers/knowledge-universe-vault-sync.ts` - 1

```
ui/src/ui/controllers/knowledge-universe-vault-sync.ts(1040,9): error TS2561: Object literal may only specify known properties, but 'invitedByAccountId' does not exist in type '{ inviteId: string; inviteeAccountId?: string | null | undefined; role?: string | undefined; status?: string | undefined; expiresAt?: string | undefined; }'. Did you mean to write 'inviteeAccountId'?
```

### `ui/src/ui/gateway-subscriptions/agent-growth.ts` - 1

```
ui/src/ui/gateway-subscriptions/agent-growth.ts(29,60): error TS2339: Property 'sessionKey' does not exist on type 'GrowthSessionSyncHost'.
```

### `ui/src/ui/ports/enterprise/views/enterprise-organization-activation.browser.test.ts` - 1

```
ui/src/ui/ports/enterprise/views/enterprise-organization-activation.browser.test.ts(23,10): error TS2352: Conversion of type '{ currentTenantId: string; currentTenantLabel: string; authenticatedUser: string; membershipRole: string; memberCount: number; memberUsers: string[]; memberSummaries: never[]; adminCount: number; ... 29 more ...; configIssueLabels: never[]; }' to type 'EnterprisePortReadModel' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
```

### `ui/src/ui/ports/enterprise/views/enterprise-organization-surface.ts` - 1

```
ui/src/ui/ports/enterprise/views/enterprise-organization-surface.ts(5021,5): error TS2322: Type '{ tenantId: string; startDate: string; endDate: string; agents: { agentId: string; totalTokens: number; totalCost: number; sessionCount: number; lastActiveAt: number | null; }[]; seats: { seatId: string; ... 5 more ...; unmatchedAgentIds: string[]; }[]; unmatchedAgentIds: string[]; } | null' is not assignable to type '{ tenantId: string; startDate: string; endDate: string; agents: ({ agentId: string; } & OrganizationAgentUsageSlice)[]; users: OrganizationMonthlyUserUsageRow[]; seats: OrganizationMonthlySeatUsageRow[]; unmatchedAgentIds: string[]; } | null'.
```

### `ui/src/ui/ports/platform/pricing/plan-form-helpers.node.test.ts` - 1

```
ui/src/ui/ports/platform/pricing/plan-form-helpers.node.test.ts(58,52): error TS2739: Type '{ monthlyCredits: string; maxConcurrentRuns: string; maxWorkflows: string; maxKnowledgeBases: string; overagePolicyType: "credits_only"; allowBurstConcurrency: true; allowedTiers: string[]; ... 7 more ...; allowCustomPolicy: false; }' is missing the following properties from type 'EntitlementEditor': aiBasic, aiPro, aiElite
```
