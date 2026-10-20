# Task: clear the codex share of trunk type debt

**Scope:** 15 files, 59 `tsgo` errors on `origin/main`.
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

### Start here: one edit clears 23 of your 59 errors

`ui/src/ui/app-view-state-shell-slices.ts` accounts for 23 errors and they are **a single defect**.
Nine `enterprise-operational-identity` members are declared twice inside the same interface, at
roughly lines 1006-1063 and again 1107-1120. That is 18 `TS2300` duplicate-identifier plus 5 `TS2717`
redeclaration. The shape is a merge that applied the same hunk twice.

Delete the **second** block, keep the first, and confirm the two declarations were identical before
deleting - if they diverged, the newer field types have to be reconciled rather than dropped.

**This file is under active edit in the shared worktree.** Coordinate before touching it; do not land
a drive-by fix on top of someone's WIP.

After that, 8 of your remaining errors are `TS7006` (parameter implicitly `any`), which are
annotation work, not redesign.

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

Save this list as `/tmp/codex-files.txt`:

```
ui/src/ui/app-view-state-shell-slices.ts
ui/src/ui/ports/employee/render-model-memory-center.ts
ui/src/ui/ports/employee/render-model.ts
src/conversations/source-identity-migration.ts
ui/src/ui/ports/employee/views/memory-center-page.ts
src/conversations/managed-planes.test.ts
src/conversations/memory-admission.ts
src/conversations/purge/real-adapters.ts
ui/src/ui/views/cost-budget-v2/pages/settings-page.browser.test.ts
src/conversations/catalog/sqlite-catalog.ts
src/conversations/cogniweave-bridge.ts
ui/src/ui/ports/employee/conversation-lifecycle-wire.ts
ui/src/ui/ports/employee/employee-workbench-agent-scope.node.test.ts
ui/src/ui/ports/employee/views/workbench-enterprise-operational-identity-section.ts
ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts
```

Then:

```bash
pnpm build:collaboration:packages && pnpm tsgo 2>&1 \
  | grep -F -f /tmp/codex-files.txt \
  | grep -c 'error TS'   # must print 0
```

Also required before opening the PR:

- `pnpm format:check` clean
- tests covering the files you changed pass (`pnpm vitest run <paths>`; use
  `OPENBOT_TEST_PROFILE=low` if memory-constrained)
- the error count for the **other** buckets has not increased

## Your files

| errors | file                                                                                  | attribution                            |
| ------ | ------------------------------------------------------------------------------------- | -------------------------------------- |
| 23     | `ui/src/ui/app-view-state-shell-slices.ts`                                            | `loom:codex-v111-recovery`             |
| 11     | `ui/src/ui/ports/employee/render-model-memory-center.ts`                              | `loom:codex-v111-recovery`             |
| 5      | `ui/src/ui/ports/employee/render-model.ts`                                            | `loom:codex-v111-recovery`             |
| 3      | `src/conversations/source-identity-migration.ts`                                      | `trailer:codex-conversation-lifecycle` |
| 3      | `ui/src/ui/ports/employee/views/memory-center-page.ts`                                | `loom:codex-v111-recovery`             |
| 2      | `src/conversations/managed-planes.test.ts`                                            | `trailer:codex-conversation-lifecycle` |
| 2      | `src/conversations/memory-admission.ts`                                               | `trailer:codex-conversation-lifecycle` |
| 2      | `src/conversations/purge/real-adapters.ts`                                            | `trailer:codex-conversation-lifecycle` |
| 2      | `ui/src/ui/views/cost-budget-v2/pages/settings-page.browser.test.ts`                  | `loom:codex-v111-recovery`             |
| 1      | `src/conversations/catalog/sqlite-catalog.ts`                                         | `trailer:codex-conversation-lifecycle` |
| 1      | `src/conversations/cogniweave-bridge.ts`                                              | `trailer:codex-conversation-lifecycle` |
| 1      | `ui/src/ui/ports/employee/conversation-lifecycle-wire.ts`                             | `loom:codex-v111-recovery`             |
| 1      | `ui/src/ui/ports/employee/employee-workbench-agent-scope.node.test.ts`                | `loom:codex-v111-recovery`             |
| 1      | `ui/src/ui/ports/employee/views/workbench-enterprise-operational-identity-section.ts` | `loom:codex-v111-recovery`             |
| 1      | `ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts`        | `loom:codex-v111-recovery`             |

