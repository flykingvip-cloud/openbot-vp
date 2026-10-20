# Enterprise Data Capability Hub P0 完成报告（供专家验收，2026-06-05，修订版 v2）

> 主方案：`docs/design/openbot-enterprise-data-capability-hub-third-party-task-plan-2026-06-05.md` §9.1  
> 修订说明：`docs/design/edc-hub-p0-design-revision-2026-06-05.md`（响应专家 Findings F1–F8）

## 一、阶段目标与验收口径

P0 目标：**在进入开发前冻结边界、模型、分工与交付节奏**。

| 验收项                                    | 计划要求 | 状态                          |
| ----------------------------------------- | -------- | ----------------------------- |
| 梳理现有 Seat/Asset/Policy/Audit 代码结构 | 必需     | ✅ 完成                       |
| 输出现状与目标映射图                      | 必需     | ✅ 完成（见实施说明书 §2）    |
| 完成五份关键设计文档                      | 必需     | ✅ 完成                       |
| 输出系统边界、假设与风险清单              | 必需     | ✅ 完成                       |
| 输出阶段拆分与依赖关系                    | 必需     | ✅ 完成                       |
| 架构边界清晰、无冲突主体                  | 通过标准 | ✅ 已确认                     |
| 无「先做页面后补运行层」反向排期          | 通过标准 | ✅ 已确认（P1-P4 运行层优先） |

## 二、交付物清单

### 2.1 五份冻结设计文档（v2 修订）

| 文档                        | 路径                                         | v2 关键修订                                  |
| --------------------------- | -------------------------------------------- | -------------------------------------------- |
| Connector Action Versioning | `docs/design/connector-action-versioning.md` | 逐连接器显式迁移映射表                       |
| Scope Policy Model          | `docs/design/scope-policy-model.md`          | TEAM fail-closed；DEPARTMENT 实验性          |
| Data Classification Model   | `docs/design/data-classification-model.md`   | 版本级分类键；未知字段 fail-closed           |
| Audit Runtime Schema        | `docs/design/audit-runtime-schema.md`        | objectRefs；HIGH/CRITICAL 审计 fail-closed   |
| Approval Workflow Model     | `docs/design/approval-workflow-model.md`     | approvalContextId；快照校验；服务端解析 seat |

### 2.2 P0 配套文档

| 文档         | 路径                                                         | 说明                                    |
| ------------ | ------------------------------------------------------------ | --------------------------------------- |
| 实施说明书   | `docs/design/edc-hub-p0-implementation-manual-2026-06-05.md` | 现状映射、模块规划、Mock 策略、验收五问 |
| 风险清单     | `docs/design/edc-hub-p0-risk-register-2026-06-05.md`         | 18 项风险 + 拒收条件对照                |
| 设计修订说明 | `docs/design/edc-hub-p0-design-revision-2026-06-05.md`       | 专家 Findings F1–F8 响应对照            |
| 本验收报告   | `docs/design/edc-hub-p0-completion-report-2026-06-05.md`     | 供专家团队签收                          |

### 2.3 代码变更

**P0 阶段无生产代码变更**（设计冻结阶段，符合方案预期）。

## 三、现状基线摘要（代码核验）

### 3.1 后端锚点确认

| 文件                                                  | 现有能力                                                   | 与本项目关系              |
| ----------------------------------------------------- | ---------------------------------------------------------- | ------------------------- |
| `src/gateway/enterprise-seat-assets-store.ts`         | Seat、Binding、AccessPolicy、ConnectorCredential、Store v2 | **扩展** Store v3/v4 字段 |
| `src/gateway/enterprise-seat-assets-governance.ts`    | 资产绑定、Connector Profile 快照                           | **保留**，不重构          |
| `src/gateway/enterprise-seat-assets.ts`               | HTTP 路由、audit/events                                    | **保留**，新增 RPC        |
| `src/gateway/enterprise-seat-assets-audit.ts`         | 治理审计写入                                               | **保留**，与数据审计并存  |
| `src/gateway/server-methods/agents.ts`                | Agent 归属 Seat                                            | **P5** 接入数据动作       |
| `src/gateway/server-methods/employee-capability.ts`   | 员工能力列表                                               | **P5** 扩展解释性回答     |
| `src/gateway/server-methods/enterprise-capability.ts` | 企业能力治理                                               | **P5** 挂载 Data Hub 子面 |
| `src/gateway/control-ui-contract.ts`                  | `connectorIds` 在 Seat 摘要中                              | **保留**                  |

