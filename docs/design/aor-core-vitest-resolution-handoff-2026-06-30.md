# AOR core vitest resolution handoff

Date: 2026-06-30

Status: Action required (cross-agent coordination)

From: kiro (cost-accounting / non-embedded credit-usage wiring)

To: `cursor-agent` (model-entitlement-chain / policy-engine owner) and `cursor-builder` (vitest.config.ts owner, builder-decommission)

---

## 1. Symptom

Any server-side vitest test whose import graph reaches the commercial run gate fails to load with:

```
Error: Cannot find package '@openbot/aor-core' imported from
src/gateway/model-entitlement/aor-selection.ts
  code: 'ERR_MODULE_NOT_FOUND'
```

Confirmed on `src/gateway/supervisor/worker-executor.test.ts` (its pre-existing cases fail too, not just new ones). It almost certainly affects every test that loads the chain below, so the blast radius is broad (billing / gateway commercial gate tests).

The failing import chain:

```
commercial-run-gate.ts
  -> agent-run-governance.ts
    -> authorize-commercial-run.ts
      -> employee-model-gate.ts
        -> aor-selection.ts
          -> @openbot/aor-core   (unresolved at vitest runtime)
```

## 2. Root cause

The in-process AOR selection integration (`src/gateway/model-entitlement/aor-selection.ts`, added by model-entitlement-chain task 13 "AOR selection") imports `@openbot/aor-core`.

- `tsconfig.json` HAS the path mapping, so `pnpm tsgo` resolves it and type-check passes:
  - `tsconfig.json` lines 27 to 31: `@openbot/aor-core`, `@openbot/aor-backend-openbot`, `@openbot/aor-backend-stub`, `@openbot/aor-backend-graph`, `@openbot/aor-sdk-node`.
- `vitest.config.ts` `resolve.alias` does NOT have an entry for `@openbot/aor-core` (or any `@openbot/aor-*`). It only aliases `@openbot/collaboration-core`, `@openbot/collaboration-runtime`, `@openbot/collaboration-openbot-adapter`.
- `@openbot/aor-core` is also not a declared `package.json` dependency of the root workspace, so pnpm does not symlink `node_modules/@openbot/aor-core` (verified: `node_modules/@openbot/` does not exist; `require.resolve('@openbot/aor-core')` returns `MODULE_NOT_FOUND`; two clean `pnpm install` runs did not create it).

Net: tsgo resolves via tsconfig paths, but vitest has no alias and no node link, so it cannot resolve the package at test runtime.

This is an incomplete integration: the tsconfig path was added without the matching vitest alias. The repo convention for `src/`-consumed workspace packages is tsconfig path plus vitest alias (see how `@openbot/collaboration-*` are wired), not a `package.json` dependency.

## 3. Ownership

- `src/gateway/model-entitlement/**` (incl. `aor-selection.ts`, `employee-model-gate.ts`) is model-entitlement-chain work, owner `cursor-agent` (loom task `policy-engine:cursor-agent`).
- `vitest.config.ts` is owned by `cursor-builder` (loom task `builder-decommission:cursor-builder`).
- The AOR packages plus `tsconfig.json` and `package.json` sit in the loom `AOR` landing stream (exclusive).

Because the runtime dependency was introduced by the model-entitlement work but the fix file (`vitest.config.ts`) is owned by builder-decommission, this needs coordination between the two owners.

## 4. Fix (preferred: mirror the collaboration alias pattern)

Add to the `resolve.alias` array in `vitest.config.ts`, mirroring the existing `@openbot/collaboration-*` entries:

```ts
{
  find: "@openbot/aor-core",
  replacement: path.join(repoRoot, "packages", "aor-core", "src", "index.ts"),
},
```

Add aliases for any other `@openbot/aor-*` packages reachable from `src/` (or from test import graphs). Today only `@openbot/aor-core` is imported under `src/` (via `aor-selection.ts`); the rest are consumed only inside `packages/aor-*`. Keep this alias list in sync with the `tsconfig.json` paths (lines 27 to 31) so tsgo and vitest agree.

## 5. Alternative (also fixes prod and node runtime resolution)

Declare the dependency so pnpm links it, which resolves for node runtime, build, and vitest without an alias:

```jsonc
// package.json (root) dependencies
"@openbot/aor-core": "workspace:*"
```

This is more robust for runtime resolution, but diverges from the current `@openbot/collaboration-*` convention (those use tsconfig path plus vitest alias, no package.json dep). Pick one approach and apply it consistently.

## 6. Verify

```bash
OPENBOT_TEST_PROFILE=low pnpm test src/gateway/supervisor/worker-executor.test.ts
```

Should load without `ERR_MODULE_NOT_FOUND`. Then sanity-check other commercial-gate consumers (authorize-commercial-run, agent-run-governance) and run `pnpm tsgo` to confirm types still resolve.

## 7. Notes

- No `tsconfig.json` change is needed; its paths are already correct.
- This is independent of the cron credit-usage wiring landed alongside this report. That cron change passes its tests because its test harness mocks `agent-run-governance`, so it never loads the AOR chain.
- Two unrelated pre-existing type errors live in the same area and are owned elsewhere (confirmed not part of the cron change via `git diff`): `logWarn` call shape at `src/cron/isolated-agent/run.ts:593`, and `usage.reported` not assignable to `BillingDomainEvent` at `src/gateway/billing/record-credit-usage.ts:338` and `:365`. These suggest in-flight changes to the logger signature and the billing event type union. Flagging so the owners can close them; they also keep `pnpm tsgo` red until resolved.
