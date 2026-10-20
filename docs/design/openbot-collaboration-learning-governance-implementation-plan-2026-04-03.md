# OpenBot 协作学习治理升级实施方案

Date: 2026-04-03

> 归档说明
>
> 原始 `2026-04-03` 方案文件当前未保留在工作树中。本文档依据当前仓库内已落地实现、`2026-04-09` 收尾文档、第二宿主验证文档与相关测试入口重建，用于恢复方案链路与验收上下文。
>
> 因此，本文保持“当时的实施方案”口径描述目标、范围、步骤与验收标准；若与当前最终落地存在表达差异，应以后续收尾和验证文档为准。

## Related Docs

- 收尾报告：[/design/openbot-collaboration-sdk-closeout-2026-04-09](/design/openbot-collaboration-sdk-closeout-2026-04-09)
- 收尾检查清单：[/design/openbot-collaboration-sdk-closeout-checklist-2026-04-09](/design/openbot-collaboration-sdk-closeout-checklist-2026-04-09)
- 下一阶段决策：[/design/openbot-collaboration-sdk-next-stage-decision-2026-04-09](/design/openbot-collaboration-sdk-next-stage-decision-2026-04-09)
- 第二宿主最小接入方案：[/design/aegis-second-host-minimal-integration-plan-2026-04-09](/design/aegis-second-host-minimal-integration-plan-2026-04-09)
- 第二宿主验证报告：[/design/aegis-second-host-validation-report-2026-04-09](/design/aegis-second-host-validation-report-2026-04-09)

## 1. 背景

OpenBot 当前已经具备协作群、群画像、参与覆盖层、session 上下文、memory flush、gateway 控制面与 workbench UI 等基础设施，但“协作学习”与“治理对象”仍然分散在多个局部能力中，缺少一条可闭环的主链：

1. 群内沉淀的经验还不能稳定回流为结构化学习资产。
2. 学习资产还不能稳定影响 bot 的能力上下文与行为边界。
3. task / deliverable / review / decision 等治理对象缺少统一的持久化读模型与前台操作路径。
4. OpenBot 专属实现与可跨宿主复用的领域/运行时逻辑尚未清晰分层。

本次升级的目标，是把“协作学习”和“治理对象”从局部能力，提升为可测试、可验证、可收敛、可跨宿主复用的正式能力边界。

## 2. 总目标

本阶段要完成四件事：

1. 形成正式的协作领域层与运行时层边界。
2. 打通 memory -> capsule -> projection -> asset -> capability context 的学习回流闭环。
3. 打通 task / deliverable / review / decision 的治理对象持久化、查询、状态流转与 workbench 展示。
4. 为未来第二宿主验证保留清晰 adapter 边界，但本阶段不拆仓、不发布、不切流。

## 3. 非目标

本阶段明确不做：

1. 不把协作能力拆出当前主仓。
2. 不做 npm 对外发布。
3. 不把 OpenBot 专属适配层泛化为通用宿主层。
4. 不把第二宿主接入纳入当前主链路切换。
5. 不把 workbench 之外的所有旧 UI 表面一次性全部重写。

## 4. 目标边界

本次升级按三层边界设计：

### 4.1 collaboration-core

职责：

1. 纯领域对象
2. 状态机
3. 学习投影策略
4. 能力覆盖与参与规则
5. 模板、健康度、判定函数

要求：

1. 不依赖 OpenBot 宿主基础设施
2. 可独立测试
3. 可被第二宿主消费

### 4.2 collaboration-runtime

职责：

1. route
2. projection
3. context builder
4. gate controller
5. learning promotion

要求：

1. 只依赖 `collaboration-core`
2. 不依赖 OpenBot 文件系统、gateway 或 UI
3. 保持运行时规则层可测试、可宿主无关消费

### 4.3 collaboration-openbot-adapter

职责：

1. OpenBot 文件存储适配
2. metadata/object storage
3. session / directory / audit 适配
4. 把 core/runtime 接到当前 OpenBot 基础设施

