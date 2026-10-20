# Phase D H1 — 热路径旁一处 Runtime 门面 observe（书面范围；**非 Gate 收紧 / 非 enforce**）

> 范围 id：`phase_d_hotpath_facade_observe_one_site`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-hotpath-facade-observe-one-site-scope.md`。  
> 日期：**2026-10-13**（Asia/Shanghai）  
> 对照：Doc02 §9；`phase-d-runtime-facade-shadow.md`（#60）；`phase-d-p8b-p8c-deferred.md`；`phase-d-meta-schema-path-gate-owner-track-scope.md`（#101）  
> 前置：`phase-d-hotpath-facade-observe-one-site-acceptance.md` + `phase-d-hotpath-facade-observe-one-site-start-order.md`  
> **引用 Owner track：** `phase_d_meta_schema_path_gate_owner_track_acceptance`（若 tip 仍在）  
> **本 PR = docs-only 书面范围 / 接受 / 开工令。** 编码实现须引用开工令另开实现 PR；**不**在本 PR 改 `src/` / `packages/`。  
> **站桩（全文有效）：Phase C NO-GO COMPLETE；unique-benefit FAIL；C10 仍不能 pass。** 把本包读成 C10 pass / Decision C GO / 整段 D GO / Gate 已收紧 / enforce 默认开 = **FAIL**。  
> **合入 ≠ PASS/GO。**

## 0. 为何开本刀

| 现象 | 证据 |
| --- | --- |
| Owner 令 | 2026-10-13：推进「真在热路径发挥治理作用」；同意先做 H1（观察挂点），不直接 H4 |
| #60 现状 | Runtime 门面 `observeOrchestrationRuntimeFacade` / `observePreflightRuntimeFacade` 已 `code-present`，**不被** gateway-hook / dispatch / chat.send import |
| soft/observe | ACP 等入口已有 default-off preflight observe；门面 shadow 仍未挂进热路径旁调用点 |
| 站桩 | C **NO-GO**；**C10 仍不能 pass**；Gate 收紧 / enforce 仍 OUT |

本刀把「下一阶 = 热路径旁**一处** façade observe」收成有界书面三件套：授权日后实现 PR 在**恰好一个**已命名调用点调用既有门面 observe；默认关；仅报告；丢弃 allow。**不是** Gate 收紧；**不是** enforce；**不是**整段 D GO。

## 1. 目标（Goal）

1. 书面锁定 IN/OUT、调用点候选、旗标、回滚、主张天花板。  
2. 授权后续实现 PR：在**一个**热路径旁点调用既有 façade observe；unset/off 时行为与今日相同。  
3. 打开后仍只报告；不阻断、不写生产账本、不选中执行 Path、不翻 `readyToTighten`。  
4. 主张天花板（实现后）：至多 **`runtime-enabled`（仅观察）**；禁止 `production-proven` /「Gate 已收紧」。  
5. **C10 仍不能 pass**；Phase C NO-GO 不改写。

## 2. 范围内（IN）

### 2.1 本 scope PR（docs-only）

| 项 | 说明 |
| --- | --- |
| 书面三件套 | 本 scope + acceptance + start-order |
| 最小 xref | 可选：`phase-d-p8b-p8c-deferred.md` / `docs_phase_d_bounded_closeout.md` 一行指针 |

### 2.2 实现 PR（引用开工令；**本 PR 不开**）

| 项 | 约束 |
| --- | --- |
| 调用点 | **恰好一个**；实现 PR 正文必须点名路径与函数。候选（择一）：(A) `src/auto-reply/reply/dispatch-acp.ts` 既有 ACP turn observe 旁；或 (B) `src/agents/execution-preflight/` 既有 soft/observe 旁 |
| API | 复用 `observeOrchestrationRuntimeFacade` 和/或 `observePreflightRuntimeFacade`（#60）；不另起执行故事 |
| 旗标 | 优先复用 `OPENBOT_CONSTITUTIONAL_SHADOW`（调用方传快照）；若需独立门控可新增默认关 `OPENBOT_CONSTITUTIONAL_HOTPATH_FACADE_OBSERVE`——实现 PR 须记名选择。模块**不**单独读 `process.env` |
| 行为 | 关 = inert；开 = 报告-only；丢弃 allow；不 `applyPreflightToTools`；不 `armCompletionHold` |
| 恒 false | `enforced` / `liveInvoke` / `fabricDefaultOn` / `readyToTighten` /（本刀不授权的）热路径 deny |
| 单测 | 默认关 inert；opt-in 有报告；关回滚；该调用点以外无新 import 扩散 |

## 3. 范围外（OUT）

- Gate / Path **热路径收紧**；enforce 默认开；`readyToTighten=true`  
- Fabric default-on；`ORCHESTRATION_LIVE_INVOKE=true` 作生产默认  
- ACP stdio 桥另刀；`packages/aor-core` 内预检；为观察开 Fabric  
- 登记集扩 >1；本刀扩展 `executed=true` 到网关/租户数据  
- 改写 Phase C 冻结正文；宣称 C10 pass / C GO / 整段 D GO  
- 本 PR 改 `src/` / `packages/`  
- 无新 scope 把 H2–H4 偷渡进本刀

## 4. 主张天花板

- 本 docs PR：`code-present`（文档事实）  
- 后续实现 PR：至多 **`runtime-enabled`（observe-only）**  
- **禁止** `production-proven` /「Gate 已收紧」/ C5 全面 pass / C10 pass

## 5. 回滚

- 秒级：unset 观察旗标 / 不传 opt-in 快照  
- 实现 PR：`git revert`；或删除该单一调用点  
- 不得借回滚声称曾短暂 GO / 短暂 Gate 收紧

## 6. 成功标准（本 docs PR）

| 标准 | 判定 |
| --- | --- |
| 三件套 | scope + acceptance + start-order 入库 |
| 站桩 | 每文件明文：**C10 仍不能 pass**；C NO-GO；非整段 D GO；非 Gate 收紧 |
| 无越界 | OUT 未触碰；本 PR 无 `src/` / `packages/` |
| 合入 ≠ PASS/GO | 明文 |

## 7. 验收提示

**PASS：** 三件套齐全；IN=一处 façade observe；OUT 含 Gate/enforce/Fabric/live invoke/stdio/AOR；C10 仍不能 pass。  
**FAIL：** 写成 Gate 已收紧 / enforce 默认开 / 整段 D GO / 夹带代码。
