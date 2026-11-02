# 01 — Credentials-omit root cause (DEF-008)

**Pin:** `d42fbc3ca2b4041ee70bb1dfb9cd70f33678370c`  
**When:** 2026-11-02 Asia/Shanghai  
**Classification:** **product defect**（可接受为缺陷登记；环境经 macOS `/var`→`/private/var` 触发，但产品路径比较未 canonicalize）  
**Security boundary:** **YES（收紧表述）** — 这是**凭证排除失效**：默认备份在宣称 omit / `skipped.reason=excluded` 时，归档内仍可能含 `credentials/oauth.json`。  
**现有证据没有证明**：远程攻击、权限提升、或已经发生真实凭证泄露。风险是：备份被分享 / 上传 / 存储时可能暴露凭证。

## 证据分层（禁止把团队诊断写成「验收方已独立复现」）

| 层级 | 内容 | 结论 |
| --- | --- | --- |
| A. 代码根因核对 | `src/infra/backup-create.ts:194`（`path.resolve` only）与 `:371`（tar filter 直接使用该判断） | 与归档证据**相互吻合** → **可接受为产品缺陷登记** |
| B. 团队诊断脚本 | 调用产品 `createBackupArchive`，虚构载荷；输出同时显示 `includeCredentials=false`、`skipped.reason=excluded` 与归档内存在 `credentials/oauth.json` | 支持「排除承诺与实际归档不一致」；**属团队诊断证据** |
| C. 验收方独立运行复现 | 独立重跑诊断时遇**双阻断**：(1) 缺 `node_modules/@openbot` 链接（工作区依赖解析）；(2) `packages/collaboration-core/dist` 不存在。不仅是缺构建产物；**单项恢复未必足够**（Stage4 导入见 `logs/01-stage4-credentials-omit-repro.log`） | **未完成** → 状态 **BLOCKED**；**不得**写成「验收方已独立复现」 |
| D. tip WT 上既有 unit 日志 | `logs/02-backup-unit-omit-repro.log` 显示 omit 断言 FAIL（历史/同 pin 树证据） | 可作旁证；**仍不替代**独立复核者对本轮诊断脚本的独立复现 |

No live secrets were used. Diagnostic wrote only `FICTIONAL_PLACEHOLDER_NOT_A_SECRET`. Logs must not be extended with real OAuth material.

## Root cause

1. `resolveBackupPlanFromDisk` returns `oauthDir` as the **logical** path from `resolveOAuthDir()` (`backup-shared.ts` ~120, returned ~271).
2. Included **state** asset uses **canonical** `realpath` (`canonicalPath`) as `sourcePath`.
3. On macOS, `os.tmpdir()` is under `/var/folders/...` which realpaths to `/private/var/folders/...`.
4. Tar pack walks canonical state tree; filter calls `isOauthPathExcluded(entryPath, plan.oauthDir)` (`backup-create.ts:371-379`).
5. `isOauthPathExcluded` (`backup-create.ts:194-198`) does `path.resolve` only — **does not realpath** — so `isPathWithin(/private/var/.../credentials/oauth.json, /var/folders/.../credentials)` is **false**.
6. Filter therefore **keeps** credential files. Manifest still records `options.includeCredentials=false` and `skipped: [{kind:credentials, reason:excluded}]` — **plan/metadata lie relative to payload**.

Diagnostic numbers (团队归档 / Asia/Shanghai；非验收方本轮独立复现成功):

- `symlinkMismatch: true`
- `isPathWithin_logical_vs_real_entry: false`
- `isPathWithin_real_vs_real: true`
- `credentialLeakInArchive: true` with relpath `.../credentials/oauth.json` inside archive payload  
  （标识名沿用脚本字段；含义是「归档内出现凭证路径」，**不是**「已确认真实泄露事件」）

## Exact loci

| Role | File:line |
| --- | --- |
| Non-canonical filter compare | `src/infra/backup-create.ts:194-198` (`isOauthPathExcluded`) |
| Filter call site | `src/infra/backup-create.ts:371-379` |
| Plan returns logical `oauthDir` | `src/commands/backup-shared.ts:271` (resolve ~120; skip list **does** canonicalize ~253) |
| Failing product unit assert | `src/commands/backup.test.ts:451-452` |
| Failing Stage4 acceptance assert | `docs/acceptance/stage4-store-evidence.test.ts:279-280` |

## Impact（措辞收紧）

- **安全影响准确表述：** **凭证排除失效**。当备份被分享、上传或存储时，**可能**暴露凭证。
- **现有证据没有证明**远程攻击、权限提升、或已经发生真实凭证泄露。
- 触及安全边界可保留（default omit 承诺与 payload 不一致），但不得夸大为 RCE / 远程利用链 / 已泄露事件。
- Acceptance Stage4 在此缺陷未修复前不能为 PASS。
- Tests detecting the inconsistency are correct; this is a **payload inclusion** bug relative to the omit promise.

## Fix suggestion（NO product patch in this PR；已收窄）

**不得采纳**「无条件排除任意 `/credentials/` 目录」：可能误删普通工作区内容，且无法覆盖自定义凭证目录。

Authorized product follow-up should:

1. 围绕**实际配置的凭证目录**及其 **canonicalize / realpath 规范路径**，在 filter 比较前与 asset `sourcePath` 使用同一套规范化；**或**把已规范化的 oauth 路径传入 tar filter。
2. **保留**显式 `includeCredentials===true` 的预期行为（opt-in 打包凭证应继续可用）。
3. 增加回归：强制 logical vs realpath mismatch（macOS tmpdir 足够），断言默认 omit 时归档字节不含凭证路径，且 filter 使用规范化 oauth。
4. 可选：当 `includeCredentials===false` 但归档列出凭证路径时，backup verify 发出警告。

## Defect ID

**DEF-008** — Backup default credentials-omit fails across symlink/realpath（凭证排除失效；安全边界 YES，表述见上）。

See `docs/acceptance/p1-fix-2026-11-01/defect-status.md`（documentation only; not authorized as product fix here）.

## 本轮范围声明

本轮**未修改产品代码**、**未安装工具链**、**未 merge**；文档 / 口径更新，且 PR 范围包含 `.loom/registry.yaml` 管理登记（**不是**绝对「仅文档与日志」）。独立复现双阻断已由用户本机确认；本轮**不安依赖、不构建**。详见 `../2026-11-02-independent-reviewer-corrections/01-owner-confirm-round2.md`。