要求：

1. 明确是 OpenBot 专属层
2. 不作为第二宿主直接复用边界

## 5. 关键业务链路

### 5.1 学习回流链路

目标链路：

`memory flush -> GroupMemoryCapsule -> LearningProjection -> AgentLearningAsset -> capability context`

要求：

1. 仅在存在协作群上下文时触发。
2. 支持按 confidentiality tier 控制 sensitivity / reusability / promotion。
3. restricted / secret 内容不得无条件提升为 bot 的个人可迁移能力。
4. 最终可被系统提示或能力上下文消费。

### 5.2 治理对象链路

覆盖对象：

1. `Task`
2. `Deliverable`
3. `Review`
4. `Decision`

要求：

1. 四类对象都要具备正式持久化读写边界。
2. 四类对象都要具备状态机或状态流转校验。
3. Gateway 要能返回 group + bot 作用域下的治理对象快照。
4. Workbench 要能展示列表页、详情页及关键操作。

### 5.3 协作能力上下文链路

目标链路：

`group profile + participation overlay + personal capabilities + promoted capabilities -> effective capability context`

要求：

1. 最终输出可直接进入系统提示的结构化文本或等价上下文。
2. 明确 confidentiality 与 policy filters。
3. group/overlay 限制不能被 promoted capability 绕过。

## 6. 实施范围

### 6.1 后端

需要完成：

1. 协作学习存储目录与 group file store 约定
2. Gateway collaboration snapshot 读取能力
3. task / deliverable / review / decision 的 transition handler
4. decision draft 更新 handler
5. memory flush 回流逻辑
6. capability context builder 接线

### 6.2 前端

需要完成：

1. active session 的 collaboration governance snapshot 投影
2. collaboration learning snapshot 拉取控制器
3. governance action 控制器
4. workbench 治理视图
5. 对 task / deliverable / review / decision 的 detail 页面
6. decision draft 编辑与保存

### 6.3 包结构

需要完成：

1. 三包正式 `package.json`
2. 三包正式 `src/`
3. 三包 `README.md`
4. 三包测试入口
5. 三包 typecheck/build 基础设施

## 7. 分阶段实施

## 7.1 Phase 1: 边界收口

目标：

1. 把领域逻辑、运行时逻辑、OpenBot 适配逻辑拆成三层。
2. 恢复为正式 workspace 包，而不是临时源码堆叠。

交付：

1. `packages/collaboration-core`
2. `packages/collaboration-runtime`
3. `packages/collaboration-openbot-adapter`

完成标准：

1. 三包都存在正式 `package.json`
2. 三包都存在 `src/`
3. 三包都能独立测试和 typecheck

## 7.2 Phase 2: 学习回流闭环

目标：

1. 让 memory flush 产物进入协作学习存储。
2. 按保密等级控制 projection/promotion。
3. 让 promoted capability 可反向进入 session capability context。

交付：

1. memory flush -> capsule 生成逻辑
2. projection/promotion 服务接线
3. promoted capability 读取逻辑
4. capability system prompt 组装逻辑

完成标准：

1. internal 内容可产生 capsule / projection / asset
2. restricted/secret 内容不会被无条件提升为 active asset
3. 系统提示可包含 group / overlay / promoted capability 三类信息

## 7.3 Phase 3: 治理对象正式化

目标：

1. 让治理对象从局部状态变成正式持久化对象。
2. 让 gateway 能返回完整治理快照。
3. 让 transition 行为受状态机校验保护。

交付：

1. `collaboration.learning.snapshot`
2. `collaboration.task.transition`
3. `collaboration.deliverable.transition`
4. `collaboration.review.transition`
5. `collaboration.decision.transition`
6. `collaboration.decision.updateDraft`

完成标准：

1. gateway 可加载 group + bot 作用域下的 learning objects
2. transition 成功后可持久化回写
3. 非法状态迁移会被拒绝

## 7.4 Phase 4: Workbench 治理前台

