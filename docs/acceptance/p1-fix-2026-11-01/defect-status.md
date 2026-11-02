# Defect status update — tip `f68a3c56b00fe060209678921bfdc28dbd4138b5`

Vocabulary: PASS / FAIL / BLOCKED / NOT RUN / N/A.  
Re-reproduction required on NEW tip before any fix (completed).

| ID      | Title                                    | Old pin    | Tip reproduce       | Tip after fix                                    | Notes                                                                                                                                                                      |
| ------- | ---------------------------------------- | ---------- | ------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEF-001 | PluginMemoryToolFactory / tsgo contract  | FAIL       | FAIL                | **PASS**                                         | Real producer (`extensions/memory-core`) + impl (`memory-tool.ts`) + plugin type aligned; contract test added. Extra tip tsgo errors fixed with real types (not `as any`). |
| DEF-002 | protocol:check Swift GatewayModels drift | FAIL       | FAIL                | **PASS** (after regen commit)                    | Canonical gen flow. Light swiftc+AnyCodable OK. Full `swift build --target OpenBotProtocol` BLOCKED (dep hang).                                                            |
| DEF-003 | format:check ~30 files                   | FAIL       | FAIL (pre-existing) | **FAIL** (out of P1; changed files only oxfmt’d) | Not authorized as P1 product fix; no mass reformat.                                                                                                                        |
| DEF-004 | SarGovernanceProvider import             | FAIL       | FAIL                | **PASS**                                         | Import from `sar-governance-bridge`; materializer resolves; focused vitest PASS.                                                                                           |
| DEF-005 | tool-policy.test drift                   | FAIL (old) | NOT RUN this PR     | open                                             | Out of P1 authorization.                                                                                                                                                   |
| DEF-006 | employee entitlement allowlist units     | FAIL (old) | NOT RUN this PR     | open                                             | Out of P1 authorization.                                                                                                                                                   |
| DEF-007 | dispatchInboundMessage lifecycle unit    | FAIL (old) | NOT RUN this PR     | open                                             | Out of P1 authorization.                                                                                                                                                   |

## Cleared on NEW tip (authorized P1)

- DEF-001, DEF-002, DEF-004

## Explicit

Clearing these P1s removes current type/protocol/materializer blockers for honest green `tsgo` + `protocol:check` on tip. It is **not** a fullstack acceptance PASS.

## DEF-008 — Backup credentials-omit (realpath / macOS symlink)

| Field | Value |
| --- | --- |
| ID | **DEF-008** |
| Status | **OPEN**（产品缺陷登记已接受；本 PR 为 `docs/acceptance/**` + `.loom/registry.yaml`，无产品代码） |
| Security boundary | **YES** — **凭证排除失效**；备份分享/上传/存储时**可能**暴露凭证。**现有证据没有证明**远程攻击、权限提升、或已经发生真实凭证泄露 |
| Pin found | `d42fbc3ca2b4041ee70bb1dfb9cd70f33678370c` |
| When | 2026-11-02 Asia/Shanghai |
| Classification | Product defect（env 经 `/var`→`/private/var` 触发；比较非 canonical） |
| Team diagnostic evidence | 虚构载荷下 `includeCredentials=false` + `skipped.reason=excluded` 同时归档含 `credentials/oauth.json` |
| Independent runtime repro | **未完成 / BLOCKED**（双阻断：缺 `node_modules/@openbot` 链接 **且** `packages/collaboration-core/dist` 不存在；单项恢复未必够）；**不得**写成验收方已独立复现 |
| Evidence | `docs/acceptance/runs/2026-11-02-credentials-omit/`；独立复核 `docs/acceptance/runs/2026-11-02-independent-reviewer-corrections/` |
| Primary loci | `src/infra/backup-create.ts:194-198`, `:371-379`；`src/commands/backup-shared.ts:271` |
| Failing asserts | `src/commands/backup.test.ts:451-452`；`docs/acceptance/stage4-store-evidence.test.ts:279-280` |
| Authorized fix? | **No** in this acceptance docs PR — analyze + recommend only |
| Suggested fix（收窄） | 围绕**实际配置的凭证目录**及其 canonicalize/realpath 验证过滤；**保留**显式 `includeCredentials`。**不采纳**无条件排除任意 `/credentials/`（可能误伤工作区且无法覆盖自定义凭证目录） |
| Blocks fullstack PASS? | **Yes** — 总评 **FAIL / NOT READY**；不据此批准 #193 合并 |
| This round | **未修改产品代码、未安装工具链、未 merge** — 文档/口径 + loom 管理登记；见 `01-owner-confirm-round2.md` |
