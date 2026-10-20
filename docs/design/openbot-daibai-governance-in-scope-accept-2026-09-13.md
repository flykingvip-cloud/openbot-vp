# 大白管家治理体系范围内生产验收

Date: 2026-09-13

**结论：PASS（范围内验收通过）。**

平台管理员、企业管理员、员工大白管家三类治理边界，以及平台高级治理 UI、审计查询和拒绝路径，已通过范围内生产验收。原 2 项不纳入本轮必过项，不构成代码失败，也不得通过生产写入强行补测。后续不得把「未执行真实生产写入」描述成缺陷。

## 发布身份

| 项               | 结果                                              |
| ---------------- | ------------------------------------------------- |
| LIVE 容器        | `openbot-gateway-rc`                              |
| LIVE commit      | `6bc9ff13f681be200b5ad3d139e424e9ebe668db`        |
| version          | `2026.7.12-rc.2`                                  |
| healthz / readyz | 本机 18789 与 `https://www.openbot.love` 均为 200 |

全程未做生产写入、重启、配置变更或真实终端归属分配。

## 统计

- PASS: 16
- FAIL: 0
- NOT_APPLICABLE / DEFERRED: 2
- BLOCKED: 0

## 范围内已验证

### 三类会话

- 平台超管：`sessionKind=platform-super-admin`
- 企业管理员：`sessionKind=enterprise-admin`
- 员工：`sessionKind=member`

### 治理 RPC

- 企业 / 员工 `management-governance.audit.list` 可读；www Control UI 归到 `scope.kind=self`
- 客户端传入非法 `tenantId` 被拒绝（`INVALID_REQUEST`）
- 企业 / 员工 `management-governance.node.assign` 对虚构节点返回 `platform scope required`，未写入
- 平台 `audit.list` 可读，`scope.kind=platform`
- 平台对虚构节点 `node.assign` 返回 `unknown nodeId`，未写入

### 平台高级治理 UI

入口：`https://admin.openbot.love/platform/advanced#platform-advanced:governance`

- Tab「权限与审计」可选中
- 文案可见：权限与审计、大白管家权力链、治理审计、终端归属分配
- 未选择真实节点时「确认归属」保持禁用
- UI 查询能看到拒绝记录

## NOT_APPLICABLE / DEFERRED

这两项已从本轮必过项排除。

1. **NOT_APPLICABLE：企业端口（非 www Control UI）tenant 审计字段。**  
   当前治理审计产品入口是平台高级治理页。企业和员工通过同一治理 RPC 验证作用域与拒绝边界即可。企业端口独立审计页属于未来入口扩展，不是当前三类治理链缺陷。

2. **DEFERRED：明确测试终端上的 `node.assign` 正式写入。**  
   生产安全策略不执行真实归属写入。拒绝路径、未知节点拒绝和 UI 禁用已覆盖写入安全边界。成功写入只能在隔离测试环境或明确标记的测试终端上进行。

## 范围说明

- 企业端口独立审计页不属于当前治理产品入口
- 真实 `node.assign` 写入因生产安全策略不执行
- 写入路径已通过非授权拒绝、未知节点拒绝和 UI 禁用状态验证
- 若未来提供隔离测试终端，或企业端口新增审计页，应分别建立专项验收

## 同批代码变更

员工工作台每日摘要「今日日程」向 `workbench.schedule.list` 传入浏览器本地 `timeZone`，避免服务端默认 UTC 切日。见 `ui/src/ui/controllers/spaces.ts` 的 `resolveWorkbenchScheduleListParams`。
