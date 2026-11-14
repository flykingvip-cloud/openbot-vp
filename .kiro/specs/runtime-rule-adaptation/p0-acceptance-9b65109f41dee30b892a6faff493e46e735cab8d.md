# P0 验收摘要 — runtime-rule-adaptation

- 时间：2026-11-12（Asia/Shanghai）
- 验收负责人：`codex-runtime-manager`
- 本文件是执行盘点提交的验收材料，不代表已经独立验收通过。
- 文件名中的 SHA `9b65109f41dee30b892a6faff493e46e735cab8d` 是 **inventory baseline**（盘点引用、行号、结论所固定的实现 SHA），**不是**已接受的提交交付 SHA，也不是当前工作树在 loom 登记后的 HEAD。
- 已获授权完成本文件的 P0 纠正收口与 P1 合约设计（仅规格）。P0 独立验收通过并另获授权前：不实现校验器、不调用模型、不启用策略。

## 1. 固定验收 SHA / 工作树状态

| 项                                                   | 值                                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘点 / 行号 / 本文件名基线 SHA（inventory baseline） | `9b65109f41dee30b892a6faff493e46e735cab8d`                                                                                                                                                                                                               |
| 当前工作树 HEAD（登记用，可晚于盘点 SHA）            | `4a786626a1e2892043f57b3832ddf2a407be284a`                                                                                                                                                                                                               |
| 分支                                                 | `main`                                                                                                                                                                                                                                                   |
| 远程跟踪                                             | 再 fetch 后 `origin/main` = `4a786626a1e2892043f57b3832ddf2a407be284a`，且 `9b65109f…` 是其祖先（快进关系成立）                                                                                                                                          |
| 工作树路径                                           | `/workspace/openbot-vp-runtime-rule-adaptation`                                                                                                                                                                                                          |
| 克隆来源                                             | 自 `https://github.com/flykingvip-cloud/openbot-vp` 的 origin/main 新建，未复用其他任务工作树                                                                                                                                                            |
| 开工时工作树                                         | 干净，HEAD 当时等于盘点 SHA `9b65109f…`                                                                                                                                                                                                                  |
| 快进                                                 | 已快进 `9b65109f…` → `4a786626…`（#277 `feat(gateway): 隔离网关执行协议成果下载与回环身份头收紧`）。未跟踪的 P0 规格在快进中保留                                                                                                                         |
| #277 与政策路径                                      | **无重叠**。#277 只改 gateway 执行协议/身份头、相关 config/docs 与 `.loom/registry.yaml`，未触及 `src/agent-runtime/policy/**`、`src/agent-runtime/contracts/policy.ts` 及相关规则强制执行。因此盘点行号仍钉在 `9b65109f…`，与当前 HEAD 在政策实现上兼容 |
| 交付后工作树                                         | 规格文档（四份 P0 纠正 + 两份 P1 规格，均未跟踪）+ `.loom/registry.yaml` 外科插入 18 行（已修改、未提交）。**未改运行时代码**                                                                                                                            |
| 提交 / PR / 部署                                     | 未获授权，未执行                                                                                                                                                                                                                                         |

`git fetch origin` 已在开工时与快进前、写入前再次执行。盘点 SHA 的 `git log -1`：`fix: local UI seams, peer display, and interaction admission (#276)`。当前 HEAD 的 `git log -1`：`feat(gateway): 隔离网关执行协议成果下载与回环身份头收紧 (#277)`。

## 2. 盘点规则数量及分类

| 集合                                  | 数量                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 目录已登记                            | 27                                                                                                     |
| 目录 `retain`                         | 25                                                                                                     |
| 目录 `pending_migration`              | 2（`task.focus.switch`，`task.reply.completion`）                                                      |
| 现役未登记（临时 `INV-P0-001`…`005`） | 5                                                                                                      |
| 明确不升格 / 观察保留                 | 见 `current-rule-map.md` §3（含 prompt-mode、ClaimContract、`classifyTurnRelation`、cron 同名 helper） |