## Errors, verbatim

### `ui/src/ui/app-view-state-shell-slices.ts` - 23

```
ui/src/ui/app-view-state-shell-slices.ts(1006,3): error TS2300: Duplicate identifier 'loadEnterpriseIdentityCredentialEditPreview'.
ui/src/ui/app-view-state-shell-slices.ts(1032,3): error TS2300: Duplicate identifier 'upsertEnterpriseOperationalIdentityCredential'.
ui/src/ui/app-view-state-shell-slices.ts(1043,3): error TS2300: Duplicate identifier 'saveEnterpriseIdentityCredentialConfig'.
ui/src/ui/app-view-state-shell-slices.ts(1056,3): error TS2300: Duplicate identifier 'verifyEnterpriseOperationalIdentity'.
ui/src/ui/app-view-state-shell-slices.ts(1057,3): error TS2300: Duplicate identifier 'updateEnterpriseOperationalIdentity'.
ui/src/ui/app-view-state-shell-slices.ts(1062,3): error TS2300: Duplicate identifier 'openEnterpriseIdentityRevokeConfirm'.
ui/src/ui/app-view-state-shell-slices.ts(1063,3): error TS2300: Duplicate identifier 'closeEnterpriseIdentityRevokeConfirm'.
ui/src/ui/app-view-state-shell-slices.ts(1099,5): error TS2300: Duplicate identifier 'initialCredentialFields'.
ui/src/ui/app-view-state-shell-slices.ts(1100,5): error TS2300: Duplicate identifier 'initialSecretsConfigured'.
ui/src/ui/app-view-state-shell-slices.ts(1107,5): error TS2300: Duplicate identifier 'initialCredentialFields'.
ui/src/ui/app-view-state-shell-slices.ts(1108,5): error TS2300: Duplicate identifier 'initialSecretsConfigured'.
ui/src/ui/app-view-state-shell-slices.ts(1113,3): error TS2300: Duplicate identifier 'saveEnterpriseIdentityCredentialConfig'.
ui/src/ui/app-view-state-shell-slices.ts(1113,3): error TS2717: Subsequent property declarations must have the same type.  Property 'saveEnterpriseIdentityCredentialConfig' must be of type '(tenantId: string) => Promise<{ credentialBindingId: string; } | null>', but here has type '(tenantId: string) => Promise<void>'.
ui/src/ui/app-view-state-shell-slices.ts(1114,3): error TS2300: Duplicate identifier 'openEnterpriseIdentityRevokeConfirm'.
ui/src/ui/app-view-state-shell-slices.ts(1115,3): error TS2300: Duplicate identifier 'closeEnterpriseIdentityRevokeConfirm'.
ui/src/ui/app-view-state-shell-slices.ts(1116,3): error TS2300: Duplicate identifier 'verifyEnterpriseOperationalIdentity'.
ui/src/ui/app-view-state-shell-slices.ts(1116,3): error TS2717: Subsequent property declarations must have the same type.  Property 'verifyEnterpriseOperationalIdentity' must be of type '(tenantId: string, identityId: string) => Promise<unknown>', but here has type '(tenantId: string, identityId: string) => Promise<boolean>'.
ui/src/ui/app-view-state-shell-slices.ts(1117,3): error TS2300: Duplicate identifier 'loadEnterpriseIdentityCredentialEditPreview'.
ui/src/ui/app-view-state-shell-slices.ts(1117,3): error TS2717: Subsequent property declarations must have the same type.  Property 'loadEnterpriseIdentityCredentialEditPreview' must be of type '(tenantId: string, identityId: string) => Promise<{ fields: Record<string, string>; secretsConfigured: string[]; credentialBindingId?: string | undefined; externalAccountId?: string | undefined; } | null>', but here has type '(tenantId: string, identityId: string) => Promise<unknown>'.
ui/src/ui/app-view-state-shell-slices.ts(1121,3): error TS2300: Duplicate identifier 'upsertEnterpriseOperationalIdentityCredential'.
ui/src/ui/app-view-state-shell-slices.ts(1121,3): error TS2717: Subsequent property declarations must have the same type.  Property 'upsertEnterpriseOperationalIdentityCredential' must be of type '(tenantId: string, input: { connectorId: string; fields: Record<string, string>; allowMultiple?: boolean | undefined; credentialBindingId?: string | undefined; accountLabel?: string | undefined; externalAccountId?: string | undefined; }) => Promise<...>', but here has type '(tenantId: string, input: { connectorId: string; fields: Record<string, string>; credentialBindingId?: string | undefined; accountLabel?: string | undefined; }) => Promise<boolean>'.
ui/src/ui/app-view-state-shell-slices.ts(1130,3): error TS2300: Duplicate identifier 'updateEnterpriseOperationalIdentity'.
ui/src/ui/app-view-state-shell-slices.ts(1130,3): error TS2717: Subsequent property declarations must have the same type.  Property 'updateEnterpriseOperationalIdentity' must be of type '(tenantId: string, identityId: string, input: { displayName: string; }) => Promise<unknown>', but here has type '(tenantId: string, identityId: string, input: Record<string, unknown>) => Promise<boolean>'.
```

