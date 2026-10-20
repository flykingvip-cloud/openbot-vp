# S01 D1–D5 设计包（待独立评审）

**评审人**: kiro-sot-reviewer、codex-architecture  
**状态**: `design-accepted-implementation-locked`  
**最终裁决**: Design Convergence Accepted；R6 Accepted；Implementation Unlock Not issued；Production Authorization Not issued  
**唯一 handoff（唯一规范）**: `.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`  
**评审指针**: `docs/design/handoff-s01-design-review-guide.md`  
**契约模块**: `docs/design/contracts/s01-trusted-principal-handle-contract.ts`  
**契约测试**: `docs/design/contracts/s01-trusted-principal-handle-contract.test.ts`  
**R6 机器验收**: `scripts/verify-single-sot.mjs`（`pnpm verify:single-sot`）  
**R6 evidence**: `docs/design/evidence/memory-workspace-s01-r6-single-sot.json`

D1–D5 设计内容保留在 **unique handoff + 非生产 contract**。契约目录 `docs/design/contracts/` **不是**生产 `src/` 入口，**不是**第二套 `MemoryWorkspaceHandle`。本任务未修改 `src/memory/**`。不是 S01 retirement、不是实现接线、不是 Phase 1B unlock、不是 LIVE。Trusted Principal / ACL / P99 / 审计失败语义仍是 **design target, not verified**。后续实现必须从 `origin/main` `7aff51c198` 或更晚创建新 worktree。

#818 归档文档（例如 `docs/design/handoff-s01-d1-convergence-patch.md`、`handoff-s01-revision-r*.md`）**SUPERSEDED as second spec**：已随 #820 进入 git 基线，仍不得覆盖 unique handoff。索引：`docs/design/handoff-s01-818-archive.md`。

| ID       | 交付                           | 落地                                                                                                                      | 分类                            |
| -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| D1       | Trusted Principal 契约         | `trustedPrincipalSchema` / `parseTrustedPrincipal`；缺主体 fail-closed                                                    | design complete                 |
| D2       | Handle typed-view              | `projectWorkspaceHandleView`：`WorkspaceResourceRecord` + unique binding locator                                          | design complete                 |
| D3       | Catalog 扩展                   | 无新表；membership 为注入的只读 `PlatformAuthMembershipView`；Catalog 端口是 `src/gateway/workspace-resolver/catalog.ts`  | design complete                 |
| D4       | `evaluateS01AuthorizedToolCwd` | Zod 参数/错误码；10 个错误码；`allowAnonymousLocal` 不放行                                                                | design complete                 |
| D5       | 防回归测试                     | 批准的 `InMemoryWorkspaceResourceCatalog`；`bun test docs/design/contracts/s01-trusted-principal-handle-contract.test.ts` | design complete                 |
| R6       | 唯一 SoT 机器验收              | `node scripts/verify-single-sot.mjs`；**不要求**不存在的 `src/gateway/workspace-catalog/migrations`                       | design machine check            |
| P99      | 性能 SLA                       | unique handoff §5.3 示例代码                                                                                              | **design target, not verified** |
| R1/R3/R5 | 安全测试 / 审计失败            | 仅设计讨论                                                                                                                | **design target, not verified** |

**禁止项（已遵守）**: 未改 `get-reply.ts` / `src/memory/**` / `workspace-resolver/**`；scan=10；未操作 Aliyun RDS；未写生产 Catalog。

**实现验证未完成** (`implementationVerified: false`)：未接线 `get-reply`，未跑生产 P99，未把 R1/R3/R5 标成已验证。