已登记条目按本盘点**主性质**：

| 主性质                                    | 数量 |
| ----------------------------------------- | ---- |
| 硬约束                                    | 13   |
| 条件强制                                  | 9    |
| 有界参数（常与硬下限并存）                | 5    |
| 偏好（作为目录主标签）                    | 0    |
| 兼容/待迁（目录 disposition，与上表交叉） | 2    |

字段级混合（例如 `collab.policy.compile` 内含不变量与偏好）以规则地图和决策表为准，不重复计数为第二套目录。

## 3. 目录已覆盖 / 未登记 / 证据不足

**已覆盖：** 目录 27 条的实现文件在盘点 SHA 均存在；生产消费者已按符号检索核对（定义 / 生产调用 / 测试 / 再导出 / 动态加载）。目录查询 API 无生产消费者。#277 未改这些实现文件。

**现役未登记：**

- `INV-P0-001` 已接受成果外发与组终稿资格（`accepted-artifact-delivery.ts`）
- `INV-P0-002` 协作交接（`collaboration-handoff.ts`）
- `INV-P0-003` `SYSTEM_INVARIANTS` 的直接消费及同值双常量
- `INV-P0-004` `claimBoardActionAllowed` 板动作状态机
- `INV-P0-005` 工具前 `checkTaskActionBoundary`（`task.binding.current` 的晚到执行点）

**证据不足 / 未读：** 生产配置与 flag 现值；全渠道投递生产行为；hooks / Lobster / OpenProse 作为可适配规则的证据；async-wait 恢复全链路；ConversationTask/ledger/SessionTaskBoard 完成权威闭环。T9 外发接线（含 `outbound_auth_unwired`）保持独立缺口，不在本任务补偿。

**目录元数据与三种版本（纠正）：**

- 全部目录 `version` 仍为 `inventory:efdb1b98d83e096a31e251095080de954f5883ec`。这是 **inventory version**，预期可落后于 HEAD 乃至落后于盘点实现 SHA。
- **不得**仅因该 pin 与 HEAD（`9b65109f…` 或后来的 `4a786626…`）不同，就宣布规则版本无效。
- 须区分：inventory version（上）、implementation version（本盘点固定 `9b65109f…`）、effective policy version（如 `POLICY_COMPILER_REVISION=1.2.0`、协议 `1.1`、现行 `policyHash` / 有效窗口 / lane）。兼容判断见 `contracts-and-merge-semantics.md` §4。
- 缺失目录所列测试文件：`src/agent-runtime/policy/task-board-limits.test.ts`、`src/agent-runtime/state/mutations/claim-queued-execution.test.ts`
- 若干目录 `tests: []` 但树中已有测试（如 context-window）
- 2026-11-09 coverage 文档部分路径/owner/disposition 已过期；本盘点以盘点 SHA 源码为准

## 4. 个人与协作 shadow-proposal 候选（不是运行时白名单）

详细字段见 `first-scope-decision-table.md` §6。两个候选都是覆盖已有配置字段的 **shadow-proposal 候选**；动态调整授权尚未建立；它们**不是**运行时白名单。独立验收前**不生效**，运行时白名单**未修改**。配置来源 ≠ 调整授权。

| 场景 | 候选                                                          | 建议允许操作                                                                                                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 个人 | `model.context_window.guard`                                  | 仅对已有 `agents.defaults.contextTokens` 做有界收紧的 shadow 提案。合约：`16000 ≤ proposedValue ≤ currentEffectiveValue`。上限是含已有帽的当前有效窗口，不只是模型窗口。例：有效 32000，提案 64000 必须拒绝。删除帽或恢复更高值属放宽，须单独授权并重核，不是普通收紧。删除参数不是合法回退。有效值未知或低于 hardMin 时，不生成可执行调参提案。 |
| 协作 | `collab.policy.compile` 的字段 `maxVisibleBotRepliesPerRound` | 仅对该字段做有界收紧的 shadow 提案：`1 ≤ proposedValue ≤ currentEffectiveValue`（且 ≤ 12）。例：当前有效上限 3，提案 5 必须拒绝。不得把整个 compile 包当作可任意调参。非法提案须显式拒绝，不得用编译器钳制冒充原提案通过。不改 lane，不建立第二套参数权威。                                                                                      |