### `ui/src/ui/ports/employee/render-model-memory-center.ts` - 11

```
ui/src/ui/ports/employee/render-model-memory-center.ts(175,46): error TS18046: 'result' is of type 'unknown'.
ui/src/ui/ports/employee/render-model-memory-center.ts(176,13): error TS7006: Parameter 'row' implicitly has an 'any' type.
ui/src/ui/ports/employee/render-model-memory-center.ts(188,16): error TS7006: Parameter 'row' implicitly has an 'any' type.
ui/src/ui/ports/employee/render-model-memory-center.ts(189,20): error TS18046: 'result' is of type 'unknown'.
ui/src/ui/ports/employee/render-model-memory-center.ts(190,13): error TS7006: Parameter 'row' implicitly has an 'any' type.
ui/src/ui/ports/employee/render-model-memory-center.ts(191,16): error TS7006: Parameter 'row' implicitly has an 'any' type.
ui/src/ui/ports/employee/render-model-memory-center.ts(195,7): error TS18046: 'result' is of type 'unknown'.
ui/src/ui/ports/employee/render-model-memory-center.ts(195,38): error TS18046: 'result' is of type 'unknown'.
ui/src/ui/ports/employee/render-model-memory-center.ts(195,69): error TS18046: 'result' is of type 'unknown'.
ui/src/ui/ports/employee/render-model-memory-center.ts(196,11): error TS18046: 'result' is of type 'unknown'.
ui/src/ui/ports/employee/render-model-memory-center.ts(210,20): error TS7006: Parameter 'atom' implicitly has an 'any' type.
```

### `ui/src/ui/ports/employee/render-model.ts` - 5

```
ui/src/ui/ports/employee/render-model.ts(4732,5): error TS2561: Object literal may only specify known properties, but 'onLibraryWorkspacePassiveConnectorLocatorChange' does not exist in type 'WorkbenchKnowledgeSurface'. Did you mean to write 'libraryWorkspacePassiveConnectorLocator'?
ui/src/ui/ports/employee/render-model.ts(4732,55): error TS7006: Parameter 'value' implicitly has an 'any' type.
ui/src/ui/ports/employee/render-model.ts(4736,53): error TS7006: Parameter 'value' implicitly has an 'any' type.
ui/src/ui/ports/employee/render-model.ts(4740,36): error TS7006: Parameter 'kind' implicitly has an 'any' type.
ui/src/ui/ports/employee/render-model.ts(4741,58): error TS2345: Argument of type 'any' is not assignable to parameter of type 'never'.
```

### `src/conversations/source-identity-migration.ts` - 3

```
src/conversations/source-identity-migration.ts(209,22): error TS2339: Property 'dataPlaneId' does not exist on type 'SourceBinding'.
src/conversations/source-identity-migration.ts(211,25): error TS2339: Property 'sourceChecksum' does not exist on type 'SourceBinding'.
src/conversations/source-identity-migration.ts(342,23): error TS2339: Property 'sourceChecksum' does not exist on type 'SourceBinding'.
```

### `ui/src/ui/ports/employee/views/memory-center-page.ts` - 3

