# API comparison: Mario 0.57.1 → Earendil 0.84.4

Worktree: `cursor/pi-sdk-family-migration-v3` on `origin/main` `0de5f842a1`.  
OpenBot files containing `@mariozechner/pi-*` (excluding `node_modules`/`dist`): **297 files** (coding-agent 86, agent-core 141, pi-ai 130, pi-tui 26). Plus `extensions/matrix/package.json`.

Public surfaces were read from unpacked 0.84.4 tarballs under `/tmp/pi-sdk-v3-eval/unpack/` and Mario 0.57.1 under `/tmp/pi-sdk-v3-session/mario/`.

## coding-agent

| Symbol                                                 | 0.57.1                                                                     | 0.84.4                                                                         | OpenBot impact                  | Adapter                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `SessionManager.open/create/inMemory`                  | yes                                                                        | yes (`open` adds `cwdOverride`)                                                | transcript, runner, tests       | wrap `open` with fail-closed header/version check                                                                  |
| `CURRENT_SESSION_VERSION`                              | 3                                                                          | 3                                                                              | header writes                   | keep; still prove on disk                                                                                          |
| `AuthStorage`                                          | public; `create`/`inMemory`/`get`/`getApiKey`/`hasAuth`/`setRuntimeApiKey` | class exists internally; **not** on public `index.d.ts`                        | `pi-model-discovery.ts`, runner | typed `CredentialStore` wrapper; keep `agentDir/auth.json` + 0o600                                                 |
| `ModelRegistry`                                        | `new ModelRegistry(authStorage, modelsJsonPath)` sync                      | `new ModelRegistry(runtime: ModelRuntime)`; `ModelRuntime.create` is **async** | `discoverModels` is sync today  | `discoverModels`/`resolveModel` become async                                                                       |
| `ModelRegistry.getApiKey(model)`                       | yes                                                                        | **removed**; `getApiKeyAndHeaders` / `getApiKeyForProvider`                    | `compaction-safeguard.ts`       | helper over `getApiKeyAndHeaders`                                                                                  |
| `createAgentSession`                                   | `authStorage` + `modelRegistry`; `tools?: Tool[]`                          | `modelRuntime`; `tools?: string[]` allowlist; `noTools?: "all"\|"builtin"`     | `run/attempt.ts`, `compact.ts`  | pass `modelRuntime` + `noTools: "all"`; keep tools on `customTools` (already the OpenBot path via `splitSdkTools`) |
| `codingTools` / `readTool` singletons                  | public                                                                     | **removed**                                                                    | `pi-tools.ts`                   | `createCodingTools(workspaceRoot)` / `createReadTool(workspaceRoot)`                                               |
| `createReadTool/createWriteTool/createEditTool`        | `(cwd, options?)`                                                          | same                                                                           | `pi-tools.read.ts`              | keep; cwd is a relative base, **not a jail** (see tool ACL)                                                        |
| `AgentSession`                                         | public                                                                     | public                                                                         | runner                          | import rename                                                                                                      |
| `ExtensionAPI` / `ExtensionContext` / `ToolDefinition` | public                                                                     | public (events expanded)                                                       | `.pi/extensions/*`              | import rename; keep `toToolDefinitions`                                                                            |
| `loadSkillsFromDir` / `Skill` / `SettingsManager`      | yes                                                                        | yes                                                                            | skills / project settings       | import rename                                                                                                      |
| `estimateTokens` / `generateSummary`                   | yes                                                                        | yes + `generateSummaryWithUsage`                                               | compaction                      | import rename                                                                                                      |
| `./hooks` export                                       | present                                                                    | **removed**                                                                    | none currently imported         | n/a                                                                                                                |

## agent-core

| Symbol                                                     | 0.57.1 | 0.84.4                                                                   | Adapter       |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------ | ------------- |
| `Agent` / `AgentMessage` / `AgentTool` / `AgentToolResult` | yes    | yes; `execute(toolCallId, params, signal?, onUpdate?)` unchanged vs 0.57 | import rename |
| Extra harness/telemetry                                    | no     | yes                                                                      | unused        |

`extensions/matrix` depends on `@mariozechner/pi-agent-core@0.57.1` and must move with the family.

## pi-ai

| Symbol                                                                          | 0.57.1              | 0.84.4                             | Adapter                                    |
| ------------------------------------------------------------------------------- | ------------------- | ---------------------------------- | ------------------------------------------ |
| `complete` / `completeSimple` / `streamSimple` / `getModel`                     | package root        | **`@earendil-works/pi-ai/compat`** | documented compat entry, not a string-mask |
| `Model` / `Api` / `Context` / `Usage` / `AssistantMessage` / `OAuthCredentials` | root                | root (`compat` re-exports root)    | import via compat or root                  |
| TypeBox                                                                         | `@sinclair/typebox` | `typebox@1.3.7`                    | do not mix schema constructors             |

## pi-tui

OpenBot `src/tui/**` uses `TUI`, `Component`, `Container`, `Text`, `Markdown`, `SelectList`, `SettingsList`, `Editor`, `Key`, `matchesKey`, `CombinedAutocompleteProvider`, `Loader`, `ProcessTerminal`, `SlashCommand`, `Box`, `Spacer`. These remain on `@earendil-works/pi-tui` public index.

## Tool ACL (empirical, 0.84.4)

`createReadTool(cwd)` / `createWriteTool(cwd)` resolve relative paths against `cwd` but **allow `../` and absolute paths**. Isolated test (`fixtures/tool-acl-084.json`):

- relative `secret.txt` inside cwd → reads tenant A
- `../tenant-b/secret.txt` → **reads tenant B**
- absolute path to tenant B / outside → **reads**
- empty cwd + absolute path → **reads**
- write `../tenant-b/pwned.txt` → **writes**

OpenBot already wraps tools with `wrapToolWorkspaceRootGuard` / sandbox `assertSandboxPath`. Those wrappers remain mandatory. Phase B must keep calling factories with the **tenant workspace root** (never unbound `process.cwd()`) and keep the existing guard tests.

## Auth / model runtime

`discoverAuthStorage` must keep:

1. credentials from OpenBot auth-profiles (not a shared global `~/.pi/agent/auth.json`)
2. `agentDir/auth.json` scrub of legacy static `api_key` entries
3. tenant isolation (one agentDir per agent)

`ModelRuntime.create({ credentials, authPath, modelsPath, refreshOnCreate: false })` is the public replacement for `new ModelRegistry(authStorage, models.json)`.

## Verdict

**PASS with adapters.** Every OpenBot-used Mario API has a public 0.84 replacement or a typed wrapper. The coding-agent-only stop (public `AuthStorage`/`codingTools` missing + sibling mix) is lifted by migrating all four packages together. No `any`, no `@ts-nocheck`, no prototype mutation, no deep import of `dist/core/auth-storage.js`.
