# SAR A5：双中心真实浏览器闭环（证据链）

- 日期：2026-10-25（Asia/Shanghai）
- 仓库：https://github.com/flykingvip-cloud/openbot-vp
- 分支：`feat/sar-a5-dual-center-browser-loop`
- 基线：`origin/main` tip（含 A4 docs squash `5b6176af`）
- 专家闸门：`expert-e0-e5-acceptance-2026-10-18.md` §整改线 A5
- 路径：Path C；复用 A1–A4 / E3 / E5；不扩新架构/目录
- 正式执行接入：**仍暂缓**

## 结论（诚实）

**已打通（夹具/测站层）**：一条双中心闭环证据链——接入 → 验证 → 审核分配 → 供给 → 故障诊断可追溯——经 ControllableTestSite（`browser_dom` + TrustedPagePort）与既有治理 RPC/网关可复跑；每步有可对上的 trace/runId/审计/验证记录字段。

**未宣称 / 仍缺**：

| 项                            | 状态                                      |
| ----------------------------- | ----------------------------------------- |
| 企业外站真实账户浏览器会话    | ❌ 本阶段为 `fixture-test-site`           |
| E0–E5 整体「已交付可用」      | ❌                                        |
| §R5 真实岗位只读外站会话 PASS | ❌                                        |
| 正式执行接入放开              | ❌ 仍暂缓                                 |
| 双中心产品 UI 真人点击验收    | ❌ 本阶段为 RPC/网关/投影证据，非 UI 录屏 |

## 五步证据表

| #   | 步骤               | 复用                                                                                          | 证据                                                                                                                                                                                                                | 结果      |
| --- | ------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | **接入**           | A3 `enterprise-data.sar.bridges.upsert`                                                       | 管理员桥登记 + `sarAdminAudit`（`bridge_upsert` / actorId）                                                                                                                                                         | ✅ 测站层 |
| 2   | **验证**           | A2 `upsertSarValidationRecord`                                                                | 缺记录 → `SAR_VERIFICATION_MISSING`；跨租户/错版本不进本租户 install 列表；匹配 passed 记录落库                                                                                                                     | ✅        |
| 3   | **审核分配**       | E3 `projectCapabilityCenterInstall`                                                           | pin + 验证记录 → `executable=true` / `verification=passed`                                                                                                                                                          | ✅        |
| 4   | **供给**           | A1 process provider + A4 `resolveProjectionExecutionIdentity` + `projection-materializer.run` | 身份=桥 owner；物化产出 feed / gatewayTraceIds                                                                                                                                                                      | ✅ 测站层 |
| 5   | **故障诊断可追溯** | E5 `failureDisplay` + `SarTraceCorrelation`                                                   | ControllableTestSite 结构故障 → `OPERATION_FAULT` 可按 traceId↔runId 互查；显式 `STRUCTURE_CHANGED` SiteRunResult → `failureDisplay=structure_change` 且关联同 trace；策略拒绝 → `policy_denied`；halt 不贴五类标签 | ✅        |

闭环编排测例：`src/gateway/enterprise-data/sar-a5-dual-center-browser-loop.test.ts`  
证据辅助：`src/gateway/enterprise-data/sar-a5-dual-center-browser-loop.ts`

## 测站 vs 外站分层

| 层                              | 本阶段             | 说明                                                                                                               |
| ------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **夹具 / ControllableTestSite** | ✅                 | in-memory TrustedPagePort；`executionMode: browser_dom`；账户绑定经 `SarExecutionAuthority`；**不是** CDP 外站会话 |
| **fixture-bridge 控制面 HTTP**  | 未作为本闭环主路径 | R2 已有；A5 主路径走 ControllableTestSite（与 A1 一致）                                                            |
| **企业外站真实会话**            | ❌                 | 无登录外站账户浏览器；**不得**写成「企业网站接入已打通」                                                           |

浏览器证据层级常量：`SAR_A5_BROWSER_EVIDENCE_LEVEL.fixtureTestSite`（`"fixture-test-site"`）。

## 实现要点（不扩架构）

1. 接入：A3 管理 RPC（非静默 MCP/OI）。
2. 验证：A2 持久验证记录驱动安装态；fail-closed 保留。
3. 审核分配：E3 安装投影读取真实 validationRecords。
4. 供给：A1 `getProcessControlledSarProvider` + A4 物化身份核验后 `projection-materializer.run`。
5. 故障：E5 关联表 + `resolveSarFailureDisplay`；ControllableTestSite 结构故障当前映射为 `OPERATION_FAULT`（message=`STRUCTURE_CHANGED`），属既有失败码，可追溯；五类展示用显式 `STRUCTURE_CHANGED` 结果证明接线。

## 残余

- ControllableTestSite 结构故障未把 `error.code` 升为 `STRUCTURE_CHANGED`（仍为 `OPERATION_FAULT`）；五类展示依赖桥路径显式码——若产品要夹具层直接贴「结构变化」，需另阶段改 runtime 映射（本阶段不扩）。
- 无 Playwright/CDP 外站实测；无双中心 UI 点击剧本。
- 正式执行接入开关保持关闭。

## 明确非宣称

- 不宣称 E0–E5 产品就绪或专家整体闸门通过。
- 不宣称 R5 PASS。
- 不宣称企业外站真实会话已打通。
- 不放开正式执行接入。
