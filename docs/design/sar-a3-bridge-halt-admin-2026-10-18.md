# SAR A3：桥登记与停用管理入口

- 日期：2026-10-18（Asia/Shanghai）
- 分支：`feat/sar-a3-bridge-halt-admin`
- 基线：`origin/main` A2 squash `6dcb263d097961cdfb51a935fea56b4e1893f6cf`
- 专家闸门：`expert-e0-e5-acceptance-2026-10-18.md` 阻断 #3 / A3
- 路径：Path C；复用企业数据仓与 E5 审计落盘；不扩新架构/目录
- 正式执行接入：**仍暂缓**

## 结论（诚实）

**已打通**：企业管理员可经产品 RPC 受控登记固定版本 SAR 执行桥、设置/清除停用开关；身份门为 `requireResolvedEnterpriseAdminTenantId`；变更持久化进企业数据仓；每次登记/停用/恢复写 E5 风格允许列表审计；停用不虚报撤回在途副作用。

**未宣称 / 仍缺**：

| 项                        | 状态                                       |
| ------------------------- | ------------------------------------------ |
| 企业外站真实会话实测      | ❌                                         |
| E0–E5 整体可用            | ❌                                         |
| §R5 真实会话 PASS         | ❌                                         |
| A4 物化身份与持续授权测试 | ❌ 未做                                    |
| A5 双中心真实浏览器闭环   | ❌ 未做                                    |
| 新管理 UI 页面            | ❌ 本阶段仅 RPC；可复用既有安装/管理调用面 |
| 正式执行接入放开          | ❌ 仍暂缓                                  |

## 打通路径（一句话）

`enterprise-data.sar.bridges.upsert` / `halts.set` / `halts.clear` → `requireResolvedEnterpriseAdminTenantId` → `upsertSarExecutionBridge` / `setSarExecutionHalt` / `clearSarExecutionHalt` + `recordSarAdminAudit` → 企业 JSON 仓持久化；执行侧仍经 `evaluateSarExecutionHalt` → `SAR_EXECUTION_HALTED`（`inFlightSideEffectsWithdrawn: false`）。

## 专家阻断对照

| 阻断                               | A3 后                                           |
| ---------------------------------- | ----------------------------------------------- |
| #1 治理网关未注入实际 SAR provider | A1 已接线                                       |
| #2 能力详情 RPC 固定空验证记录     | A2 已接线                                       |
| #3 桥登记/停用缺管理入口           | **已解决接线**：受控产品 RPC + 审计；非测调冒充 |
| #4 E5 端到端真实浏览器             | 未做（A5）                                      |

## 实现要点

1. `src/gateway/enterprise-data/types.ts` — `SarAdminAuditEvent` / `sarAdminAuditEvents`
2. `src/gateway/enterprise-data/sar-admin-audit.ts` — `recordSarAdminAudit` / `listSarAdminAuditEvents`
3. `src/gateway/server-methods/enterprise-data-sar-admin.ts`
   - `enterprise-data.sar.bridges.upsert` / `.list`
   - `enterprise-data.sar.halts.set` / `.clear`
   - `enterprise-data.sar.admin-audit.list`
   - 一律 `requireResolvedEnterpriseAdminTenantId`；`haltedBy` / 审计 `actorId` 来自可信会话，不接受客户端冒充
   - 停用响应与审计固定 `inFlightSideEffectsWithdrawn: false`、`priorWriteMayBeReplayed: false`
4. `enterprise-data.ts` 注册上述 handlers
5. 测例：`sar-a3-bridge-halt-admin.test.ts`
   - 授权成功 + 持久化 + 审计
   - 非授权拒绝、不落库
   - 停用挡新运行、恢复后放行
   - 不虚报撤回在途
   - 源码诚实检查

## 风险

- 生产默认仓无桥时执行仍 `SAR_HANDLER_MISSING`（fail-closed；≠ 已放开执行）。
- 管理员登记的桥仍受绑定/私有账户/验证/范围门约束；本 PR 不宣称运营可绕过这些门。
- ControllableTestSite / 夹具 provider ≠ 企业外站真实账户浏览器会话。
