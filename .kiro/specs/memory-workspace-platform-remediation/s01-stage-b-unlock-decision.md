# S01 Stage B Unlock Decision

- **Owner**: `cursor-data-governance`
- **Role**: Stage B unlock packet owner
- **日期**: 2026-08-30
- **基线**: `origin/main` `ffd40b16a5`
- **selfAccepted**: `false`
- **stageBShadowUnlock**: `proposed`
- **stageBUnlockIssued**: `false`

这不是 Stage B 实现，不是 get-reply 接线，也不是第二套 S01 规范。
唯一设计 SoT 仍是 `handoff-s01-trusted-principal-handle-gate.md`。
Stage 边界仍是 V1.8 `handoff-s01-implementation-readiness.md`。

## 操作者已确认

| 项                              | 状态     |
| ------------------------------- | -------- |
| #844 IA1/IA2 修复               | 已合入   |
| #846 Kiro SoT Reviewer pass 2   | accepted |
| #847 Codex Architecture pass 2  | accepted |
| Stage A Adapter Implementation  | Accepted |
| remaining / liveWriteWatchIndex | 10 / 10  |
| implementationVerified          | false    |
| Stage B                         | locked   |

## 最小解锁条件（V1.8 Stage B 进入）

V1.8：Stage B 进入 = Stage A 及 A 安全/治理验收 `accepted`。

本包判定：**conditions-met**。

- Stage A Adapter Implementation accepted（操作者 + #846/#847）
- IA1/IA2 closed
- `get-reply.ts:164` 仍是 `resolveEmployeeBuiltinStewardWorkspaceDir`
- P5 仍在 scan；10/10
- `implementationVerified=false` 保持
- 未授权 LIVE / Item 7 / Phase 1B

## 本包不签发

Unlock 只 **proposed**，不 issued。Stage B 保持 locked，直到 `codex-architecture` 独立验收本包。

请写入（本包不创建、不代签）：

`docs/design/evidence/memory-workspace-s01-stage-b-unlock-review-codex-architecture.json`

验收通过后，下一步只允许 Stage B shadow wiring：

- `get-reply` 仅无副作用 shadow
- 旧 helper 仍决定用户可见 cwd
- flag off = legacy；P5 必须仍在
- 不得改 remaining / liveWriteWatchIndex
- 不得开始 Stage C/D/E
