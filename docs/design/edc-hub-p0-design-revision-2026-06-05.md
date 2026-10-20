# Enterprise Data Capability Hub P0 设计修订说明（专家反馈响应，2026-06-05）

> 基线报告：`docs/design/edc-hub-p0-completion-report-2026-06-05.md`  
> 修订版本：**P0 v2**

## 修订摘要

专家团队对 P0 设计提出 8 项 Findings 与 2 项 Open Questions。本修订**全部采纳** Findings，并冻结 Open Questions 口径。

## Findings 响应对照

| #   | 专家发现                              | 修订动作                                                                                  | 修订文档                                  |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| F1  | PER_REQUEST 绑定 traceId 自相矛盾     | 引入独立 `approvalContextId`；`traceId` 仅用于审计；重试显式携带 ctx                      | `approval-workflow-model.md` §2.3、§3.4   |
| F2  | 分类未绑 version + 未知字段 fail-open | 键扩展为 `connectorId+actionKey+version+fieldPath`；未知字段默认 `fail_closed_redact`     | `data-classification-model.md` §2.2、§2.3 |
| F3  | 审批 API 信任客户端 seatId            | 申请 API 移除 seatId；服务端从 session 解析                                               | `approval-workflow-model.md` §4           |
| F4  | ONCE 审批不随 Scope 失效              | 增加 `ApprovalContextSnapshot`（scope/grant/classification digest）；变更即 `invalidated` | `approval-workflow-model.md` §2.2、§7     |
| F5  | 迁移统一映射 read_summary 武断        | 改为逐连接器显式映射表；无映射=pending_review，不自动迁移                                 | `connector-action-versioning.md` §6.2     |
| F6  | DataAudit 缺对象引用                  | 新增 `objectRefs`（哈希主键 + hint）；上限 50 条                                          | `audit-runtime-schema.md` §2.2、§2.3      |
| F7  | TEAM 缺 teamLabel 静默降级 SELF       | 改为 fail-closed `SCOPE_CONTEXT_MISSING`                                                  | `scope-policy-model.md` §2.2.1、§7        |
| F8  | 审计失败全局 fail-open                | HIGH/CRITICAL fail-closed；LOW/MEDIUM fail-open                                           | `audit-runtime-schema.md` §2.4            |

## Open Questions 冻结口径

### Q1：首版审批人支持 department-head 还是 enterprise-admin？

**冻结决策：首版仅 `enterprise-admin`。**

- `ApprovalPolicy.approverRole` 首版类型收窄为 `"enterprise-admin"`
- `department-head` 列入 P5+ 扩展（需 `roleCode` 映射 + UI 配置）
- 种子策略中 MEDIUM 批量查询也使用 `enterprise-admin`（24h ONCE）

### Q2：DEPARTMENT Scope 无稳定 departmentId 是否进首版？

**冻结决策：实验性支持，默认不启用。**

- 首版种子仅 `SELF / TEAM / ALL`
- `DEPARTMENT` 保留类型定义，但默认不种子；UAT 租户可显式启用
- 解析暂用 `roleCode` + `teamLabel`，标注为**过渡方案**，非长期安全边界
- 缺失 department 上下文：**fail-closed**
- 稳定 `departmentId` 就绪后（P5+）升级为正式 Scope

## 受影响文档版本

| 文档                                             | 版本 |
| ------------------------------------------------ | ---- |
| `connector-action-versioning.md`                 | v2   |
| `scope-policy-model.md`                          | v2   |
| `data-classification-model.md`                   | v2   |
| `audit-runtime-schema.md`                        | v2   |
| `approval-workflow-model.md`                     | v2   |
| `edc-hub-p0-implementation-manual-2026-06-05.md` | v2   |
| `edc-hub-p0-risk-register-2026-06-05.md`         | v2   |
| `edc-hub-p0-completion-report-2026-06-05.md`     | v2   |

## 请专家团队复验

请确认以上修订是否解除原 Findings。若通过，我方可进入 **P1 编码**。

**复验结论（请专家团队填写）：**

- [ ] 修订通过，可进入 P1
- [ ] 仍有问题（请注明编号：\***\*\_\_\_\*\***）
