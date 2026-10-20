# Handoff S01 #818 归档（指针，不是第二套规范）

> **状态**: `superseded-archive`  
> **不是第二套规范**。唯一 handoff / 唯一规范是 unique handoff。  
> **来源**: 已关闭的 PR #818（`kiro-daibai/handoff-s01-clean` @ `8ce0710af1bc`）。

\#818 无法按原文合入 `main`：

1. 必过检查 `check (types, lint, format)` 因 oxfmt 失败（`handoff-s01-re-review-request.md`、`handoff-s01-reference-map.md`）。
2. 覆盖 `docs/design/handoff-s01-design-review-guide.md` 会丢掉 `唯一 handoff` / `SUPERSEDED`，主干 R6 `scripts/verify-single-sot.mjs` 会失败。
3. `scripts/verify-single-sot.ts` 与 `handoff-s01-revision-r6-single-sot-verification.md` 把不存在的 `src/gateway/workspace-catalog/migrations` 当成失败。Accepted R6 要求该目录**不存在**。

本 PR **不**加入 `scripts/verify-single-sot.ts`，**不**覆盖已接受的 review guide。下列文件仅作归档，文首均为 **SUPERSEDED as second spec**。

| 归档文件                                                              | 说明                                     |
| --------------------------------------------------------------------- | ---------------------------------------- |
| `docs/design/handoff-s01-consolidated.md`                             | 合并稿                                   |
| `docs/design/handoff-s01-convergence-plan.md`                         | 收敛计划                                 |
| `docs/design/handoff-s01-d1-convergence-patch.md`                     | D1 补丁                                  |
| `docs/design/handoff-s01-d1-trusted-principal-contract.md`            | D1 展开                                  |
| `docs/design/handoff-s01-d2-d4-d5-convergence-patches.md`             | D2/D4/D5 补丁                            |
| `docs/design/handoff-s01-d2-workspace-handle-model.md`                | D2 展开                                  |
| `docs/design/handoff-s01-d3-catalog-extension.md`                     | D3 展开                                  |
| `docs/design/handoff-s01-d4-resolve-authorized-tool-cwd-interface.md` | D4 展开                                  |
| `docs/design/handoff-s01-d5-regression-prevention-test-plan.md`       | D5 展开                                  |
| `docs/design/handoff-s01-design-completion-summary.md`                | 完成总结                                 |
| `docs/design/handoff-s01-r6-acceptance-blockers.md`                   | R6 阻塞说明（历史）                      |
| `docs/design/handoff-s01-re-review-request.md`                        | 再评审请求                               |
| `docs/design/handoff-s01-reference-map.md`                            | 引用图                                   |
| `docs/design/handoff-s01-revision-plan.md`                            | 修订计划                                 |
| `docs/design/handoff-s01-revision-r1-anonymous-local-security.md`     | R1                                       |
| `docs/design/handoff-s01-revision-r2-authorization-matrix.md`         | R2                                       |
| `docs/design/handoff-s01-revision-r3-trusted-proxy-threat-model.md`   | R3                                       |
| `docs/design/handoff-s01-revision-r4-performance-benchmark.md`        | R4                                       |
| `docs/design/handoff-s01-revision-r5-audit-failure-semantics.md`      | R5                                       |
| `docs/design/handoff-s01-revision-r6-single-sot-verification.md`      | R6 旧稿（错误地要求 phantom migrations） |
| `docs/design/handoff-s01-revision-r7-r8-documentation-consistency.md` | R7/R8                                    |
| `docs/design/handoff-s01-revision-summary.md`                         | 修订摘要                                 |

裁决不变：S01 Design Convergence Accepted；R6 Accepted；Implementation Unlock **Not issued**；Production Authorization **Not issued**。
