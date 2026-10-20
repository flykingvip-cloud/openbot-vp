# 需求文档：进化运行时闭环（Evolution Runtime Closure）

## 简介

本 spec 将「技能进化 / Agent 行为进化 / 平台系统进化 / 成果资产沉淀」从局部原型收敛为**真实可运行、可观测、可治理、可回滚**的业务闭环。  
不以「接口存在」或「页面可展示」为完成标准；每条链路必须具备：触发证据、状态流转、持久化、真实执行、结果归因、治理门槛、可观测性、幂等性、故障恢复与回滚。

### 与既有规格关系

| 既有 spec                                   | 角色                           | 本 spec 处置                                   |
| ------------------------------------------- | ------------------------------ | ---------------------------------------------- |
| `skill-lifecycle-asset-system`              | 员工端技能资产 UI/生命周期模型 | 复用；补 **执行绑定投影** 与 **调用事件** 断点 |
| `agent-growth-lifecycle`                    | Growth OS / Working DNA 内核   | 复用；补 **后台自动评估** 与 **多信号语义**    |
| `capability-lifecycle-closure` / incubation | 能力准入、孵化                 | 协调；不造平行资产库                           |
| `ai-workforce-governance`（代码模块）       | 治理算法原型                   | 迁持久化 + 生产调度 + 真实动作生效             |

### 核心不变量

1. **唯一执行真相**：可执行技能不得再增加第三套平行系统；资产 → 运行时必须有且仅有一条 `SkillExecutionBinding`（或等价编译投影）。
2. **成果 ≠ 技能**：deliverable/knowledge 是「产出了什么」；executable skill 是「以后如何稳定完成同类工作」。
3. **前端不是证据源**：`localStorage` 可缓存 UI，权威样本与 sampleCount 在服务端。
4. **UI RPC 不是唯一触发器**：Working DNA / 治理调度必须可后台推进。
5. **禁止伪造指标**：缺数据用 `null`，不得默认 0/成功。
6. **不触碰他人 WIP**：共享工作树只提交本任务 paths；热文件协调后提交。

### 四条闭环

| ID    | 闭环               | 最小完成标准                                                                                     |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------ |
| **A** | 成果与知识资产沉淀 | 执行 → 交付物识别 → 版本化资产 → 治理/使用，不自动变可执行技能                                   |
| **B** | 可执行技能进化     | 多样本证据 → candidate → 审批 → 发布 → 安装 → **真实加载** → 调用事件 → 健康/灰度/回滚           |
| **C** | Agent 行为进化     | 真实任务结果 → 运营信号 → Working DNA 变更 → 注入后续运行 → 二阶评估/回滚/防振荡（**后台触发**） |
| **D** | 平台系统进化       | 持久遥测 → 异常 → 审批/受限自动动作 → **影响真实运行时** → 效果验证                              |

### Phase 0 审计结论摘要（以代码为准，2026-07-19）

| 断点              | 结论                                                                         | 风险        |
| ----------------- | ---------------------------------------------------------------------------- | ----------- |
| 资产 ↔ 执行器桥接 | **断裂**：`skill-lifecycle-store` 与 FS `SKILL.md` 运行时为平行系统          | **P0-High** |
| 技能健康度        | 仅 RPC/`skill-health.sample`；滚动窗口进程内 Map；`lastInvokedAt` 无生产写入 | **P0-High** |
| 稳定模式          | 前端启发式 + 硬编码 `sampleCount: 3`；`pattern-detection.subscribe` 无后端   | **P0-High** |
| 成果 vs 技能      | 自动捕获写入同一 `skill-assets` 且可建 robot relation                        | **P0-Med**  |
| Working DNA       | DNA 变更/回滚仅 `agents.recompute-growth`；live 仅 task success 信号         | **P0-Med**  |
| 平台治理          | Map 内存原型；`runScheduledJob` 无生产注册；pause 不改真实 runtime           | **P0-High** |

详细证据见同目录 `design.md` §0 与交付报告 Phase 0 段。

---

## 术语表

| 术语                      | 定义                                                                        |
| ------------------------- | --------------------------------------------------------------------------- |
| **SkillExecutionBinding** | 将「已安装且启用的技能版本」投影为 agent 本次运行可消费的技能快照的唯一桥接 |
| **skill*invocation*\***   | 技能调用统一事件（started/completed）                                       |
| **CandidateSkill**        | 未审批不可进入运行时的候选可执行技能                                        |
| **DeliverableAsset**      | 成果/知识资产（assetType knowledge 等），非默认可执行                       |
| **Working DNA**           | `working-style.json` 行为偏好；注入 system prompt                           |
| **GovernanceAction**      | pause/limit/redirect 等；必须能改真实 binding/runtime 状态                  |