未入选（避免发明可调权限或触碰强制边界）：`requirePeerReview`、自进与决策模式放宽、外发授权、租户隔离、取消围栏、`replyLanguage`（lane 默认 legacy，执行证据不足）、`maxBeatsPerEpisode` 上调、无运行时授权主体的源码常量限额、`prompt-mode`。自进/决策/密级默认属「语义及授权边界待核准」，不得自动写成硬约束违反，但首期仍不开放。

## 5. 重复权威或缺执行点

**重复 / 双源（现值相同，存在漂移风险）：**

- `MAX_PARKED_TASKS=3` 与 `MAX_PARKED_SLOTS=3`：源码明确为不同语义，禁止混用。
- `SYSTEM_INVARIANTS.maxVisibleRepliesCeiling=12` 与 `COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT=12`（`gateway/collaboration-dispatch/types.ts`）。
- cron 本地 `normalizeDeliveryTarget` 与 policy 同名函数：同名不同义，不是第二套出站授权。
- `compileEffectiveCollaborationPolicy` 文件头仍写 “no consumers yet”，但 `resolve-effective-policy.ts` 已是生产组合根。Gateway policy-compiler 仅为再导出，不是第二算法。适配层也不得成为第二套参数权威。

**执行缺口 / 声明与实现不一致：**

- `evaluateContextWindowGuard` 未用于 `compact.ts` / `extensions.ts`（只解析窗口）。
- `evaluateContextWindowGuard` API 允许把硬下限降到 1；主入口虽传入常量 16000。
- `evaluateGroupFinalDeliveryEligibility` 在身份完整时返回 `outbound_auth_unwired`（T9 独立缺口）。
- 不变量声明 `l2CannotWidenL1`。须区分 L1 **强制边界**与 **可覆盖默认**。部分 L2 字段（自进、决策模式、密级 `public`）当前编译器允许与 L1-Default 不同、且按日常语义更宽——记为「语义及授权边界待核准」，**不得**把“默认 false 改为 true”自动视为违反硬约束。本阶段不修编译器。
- 目录 enforcementPoints 未列出 `checkTaskActionBoundary` / before-call。
- 声称“有测试路径”但文件缺失：见 §3。

未发现“必须新造第二调度器才能继续盘点”的阻断；也未把主链断裂当作本任务可修复项。T9 外发未完全接线不在此修复。

## 6. 验证命令及结果

实际使用的检索（均在仓库根 `/workspace/openbot-vp-runtime-rule-adaptation`，对盘点 SHA `9b65109f41dee30b892a6faff493e46e735cab8d` 的实现；通过向 `rg` 显式传入路径以避免非 TTY 下读 stdin）。快进后再次核对 #277 文件列表与政策路径重叠：

```text
git fetch origin
git rev-parse HEAD origin/main
git merge-base --is-ancestor 9b65109f41dee30b892a6faff493e46e735cab8d origin/main
git merge-base --is-ancestor HEAD origin/main
git status --porcelain=v1
git diff --name-only 9b65109f41dee30b892a6faff493e46e735cab8d..origin/main -- src/agent-runtime/policy src/agent-runtime/contracts/policy.ts
# 提取 catalog.ts 的 27 个 id，并核验 implementation / tests 路径是否存在
# 对 policy 导出符号做生产/测试/文档分类检索
# 对目录外实现（runAdmittedTurn、interpretInteraction、confirmPendingTurnDelivery、
#   claimQueuedExecution、focus-switch、reply-completion 等）做调用点检索
# 检索 SYSTEM_INVARIANTS、requirePeerReview、contextTokens、collaboration.lane、
#   compileEffectiveCollaborationPolicy、normalizeDeliveryTarget、classifyTurnRelation
git diff --check -- .kiro/specs/runtime-rule-adaptation/
```