目标：

1. 让治理对象在当前 workbench 链路可见、可操作。
2. 替换“placeholder-grade governance view”。

交付：

1. collaboration learning snapshot controller
2. governance actions controller
3. workbench render-model governance projection
4. tasks / deliverables / reviews / decisions 列表与详情页
5. decision draft 编辑与状态按钮

完成标准：

1. active session 的治理快照可投影到 workbench props
2. 列表页与详情页都能渲染 persisted objects
3. detail 页能触发治理流转动作

## 7.5 Phase 5: 第二宿主准备

目标：

1. 保证 `core` 和 `runtime` 已具备跨宿主消费条件。
2. 暂不做宿主切流，只冻结边界，给第二宿主验证做准备。

交付：

1. 明确 `openbot-adapter` 仅用于 OpenBot
2. 明确 `core/runtime` 为跨宿主候选边界
3. 形成后续第二宿主最小接入方案输入

完成标准：

1. 第二宿主只需要消费 `core` 与 `runtime`
2. 第二宿主不直接依赖 `openbot-adapter`

## 8. 验收标准

本阶段视为完成，至少同时满足以下条件：

1. 三个协作包都具备正式包结构。
2. 三个协作包的本地 `test` 与 `typecheck` 可通过。
3. 主仓 `pnpm build` 可通过。
4. 学习回流链路至少具备 internal 与 restricted 两类行为测试。
5. Gateway 协作治理 handler 具备 snapshot、transition、draft update 测试。
6. Workbench 治理视图具备 render-model 与 detail/transition 测试。
7. 边界口径明确：当前不迁仓、不发布、不主链路切流。

## 9. 风险与控制

### 9.1 风险：边界名义拆分，实际仍强耦合

控制：

1. `runtime` 不直接依赖 OpenBot 宿主能力
2. `openbot-adapter` 承担宿主侧文件与对象存储接线

### 9.2 风险：restricted 信息错误推广

控制：

1. 把 confidentiality tier 映射到 sensitivity / reusability
2. restricted/secret 默认不能直接变成 active personal asset

### 9.3 风险：UI 已接线但仍是占位页

控制：

1. 验收时必须有 persisted object detail 页测试
2. 验收时必须能触发 transition action

### 9.4 风险：过早进入拆仓/发布讨论

控制：

1. 本阶段只冻结包边界
2. 第二宿主验证完成前不做拆仓/发布结论

## 10. 实施后决策口径

如果本阶段完成，下一阶段不直接进入发布，而应进入：

`边界冻结 + 第二宿主最小验证`

只有满足以下条件，才进入后续更大动作讨论：

1. `core` 与 `runtime` 已被第二宿主真实消费
2. 宿主 adapter 边界已清晰
3. 至少一条宿主深链路已验证

否则，默认继续在主仓内稳定维护。

## 11. 最终预期输出

本方案完成后，OpenBot 应达到的状态是：

1. 协作学习治理从“概念能力”变成“正式包边界 + 正式治理链路”。
2. 群体经验可以受控回流到 bot 能力上下文。
3. task / deliverable / review / decision 能在 gateway 与 workbench 中被一致处理。
4. 当前实现为第二宿主验证奠定基础，但尚不推进迁仓、发布或切流。

## 12. 归档后的状态说明

按当前仓库事实，本方案对应的第一阶段工作已完成并已进入收尾状态。正式结论以后续文档为准：

1. 收尾结论见：[/design/openbot-collaboration-sdk-closeout-2026-04-09](/design/openbot-collaboration-sdk-closeout-2026-04-09)
2. 核检清单见：[/design/openbot-collaboration-sdk-closeout-checklist-2026-04-09](/design/openbot-collaboration-sdk-closeout-checklist-2026-04-09)
3. 下一阶段口径见：[/design/openbot-collaboration-sdk-next-stage-decision-2026-04-09](/design/openbot-collaboration-sdk-next-stage-decision-2026-04-09)
