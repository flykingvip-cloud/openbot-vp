# Task: clear the kiro share of trunk type debt

**Scope:** 7 files, 22 `tsgo` errors on `origin/main`.
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

### Your debt is concentrated in one surface

18 of your 22 errors sit in four files on the knowledge-space-import surface. Five of them are
`TS2678` ("case type not comparable to switch type") plus two `TS2551` and one `TS2367`, which
together read as **a union type that lost members**: `SpaceImportKind` and/or
`KnowledgeUniversePageTab` no longer contain values the switch statements and comparisons still use.

Check that first. If the union is the root cause, fixing the type definition may clear most of the
four files at once. If the union is correct and the call sites are stale, the call sites move instead

- decide which side is right rather than casting to make the error disappear.

Two `TS2307` "cannot find module" also appear in your set; confirm they are not build-output paths
before treating them as missing source.

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

Save this list as `/tmp/kiro-files.txt`:

```
ui/src/ui/views/knowledge-universe-space-import.ts
ui/src/ui/controllers/knowledge-universe-local-folder.ts
ui/src/ui/views/knowledge-universe-space-import-passive-connector.ts
ui/src/ui/views/knowledge-universe-space-import.node.test.ts
src/gateway/agent-growth/background-recompute.test.ts
ui/src/ui/employee-shell/employee-embed-a11y.browser.test.ts
ui/src/ui/employee-shell/employee-embed-mobile.browser.test.ts
```

Then:

```bash
pnpm build:collaboration:packages && pnpm tsgo 2>&1 \
  | grep -F -f /tmp/kiro-files.txt \
  | grep -c 'error TS'   # must print 0
```

Also required before opening the PR:

- `pnpm format:check` clean
- tests covering the files you changed pass (`pnpm vitest run <paths>`; use
  `OPENBOT_TEST_PROFILE=low` if memory-constrained)
- the error count for the **other** buckets has not increased

## Your files

| errors | file                                                                   | attribution              |
| ------ | ---------------------------------------------------------------------- | ------------------------ |
| 7      | `ui/src/ui/views/knowledge-universe-space-import.ts`                   | `loom:kiro-web-ui`       |
| 4      | `ui/src/ui/controllers/knowledge-universe-local-folder.ts`             | `loom:kiro-web-ui`       |
| 4      | `ui/src/ui/views/knowledge-universe-space-import-passive-connector.ts` | `loom:kiro-web-ui`       |
| 3      | `ui/src/ui/views/knowledge-universe-space-import.node.test.ts`         | `loom:kiro-web-ui`       |
| 2      | `src/gateway/agent-growth/background-recompute.test.ts`                | `loom:kiro-agent-growth` |
| 1      | `ui/src/ui/employee-shell/employee-embed-a11y.browser.test.ts`         | `loom:kiro`              |
| 1      | `ui/src/ui/employee-shell/employee-embed-mobile.browser.test.ts`       | `loom:kiro`              |

## Errors, verbatim

### `ui/src/ui/views/knowledge-universe-space-import.ts` - 7

```
ui/src/ui/views/knowledge-universe-space-import.ts(135,7): error TS2367: This comparison appears to be unintentional because the types 'KnowledgeUniversePageTab' and '"spaceImport"' have no overlap.
ui/src/ui/views/knowledge-universe-space-import.ts(136,29): error TS2345: Argument of type '"spaceImport"' is not assignable to parameter of type 'KnowledgeUniversePageTab'.
ui/src/ui/views/knowledge-universe-space-import.ts(353,10): error TS2678: Type '"file"' is not comparable to type 'SpaceImportKind'.
ui/src/ui/views/knowledge-universe-space-import.ts(359,10): error TS2678: Type '"dataset"' is not comparable to type 'SpaceImportKind'.
ui/src/ui/views/knowledge-universe-space-import.ts(365,10): error TS2678: Type '"gitRepo"' is not comparable to type 'SpaceImportKind'.
ui/src/ui/views/knowledge-universe-space-import.ts(366,10): error TS2678: Type '"cloudDrive"' is not comparable to type 'SpaceImportKind'.
ui/src/ui/views/knowledge-universe-space-import.ts(367,10): error TS2678: Type '"mailAttachment"' is not comparable to type 'SpaceImportKind'.
```

