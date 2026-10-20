# 执行链排障

运行时代码在 `src/agents/execution-preflight/`。对话和定时任务都在 `runEmbeddedPiAgent` → `attempt.ts` 进入它。事件走原来的 `emitAgentEvent`，`stream` 为 `lifecycle`，`data.event` 为事件名。

## 技能有没有真正命中

看本轮事件：

- `skill_alias_resolved` 加上 `primary_skill_selected`：别名已经收成主技能。`data.skill` 是正主，不是别名。
- 只有 `execution_preflight_started` 和 `intent_classified`，没有 `primary_skill_selected`：这轮没有契约命中。模型仍按原提示词自选，工具集不被契约收窄。
- `decisionCode` 为 `skill_ambiguous`、`skill_alias_unresolved`、`skill_disabled`：没有主技能，写入工具已从候选移除。

`pptx` 命中后 `data.skill` 必须是 `cyber-ppt`。

## 工具是被过滤，还是根本不可见

看 preflight 的 `toolVisibility`（测试和类型里有；事件本身只记 `tools_filtered`）：

- `not_visible`：策略允许集里就没有它。
- `execution_denied`：策略里有，契约或阻塞决定把它拿掉了。
- `visible`：模型看得到，调用时仍可能被工作区或审批拒绝。

不要用「工具失败了」概括这三种。

## 权限问题还是资源问题

| 用户看到的情况             | 类                                                   | 下一步                 |
| -------------------------- | ---------------------------------------------------- | ---------------------- |
| 工具不在候选里             | `not_visible`                                        | 查工具策略，不要重试   |
| 工具在，调用被执行包装拒绝 | `authorization_denied` 或 `skill_contract_violation` | 不要换一个引擎绕过     |
| 审批没点或被拒绝           | `approval_required` / `approval_denied`              | 等用户，不要自动重试   |
| 路径越出工作区             | `resource_out_of_scope`                              | 请用户把材料放进工作区 |
| 502 / 连接重置             | `transient_failure`                                  | 回复层最多再试一次     |

分类函数是 `classifyExecutionFailure`。瞬时 HTTP 重试只有在它返回 `retryable: true` 时才会发生。

## 重试和 fallback

- 重试主人是回复层的那一次 HTTP 重试，不是模型。
- `fallbackAllowed` 对权限、审批、越界、契约违反都是 false。代码没有「换一个更宽的工具再试」。
- 契约违反抛 `SkillContractViolationError`。再调用同一禁止引擎会再次被拒，不会扩大权限。

## 交付有没有验收

有 `required-validators` 的技能：

- `attempt.ts` 把本轮写入路径和 sha256 交给 `resolveAttemptDelivery`。
- 没有路径或哈希：`delivery_blocked`。
- 哈希与回执不一致：`artifact_changed`。
- 任务、路径、哈希、校验器 id 或版本任一不匹配：拒绝交付。
- 只有已注册校验器的回执才能 `deliveryOutcome=allowed`。
- 校验器未注册：预检就是 `validator_unavailable`，不会等到最后一句才发现。
- 模型说「已完成」或工具元数据里的 `qa_passed` 都不能代替回执。

没有这些契约字段的普通回复不改写正文。当前仓库里的 `cyber-ppt` 不声明 `required-validators`。

跟踪只做运行时关联：进程内可按 `taskId` 读回，lifecycle 事件带上决策码、attempt 和产物哈希。进程重启后不能恢复。这不是完整审计日志。

`exec` 中的 `mcporter` 属于宿主执行，只做 MCP-shaped command detection only，不是 independent MCP authorization。终版引擎记号会被拦住；没有单独的 MCP 工具允许名单。

需要校验器的技能，完成声明只经过 `judgeCompletionSend`。回执生效前，流式回调只发送固定进度句「正在处理，结果尚未对外公布。」，不转发模型原文。`message`、`sessions_send`、渠道 `deliverOutboundPayloads` 和子代理转发在传输函数之前拒绝完成句。中性进度仍可从工具发出。

`required-validators` 和 `required-artifacts` 都是全满足。每一对「校验器 × 产物」都要有同一 task、同一路径、同一哈希、已注册版本的通过回执。少一份、版本不符、结果失败、路径或 task 对不上，都是 `delivery_blocked`。产物字节变化后旧回执失效，决策码是 `artifact_changed`。A 产物的回执不能用来通过 B 产物。