### 3.2 前端锚点确认

| 文件                                                                       | 现状                 | 目标                                  |
| -------------------------------------------------------------------------- | -------------------- | ------------------------------------- |
| `ui/src/ui/navigation.ts`                                                  | 无 Data Hub 一级导航 | 不新增一级导航 ✅                     |
| `ui/src/ui/ports/enterprise/views/enterprise-capability-center-surface.ts` | 能力中心主面         | P5 增加 Connector Capabilities 子 Tab |
| `ui/src/ui/ports/enterprise/views/enterprise-organization-surface.ts`      | 组织与岗位           | 复用 Seat 配置入口                    |
| `ui/src/ui/ports/enterprise/semantic/enterprise-read-model.ts`             | 企业读模型           | P5 扩展数据能力摘要                   |

### 3.3 已确认架构判断

1. **Seat 已是权限与资产归属核心** — `EnterprisePositionSeat` + `SeatAssetBinding` 已落地
2. **connector 已是正式资源类型** — `assetType: connector` + `ConnectorCredentialBinding`
3. **企业机器人归属 Seat** — `defaultAgentAssetIds` 在 Seat 上
4. **审计基础存在** — `EnterpriseAssetAuditEvent`，缺数据调用双层审计（P4 补齐）
5. **无版本化动作模型** — P1 核心交付
6. **无 Data Gateway** — P3 核心交付

## 四、目标架构确认

### 4.1 运行时链路（冻结）

```text
Agent
  → Resolve Seat
  → SeatActionGrant Check
  → Connector Action Version Check
  → Scope Policy Check
  → Approval Check
  → Connector Runtime
  → Data Classification
  → Masking
  → Audit Runtime
  → DataGatewayResponse
```

### 4.2 硬边界确认（方案 §4）

| 约束                     | P0 确认                |
| ------------------------ | ---------------------- |
| 禁止 DigitalHuman 授权链 | ✅ 五份文档均未引入    |
| 禁止 Agent 直连数据库    | ✅ Gateway 唯一入口    |
| 禁止任意 SQL             | ✅ Scope filter 白名单 |
| 禁止首版写操作           | ✅ readOnly 强制       |
| 禁止无版本动作           | ✅ actionKey + version |
| 禁止绕过 Scope/Masking   | ✅ 服务端强校验        |

## 五、阶段排期与依赖（WBS）

| 阶段   | 建议周期    | 依赖  | 下一里程碑                |
| ------ | ----------- | ----- | ------------------------- |
| **P0** | 第 1-2 周   | —     | **本报告验收**            |
| P1     | 第 3-4 周   | P0 ✅ | Action Catalog + Registry |
| P2     | 第 5-6 周   | P1    | Scope + Masking           |
| P3     | 第 7-8 周   | P2    | Data Gateway              |
| P4     | 第 9-10 周  | P3    | Audit + Approval          |
| P5     | 第 11-12 周 | P4    | UI + 员工端               |
| P6     | 第 13-14 周 | P5    | 迁移 + UAT                |

## 六、手工验证记录（P0）

