# 能力升级提案 Implementation Tasks

## Agents

- codex-capability-proposal · role: owner · scope: 机器人发起能力升级提案的业务闭环规格与实施拆解 · paths: .kiro/specs/capability-upgrade-proposal/\*\*, docs/design/openbot-capability-upgrade-proposal-implementation-plan-2026-07-17.md · since: 2026-07-17

## Ownership Notice

- 当前 `src/gateway/skill-lifecycle-store.ts`、`src/gateway/asset-admission.ts`、`src/gateway/server-methods/employee-capability.ts` 和相关孵化 UI 由 `capability-lifecycle-closure:kiro-daibai` 持有。
- Gork 团队开始实现前必须完成 owner 移交或由现 owner 负责集成；禁止两个任务同时声明同一路径。
- `src/gateway/server-methods.ts`、`server-methods-list.ts`、`method-scopes.ts` 是共享热文件，应由当期指定 lander 统一接线。

## Milestone 0: Contract And State Machine

- [ ] 0.1 定义 `CapabilityUpgradeProposal` 契约与 Zod schema
  - 新模块建议：`src/gateway/capability-upgrade-proposal/types.ts`。
  - 覆盖问题、证据、现有能力差距、建议资产类型、权限、风险、验证、目标范围和来源机器人。
- [ ] 0.2 定义生命周期状态机
  - `draft -> submitted -> triaging -> needs_evidence | accepted | rejected | withdrawn`。
  - `accepted -> incubating -> validating -> approved -> materialized -> published`。
  - `incubating/validating -> changes_requested | failed`，修订后可重新进入评审。
- [ ] 0.3 定义不可变量
  - 机器人不能填写最终 reviewer、批准权限或发布范围。
  - 提案风险只能由治理规则提高，不能由模型降低。
  - `materialized` 必须引用真实资产 ID 和版本。

## Milestone 1: Proposal Store And Evidence

- [ ] 1.1 实现租户隔离、原子写入的 Proposal Store
  - 建议独立端口与 repository，避免继续扩张 `incubation-store.ts` 的单文件数组。
  - 支持按 tenant、status、problem domain、proposer agent、target kind 查询。
- [ ] 1.2 实现证据引用
  - 支持 transcript、run report、workflow recording、support case、deliverable、metric snapshot 和外部 artifact 引用。
  - 引用必须带 hash、provenance、访问范围和脱敏状态。
- [ ] 1.3 实现幂等与并发控制
  - 创建接受 `idempotencyKey`；更新使用 `expectedVersion`。
- [ ] 1.4 实现重复问题聚类
  - 确定性 key + 语义候选，不自动合并；由 reviewer 确认关联。

## Milestone 2: Robot Proposal Flow

- [ ] 2.1 增加机器人提案工具
  - `capability_proposal.create_draft`、`attach_evidence`、`submit`、`status`、`withdraw`。
  - Tool 只允许操作当前机器人创建且当前用户/租户可见的提案。
- [ ] 2.2 建立提案触发规则
  - 重复人工接管、连续失败、缺少连接器、同类临时方案重复、录制工作流稳定复用等信号只生成建议，不自动提交。
- [ ] 2.3 增加用户确认
  - 机器人提交企业审核前，向当前责任人展示问题、证据、权限与预期价值；明确确认后才 `submitted`。
- [ ] 2.4 接入“录制工作流”
  - 稳定录制优先生成 Skill；当缺少 Tool/Connector/Plugin 时生成关联能力升级提案。

## Milestone 3: Enterprise Triage And Incubation

- [ ] 3.1 实现企业提案队列
  - 按业务影响、重复频次、证据质量、预期复用范围、安全风险和成本排序。
- [ ] 3.2 实现 triage 决策
  - `request_evidence`、`accept_for_incubation`、`reject`、`link_existing_capability`、`merge_candidate`。
- [ ] 3.3 将接受的提案接入现有孵化中心
  - 创建 incubation work item，而不是伪造已存在的 capability。
  - Proposal 保持问题源记录，孵化对象记录解决方案演进。
- [ ] 3.4 支持按目标类型执行孵化模板
  - `skill`、`plugin`、`connector`、`tool`、`core` 使用不同的检查表和审批门禁。

## Milestone 4: Materialization

- [ ] 4.1 Skill 路径
  - 创建个人/企业 Skill draft，复用现有 Skill review、版本和健康度。
- [ ] 4.2 Plugin 路径
  - 生成插件包候选、manifest、依赖清单、安全扫描与安装范围建议；管理员安装。
- [ ] 4.3 Connector/MCP 路径
  - 生成接口契约、认证类型、数据范围和最小权限申请；秘密由 Vault 管理。
- [ ] 4.4 Tool 路径
  - 生成工程实现任务、测试和权限 schema；走代码评审与部署，不能由机器人直接安装。
- [ ] 4.5 Core 路径
  - 转换为架构决策/工程项目，记录 owner、里程碑和发布计划；禁止自动修改生产核心。
- [ ] 4.6 建立 Proposal 到资产的 lineage
  - 保存 proposalId、incubationId、assetId、version、reviewId 和发布范围。

## Milestone 5: Validation And Publication

- [ ] 5.1 建立验证计划执行器
  - 区分自动测试、沙盒试用、限定部门试点和人工验收。
- [ ] 5.2 复用现有企业审核和治理注册表
  - `approved` 不等于 `published`；发布范围和调用权限单独审批。
- [ ] 5.3 发布到企业能力目录
  - 展示解决的问题、适用范围、输入输出、依赖、风险、owner、版本和效果指标。
- [ ] 5.4 通知提案来源人和机器人
  - 状态、修改要求、拒绝理由、资产链接和发布范围完整回流。

## Milestone 6: Feedback And Re-Incubation

- [ ] 6.1 记录采用和效果数据
  - 安装、启用、调用、成功、人工接管、成本、满意度和部门覆盖。
- [ ] 6.2 将真实指标接入孵化评分
  - 替换当前用机器人数量近似部门/员工数量以及满意度恒空的逻辑。
- [ ] 6.3 自动提出迭代建议
  - 只能形成新 revision 或关联 Proposal，禁止自动修改已发布资产。
- [ ] 6.4 支持弃用、退役和重新孵化
  - 影响分析覆盖已安装机器人、共享组、企业消费者和依赖资产。

## Release Gates

- [ ] G1 Contract：状态机、租户隔离、幂等、版本冲突和证据访问测试全部通过。
- [ ] G2 Internal：机器人只能创建草稿；提交、接受、发布和授权均有明确责任人。
- [ ] G3 Pilot：至少完成 Skill、Connector、Tool 三类提案各一条端到端真实闭环。
- [ ] G4 Enterprise：Proposal、孵化、资产、授权、发布和效果数据具备完整 lineage 与审计。