attempt 进行中的会话锁在 `runEmbeddedAttempt` 的 finally 和 `runEmbeddedPiAgent` 拿到返回值之后解除。解除的是这次 attempt 的锁，不是延迟交付上下文。延迟上下文按 taskId 保留，供随后的 cron `chat.inject` 和子代理 `runSubagentAnnounceDispatch` 读取。没有有效回执时这两个底层函数不会被调用。成功交付、明确失败、取消，或保留期限到期，才清理该 task 的上下文。清理计数只记原因和数量，不记正文、凭证或工具参数。同一 session 上的新 task 不继承旧 task 的回执。并发 task 各自保留，后一个不会盖掉前一个。

跟踪只覆盖本次请求的生命周期，进程重启后不能恢复，也不是跨进程审计。`mcporter` 仍是 MCP-shaped command detection only，不是 independent MCP authorization；后续若要独立授权，应改成结构化 MCP 工具，不在这里加新总线。运行包里的 `dist/build-info.json` commit 来自构建时写入的 Git commit，用来追溯那次构建，不能代替 PR head SHA。当前没有部署。

## json-canvas 生产校验器

第一个生产校验器是 `json-canvas-structure` 版本 `1`，只检查一份 `.canvas` 的 JSON 结构。宿主在预检时注册它。模型文本不能注册校验器。

技能 `skills/json-canvas/SKILL.md` 声明了 `required-artifacts`、`required-validators`、`delivery-blocked-until`、`generation-stage-tools` 和 `delivery-stage-tools`。这些字段在 `OPENBOT_CANARY_VALIDATORS` 不含 `json-canvas-structure` 时不生效，普通对话和其他技能保持原样。

回执绑定 taskId、artifactPath、artifactSha256、validatorId、validatorVersion、result、timestamp。缺产物、损坏、未注册、超时、异常、版本不符都不放行。校验结果只记原因码，不记文件正文。

这次同步校验的预算不是可抢占的运行时中断。解析前拒绝超过 512 KiB 的输入（`too_large`，不调用 JSON.parse）。结构检查结束后再读一次时钟，若已到 deadline，结果是 `timeout`，即使字节本身合法。它不能打断一次已经开始的 JSON.parse。

回执和延迟上下文都在进程内存里。成功、失败、取消或保留期限到期后按 task 清理，计数只记数量和原因。进程重启后内存清空，旧回执不能复用，交付失败关闭。没有跨进程恢复。

## 灰度部署门

canary 还没有切到生产。部署前要重新读取 `origin/main`，候选 SHA 必须等于该 tip，再读当前 LIVE `build-info`，通过 forward-only，然后才构建生产镜像并核对镜像内 SHA。生产校验器只对 canary 租户打开。需要能快速回退。监控只看 `validator_unavailable`、`validation_failed`、`artifact_changed`、`delivery_blocked`、`delivery_receipt_verified`，以及保留上下文的数量和清理原因。

当前建议：不部署。不构建生产镜像，不重启生产网关。执行链仍未完成。

## 长程任务

- 进度账本：看任务描述里是否同时有目标和验收条，以及 `gateway.progressLedger.enabled`。它只记账。
- 对话激活：环境变量 `OPENBOT_CONVERSATION_TASK_ACTIVATION`。未设置就是关，不会创建任务。
- 焦点门：`chat.send` 里的 `applyFocusSwitchGate`。确认冲突返回 `focus_conflict` 并挡住发送。会话文件缺失是 `focus_state_unavailable`，放行并计数，不写账本。

## 线上包和这次冒烟

生产流量没有切到这次构建。线上 build commit 仍是 `1617926868e64b3d65e1b2f37e488ba6e8fb08f0`。排障时如果事件里没有 `execution_preflight_started`，说明这台进程还是旧包。

审查记录要同时给出 PR head Git SHA、远端 `github/main` SHA，以及运行包 `dist/build-info.json` 的 commit。这个 commit 是 `scripts/write-build-info.ts` 在构建时写入的 Git SHA（归档没有 `.git` 时由 `GIT_COMMIT` 传入）。它只追溯那一次归档构建，不能代替 PR head SHA。若文档提交发生在构建之后，两者会不同，必须分别写出。

隔离冒烟从该归档的 `dist/entry.js` 监听 `127.0.0.1:18991`，不使用生产端口 18789，也不替换线上进程。行为检查在同一提交的模块里执行，不把生产对话接到这台隔离网关。执行链仍未完成，不能部署。已经离开进程的旧消息无法撤回。