| 验证项                      | 方法                        | 结果              |
| --------------------------- | --------------------------- | ----------------- |
| 后端锚点文件存在            | 代码阅读                    | 8/8 文件确认      |
| connector 资源类型          | grep `assetType: connector` | 已存在            |
| 无现有 ConnectorAction 实现 | 全库搜索                    | 确认缺失，P1 新建 |
| 无现有 Data Gateway         | 全库搜索 `enterprise-data`  | 确认缺失，P3 新建 |
| 五份设计文档完整性          | 章节检查                    | 8/8 章节齐全      |
| 风险清单覆盖拒收条件        | 对照方案 §15                | 11/11 覆盖        |

## 七、已知问题清单

| ID  | 问题                                   | 影响阶段 | 计划处理                                           |
| --- | -------------------------------------- | -------- | -------------------------------------------------- |
| K01 | `departmentId` 无独立组织模型字段      | P2       | 首版用 teamLabel/roleCode 映射                     |
| K02 | 现有 AccessPolicy 无动作级粒度         | P1-P6    | SeatActionGrant 补充 + P6 迁移                     |
| K03 | 真实 CRM/ERP 联调环境未确认            | P1-P3    | Mock Strategy（实施说明书 §6）                     |
| K04 | Store 版本升级需与 SQLite 迁移脚本同步 | P1       | `migrate-enterprise-seat-assets-to-sqlite.ts` 扩展 |

## 八、回滚说明（P0）

P0 仅交付设计文档，无代码变更，回滚即为删除/归档 `docs/design/edc-hub-*.md` 与五份设计文档，不影响现有运行时。

## 九、P0 通过标准自检

| 标准               | 自检                         |
| ------------------ | ---------------------------- |
| 架构边界清晰       | ✅ Seat 唯一授权核心已写明   |
| 无新增冲突主体     | ✅ 未引入 DigitalHuman       |
| 无反向排期         | ✅ P1-P4 运行层先于 P5 UI    |
| 五份文档可逐项核验 | ✅ 含数据模型、API、测试矩阵 |
| Mock 策略已定义    | ✅ 第 3 周前就绪             |

## 十、专家反馈修订记录（v2）

| Finding                       | 状态                                  |
| ----------------------------- | ------------------------------------- |
| F1 PER_REQUEST / traceId 矛盾 | ✅ 已修订 → `approvalContextId`       |
| F2 分类无 version + fail-open | ✅ 已修订 → 版本键 + fail-closed      |
| F3 审批 API 信任 seatId       | ✅ 已修订 → 服务端解析                |
| F4 ONCE 审批与 Scope 脱钩     | ✅ 已修订 → `ApprovalContextSnapshot` |
| F5 迁移映射武断               | ✅ 已修订 → 显式映射表                |
| F6 审计缺对象引用             | ✅ 已修订 → `objectRefs`              |
| F7 TEAM 静默降级 SELF         | ✅ 已修订 → fail-closed               |
| F8 审计全局 fail-open         | ✅ 已修订 → 按风险分级                |
| Q1 approverRole 口径          | ✅ 冻结 → 首版仅 enterprise-admin     |
| Q2 DEPARTMENT Scope           | ✅ 冻结 → 实验性，默认不启用          |

详见：`docs/design/edc-hub-p0-design-revision-2026-06-05.md`

## 十一、请专家团队复验

请确认 v2 修订是否解除原 Findings。通过后我方启动 **P1** 编码：

1. `approvalContextId` 方案是否可稳定实现 PER_REQUEST？
2. 版本级分类 + fail-closed 是否满足安全边界？
3. 显式迁移映射表是否可接受？
4. Open Questions 冻结口径是否同意？

**复验结论（请专家团队填写）：**

- [ ] 修订通过，可进入 P1
- [ ] 仍有问题（请注明编号：\***\*\_\_\_\*\***）
- [ ] 不通过（拒收原因：\***\*\_\_\_\*\***）

---

**关联文档：**

- 主方案：`docs/design/openbot-enterprise-data-capability-hub-third-party-task-plan-2026-06-05.md`
- 岗位资产定版：`docs/design/openbot-position-asset-management-plan-2026-06-04.md`
