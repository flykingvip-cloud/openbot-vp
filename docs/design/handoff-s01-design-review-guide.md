# Handoff S01 设计评审说明（指针文档）

> **状态**: `review-pointer`  
> **不是第二套规范**。唯一 handoff / 唯一规范是 unique handoff。  
> **Git 基线**: 设计与 R6 已随 #815 合入；#818 归档随 #820 合入；pass 3 随 #821 合入。本指针记录最终裁决；后续实现须从最新 `origin/main` 开新 worktree。

## 唯一规范来源

1. **Unique handoff（唯一规范）**  
   `.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`
2. **非生产契约**  
   `docs/design/contracts/s01-trusted-principal-handle-contract.ts`  
   `docs/design/contracts/s01-trusted-principal-handle-contract.test.ts`
3. **R6 机器验收**  
   `scripts/verify-single-sot.mjs`  
   evidence: `docs/design/evidence/memory-workspace-s01-r6-single-sot.json`

`docs/design/handoff-s01-trusted-principal-handle-gate.md` 仍是 **DEPRECATED stub**，不得当第二套 D1–D5。

## SUPERSEDED：分支 WIP 不得当规范

下列路径来自闭环 PR #818 的归档重放，**已在本 git 基线**，仍是 **SUPERSEDED as second spec**，不能覆盖 unique handoff。索引：`docs/design/handoff-s01-818-archive.md`。

- `docs/design/handoff-s01-d1-convergence-patch.md` — **SUPERSEDED as second spec**
- `docs/design/handoff-s01-d2-d4-d5-convergence-patches.md` — **SUPERSEDED as second spec**
- `docs/design/handoff-s01-revision-r1-anonymous-local-security.md` — **SUPERSEDED as second spec**
- `docs/design/handoff-s01-revision-r3-trusted-proxy-threat-model.md` — **SUPERSEDED as second spec**
- `docs/design/handoff-s01-revision-r4-performance-benchmark.md` — **SUPERSEDED as second spec**
- `docs/design/handoff-s01-revision-r5-audit-failure-semantics.md` — **SUPERSEDED as second spec**
- `docs/design/handoff-s01-revision-r6-single-sot-verification.md` — **SUPERSEDED as second spec**（其中 `src/gateway/workspace-catalog/migrations` 与当前架构不一致）

R1/R3 的安全测试、R4 的 P99、R5 的审计失败行为：在 unique handoff 里仍是 **design target**，不是实现验证证据。

## 实际路径（取代错误清单）

| 角色           | 路径                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Unique handoff | `.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md` |
| D1–D5 设计包   | `.kiro/specs/memory-workspace-platform-remediation/s01-d1-d5-design-package.md`                  |
| 契约           | `docs/design/contracts/s01-trusted-principal-handle-contract.ts`                                 |
| Catalog 端口   | `src/gateway/workspace-resolver/catalog.ts`                                                      |
| Catalog 投影   | `src/gateway/data-governance/workspace-catalog-projection.ts`                                    |
| R6 脚本        | `scripts/verify-single-sot.mjs`                                                                  |
| **不存在**     | `src/gateway/workspace-catalog/` 与 `src/gateway/workspace-catalog/migrations`                   |

## 设计完成 vs 实现验证

| 项                                                                      | 状态                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------- |
| D1–D5 设计契约                                                          | **design complete / Design Convergence Accepted** |
| R6 机器验收（无 phantom migrations、无独立表、契约走 InMemory adapter） | **Accepted**（#815）                              |
| `resolveAuthorizedToolCwd` 生产接线                                     | **not implementation-verified**                   |
| P99 < 50ms                                                              | **design target, not verified**                   |
| R1/R3 安全测试、R5 审计失败                                             | **design target, not verified**                   |
| `implementationGate.status`                                             | **not-met**                                       |
| Implementation Unlock                                                   | **Not issued**                                    |
| Production Authorization                                                | **Not issued**                                    |

命令：`node scripts/verify-single-sot.mjs` 或 `pnpm verify:single-sot`。CI：`.github/workflows/ci-gate.yml` 的 `check (types, lint, format)` job。
