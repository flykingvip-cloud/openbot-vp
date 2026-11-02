# 10 — Credentials-omit (Stage4 / backup) — 2026-11-02

See full write-up: [`../runs/2026-11-02-credentials-omit/01-credentials-omit-root-cause.md`](../runs/2026-11-02-credentials-omit/01-credentials-omit-root-cause.md)

**Summary:**

- **DEF-008** 可接受为**产品缺陷登记**：代码根因（`backup-create.ts:194` / `:371`，仅 `path.resolve`、未 canonicalize）与团队归档诊断相互吻合。
- **验收方独立运行复现尚未完成**：**缺少 `node_modules/@openbot` 链接**，且 **`packages/collaboration-core/dist` 不存在**；不仅是缺构建产物，还有工作区依赖解析问题；**恢复其中一项未必足够**。**不得**把团队诊断写成「验收方已独立复现」。
- Pin `d42fbc3ca2…`：默认备份在 state realpath 与 logical `oauthDir` 不一致时，仍可能打入 `credentials/oauth.json`，同时 manifest 宣称 excluded。
- **安全影响：** 凭证排除失效；备份被分享/上传/存储时**可能**暴露凭证。现有证据**没有证明**远程攻击、权限提升、或已经发生真实凭证泄露。
- Stage4：**FAIL**（缺陷登记口径）；全栈继续 **FAIL / NOT READY**。
- 修复建议已收窄：围绕实际配置凭证目录的 canonicalize/realpath 验证过滤，并保留显式 `includeCredentials` 行为；**不采纳**无条件排除任意 `/credentials/`。
- 本轮**未修改产品代码**、**未安装工具链** — 文档/口径更新；PR 范围另含 `.loom/registry.yaml` 管理登记（见 PR #193 审视）。