### `ui/src/ui/controllers/knowledge-universe-local-folder.ts` - 4

```
ui/src/ui/controllers/knowledge-universe-local-folder.ts(171,27): error TS2339: Property 'cancelled' does not exist on type '{}'.
ui/src/ui/controllers/knowledge-universe-local-folder.ts(174,34): error TS2339: Property 'path' does not exist on type '{}'.
ui/src/ui/controllers/knowledge-universe-local-folder.ts(174,61): error TS2339: Property 'path' does not exist on type '{}'.
ui/src/ui/controllers/knowledge-universe-local-folder.ts(265,36): error TS2554: Expected 1 arguments, but got 2.
```

### `ui/src/ui/views/knowledge-universe-space-import-passive-connector.ts` - 4

```
ui/src/ui/views/knowledge-universe-space-import-passive-connector.ts(25,21): error TS2339: Property 'onBindPassiveConnector' does not exist on type 'WorkbenchKnowledgeSurface'.
ui/src/ui/views/knowledge-universe-space-import-passive-connector.ts(54,21): error TS2551: Property 'onLibraryWorkspacePassiveConnectorLocatorChange' does not exist on type 'WorkbenchKnowledgeSurface'. Did you mean 'libraryWorkspacePassiveConnectorLocator'?
ui/src/ui/views/knowledge-universe-space-import-passive-connector.ts(77,21): error TS2551: Property 'onLibraryWorkspacePassiveConnectorLabelChange' does not exist on type 'WorkbenchKnowledgeSurface'. Did you mean 'libraryWorkspacePassiveConnectorLabel'?
ui/src/ui/views/knowledge-universe-space-import-passive-connector.ts(90,39): error TS2339: Property 'onBindPassiveConnector' does not exist on type 'WorkbenchKnowledgeSurface'.
```

### `ui/src/ui/views/knowledge-universe-space-import.node.test.ts` - 3

```
ui/src/ui/views/knowledge-universe-space-import.node.test.ts(384,7): error TS2353: Object literal may only specify known properties, and 'onEnsurePersonalSpaceForImport' does not exist in type 'Partial<WorkbenchKnowledgeSurface>'.
ui/src/ui/views/knowledge-universe-space-import.node.test.ts(766,7): error TS2322: Type '"dataset"' is not assignable to type 'SpaceImportKind | null | undefined'.
ui/src/ui/views/knowledge-universe-space-import.node.test.ts(793,7): error TS2322: Type '"file"' is not assignable to type 'SpaceImportKind | null | undefined'.
```

### `src/gateway/agent-growth/background-recompute.test.ts` - 2

```
src/gateway/agent-growth/background-recompute.test.ts(131,18): error TS2353: Object literal may only specify known properties, and 'enabled' does not exist in type '{ id: string; }'.
src/gateway/agent-growth/background-recompute.test.ts(132,18): error TS2353: Object literal may only specify known properties, and 'enabled' does not exist in type '{ id: string; }'.
```

### `ui/src/ui/employee-shell/employee-embed-a11y.browser.test.ts` - 1

```
ui/src/ui/employee-shell/employee-embed-a11y.browser.test.ts(1,33): error TS2307: Cannot find module '@vitest/browser/context' or its corresponding type declarations.
```

### `ui/src/ui/employee-shell/employee-embed-mobile.browser.test.ts` - 1

```
ui/src/ui/employee-shell/employee-embed-mobile.browser.test.ts(1,22): error TS2307: Cannot find module '@vitest/browser/context' or its corresponding type declarations.
```
