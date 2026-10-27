# TEAM-REAL F1–F3：任务激活 / 计划确认 / 团队成果提交（审查 A–E 响应）

- 日期：2026-10-27（Asia/Shanghai）
- 分支：`fix/team-real-collab-activation-confirm-deliverable`
- PR：https://github.com/flykingvip-cloud/openbot-vp/pull/128
- 规避：不改 #34/#67/#68 formal-root twin remount；不新建平行成果权威；不做 A/B 双向同步；不扩大沙箱挂载。

## 审查结论响应（NEEDS CHANGES → 本轮）

### A 授权与会话
- `authorizeTeamGroupResourceAccess` 复用 `assertGroupMemberAccess` + membership tenant + `resolveTrustedGroupLocator`。
- 提交前校验 task 存在/归属；读取前校验读权；拒绝时 `writtenToGroupDir:false` 且不返回正文。
- `checkDispatchReadiness`（operator.read）只接受 memberId，注册/归属/会话从权威 roster 解析；**默认不写会话**。
- 会话创建改走 write 方法 `collaboration.task.ensureMemberSession`，并校验 sessionKey↔agent 绑定；空 session ≠ 模型/工具就绪。

### B 任务控制 + 激活幂等
- task 写入改走 `withTaskControlLock`；**不重开** completed/cancelled。
- 未确认仅 draft；确认后才 ready。
- `activationKey` 含完整合同指纹，落入 task.tags；冲突拒绝；board list 失败显式错误。
- 看板态使用 `submitted_for_review`；board 已发布但 OS sync 失败 → `partial_success`（`boardPublished:true`）。

### C 成果 locator / 路径 / 版本
- 复用 objectStorage deliverable + group `deliverables/` locator（非平行库）。
- 持久化 `relativePath` / `contentSha256` / `formalLocator`；幂等回放返回**原回执**并校验内容。
- 父目录 symlink 逃逸拒绝；不可变版本路径；先对象后原子文件写，避免覆盖后回滚删。

### D 真实接线
- `chat.send` → `maybeConfirmPlanFromChatSend`（与 UI 同一 `confirmCollaborationTodolist`）。
- `precheckDispatchReadiness` 供派工前调用；readiness RPC 已挂 pack。
- **缩小范围**：未改 `claim-contract-entry` / `claimBoardItem` 热实现体（避免回归）；正式派工前产品须调 readiness；agent DELIVERABLE settle/formal-root 热文件未改。

### E 质量
- NL confirm：无 `expectedVersion` 且无 card binding（todolistId+boardItemId）时拒绝，不默认当前唯一 proposed。
- 相关 vitest 31 通过；未跑 F4/F5；未合入；未切 18789。

## 分栏结论
| 栏 | 判定 |
| --- | --- |
| 代码修复 | 本 PR（审查 A–E 响应） |
| 隔离验证 | vitest 本 pack 相关 |
| 真实小闭环 F4 | 未执行 |
| 复杂任务 F5 | 未执行 |
| 生产启用 | 未授权 |

## R2 三包收敛（相对 tip b35dc8b9）

- 包1：`authorizeTeamGroupResourceAccess` 的 groupLocator/groupsRoot 贯穿 submit/read/task 查找；write≠read（observer/非 active 拒写）；readiness 仅活跃 bot + agent registry，严格 sessionKey；`precheckDispatchReadiness` = **基础接口待接入**（未强制进 claim/派工链）。
- 包2：激活查重+发布同一 `withTaskControlLock`；JSON 规范化完整指纹含 Due/suggestedClaimants；质量不足保持 draft；chat.send await 确认并 surface，从 owner-decision delivery 绑定 version，确认轮不进入依赖执行。
- 包3：`writeFileExclusiveImmutable`（wx）；withRoundLock；幂等校验磁盘文件，缺失 → `idempotent_replay_file_missing`。
- **缩小范围 / 剩余接线**：未改 claimBoardItem / claim-contract-entry / formal-root settle；agent 成果工具未强制走 submitTeamDeliverable。
- 不合入 main / 不切 18789 / 不做 F4（待真实聊天+agent 链接通后再复审）。

