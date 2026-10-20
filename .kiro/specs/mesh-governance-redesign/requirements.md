# Requirements Document

## Introduction

本 spec 重新设计企业端**机巢治理**（Mesh Governance）模块。核心变更：

1. **去除伪治理项**：移除"待补创建人"和"待补归因"队列。创建人归属是组织架构的自然属性（岗位驱动，人随岗走），不是治理问题；成本归因应由系统在会话产生时自动完成。
2. **聚焦运营治理**：机巢治理专注于机器人和协作小组的**运行健康度**管理——状态异常、成本超标、质量下降、安全合规。
3. **归属模型重构**：机器人/协作小组的归属关系由岗位体系自动维护，岗位人员变动时管理权自动继承，无需人工"补"。
4. **UI 精简**：压缩 Hero 区域，首屏即工作区；空队列折叠；治理队列按运营紧急度分级。

**设计原则**：

- 机巢治理 = 机器人 + 协作小组的运营管理（不是数据完整性修补）
- 归属关系是基础信息，直接展示在列表中，不作为治理项
- 治理队列只包含需要人工介入的运营异常
- 首屏即工作区，管理员进入页面立即看到需要处理的问题

## Glossary

- **机巢（Mesh）**：企业内所有机器人和协作小组构成的运营网络。
- **岗位归属（Position Ownership）**：机器人/协作小组创建时自动绑定到创建者所在岗位，岗位人员变动时管理权自动继承给新任职人员。
- **运营治理（Operational Governance）**：针对机器人和协作小组的运行状态、成本效率、质量表现、安全合规进行监控和干预。
- **治理队列（Governance Queue）**：按紧急程度分级的待处理运营异常列表。
- **健康度（Health Score）**：综合运行状态、错误率、成本效率、活跃度等维度的机器人/协作小组健康评分。
- **僵尸对象（Zombie）**：长期无活跃会话的机器人或协作小组。
- **成本突增（Cost Spike）**：单位时间内成本超出历史基线的异常增长。
- **岗位（Position）**：组织架构中的职能单元，与具体人员解耦；人员调岗/离职时岗位不变。

## Requirements

## Phase 1 — 归属模型重构

### Requirement 1: 机器人创建时自动记录岗位归属

**User Story:** 作为企业管理员，我希望机器人在创建时自动记录创建者的岗位信息，这样无需事后手动补充创建人。

#### Acceptance Criteria

1. WHEN 任何岗位人员创建一个新机器人, THE system SHALL 自动将当前操作人的 `positionId` 和 `userId` 写入机器人的 `ownership` 字段。
2. THE `ownership` 字段 SHALL 包含 `{ positionId, createdByUserId, createdAt }`，其中 `positionId` 为必填。
3. WHEN 机器人创建完成后, THE system SHALL NOT 将该机器人标记为"无创建人"或"待补创建人"状态。
4. IF 通过 API 批量导入机器人且无法确定岗位, THEN THE system SHALL 将 `positionId` 设为企业默认管理岗位，并在导入报告中标注。

### Requirement 2: 协作小组创建时自动记录岗位归属

**User Story:** 作为企业管理员，我希望协作小组在创建时自动记录发起人的岗位信息。

#### Acceptance Criteria

1. WHEN 任何岗位人员创建一个新协作小组, THE system SHALL 自动将当前操作人的 `positionId` 和 `userId` 写入协作小组的 `ownership` 字段。
2. THE `ownership` 字段结构 SHALL 与机器人一致：`{ positionId, createdByUserId, createdAt }`。
3. THE system SHALL NOT 对协作小组硬编码 `creatorStatus = "unowned"`。

### Requirement 3: 岗位人员变动时管理权自动继承

**User Story:** 作为企业管理员，我希望当岗位所属人员变动时，该岗位下所有机器人和协作小组的管理权自动转移给新任职人员。

#### Acceptance Criteria

1. WHEN 岗位 A 的任职人员从 User-X 变更为 User-Y, THE system SHALL 自动将岗位 A 下所有机器人和协作小组的当前管理人更新为 User-Y。
2. THE system SHALL 保留原始 `createdByUserId` 不变（历史记录），仅更新 `currentManagerUserId`。
3. WHEN 岗位人员变动完成后, THE system SHALL NOT 产生任何"待补创建人"治理项。
4. THE system SHALL 在变动日志中记录 `{ positionId, previousUserId, newUserId, transferredAt, affectedAgentCount, affectedGroupCount }`。

### Requirement 4: 机器人/协作小组列表直接展示归属信息

**User Story:** 作为企业管理员，我希望在机器人和协作小组列表中直接看到归属岗位和当前负责人。

#### Acceptance Criteria

1. THE 机器人列表 SHALL 展示列：名称、归属岗位、当前负责人、运行状态、健康度、本月成本。
2. THE 协作小组列表 SHALL 展示列：名称、归属岗位、当前负责人、成员数、活跃度、本月成本。
3. THE 归属信息 SHALL 作为基础展示字段，不作为治理队列项。
4. WHEN 点击归属岗位, THE system SHALL 跳转到组织架构中该岗位的详情页。

