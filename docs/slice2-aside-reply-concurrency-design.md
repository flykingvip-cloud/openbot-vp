# 切片 2 旁白：普通插问并发回复 — 设计说明（不实施）

时区：Asia/Shanghai。PR #216。  
**本文件仅设计，本轮不实施 reply_lane / 并发独立 LLM。**  
切片 2 普通插问状态：**未完成**。不与切片 3 混名。

## 1. 问题

进度查询与 board_readonly 已可即时答；一般插问 B 在 A 活跃时仍可能走 collect **followup 串行**，主人得不到及时可见回复。「入队成功」≠完成。

## 2. 可复用的既有并发机制（候选，须验证）

| 机制 | 现状 | 复用方式 | 风险 |
|---|---|---|---|
| 独立 `runId` / `idempotencyKey` | chat.send 已有 | B 全程挂自己的 run 身份 | 终局清理若按 session 一把清会误伤 A |
| `chatAbortControllers` map | 按 run 登记 | B 自有 AbortController；暂停/取消可同时 abort A+B 或按策略 | 取消范围若只按 sessionId 会误伤或漏伤 |
| Embedded PI 多 run | 需核实同 session 是否允许第二 embedded 运行 | 若运行时已支持并行只读 run，则挂 reply-only 工具集 | 会话锁 / 转录写入是否互斥未证 |
| followup 队列 | 默认 collect | **降级路径**：无法隔离写工具时诚实串行并标明「任务结束后作答」 | 不能伪装已即时答 |
| steer | 已有 amend 注入 | **不用于**一般插问（会混入 A 工具循环） | 已否决 |

**结论**：不新增任务控制者；若实施，优先「原入口旁路 + 独立 runId + 只读工具集」，否则降级 followup 并诚实披露。

## 3. 必须证明的隔离（实施前闸门）

「禁止工作区写工具」**不足以**证明隔离。实施前须有失败用例覆盖：

1. **转录写入**：B 的 assistant/user 行不得写入 A 的流缓冲或错误归属 `chatRunId`
2. **会话锁**：B 不得长期占用导致 A 的 tool 回合饿死或死锁；或证明只读短回合不争写锁
3. **取消范围**：主人「暂停 A」→ A abort；B 的生命周期策略显式（一并停 / 允许答完）；不得复活 A
4. **事件归属**：gateway broadcast / UI `chatRunId` 按消息身份分桶；A final 不 `removeChatRun(B)`，B 结束不清 A abort controller
5. **任务板 / 工作区**：B 禁止 `commitSameTaskConstraint`、禁止写工具；不得并发改同一任务资源

## 4. 与切片 3 的边界

切片 3 已增强约束日志、恢复提示与判定上下文；**不**依赖 reply_lane。  
本设计实施与否不影响切片 3 验收序列（插问步骤可用 disposition / board_readonly 证明「查询不写状态」）。

## 5. 实施前交付物（若获批准）

- 红灯：并发转录串流、取消误伤、板被 B 写入
- 最小 diff 范围清单 + 资源隔离测试
- 仍禁止第二任务引擎 / 独立裁决模型 / 自动替代唤醒
