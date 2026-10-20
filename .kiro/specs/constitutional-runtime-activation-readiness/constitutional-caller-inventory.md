# Constitutional caller inventory — Checkpoint A

assessedAt: 2026-09-28T04:10:00Z (symbol scan)
Code SHA: `6628f4bf364bd6d0560847b938b00e74035a8947`
Transcripts: `evidence/rg-constitutional-symbols.txt`, `evidence/rg-imports-and-flags.txt`, `evidence/rg-wiring.txt`

## Scope

"Package" means `packages/constitutional-contracts`. A package-external caller is any reference outside that directory. Scans used `rg` over the worktree, excluding `node_modules` and `dist`. Docs and tests are listed when they name a symbol, and marked so they are not mistaken for hot-path calls.

Definitions:

| Symbol                              | Defined                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| `selectLegalPath`                   | `packages/constitutional-contracts/src/legal-path/select.ts:209`     |
| `executeLegalPath`                  | `packages/constitutional-contracts/src/legal-path/execute.ts:102`    |
| `runRuntimeFacadeShadow`            | `packages/constitutional-contracts/src/runtime-facade/shadow.ts:193` |
| `reportPathGap`                     | `packages/constitutional-contracts/src/path-gap/report.ts:192`       |
| `observeOrchestrationRuntimeFacade` | `src/task-orchestration/constitutional-runtime-facade.ts:34`         |
| `observePreflightRuntimeFacade`     | `src/agents/execution-preflight/constitutional-runtime-facade.ts:51` |

## selectLegalPath — package-external callers: 0

Inside the package only:

| Caller                                                    | Line  | Kind                                                                                                                      |
| --------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| `runtime-facade/shadow.ts`                                | 220   | report-only bridge when shadow and select are both opted in; result still has `executed: false` (`shadow.ts:124`, `:245`) |
| `legal-path/execute.ts`                                   | 111   | package-local stub                                                                                                        |
| `legal-path/select.test.ts`, `legal-path/execute.test.ts` | tests | package tests                                                                                                             |

No file under `src/`, `extensions/`, `apps/`, `scripts/`, or the sibling constitutional packages calls `selectLegalPath`. The state matrix only mentions the absence of `src/` callers (`docs/design/evidence/constitutional-governance-state-matrix-2026-09-27.json`).

## executeLegalPath — package-external callers: 0

Callers are `legal-path/execute.ts` (definition) and `legal-path/execute.test.ts`. `runRuntimeFacadeShadow` does not call it. Neither observe façade calls it. `src/gateway` has no match. `scripts/governance` (PR #171) has no match.

When the package-local stub does run, the only side effect is the string `package-local-execute-allowed` (`execute.ts:34`, `:148`). Registry `executionAuthorized` stays false (`packages/constitutional-contracts/src/legal-path/registry.ts:31`, `:46`). The function does not write gateway or tenant state (`execute.ts:10-12`).

## runRuntimeFacadeShadow — package-external callers

| Caller                                                            | Line   | Reaches hot path?                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/task-orchestration/constitutional-runtime-facade.ts`         | 38     | No. `observeOrchestrationRuntimeFacade` is the only production-tree wrapper. It is not imported by `dispatch.ts` or `gateway-hook.ts` (test lock at `constitutional-runtime-facade.test.ts:13-20`). |
| `src/agents/execution-preflight/constitutional-runtime-facade.ts` | 54     | No. `observePreflightRuntimeFacade` is not imported by `index.ts`, `resolve.ts`, or `trace.ts` (test lock at `constitutional-runtime-facade.test.ts:27-40`).                                        |
| `packages/constitutional-runtime/src/index.ts`                    | 17     | Re-export only. Scaffold, not a gateway import.                                                                                                                                                     |
| `packages/constitutional-runtime/src/scaffold.test.ts`            | 71, 81 | Package scaffold tests.                                                                                                                                                                             |
| `packages/constitutional-runtime/README.md`                       | 13     | Docs.                                                                                                                                                                                               |

`src/gateway` imports of `constitutional-contracts`, `selectLegalPath`, `executeLegalPath`, `runRuntimeFacadeShadow`, and both `observe*` functions: **none** (`evidence/rg-authority.txt`).

`src/conversation-task` imports of those symbols: **none**.

### What the observe façades actually forward

`observeOrchestrationRuntimeFacade` (`constitutional-runtime-facade.ts:38-47`) forwards `env`, `shadow`, `enforce`, `candidatePath`, and `workflowRef`. It does not forward `select` or `execute`. It forces `dispatchInvoked: false` and `enqueued: false` (`:52-53`) and echoes `ORCHESTRATION_LIVE_INVOKE` (`types.ts:22` is `false`).

`observePreflightRuntimeFacade` (`constitutional-runtime-facade.ts:54-67`) forwards the same option fields. It forces `wroteReceipt: false` and `wroteTrace: false` (`:72-73`). The module does not contain `process.env` (test at `constitutional-runtime-facade.test.ts:40`).

A caller can still turn the select bridge on only by placing a truthy `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT` in the **env snapshot argument**, and only if shadow is also opted in. Nothing in gateway, dispatch, or the preflight barrel constructs that call.

Who calls the observe functions:

| Function                            | Callers outside its own file                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `observeOrchestrationRuntimeFacade` | `src/task-orchestration/constitutional-runtime-facade.test.ts:37`, `:63`         |
| `observePreflightRuntimeFacade`     | `src/agents/execution-preflight/constitutional-runtime-facade.test.ts:47`, `:73` |

## reportPathGap — related, not select/execute

| Caller                                                     | Line    | Kind           |
| ---------------------------------------------------------- | ------- | -------------- |
| `packages/constitutional-conformance/src/index.ts`         | 21      | re-export      |
| `packages/constitutional-conformance/src/scaffold.test.ts` | 97, 103 | scaffold tests |

No `src/` caller.

## Import graph of the four workspace packages

Production `src/` imports `@openbot/constitutional-contracts` only from the two façade files (relative path into `packages/constitutional-contracts/src/index.js`, not a gateway barrel):

- `src/task-orchestration/constitutional-runtime-facade.ts:8-13`
- `src/agents/execution-preflight/constitutional-runtime-facade.ts:8-12`

Sibling packages re-export slices and are not imported by `src/gateway`:

- `@openbot/constitutional-runtime` re-exports `runRuntimeFacadeShadow`
- `@openbot/constitutional-conformance` re-exports `reportPathGap` and the shadow evaluator
- `@openbot/constitutional-registry` re-exports adapters and the read model (`packages/constitutional-registry/src/index.ts:35`)

`process.env.OPENBOT_CONSTITUTIONAL_*` reads under `src/`, `packages/`, and `extensions/`: **none**. The only hit is the test that asserts `dispatch.ts` does not contain that string (`constitutional-runtime-facade.test.ts:20`).
