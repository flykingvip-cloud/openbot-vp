# SAR R5 只读对照试点报告（协议/夹具）

- 日期：2026-10-18（Asia/Shanghai）
- 分支：`feat/sar-r5-readonly-pilot`
- 专家闸门：`expert-p0-p4-acceptance-2026-10-18.md` §R5 + P3 重界定
- 路径：Path C；只读；不建 Bridge daemon；不导出 Cookie；不 fork OpenCLI
- 代码入口：`src/site-capability/readonly-pilot.ts`、`pilot-comparison.ts`、`readonly-pilot-audit.ts`

## R5 状态：**未达 / 仅协议夹具对照**

| 宣称                                                         | 状态                                              |
| ------------------------------------------------------------ | ------------------------------------------------- |
| 同一真实账户、同一任务集：SAR 只读 vs 浏览器对照（夹具协议） | ✅ 本交付可审计                                   |
| 夹具内业务正确性 ≥ 通用浏览器对照                            | ✅（见下表）                                      |
| 成本/耗时改善来自**实测 wall-clock**                         | ❌ 仅 harness step-clock（`SAR_PILOT_STEP_MS=5`） |
| 真实外站已登录账户浏览器会话对照                             | ❌ 本环境不可用                                   |
| **R5 达标 / 企业外站已实测**                                 | ❌ **不可宣称**                                   |

**结论一句话**：本报告是 **协议/夹具对照** 证据，**不是** R5 真实岗位只读试点的达标证明。

## 账户范围

| 字段     | 值                                             |
| -------- | ---------------------------------------------- |
| tenantId | `tenant-pilot`                                 |
| userId   | `user-pilot`                                   |
| 原绑定   | `bind-pilot-original`                          |
| 说明     | 夹具主体 + 原绑定；**不是**企业外站账户 worker |

跨账户 / 备用绑定拒绝仍由既有 P3 测例覆盖（`sar-p3-readonly-pilot.test.ts`）。

## 任务集

| 站       | capabilityId          | version      | args              | 真值来源                          | 需夹具会话           |
| -------- | --------------------- | ------------ | ----------------- | --------------------------------- | -------------------- |
| bulletin | `pilot.bulletin.read` | `2026.10.17` | `desk=ops`        | `SAR_PILOT_GROUND_TRUTH.bulletin` | 否                   |
| inbox    | `pilot.inbox.summary` | `2026.10.17` | `mailbox=primary` | `SAR_PILOT_GROUND_TRUTH.inbox`    | 是（假口令夹具会话） |

原点：`https://pilot.bulletin.test`、`https://pilot.inbox.test`（内存 `ReadonlyPilotSite`）。小红书不是试点站。

## SAR vs 通用浏览器结果对比表（夹具）

两侧均经账户浏览器串行派发 + 有限操作集。通用浏览器走更长步：navigate → read_page → request_context → capture_result。

| 站       | capability          | SAR（派发/时延/正确） | 通用浏览器（派发/时延/正确） | 正确性 ≥ 对照 | 成本时钟                          |
| -------- | ------------------- | --------------------- | ---------------------------- | ------------- | --------------------------------- |
| bulletin | pilot.bulletin.read | 2 / 10ms / true       | 4 / 20ms / true              | true          | harness_step_clock（非 live RTT） |
| inbox    | pilot.inbox.summary | 2 / 10ms / true       | 4 / 20ms / true              | true          | harness_step_clock（非 live RTT） |

比较器诚实字段（每次 `comparePilotRead`）：

- `evidenceKind: "protocol_fixture"`
- `liveNetworkRtt: false`
- `r5LiveSessionClaim: false`
- `fixtureRelaxed: false`
- `cost.clock: "harness_step_clock"`
- 文案含 `not a live network RTT` / `Not an R5 live-session claim`

**禁止**把上表派发/时延改善写成「真实会话成本已改善」或「R5 已达」。

## 真实会话阻塞清单

本机探测（`probeLiveReadonlyPilotPrerequisites` / `BROWSER_BRIDGES`）：

1. **no_scope_key / no_control_bridge**：默认无已注册账户浏览器控制桥；`createAccountBrowserPort` 对未知 scope 仍 fail-closed（`BROWSER_UNAVAILABLE`）。
2. **no_enterprise_logged_in_session**：无已登录企业外站账户 worker 会话可供同一真实账户对照。
3. **cost_must_be_wall_clock**：R5 要求成本改善来自实测 wall-clock，夹具 `SAR_PILOT_STEP_MS` 不满足。

（本环境虽有通用 Chrome/Playwright，但**不是** OpenBot `BROWSER_BRIDGES` 账户 worker 控制桥，不得冒充 R5 实测。）

## 最小复现真实会话条件

1. 同一真实账户 binding 已在 `SarExecutionAuthority` 注册（tenant / user / binding）。
2. 该账户的账户浏览器控制桥在 `BROWSER_BRIDGES` 在线（`kind=control-bridge`）。
3. 绑定账户已登录目标只读页（复用现有 worker；不导出 Cookie；不新建 Bridge daemon）。
4. 任务集 URL 落在 manifest `allowedOrigins` 内，且为只读。
5. 入口：对 live port 跑 `comparePilotRead` / `buildReadonlyPilotAuditEvidence`；`durationMs` 用 wall-clock，不用 harness ticks。
6. 仅当 live 正确性 ≥ 浏览器对照且成本为实测时，报告才可设 `r5LiveSessionClaim=true`；在此之前必须保持 **R5 状态：未达**。

## 代码与测例

| 产物      | 路径                                                     |
| --------- | -------------------------------------------------------- |
| 夹具站    | `src/site-capability/readonly-pilot.ts`                  |
| 比较器    | `src/site-capability/pilot-comparison.ts`                |
| 审计构建  | `src/site-capability/readonly-pilot-audit.ts`            |
| P3 既有测 | `src/site-capability/sar-p3-readonly-pilot.test.ts`      |
| R5 诚实测 | `src/site-capability/sar-r5-readonly-pilot.test.ts`      |
| 本报告    | `docs/design/sar-r5-readonly-pilot-report-2026-10-18.md` |

## 风险

- 读者可能把夹具派发改善误读为生产延迟收益 → 报告与比较器文案已反复标注 harness clock / not live RTT / not R5 claim。
- 正式执行接入仍暂缓；写路径仍夹具限制（R4）。
- 无 live 桥时不得用本机 Chrome CDP 绕过账户浏览器入口宣称 R5。
