# 目标代码边界与当前归属

本记录处理目录组织差异和实质职责差异。它取代按目录存在判断完成的方式，不批准增加第二套运行时。Owner: codex-runtime-manager。

## 组织方式的确定决定

- 保留业务 command / execution / delivery 三层，context / capabilities 两类供给，policy / state 公共机制和 contracts / wiring 边界。
- 保留 model 为共享基础组件：交互与执行共用授权、回退、用量与取消，不创建业务任务。它不属于第二条任务主线。
- 保留 catalog.ts、assembly.ts 等已有完整小组件，不为目录外观拆成空目录。组件数量或职责实际增长后才分组。
- 保留分用例 wiring：reply-turn、interaction-turn、delivery-confirm 等只绑定固定依赖，不新增万能 create-runtime 服务容器。公开入口与依赖方向比文件名优先。
- state 的现有存储适配迁至 repository/session-task.ts，恢复事务迁至 mutations/resume-current.ts；宿主通过 state/index.ts。原 conversation-task/session-task-board 继续作为唯一文件存储、锁和历史 schema 适配，不复制存储。
- 执行准入输入与结果迁至 contracts/execution.ts；command 保留原用例和兼容类型导出，没有复制分类或授权实现。

## 实质缺口的处置

| 职责 | 唯一现有归属 | 已处理 / 待完成 |
| --- | --- | --- |
| 执行准入数据 | contracts/execution.ts | 已移动真实契约；等待条件与标准执行结果尚未统一，不能称完整 execution contract |
| 状态公开边界 | state/index.ts → repository/session-task.ts → 原任务板 | 已替换现有宿主消费者，并以 manifest 禁止 repository/mutations 深导入 |
| 当前任务恢复 | state/mutations/resume-current.ts | 原实现直接移动，旧文件删除；不是双实现 |
| 指挥编排 | command 现有语义理解、准入与事务用例 | planning 尚缺完整目标/验收/待办骨架，不建空 planning 或强制前置细步骤模型 |
| 步骤选择/核验 | 原 Pi 循环、协作计划及既有 preflight | selection/verification 尚未形成独立契约；先明确原个人/协作不同权威，不复制待办状态机 |
| 成果验收/复用 | delivery 现有校验回执和投递出口 | 用户验收条件逐项核实、来源/视觉质量、reuse 完整链仍未完成 |
| 上下文来源 | context 纯投影/编译 + 原宿主读取/审计 | 维持 resolve/read/render/audit 及调用次数，后续按完整领域来源迁移，不能硬搬混合 builder |
| 能力与策略 | capabilities 调用边界 + 原权限/预算服务 | 完整适配契约、动作限制策略、合法转移规则尚未全收敛；不把元数据当强制授权 |
| 扩展退役 | 已核实的原 hooks/services/workflow 适配 | 有真实消费者及资产，未核实生产配置前不删除；已删除的 eager mention 路径不得恢复 |

缺少 message/events 契约时不造无人消费的 DTO。每个后续切片必须同时提供原职责、新 owner、真实消费者替换、旧路径退出及行为回归。

## 本次验证与限制

- runtime 组件及真实入口：39 文件 / 233 PASS；单独跨进程任务板 7 PASS。
- 联合运行首次跨进程约束竞争出现 1 条丢失断言（其余 239 PASS），单独重跑通过。该波动未因目录迁移而获得修复证据，不应掩盖或声称全量无竞争问题。
- 架构门禁 44 条通过；变更文件 typed lint 通过；tsgo 47 条基线诊断；构建通过，动态导入警告仍 209 条。
- 检查器现在忽略工作树中已删除的 tracked 源文件，允许在未暂存迁移时检查实际源树。
- 本次完成结构决策、真实执行准入契约落位和状态公开边界；并未完成表中所有业务能力缺口。未推送、合并或部署。 — codex-runtime-manager