```
ui/src/ui/ports/employee/views/memory-center-page.ts(100,18): error TS2339: Property 'id' does not exist on type 'WorkbenchSettingsGroupEntry'.
ui/src/ui/ports/employee/views/memory-center-page.ts(101,18): error TS2339: Property 'name' does not exist on type 'WorkbenchSettingsGroupEntry'.
ui/src/ui/ports/employee/views/memory-center-page.ts(101,40): error TS2339: Property 'id' does not exist on type 'WorkbenchSettingsGroupEntry'.
```

### `src/conversations/managed-planes.test.ts` - 2

```
src/conversations/managed-planes.test.ts(67,61): error TS18047: 'a' is possibly 'null'.
src/conversations/managed-planes.test.ts(67,77): error TS2769: No overload matches this call.
```

### `src/conversations/memory-admission.ts` - 2

```
src/conversations/memory-admission.ts(43,7): error TS2740: Type 'Set<string>' is missing the following properties from type 'MemoryAdmissionSignalKind[]': length, pop, push, concat, and 30 more.
src/conversations/memory-admission.ts(117,60): error TS2339: Property 'has' does not exist on type 'MemoryAdmissionSignalKind[]'.
```

### `src/conversations/purge/real-adapters.ts` - 2

```
src/conversations/purge/real-adapters.ts(129,13): error TS2353: Object literal may only specify known properties, and 'tenantId' does not exist in type '{ cfg: OpenBotConfig; agentId: string; purpose?: "default" | "status" | undefined; }'.
src/conversations/purge/real-adapters.ts(338,15): error TS2353: Object literal may only specify known properties, and 'tenantId' does not exist in type '{ cfg: OpenBotConfig; agentId: string; purpose?: "default" | "status" | undefined; }'.
```

### `ui/src/ui/views/cost-budget-v2/pages/settings-page.browser.test.ts` - 2

```
ui/src/ui/views/cost-budget-v2/pages/settings-page.browser.test.ts(19,26): error TS2741: Property 'tenantId' is missing in type '{ client: null; readModel: never; activePanel: "budget"; onNavigate: () => void; onRefresh: () => void; }' but required in type 'SettingsPageOptions'.
ui/src/ui/views/cost-budget-v2/pages/settings-page.browser.test.ts(36,26): error TS2741: Property 'tenantId' is missing in type '{ client: null; readModel: never; activePanel: "budget"; onNavigate: () => void; onRefresh: () => void; }' but required in type 'SettingsPageOptions'.
```

### `src/conversations/catalog/sqlite-catalog.ts` - 1

```
src/conversations/catalog/sqlite-catalog.ts(373,44): error TS2345: Argument of type 'string | number | bigint | boolean | null' is not assignable to parameter of type 'SQLInputValue'.
```

### `src/conversations/cogniweave-bridge.ts` - 1

```
src/conversations/cogniweave-bridge.ts(47,7): error TS2353: Object literal may only specify known properties, and 'tenantId' does not exist in type '{ cfg: OpenBotConfig; agentId: string; purpose?: "default" | "status" | undefined; }'.
```

### `ui/src/ui/ports/employee/conversation-lifecycle-wire.ts` - 1

```
ui/src/ui/ports/employee/conversation-lifecycle-wire.ts(254,3): error TS2322: Type 'unique symbol | TemplateResult<1>' is not assignable to type 'TemplateResult | null'.
```

### `ui/src/ui/ports/employee/employee-workbench-agent-scope.node.test.ts` - 1

```
ui/src/ui/ports/employee/employee-workbench-agent-scope.node.test.ts(172,24): error TS2353: Object literal may only specify known properties, and 'name' does not exist in type 'Pick<GatewayAgentRow, "id" | "ownerId" | "scope">'.
```

### `ui/src/ui/ports/employee/views/workbench-enterprise-operational-identity-section.ts` - 1

```
ui/src/ui/ports/employee/views/workbench-enterprise-operational-identity-section.ts(36,35): error TS2537: Type 'EnterpriseAgentIdentityEntry[] | undefined' has no matching index signature for type 'number'.
```

### `ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts` - 1

```
ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts(467,5): error TS2322: Type '"spaceImport"' is not assignable to type 'KnowledgeUniversePageTab'.
```
