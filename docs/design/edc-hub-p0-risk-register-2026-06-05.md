# Enterprise Data Capability Hub 风险清单

> 状态：P0 修订版 v2（2026-06-05，响应专家验收反馈）  
> 评审周期：每阶段验收前更新

## 风险登记

| ID  | 类别 | 风险描述                          | 影响 | 概率 | 缓解措施                                                      | 责任阶段 | 状态   |
| --- | ---- | --------------------------------- | ---- | ---- | ------------------------------------------------------------- | -------- | ------ |
| R01 | 架构 | 引入 DigitalHuman 新授权主体      | 高   | 低   | 方案 §4.1 硬约束；代码审查                                    | 全阶段   | 开放   |
| R02 | 架构 | Scope 仅前端过滤                  | 高   | 中   | P2 服务端求值 + P3 网关强制；安全绕过测试                     | P2-P3    | 开放   |
| R03 | 架构 | Agent 绕过网关取数                | 高   | 中   | 唯一入口 `enterprise-data.invoke`；负例测试                   | P3-P5    | 开放   |
| R04 | 数据 | 无 actionKey+version 导致静默破坏 | 高   | 中   | P1 精确版本绑定；禁止默认升级                                 | P1       | 开放   |
| R05 | 集成 | CRM/ERP 真实联调不可用            | 中   | 高   | 第 3 周前 Mock Strategy（见实施说明书 §6）                    | P1-P3    | 开放   |
| R06 | 模型 | teamLabel 不足以表达部门 Scope    | 中   | 中   | DEPARTMENT 实验性默认关闭；TEAM 缺 teamLabel fail-closed      | P2       | 已缓解 |
| R07 | 合规 | 脱敏遗漏导致明文泄露              | 高   | 中   | CONFIDENTIAL 默认脱敏；RESTRICTED 默认阻断；预览 API          | P2       | 开放   |
| R08 | 运维 | 审计存储膨胀                      | 中   | 中   | 90 天保留策略；P6 Runbook 归档                                | P4-P6    | 开放   |
| R09 | 迁移 | Store v2→v3 破坏现有 Seat 关系    | 高   | 低   | normalize 补空字段；迁移测试；回滚保留 v2 读取                | P1-P6    | 开放   |
| R10 | 产品 | 只做页面不做运行层                | 高   | 中   | 排期运行层优先（P1-P4 先于 P5 UI）                            | 全阶段   | 开放   |
| R11 | 审批 | approverRole 解析模糊             | 中   | 低   | **已冻结**：首版仅 enterprise-admin；department-head 延至 P5+ | P4       | 已关闭 |
| R12 | 性能 | Handler 超时拖累网关              | 中   | 中   | 默认 30s timeout；P6 性能基线                                 | P3-P6    | 开放   |
| R13 | 测试 | 安全绕过测试不足                  | 高   | 中   | §13 验收矩阵 + 专用 security test suite                       | P6       | 开放   |
| R14 | 兼容 | 旧 connector execute 调用方断裂   | 中   | 高   | 逐连接器显式映射表；无映射=pending_review                     | P6       | 已缓解 |
| R15 | 安全 | PER_REQUEST 审批链断裂            | 高   | 中   | approvalContextId 独立于 traceId                              | P4       | 已关闭 |
| R16 | 安全 | 未知字段静默明文                  | 高   | 中   | fail-closed + 版本级分类键                                    | P2       | 已关闭 |
| R17 | 安全 | ONCE 审批与 Scope 脱钩            | 高   | 中   | ApprovalContextSnapshot + invalidated                         | P4       | 已关闭 |
| R18 | 合规 | 高风险无审计执行                  | 高   | 中   | HIGH/CRITICAL 审计 fail-closed                                | P4       | 已关闭 |

## 假设清单

| ID  | 假设                                       | 若失效则                            |
| --- | ------------------------------------------ | ----------------------------------- |
| A01 | Seat 仍是企业侧唯一权限宿主                | 需重新评审组织模型                  |
| A02 | connector 资产绑定可复用为动作执行凭证来源 | 需独立 Credential Service           |
| A03 | 专家团队按阶段验收                         | 可合并阶段但需书面确认              |
| A04 | Node 22+ 运行时不变                        | 适配 CI 矩阵                        |
| A05 | 首版只读可满足 UAT                         | 写操作需求推迟至 v2                 |
| A06 | 首版审批仅 enterprise-admin 可接受         | 需业务方确认部门负责人审批延至 P5+  |
| A07 | DEPARTMENT Scope 实验性默认可接受          | 正式部门 Scope 待 departmentId 就绪 |

## 拒收条件对照（方案 §15）

| 拒收条件                   | 对应风险 | 防护文档                            |
| -------------------------- | -------- | ----------------------------------- |
| 新增 DigitalHuman 授权主体 | R01      | 实施说明书 §7                       |
| 无 actionKey+version       | R04      | connector-action-versioning.md      |
| Scope 仅前端               | R02      | scope-policy-model.md               |
| Classification 未参与脱敏  | R07      | data-classification-model.md        |
| 审计只有调用层             | —        | audit-runtime-schema.md             |
| 审批只有布尔开关           | R11      | approval-workflow-model.md          |
| Gateway 返回裸数据         | R03      | P3 设计（待 P3 文档）               |
| Agent 绕过网关             | R03      | 实施说明书 §8                       |
| 首版写操作                 | —        | connector-action-versioning.md §1.2 |
| 无迁移回滚                 | R09      | 各设计文档 §6-7                     |
| 无测试矩阵                 | R13      | 各设计文档 §8                       |
