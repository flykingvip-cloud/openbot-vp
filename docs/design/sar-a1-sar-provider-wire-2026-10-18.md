# SAR A1：受控 SAR provider 接入产品入口

- 日期：2026-10-18（Asia/Shanghai）
- 分支：`feat/sar-a1-sar-provider-wire`
- 基线：`origin/main` R5 squash `d6b6aab7b6`
- 专家闸门：`expert-e0-e5-acceptance-2026-10-18.md` 阻断 #1（及 E4 物化缺 provider）
- 路径：Path C；P0；evaluate 双层；账户浏览器串行；OI≠站点能力
- 正式执行接入：**仍暂缓**

## 结论（诚实）

**已打通**：进程内受控 `SarGovernanceProvider` 注入 `enterprise-data.invoke` 与 E4 物化入口（`projection-materializer.run` / on-demand / scheduled），经真实 RPC handler 可对 `ControllableTestSite` 完成只读读取；缺执行桥仍 `SAR_HANDLER_MISSING`（fail-closed ≠ 已打通冒充）。

**未宣称 / 仍缺**：

| 项                                 | 状态                                                 |
| ---------------------------------- | ---------------------------------------------------- |
| 企业外站真实会话实测               | ❌                                                   |
| E0–E5 整体可用                     | ❌                                                   |
| §R5 真实会话 PASS                  | ❌                                                   |
| A2 持久验证记录 → 安装状态         | ❌ 未做                                              |
| A3 桥登记/停用管理入口 + 审计      | ❌ 未做                                              |
| A4 物化身份与持续授权测试          | ❌ 未做                                              |
| A5 双中心真实浏览器闭环            | ❌ 未做                                              |
| 字段级 `appliedFilters` 读取前强制 | ❌ 诚实返回 `scopeEnforcedBeforeRead: false`，不撒谎 |

## 打通路径（一句话）

`enterprise-data.invoke` / E4 materializer → `invokeEnterpriseDataAction` / `runProjectionMaterialization` → `executeGovernedSarBridge` → **进程内** `getProcessControlledSarProvider()` → `SiteCapabilityRuntime.invoke`（账户浏览器串行 / ControllableTestSite 或 `createAccountBrowserPort`）。

## 专家阻断对照

| 阻断                               | A1 后                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| #1 治理网关未注入实际 SAR provider | **已解决接线**：invoke + 物化入口注入受控 provider；缺桥仍 `SAR_HANDLER_MISSING` |
| #2 能力详情 RPC 固定空验证记录     | 未做（A2）                                                                       |
| #3 桥登记/停用缺管理入口           | 未做（A3）                                                                       |
| #4 E5 端到端真实浏览器             | 未做（A5）；本交付仅为测试站 / 夹具端口                                          |

## 实现要点

1. `src/gateway/enterprise-data/controlled-sar-provider.ts`
   - `createControlledSarProvider` / `getProcessControlledSarProvider`
   - 复用 `SiteCapabilityRuntime` + 默认 `createAccountBrowserPort`；测试可 `setProcessControlledSarRuntimeForTests` 挂 ControllableTestSite
   - 禁止 Bridge daemon / Cookie 导出 / OpenCLI fork / `executeMockHandler`
   - 无能力/无授权/无绑定/无浏览器 → runtime 明确失败，不静默成功
   - `appliedFilters.length > 0` → 不读站、`scopeEnforcedBeforeRead: false`

2. 产品入口注入（RPC **不**接受客户端 provider）
   - `enterprise-data-m1.ts` → `enterprise-data.invoke`
   - `enterprise-data-m4.ts` → `projection-materializer.run`
   - `on-demand-projection-materializer.ts` / `scheduled-projection-materializer.ts`

3. 测例：`controlled-sar-provider.test.ts`
   - 经注册后的 gateway method 读 ControllableTestSite 成功
   - 缺桥仍 `SAR_HANDLER_MISSING`
   - 物化入口一条覆盖
   - 源码诚实检查：入口含 `getProcessControlledSarProvider`，不含 `params.sarProvider`

## 风险

- 生产默认 runtime 目录为空时，有桥仍会因未 register/grant 失败（能力编目属 E3/A2，非本阶段）。
- 字段级范围强制未实现；TEAM+filter 策略下 provider 拒绝宣称已强制。
- ControllableTestSite / 夹具端口 **不是** 企业外站真实账户浏览器会话。