## Phase 2 — 运营治理引擎

### Requirement 5: 治理队列按运营紧急度分级

**User Story:** 作为企业管理员，我希望治理队列按紧急程度分级展示，这样我能优先处理最紧急的问题。

#### Acceptance Criteria

1. THE 治理队列 SHALL 分为三个级别：
   - **待处置（Critical）**：已触发风控规则，需立即干预（如连续报错超阈值、成本突增、安全违规）。
   - **待复核（Warning）**：系统标记异常但未达处置线，需人工判断（如低活跃高成本、质量评分下降）。
   - **待优化（Info）**：运行正常但有改善空间（如可合并的冗余小组、可降级的低频机器人）。
2. THE system SHALL NOT 包含"待补创建人"或"待补归因"队列。
3. EACH 治理项 SHALL 包含 `{ id, level, category, target, title, evidence, suggestedAction, detectedAt }`。
4. THE 队列 SHALL 按 level（Critical > Warning > Info）排序，同级别内按 `detectedAt` 降序。

### Requirement 6: 机器人运行状态监控

**User Story:** 作为企业管理员，我希望系统自动监控机器人的运行状态，并在异常时生成治理项。

#### Acceptance Criteria

1. WHEN 机器人连续错误次数 ≥ 配置阈值（默认 5 次）, THE system SHALL 生成 Critical 级别治理项，category = `consecutive_errors`。
2. WHEN 机器人离线时间 ≥ 配置阈值（默认 24 小时）且有活跃会话, THE system SHALL 生成 Critical 级别治理项，category = `offline_with_active_sessions`。
3. WHEN 机器人最近 7 天无任何会话且已部署超过 30 天, THE system SHALL 生成 Info 级别治理项，category = `zombie_agent`。
4. WHEN 机器人错误率 ≥ 配置阈值（默认 30%）, THE system SHALL 生成 Warning 级别治理项，category = `high_error_rate`。

### Requirement 7: 成本效率监控

**User Story:** 作为企业管理员，我希望系统自动监控机器人和协作小组的成本效率，并在异常时告警。

#### Acceptance Criteria

1. WHEN 机器人单日成本超出过去 7 天均值的 3 倍, THE system SHALL 生成 Critical 级别治理项，category = `cost_spike`。
2. WHEN 机器人月度成本超出预算阈值, THE system SHALL 生成 Warning 级别治理项，category = `budget_exceeded`。
3. WHEN 机器人单次会话平均成本超出同类机器人均值的 2 倍, THE system SHALL 生成 Warning 级别治理项，category = `inefficient_cost`。
4. WHEN 协作小组总成本超出预算阈值, THE system SHALL 生成 Warning 级别治理项，category = `group_budget_exceeded`。
5. THE system SHALL 在治理项的 `evidence` 字段中包含具体数值（当前成本、基线成本、超出比例）。

### Requirement 8: 质量表现监控

**User Story:** 作为企业管理员，我希望系统监控机器人的任务完成质量，并在质量下降时提醒。

#### Acceptance Criteria

1. WHEN 机器人最近 7 天成功率低于配置阈值（默认 70%）, THE system SHALL 生成 Warning 级别治理项，category = `quality_degradation`。
2. WHEN 机器人成功率环比下降超过 20 个百分点, THE system SHALL 生成 Warning 级别治理项，category = `quality_drop`。
3. THE `evidence` 字段 SHALL 包含 `{ currentSuccessRate, previousSuccessRate, sampleSize, period }`。

### Requirement 9: 安全合规监控

**User Story:** 作为企业管理员，我希望系统监控机器人的安全合规状态，并在违规时立即告警。

#### Acceptance Criteria

1. WHEN 机器人触发敏感词过滤器, THE system SHALL 生成 Critical 级别治理项，category = `sensitive_content`。
2. WHEN 机器人执行了超出其权限范围的操作, THE system SHALL 生成 Critical 级别治理项，category = `permission_violation`。
3. THE Critical 级别安全治理项 SHALL 自动触发机器人暂停（需管理员手动恢复）。
4. THE system SHALL 在 `evidence` 中记录触发时间、触发内容摘要（脱敏）、影响范围。

### Requirement 10: 协作小组运营监控

**User Story:** 作为企业管理员，我希望系统监控协作小组的运营健康度。

#### Acceptance Criteria

1. WHEN 协作小组最近 30 天无任何会话, THE system SHALL 生成 Info 级别治理项，category = `zombie_group`。
2. WHEN 协作小组内存在功能重叠的机器人（相同能力域 + 相似描述）, THE system SHALL 生成 Info 级别治理项，category = `redundant_members`。
3. WHEN 协作小组错误率 ≥ 配置阈值, THE system SHALL 生成 Warning 级别治理项，category = `group_quality_issue`。
4. THE `suggestedAction` 字段 SHALL 根据 category 提供具体建议（如"建议归档"、"建议合并成员"、"建议排查错误源"）。

### Requirement 11: 治理动作执行

