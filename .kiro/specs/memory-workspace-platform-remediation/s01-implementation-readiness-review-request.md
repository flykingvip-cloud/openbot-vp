# S01 Implementation-Readiness 复审请求（V1.8 / IR1–IR4）

- **请求人**: `codex-architecture`
- **日期**: 2026-08-30
- **包**: `.kiro/specs/memory-workspace-platform-remediation/handoff-s01-implementation-readiness.md`
- **Evidence**: `docs/design/evidence/memory-workspace-s01-implementation-readiness.json`
- **状态**: `implementation-readiness-resubmitted`
- **selfAccepted**: `false`
- **前次**: #825 / #826 仍为 `changes-required`。请勿沿用该结论，也勿沿用 V1.7 的观察期暗接线或 9===9 预期。

这不是 S01 设计规范，也不是实现解锁。唯一设计 SoT 仍是 `handoff-s01-trusted-principal-handle-gate.md`。

## 请独立复审

| Reviewer             | 请关注                                                                                                                                               | 请写入                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `kiro-sot-reviewer`  | `targetIdentity` 非空且含 `workspaceResourceId`/`agentAssetId`；禁止 path-based identity；Shadow 保持 P5 与 10/10；两计数独立定义；lander 不得改计数 | `docs/design/evidence/memory-workspace-s01-implementation-readiness-review-kiro-sot-reviewer.json`  |
| `codex-architecture` | 映射链；Shadow ≠ Cutover；cutover 无 runtime helper fallback；回滚须 revert + 恢复 scan；Stage A–E 独立验收                                          | `docs/design/evidence/memory-workspace-s01-implementation-readiness-review-codex-architecture.json` |

请勿代签对方。本包 **未** 自签 `accepted`。`implementationGate` 仍为 `not-met`。

## 请确认已关闭

- IR1：`targetIdentity` 合同完整；权威映射链到唯一 `workspaceResourceId`；`agentId` 只是 slug
- IR2：`shadowFlagOffKeepsLegacyAndP5InScan` / `cutoverHasNoRuntimeHelperFallback` / `rollbackRequiresRevertAndScanRestoration`；已废止 flagOffRestoresHelperWithoutScanRewrite
- IR3：`remaining` 与 `liveWriteWatchIndex` 定义分开；当前无独立 write-watch 证据故不计划 9/10；lander 不得改任一数值
- IR4：Stage A–E 各有独立 Loom/PR/evidence/reviewer/门禁

## 通过前禁止

- 修改 `get-reply.ts` / `src/memory/**` / `workspace-resolver/**` / 生产 `data-governance/**`
- 写生产 Catalog、删除 S01、改写 scan
- 执行 I3、签发 Phase 1B unlock、`deployAuthorized=true`、LIVE
- 开始 Stage A

## 请核对的结论栏

```
decision: accepted | changes-required
production Catalog write: none
S01 retirement: blocked
Item 7: not-met
Phase 1B: blocked
I3: not executed
LIVE: forbidden
implementationGate: not-met
remaining = 10
liveWriteWatchIndex = 10
thisPacketStartsProductionImplementation: false
selfAccepted: false
```