结果：

- 开工基线祖先关系成立，开工时工作树干净。其后快进合法；#277 对政策实现路径的 name-only diff 为空。
- 27 个 implementation 路径全部存在。
- 目录测试路径缺失 2 个（已记录）；其余目录所列测试路径存在。
- 符号检索区分了生产调用、测试、再导出；目录 API 无生产调用。
- `git diff --check`：见交付时现场执行记录（仅规格路径；registry 插入另行检查）。
- 本阶段无运行时代码修改，未跑全库测试。未把测试文件存在视为测试通过。
- 未读取生产凭证或生产配置。
- loom：正式 register 因全量重写共享 registry 已撤销；已外科插入本任务 18 行并 `loom lint --strict` 退出码 0。未 commit。

文档内引用的源码路径与符号已按盘点 SHA 核对；行号相对 `9b65109f41dee30b892a6faff493e46e735cab8d`。

## 7. 未完成项与建议

1. loom 登记已在当前 origin/main 树上路径限定写入（未提交）。若登记负责人需要用官方 CLI 重放，须先避免 `stringifyYaml` 对热 registry 的全量重写；拟命令见 `tasks.md`。
2. 独立验收通过并另获授权前不要实现 P1 校验器。校验应拒绝未知 ID、越权参数、非候选字段、无调整授权、过期/滞后的**有效策略或任务版本**、以及不兼容的**实现版本**。目录 inventory pin 与 HEAD 不同不单独构成拒绝。非法提案须显式拒绝，不得静默钳制后当作原提案通过。
3. 后续（非本阶段）最小修复建议：统一 visible-reply 天花板单一权威；context-window 在 compact/extensions 路径补阻断；就 `l2CannotWidenL1` 的强制边界与可覆盖默认做语义及授权核准；修正目录测试路径与（可选）刷新 inventory pin。不要在适配层补偿 T9。
4. 生产 lane / `contextTokens` / `requirePeerReview` 等现值仍未知，验收或 P1 若需要必须以当时读取的配置为准，不得沿用本文件猜测。有效值未知或低于 hardMin 时，不生成可执行调参提案。

## 8. 交付文件绝对路径

工作树内：

- `/workspace/openbot-vp-runtime-rule-adaptation/.kiro/specs/runtime-rule-adaptation/tasks.md`
- `/workspace/openbot-vp-runtime-rule-adaptation/.kiro/specs/runtime-rule-adaptation/current-rule-map.md`
- `/workspace/openbot-vp-runtime-rule-adaptation/.kiro/specs/runtime-rule-adaptation/first-scope-decision-table.md`
- `/workspace/openbot-vp-runtime-rule-adaptation/.kiro/specs/runtime-rule-adaptation/p0-acceptance-9b65109f41dee30b892a6faff493e46e735cab8d.md`
- `/workspace/openbot-vp-runtime-rule-adaptation/.kiro/specs/runtime-rule-adaptation/contracts-and-merge-semantics.md`
- `/workspace/openbot-vp-runtime-rule-adaptation/.kiro/specs/runtime-rule-adaptation/p1-validation-test-matrix.md`

副本：

- `/workspace/runtime-rule-adaptation-p0/tasks.md`
- `/workspace/runtime-rule-adaptation-p0/current-rule-map.md`
- `/workspace/runtime-rule-adaptation-p0/first-scope-decision-table.md`
- `/workspace/runtime-rule-adaptation-p0/p0-acceptance-9b65109f41dee30b892a6faff493e46e735cab8d.md`
- `/workspace/runtime-rule-adaptation-p0/contracts-and-merge-semantics.md`
- `/workspace/runtime-rule-adaptation-p0/p1-validation-test-matrix.md`

限幅 diff：仅 `.kiro/specs/runtime-rule-adaptation/`，见 `/workspace/runtime-rule-adaptation-p0/limited.diff`。`.loom/registry.yaml` 的外科插入不计入该 diff。未 commit。
