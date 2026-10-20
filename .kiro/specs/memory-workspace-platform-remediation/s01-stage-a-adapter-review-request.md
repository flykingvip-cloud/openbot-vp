# S01 Stage A 合同复审请求

- **请求人**: `codex-architecture`
- **日期**: 2026-08-30
- **包**: `.kiro/specs/memory-workspace-platform-remediation/handoff-s01-stage-a-adapter.md`
- **Evidence**: `docs/design/evidence/memory-workspace-s01-stage-a-adapter.json`
- **状态**: `stage-a-contract-resubmitted`
- **selfAccepted**: `false`
- **implementationAuthorized**: `false`

这不是实现解锁，也不是 S01 设计规范。唯一设计 SoT 仍是 `handoff-s01-trusted-principal-handle-gate.md`。
#833 已在合同双审前落地生产 adapter；本包 **不接受** 该落地，`implementationAuthorized=false`。

## 请独立复审

| Reviewer             | 请关注                                                                                                                   | 请写入                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `codex-architecture` | 已删除独立表；resolver 不再是 `(handle, toolName)`；输入含 TrustedPrincipal / workspaceResourceId / membership / fencing | `docs/design/evidence/memory-workspace-s01-stage-a-adapter-review-codex-architecture.json` |
| `kiro-sot-reviewer`  | Catalog 唯一 SoT；fail-closed；本包未改生产文件；#833 未授权；scan 10/10                                                 | `docs/design/evidence/memory-workspace-s01-stage-a-adapter-review-kiro-sot-reviewer.json`  |

请勿代签对方。本包未自签 `accepted`。双审通过前不得接受 Stage A 实现。

## 请确认已关闭

- SA1：无独立 table 字段；无 `workspace_handles` / `authorized_cwds` 作为 adapter 存储
- SA2：cwd 合同对齐 D1–D4，不是简化签名
- SA3：Catalog miss、重复 binding、租户不匹配、membership 缺失、stale fencing 均 fail-closed

## 请核对

```
decision: accepted | changes-required
Stage A implementation: blocked
production Catalog write: none
S01 retirement: blocked
Item 7: not-met
Phase 1B: blocked
I3: not executed
LIVE: forbidden
remaining = 10
liveWriteWatchIndex = 10
```
