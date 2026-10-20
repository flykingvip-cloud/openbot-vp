# Computer / browser action reverse-caller matrix

- **Tree:** `gmood2008/openbot` (this worktree)
- **Anchor SHA named in finding:** `e7c614eb54214b2f62f082c8d99dca08b8c58232` (#936 diagnosis land)
- **Matrix built against worktree HEAD:** `330d92207478850800284b39c5f89852d77ca324` (`origin/main` at branch cut)
- **Date:** 2026-09-04
- **Finding scope:** reverse-callers for agent-computer style endpoints; fix only if `SHARED_BYPASS`

## Path inventory (requested vs this repo)

CopilotKit-style routes `/exec`, `/files/write`, `/files/read`, `/files/list`, `/click`, `/type`, `/key`, `/scroll` **do not exist** as first-class HTTP paths under an `agent-computer` package in this tree. There is no `ComputerGateway` / `evaluateActionPolicy` symbol.

**Source of truth (SoT) for computer-like actions:** OpenBot **browser control** routes registered by `registerBrowserRoutes` (`src/browser/routes/index.ts`), reached via:

1. Gateway RPC `browser.request` → local `createBrowserRouteDispatcher` **or** node `browser.proxy` (`src/gateway/server-methods/browser.ts`)
2. In-process dispatcher via `fetchBrowserJson` relative URLs (`src/browser/client-fetch.ts`)
3. Loopback HTTP control server `127.0.0.1:<controlPort>` with `installBrowserAuthMiddleware` (`src/browser/server.ts`)
4. Node host `invokeBrowserProxy` (`src/node-host/invoke-browser.ts`) for `browser.proxy`

| Requested endpoint | Actual endpoint / symbol in this repo                                                                                                                                                  | Notes                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `/exec`            | **Not a browser computer route.** Chat text alias `/exec` in `src/auto-reply/commands-registry.data.ts` / `reply/exec/directive.ts`. Closest browser act: `POST /act` `kind=evaluate`. | Do not invent CopilotKit `/exec`.   |
| `/files/write`     | No path. Upload = `POST /hooks/file-chooser` + Playwright `setInputFilesViaPlaywright` (paths must stay under uploads root).                                                           | humanInput-adjacent chooser arming. |
| `/files/read`      | No path. Download = `POST /download`, `POST /wait/download`.                                                                                                                           | Scoped to downloads root.           |
| `/files/list`      | No browser path. Gateway `agents.files.list` is **agent workspace** files (`src/gateway/server-methods/agents.ts`), not desktop/browser computer FS.                                   | Out of browser SoT.                 |
| `/navigate`        | `POST /navigate` — `registerBrowserAgentSnapshotRoutes`                                                                                                                                | SSRF / navigation policy applied.   |
| `/click`           | `POST /act` `kind=click`                                                                                                                                                               |                                     |
| `/type`            | `POST /act` `kind=type`                                                                                                                                                                |                                     |
| `/key`             | `POST /act` `kind=press`                                                                                                                                                               |                                     |
| `/scroll`          | `POST /act` `kind=scrollIntoView`                                                                                                                                                      |                                     |

`ACT_KINDS` (`src/browser/routes/agent.act.shared.ts`): click, close, drag, evaluate, fill, hover, scrollIntoView, press, resize, select, type, wait.

## Reverse-caller matrix (real endpoints)

Columns: **Endpoint | all server callers | Gateway method | Policy gate | Audit | Exception**

| Endpoint                                                | All server / first-party callers                                                                                                                                                                                    | Gateway method                                                                                                                                   | Policy gate                                                                                                                                                                                                   | Audit                                                                                     | Exception                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `POST /navigate`                                        | CLI `register.navigation` → `callBrowserRequest`; agent `browser` tool (`browserNavigate` / proxy); gateway `browser.request` dispatcher; node `browser.proxy` → dispatcher; direct loopback HTTP clients with auth | `browser.request` (CLI); host bot often **skips** RPC and uses `fetchBrowserJson` dispatcher/HTTP; node bot uses `node.invoke` + `browser.proxy` | HTTP: `isAuthorizedBrowserRequest`; navigate: `withBrowserNavigationPolicy` / SSRF (`navigation-guard.ts`); node: `isNodeCommandAllowed(browser.proxy)` + profile allowlist; tool: sandbox `allowHostControl` | Subsystem logs (`browser` logger). **No per-action audit ledger / evaluateActionPolicy.** | —                                                          |
| `POST /act` (`click`/`type`/`press`/`scrollIntoView`/…) | CLI `callBrowserAct` / manage resize; agent `browser-tool` + `browser-tool.actions`; gateway `browser.request`; node proxy; loopback HTTP                                                                           | Same dual entry as navigate                                                                                                                      | Auth (HTTP path); CSRF mutation guard on HTTP; node command allowlist; tool sandbox host gate. **No unified action-policy evaluator.**                                                                        | Log-only (audit gap)                                                                      | —                                                          |
| `POST /hooks/file-chooser`                              | CLI `browser upload`; agent tool arm-file-chooser; gateway/node/HTTP                                                                                                                                                | `browser.request` or dispatcher/HTTP                                                                                                             | Auth + upload path root confinement                                                                                                                                                                           | Log-only                                                                                  | **humanInput** — arms next chooser for user/page file pick |
| `POST /hooks/dialog`                                    | CLI/agent dialog arm; gateway/node/HTTP                                                                                                                                                                             | same                                                                                                                                             | Auth                                                                                                                                                                                                          | Log-only                                                                                  | **humanInput** — dialog accept/dismiss hook                |
| `POST /download`, `POST /wait/download`                 | CLI files-downloads; agent tool; gateway/node/HTTP                                                                                                                                                                  | same                                                                                                                                             | Auth + downloads-dir path confinement (traversal rejected in tests)                                                                                                                                           | Log-only                                                                                  | —                                                          |
| `GET/POST` tabs/start/stop/snapshot/screenshot/…        | CLI manage/inspect; agent tool; gateway/node/HTTP                                                                                                                                                                   | same                                                                                                                                             | Auth; profile allowlist on node                                                                                                                                                                               | Log-only                                                                                  | —                                                          |
| `agents.files.list` (not browser)                       | UI `agents.files.list`; gateway agents handler                                                                                                                                                                      | `agents.files.list`                                                                                                                              | Workspace locator / scope (Item 7)                                                                                                                                                                            | Gateway method audit patterns as elsewhere                                                | **Not computer SoT**                                       |

## Bot path proof (required shape)

Required narrative: `caller → ComputerGateway → evaluateActionPolicy → audit → execution`.

**Mapped to this repo:**

```
# CLI (canonical gateway RPC)
openbot browser …
  → callBrowserRequest
  → gateway "browser.request"          # SoT gateway method (not ComputerGateway)
  → [node] node.invoke command=browser.proxy + isNodeCommandAllowed
       → node-host invoke-browser → createBrowserRouteDispatcher → route handler → Playwright
  → [host] createBrowserRouteDispatcher (in-process) → route handler
       → for /navigate: withBrowserNavigationPolicy (SSRF) → Playwright
  → audit: subsystem logs only (gap ≠ SHARED_BYPASS)

# Agent browser tool — host
createBrowserTool.execute
  → client-actions (browserNavigate / browserAct / …)
  → fetchBrowserJson(relative|/absolute loopback)
  → relative: createBrowserRouteDispatcher (same handlers as gateway local path)
  → absolute loopback: HTTP + Bearer/password auth middleware
  → route handler → (navigate policy) → Playwright
  # NOTE: does NOT call gateway method "browser.request" on host path

# Agent browser tool — node
createBrowserTool.execute
  → callBrowserProxy → gateway "node.invoke" command=browser.proxy
  → allowlist gate → node-host → dispatcher/routes → Playwright
```

## SHARED_BYPASS verdict

| Candidate                                            | Verdict                           | Rationale                                                                                                                                                                       |
| ---------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host bot tool skips `browser.request`                | **Not SHARED_BYPASS**             | Lands on the **same** `registerBrowserRoutes` handlers used by gateway local dispatch (`client-fetch` dispatcher). Dual entry is intentional SoT, not a covert second executor. |
| In-process dispatcher skips HTTP auth middleware     | **Not SHARED_BYPASS**             | Same-process trusted path used by gateway local `browser.request` as well; HTTP listeners still fail-closed with auth (`server.auth-fail-closed`).                              |
| Missing per-action audit / no `evaluateActionPolicy` | **Audit-only gap**                | Explicitly **≠ SHARED_BYPASS** per finding rules.                                                                                                                               |
| `/hooks/file-chooser`, `/hooks/dialog`               | **humanInput accepted exception** | User/page interaction hooks, not silent FS write.                                                                                                                               |
| Direct unauthenticated computer FS `/files/*`        | **N/A**                           | Endpoints absent; uploads/downloads are root-scoped.                                                                                                                            |

**Code fix:** none. No unauthorized gateway bypass of the browser route SoT was found.

## Symbols quick index

| Role                              | Path + symbol                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Route registration                | `src/browser/routes/index.ts` `registerBrowserRoutes`                                                                        |
| Act / click / type / key / scroll | `src/browser/routes/agent.act.ts` `registerBrowserAgentActRoutes`                                                            |
| Navigate                          | `src/browser/routes/agent.snapshot.ts` `POST /navigate`                                                                      |
| Gateway SoT method                | `src/gateway/server-methods/browser.ts` `"browser.request"`                                                                  |
| Node proxy                        | `src/node-host/invoke-browser.ts`; command `browser.proxy`                                                                   |
| Policy-ish gates                  | `src/browser/http-auth.ts`, `src/browser/navigation-guard.ts`, `src/gateway/node-command-policy.ts`, tool `allowHostControl` |
| Agent caller                      | `src/agents/tools/browser-tool.ts`, `browser-tool.actions.ts`                                                                |
| CLI caller                        | `src/cli/browser-cli-shared.ts` `callBrowserRequest`                                                                         |

## Frozen (untouched)

F2 workbench.css padding; `spaces.*` short RPCs; Spaces\* schema dual keys; production cutover; `DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED` enablement.