---

## 需求

### 需求 1：现状以代码为准（Phase 0）

1. THE Owner SHALL 完成调用图/数据流审计，文件引用含仓库相对路径与行号。
2. THE Owner SHALL NOT 仅凭 tasks.md「已完成」勾选判定闭环完成。
3. WHEN 代码与历史规格冲突, THE Owner SHALL 以代码证据修正规格。

### 需求 2：唯一 SkillExecutionBinding（闭环 B 核心）

1. THE System SHALL 提供唯一投影：从 enabled `RobotSkillRelation` + 对应版本 `runtimeDefinition`（或物化 SKILL 树）生成 agent 运行技能输入。
2. THE Agent Executor SHALL 消费该投影；SHALL NOT 仅依赖与资产无关的平行目录而忽略安装关系。
3. WHEN 禁用/移除/回滚技能, THE Next Agent Run SHALL 不再加载该版本。
4. WHEN 升级 `installedVersion`, THE Next Agent Run SHALL 固定到新版本。
5. THE System SHALL NOT 新建第三套技能真相源（禁止 V2 store）。

### 需求 3：技能调用事件与健康度（闭环 B）

1. THE System SHALL 在真实技能调用时发出 `skill_invocation_started` / `skill_invocation_completed`（字段见 design）。
2. THE System SHALL 原子更新：`usageCount`、`lastInvokedAt`、版本级 SkillHealth、最近失败原因、审计。
3. THE Health Window SHALL 持久化或可从事件重算；SHALL NOT 仅依赖进程内 Map。
4. THE System SHALL NOT 伪造 business outcome。

### 需求 4：服务端稳定模式与候选技能（闭环 B）

1. THE System SHALL 在服务端持久化跨独立任务/run 的执行样本。
2. `sampleCount` SHALL 来自去重后的独立任务/run，SHALL NOT 由前端关键字硬编码为 3。
3. THE Frontend SHALL 仅展示服务端候选；localStorage 仅 UI 缓存。
4. THE Candidate SHALL 含 profile、runtimeDefinition、lineage、IO 契约、工具权限、依赖、回放案例、风险、质量指标；未经审批 SHALL NOT 进入运行时投影。

### 需求 5：成果与可执行技能分离（闭环 A）

1. Deliverable auto-capture SHALL 标记为成果/knowledge 语义，SHALL NOT 自动视为可执行技能。
2. THE System SHALL NOT 仅凭单次交付物创建可执行技能版本。
3. 成果沉淀链路 SHALL 支持版本化与使用/治理读模型。

### 需求 6：Working DNA 自动闭环（闭环 C）

1. THE System SHALL 在可靠后台事件或调度上触发 DNA 评估/应用/回滚（不仅 UI `recompute-growth`）。
2. UI RPC MAY 保留为手动诊断入口。
3. Operational signals SHALL 区分：任务成功、工具成功、交付成功、人工接管、满意度等；缺失为 null。
4. `operationalScore` 二阶评估 SHALL NOT 被 adaptivity 自指污染（保持 raw vs adjusted 分离）。
5. 回滚 SHALL 写 suppression 防振荡。

### 需求 7：平台治理闭环（闭环 D）

1. Assets/metrics/anomalies/actions/job cursor SHALL 持久化（仓库认可方案）。
2. Production startup SHALL 注册调度并在关闭时清理。
3. 自动动作 SHALL 有 kill switch、幂等键、审计、效果验证。
4. High-risk actions SHALL human-gated。
5. pause/limit/redirect SHALL 改变真实 runtime（如 binding disabled），不仅治理页状态。

### 需求 8：验收场景（Phase 5）

覆盖用户指令中的 12 条端到端场景（三次独立任务成候选、未审批不进运行时、安装可用、禁用不加载、版本固定与回滚、健康自动更新、重启不丢、DNA 自动注入与回滚不振荡、治理真实暂停、租户隔离、并发幂等）。

### 需求 9：工程约束

遵循 `AGENTS.md`：严格类型、无 any、无 prototype mutation、scoped `scripts/committer`、`Task`/`Agent` trailers、不碰他人 WIP、不切换分支除非用户要求。
