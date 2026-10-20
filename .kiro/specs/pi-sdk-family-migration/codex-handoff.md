# Codex handoff — Pi SDK family migration v3

## Identity

- Agent: `cursor`
- Worktree: `../openbot-pi-sdk-family-migration-v3`
- Branch: `cursor/pi-sdk-family-migration-v3`
- Baseline at branch creation: `origin/main` `0de5f842a1` (Item 7 / #809); rebased onto `b105d2d161` (#810) before push.
- Tip: recorded in PR #812 after this handoff commit lands.
- PR: https://github.com/gmood2008/openbot/pull/812
- v2 worktree `../openbot-pi-sdk-family-migration-v2` was **not** modified and was **not** copied (still ~311 dirty files for the original executor).
- Independent PR. Do **not** merge, deploy, edit PR #797, add audit ignore, bypass CI, or force-push. Wait for Codex review.

## Phase A

**PASS.** Evidence in this spec directory:

- `api-comparison.md`
- `session-compatibility.md` (23/23)
- `supply-chain-review.md`
- `fixtures/session-057.jsonl`, `write-057.json`, `read-084.json`, `tool-acl-084.json`

Pin (exact): `@earendil-works/pi-coding-agent`, `pi-agent-core`, `pi-ai`, `pi-tui` all `0.84.4`. MIT. No Mario 0.57 remaining in root or `extensions/matrix`.

## Phase B

### Dependency / audit

- Root + `extensions/matrix` pinned to Earendil `0.84.4`.
- `pnpm-lock.yaml` has **no** `@mariozechner/pi-*` and **no** `extract-zip`.
- `pnpm audit --prod --audit-level=high --registry https://registry.npmjs.org` → **exit 0** (8 low + 33 moderate; **0 high / 0 critical**).
- npmmirror `pnpm audit` is not a valid endpoint (`ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`); always pass `--registry https://registry.npmjs.org`.

### Adapters (`src/agents/pi-sdk/`)

| Adapter            | Behavior                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-storage.ts`  | `OpenBotAuthStorage` implements `CredentialStore`; keeps Mario-shaped helpers for OpenBot call sites                                        |
| `model-runtime.ts` | `createPiModelRuntime` + async `discoverModels`                                                                                             |
| `session.ts`       | `openSessionManager()` fail-closed if header missing or `version > CURRENT_SESSION_VERSION` (SDK still reads version 99)                    |
| `coding-tools.ts`  | `createCodingTools(cwd)` / `createReadTool(cwd)`; **empty cwd throws**; factories are not a jail                                            |
| `oauth.ts`         | local `OAuthProvider` list + `getOAuthApiKey` / `loginOpenAICodex` wrapping `openaiCodexProvider().auth.oauth` (`pi-ai/oauth` is type-only) |

### Production API mapping

- Imports: `@mariozechner/pi-*` → `@earendil-works/pi-*`; `complete` / `streamSimple` / `getModel` from `@earendil-works/pi-ai/compat`.
- `createAgentSession`: `modelRuntime` + `noTools: "all"` (OpenBot tools stay on `customTools`).
- Agent: `streamFn` → `streamFunction`; `replaceMessages` → `state.messages =`; `setSystemPrompt` → `state.systemPrompt =`.
- TUI: `TuiMainScreen`; `getKeybindings`; `tui.select.cancel` (was `selectCancel`).
- Skills: `Skill.source` → `sourceInfo.source`.
- Compaction: `generateSummary(..., headers?, signal?, instructions?)`.
- `clearApiProviders` → `resetApiProviders`.
- Edit tool: 0.84 requires `edits[]`. `normalizeToolParams` lifts Mario/Claude `{oldText,newText}` / `{old_string,new_string}` into `edits[]` so existing transcripts and tests keep working. OpenBot workspace-root / sandbox guards remain.

### Gates run in this worktree

| Gate                                                                         | Result                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm audit --prod --audit-level=high --registry https://registry.npmjs.org` | 0 high / 0 critical                                                                                                                                                                                                |
| `pnpm tsgo` on files in this branch diff                                     | **0 errors**                                                                                                                                                                                                       |
| `pnpm tsgo` full tree                                                        | 161 errors in **68 files not in this diff** (UI/collaboration/wecom fixtures; present on current `origin/main`, not introduced here)                                                                               |
| Scoped tests                                                                 | `pi-sdk/*`, compaction identifier/retry/tool-result, extra-params (+ kilocode/openrouter/zai), google sanitize, oauth refresh, edit/workspace-only, skills-status — pass after `pnpm build:collaboration:packages` |
| Format                                                                       | oxfmt on migrated files                                                                                                                                                                                            |
| `pnpm check` full                                                            | blocked by the same baseline `tsgo` errors; **not** ignored                                                                                                                                                        |

### Rollback

Revert this PR. That restores Mario `@mariozechner/pi-*@0.57.1` and `extract-zip@2.0.1` (GHSA-jfgx-wxx8-mp94 / GHSA-jmr9-qjv8-65gv). Do not mix Mario 0.57 with Earendil 0.84.

## Declarations

- No takeover / reset / restore of v2 WIP
- No production deployment
- No audit ignore, CI skip, or force-push
- Engines: Earendil lists `node >= 22.19.0`; OpenBot stays `>=22.12.0` unless install/runtime fails

## Review

Waiting for Codex. Do not merge or deploy from this PR.