**User Story:** 作为企业管理员，我希望能直接在治理队列中执行处置动作。

#### Acceptance Criteria

1. FOR Critical 级别治理项, THE system SHALL 提供动作：暂停、限流、下线。
2. FOR Warning 级别治理项, THE system SHALL 提供动作：降级模型、设置预算上限、标记为已知问题。
3. FOR Info 级别治理项, THE system SHALL 提供动作：归档、合并、忽略（本周期不再提醒）。
4. WHEN 管理员执行任何治理动作, THE system SHALL 记录审计日志 `{ actionType, targetId, operatorUserId, operatorPositionId, executedAt, reason? }`。
5. WHEN 治理动作执行成功, THE system SHALL 从队列中移除该治理项并更新目标对象状态。

## Phase 3 — UI 重构

### Requirement 12: 页面布局精简——首屏即工作区

**User Story:** 作为企业管理员，我希望进入机巢治理页面后立即看到需要处理的问题，而不是一个大面积的装饰性头部。

#### Acceptance Criteria

1. THE 页面头部 SHALL 压缩为单行布局（≤ 64px 高度），包含：页面标题 + 核心指标（机器人数、协作小组数、本月总成本）+ 刷新按钮。
2. THE system SHALL NOT 展示英文 eyebrow（"Mesh governance"）或大面积渐变背景。
3. THE 治理队列 SHALL 在首屏可见（无需滚动）。
4. THE 右侧 action cards（治理队列 N 项、待补归因、待补创建人、刷新机巢）SHALL 被替换为头部行内的紧凑指标。

### Requirement 13: 治理队列 UI 优化

**User Story:** 作为企业管理员，我希望治理队列界面紧凑高效，空队列不浪费空间。

#### Acceptance Criteria

1. WHEN 某个级别的治理队列为空, THE system SHALL 将其折叠为单行显示（仅标题 + "0 项"），不展开空态文案。
2. THE 治理项行 SHALL 展示：目标名称、问题类型标签、检测时间、建议动作按钮。
3. WHEN 点击治理项, THE system SHALL 在右侧 detail panel 中展示完整证据和可执行动作。
4. THE detail panel SHALL 固定在右侧，不随列表滚动消失。

### Requirement 14: 排名工作台保留并优化

**User Story:** 作为企业管理员，我希望保留员工排名、机器人排名、协作小组排名功能，但与治理队列解耦。

#### Acceptance Criteria

1. THE 工作台 tabs SHALL 保留：治理队列、员工排名、机器人排名、协作小组排名。
2. THE 机器人排名 SHALL 按维度排序：运行成效、成本效率、稳定性。
3. THE 协作小组排名 SHALL 按维度排序：协同产出、成本效率、风险最少。
4. THE 员工排名 SHALL 按维度排序：使用成效、成本效率、异常最少。
5. THE 排名列表中 SHALL 直接展示归属岗位和当前负责人（作为基础列，非治理项）。

## Phase 4 — 治理配置

### Requirement 15: 治理阈值可配置

**User Story:** 作为企业管理员，我希望能自定义各项治理监控的阈值。

#### Acceptance Criteria

1. THE system SHALL 提供治理配置面板，包含以下可配置阈值：
   - 连续错误次数阈值（默认 5）
   - 离线告警时间阈值（默认 24 小时）
   - 僵尸判定天数（默认 30 天）
   - 错误率告警阈值（默认 30%）
   - 成本突增倍数（默认 3 倍）
   - 质量下降百分点（默认 20）
2. WHEN 管理员修改阈值, THE system SHALL 立即重新评估所有对象并更新治理队列。
3. THE 阈值配置 SHALL 持久化到企业配置中，跨会话生效。

### Requirement 16: 治理通知与升级

**User Story:** 作为企业管理员，我希望 Critical 级别的治理项能主动通知我。

#### Acceptance Criteria

1. WHEN 新的 Critical 级别治理项产生, THE system SHALL 向该机器人/协作小组归属岗位的当前负责人发送通知。
2. IF Critical 治理项超过 4 小时未处理, THE system SHALL 升级通知到上级管理岗位。
3. THE 通知内容 SHALL 包含：问题摘要、目标对象、检测时间、建议动作、直达链接。

## Correctness Properties

1. **归属完整性**：任何新创建的机器人或协作小组，其 `ownership.positionId` 必须非空。
2. **继承一致性**：岗位人员变动后，该岗位下所有对象的 `currentManagerUserId` 必须等于新任职人员的 `userId`。
3. **队列纯净性**：治理队列中不得出现 category 为 `missing_owner` 或 `missing_attribution` 的项。
4. **检测幂等性**：相同输入数据连续两次运行治理检测引擎，产生的治理项集合（含 id）完全相同。
5. **阈值边界正确性**：恰好等于阈值的数据不触发告警；严格超过阈值的数据必须触发。
6. **动作原子性**：治理动作执行成功后，目标对象状态更新和队列移除必须在同一事务中完成。
7. **审计完整性**：每个治理动作执行后，审计日志中必须存在对应记录。
