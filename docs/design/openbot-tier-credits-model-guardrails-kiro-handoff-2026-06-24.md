# OpenBot Tier / Credits / Model Guardrails - Kiro 实施说明

Date: 2026-06-24

Audience: Kiro 执行者

Final Acceptance Owner: `codex`

Status: **Completed (Phase 1–4)** — 2026-06-24 codex 有条件验收放行后冻结；原「只授权 Phase 1」口径已被实施指令取代（见 §1.3）。

Primary design source:

- `docs/design/openbot-tier-credits-model-guardrails-plan-2026-06-24.md`

Supporting context:

- `docs/design/openbot-commercial-runtime-billing-plan-2026-06-23.md`
- `docs/design/platform-plan-entitlement-architecture-2026-06-20.md`
- `docs/design/platform-pricing-tiers-2026-06-16.md`

---

## 1. 任务目标

这次任务不是重做套餐系统，也不是改 Credits 计量公式。

这次只做一件事：

```text
把平台端套餐配置页从
“Tier + 手工模型双配”
收口成
“Tier 主配置 + 模型池自动投影 + modelQuota 下沉高级控制”。
```

### 1.1 已交付范围（Phase 1–4）

| Phase       | 内容                                                                                                                                      | 状态      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **Phase 1** | Tier 主配置、模型池只读预览、保存时派生 `allowedModelIds`、`modelQuota` 下沉高级控制                                                      | ✅ 已交付 |
| **Phase 2** | `modelQuota` 从主流程移入 `<details>` 折叠「高级模型控制」，仅对自动解析池可编辑                                                          | ✅ 已交付 |
| **Phase 3** | （Plan 文档中间阶段；与 Phase 2 一并落地于同一 UI 改造）                                                                                  | ✅ 已交付 |
| **Phase 4** | **ModelBudget**（`monthlyCreditsCap` / `spendCapCents`）独立于 `modelQuota`；只读核算 `model-budget-status.ts`，**不入** Credits 计量主链 | ✅ 已交付 |

Phase 1 核心要求：

1. 平台套餐编辑页：`Tier` 成为主配置
2. 模型池由 `Tier` 自动解析并只读预览
3. 保存时自动带上派生的 `allowedModelIds`
4. `modelQuota` 下沉到高级控制，不再作为默认主流程配置
5. 保持企业端/员工端现有 entitlement 链路兼容

### 1.2 仍然明确不做

以下内容 **未做、且不在本 handoff 范围内**：

1. 不做 `Credits v2`
2. ~~不做 `ModelBudget` / `ModelCreditBucket`~~ → **已撤销**：Phase 4 按 Plan 文档新增独立 `ModelBudget` 结构（见 §1.3）
3. 不改 `record-credit-usage.ts` 的 Credits 结构
4. 不改 `authorizeCommercialRun()` 主链
5. 不改 `SubscriptionRuntimeSnapshot` 结构
6. 不移除后端 `allowedModelIds` 字段
7. 不做 enterprise/user runtime 大重构
8. 不改 commerce / order / proration / subscription lifecycle

如果为了完成当前任务必须跨进上述（除已交付 Phase 4 外）范围，请暂停并记录，不要硬做。

### 1.3 范围口径变更记录（codex 2026-06-24）

**背景**：初版 handoff（Status: 只授权 Phase 1）与后续实施指令「完成 Plan 文档 Phase 1–4」不一致。

**codex 裁定**：

- 以 **Plan 文档 + 实际交付** 为准：Phase 1–4 均属授权范围。
- Phase 4 `ModelBudget` 为 **只读核算 / 配置结构**，与套餐总 Credits 桶口径分离，**不**改写 `record-credit-usage` / `authorizeCommercialRun` 主链。
- 初版 handoff §1.2 第 2 条「不做 ModelBudget」**作废**；验收 §10 第 5 条按本表更新。

**Phase 4 关键落点**：

- 前端：`plan-form-helpers.ts`（`buildDraftModelBudgets` / `buildModelBudgetsForSave`）、`page.ts` submit 链路
- 后端：`model-budget-status.ts`、`plan-version-model-binding-store.ts`、`platform-plan-bundle.ts`

---

## 2. 必须接受的语义冻结

在这次任务里，以下语义是固定的：

### 2.1 Tier

`Tier` 表示：

```text
模型能力层 / 模型池分组
```

职责：

- 定义套餐开放哪些模型层
- 作为套餐主配置

### 2.2 Credits

`Credits` 表示：

```text
套餐级 AI 工作额度 / 总预算
```

职责：

- 决定总预算
- 不决定具体开放哪些模型

### 2.3 modelQuota

`modelQuota` 表示：

```text
高级模型级限制 / guardrail
```

职责：

- 某个模型的额外限制
- 不作为套餐主流程配置
- 不解释成 Credits 结构

---

## 3. 当前代码真相

Kiro 开工前必须先理解当前双轨状态：

### 3.1 Tier -> 模型池投影能力已经存在

已存在后端与前端 gateway：

- `src/gateway/resource-catalog/resolve.ts`
- `src/gateway/server-methods/resource-catalog.ts`
- `ui/src/ui/capability/resource-catalog/gateway-client.ts`

关键 RPC：

- `platform-resource-catalog.resolve-tiers`

它已经能做：

```text
tierIds -> modelIds
```

### 3.2 套餐页当前还是双配

当前平台页仍同时维护：

- `allowedTiers`
- `allowedModelIds`
- `modelQuota`

关键文件：

- `ui/src/ui/ports/platform/pricing/page.ts`
- `ui/src/ui/ports/platform/pricing/plan-form-helpers.ts`
- `ui/src/ui/ports/platform/pricing/plan-version-actions.ts`

### 3.3 运行时默认仍兼容 `allowedModelIds`

不要破坏这条链：

- `src/gateway/model-entitlement/entitlement-config.ts`
- `src/gateway/model-entitlement/tier-routing.ts`
- `src/gateway/model-entitlement/entitlement-projection.ts`
- `src/gateway/model-entitlement/employee-model-gate.ts`

当前系统仍依赖 `allowedModelIds` 作为兼容输出。

因此本次任务必须遵守：

```text
前台主配置改成 Tier
后端保存仍保留 allowedModelIds（由 Tier 自动派生）
```

---

## 4. 你要实现的具体效果

### 4.1 平台套餐编辑页

当前：

- 运营需要选 Tier
- 又需要勾模型
- 还可能给模型填额度

目标：

1. 运营只需要主配 `allowedTiers`
2. 模型区变成：
   - “Tier 自动解析模型池”
   - 只读预览
3. 若没选 Tier：
   - 模型区显示空态提示
   - 保存被阻止

### 4.2 保存链路

保存套餐时：

1. 前端先调用 `platform-resource-catalog.resolve-tiers`
2. 得到自动解析的 `allowedModelIds`
3. 再提交：
   - `allowedTiers`
   - 派生出来的 `allowedModelIds`
   - 其它 entitlement / policy 字段

### 4.3 modelQuota 展示

`modelQuota` 不能再放在默认主流程里。

要求：

1. 默认主编辑区域不再强调模型额度
2. `modelQuota` 下沉到高级控制
3. 只对当前自动解析出的模型池展示额度输入

可以接受的实现形式：

- 简单的 `details` 折叠区
- 二级抽屉
- 高级展开区

这次不要求做很复杂的视觉设计，但必须从主流程中降级。

---

## 5. 必改文件

### 前端主范围

- `ui/src/ui/ports/platform/pricing/page.ts`
- `ui/src/ui/ports/platform/pricing/plan-form-helpers.ts`
- `ui/src/ui/ports/platform/pricing/plan-version-actions.ts`
- `ui/src/ui/ports/platform/pricing/plan-detail-edit.browser.test.ts`
- `ui/src/ui/ports/platform/pricing/page.browser.test.ts`
- `ui/src/ui/ports/platform/pricing/plan-form-helpers.node.test.ts`
- `ui/src/i18n/locales/zh-CN.ts`
- `ui/src/i18n/locales/en.ts`

### 可读但尽量不改的兼容链路

- `src/gateway/server-methods/platform-plan-bundle.ts`
- `src/gateway/model-entitlement/tier-routing.ts`
- `src/gateway/model-entitlement/entitlement-projection.ts`
- `src/gateway/model-entitlement/employee-model-gate.ts`

说明：

- 如果前端保存逻辑已经能自动投影并提交正确 payload，后端不一定需要改
- 但如果你发现现有 bundle handler 无法接受这种保存语义，再做最小必要改动

---

## 6. 具体实施步骤

按下面顺序做，不要跳步。

### Step A - 先把套餐页改成 Tier 主配置

目标：

- 用户先配置 `allowedTiers`
- 模型池只读显示

要求：

1. 套餐页主表单不再以手工模型勾选为主
2. 模型区域标题和说明改成：
   - Tier 自动解析模型池
   - 说明这是自动投影结果
3. 选 Tier 后立即刷新模型预览

### Step B - 保存前自动解析 `allowedModelIds`

目标：

- 保持现有后端链路兼容

要求：

1. `submitCreate`
2. `submitUpdate`
3. 如有草稿版本编辑保存链，也要一并检查

统一改成：

```text
resolve-tiers -> resolved allowedModelIds -> save bundle
```

注意：

- 不要直接把 `allowedModelIds` 从后端 payload 删掉
- 只是把它从“用户手工输入”改成“系统自动派生”

### Step C - modelQuota 下沉高级控制

目标：

- 主流程只关心 Tier，不关心每个模型额度

要求：

1. 默认主编辑表单不展示大块模型额度控制
2. 若保留额度输入，必须放到“高级控制”区域
3. 高级控制只显示当前自动解析出的模型池

### Step D - 兼容老数据

目标：

- 旧套餐版本仍能正常打开与展示

要求：

1. 如果某个历史版本只有 `allowedModelIds`，没有 `allowedTiers`
   - 页面仍能显示
2. 如果有 `allowedTiers`
   - 优先按 Tier 自动解析
3. 不要把旧版本直接打坏

### Step E - 文案收口

必须把平台端语义改清楚：

1. Tier 是主配置
2. 模型池是自动解析
3. `modelQuota` 是高级控制

禁止继续让页面暗示：

```text
Tier 和模型需要双重人工维护
```

---

## 7. 测试要求

### 7.1 必须新增或更新的测试

至少覆盖这些场景：

1. 选 Tier 后，页面能展示自动解析的模型池
2. 保存时请求体包含：
   - `allowedTiers`
   - 自动解析的 `allowedModelIds`
3. 没选 Tier 时：
   - 模型池为空
   - 保存被阻止
4. 历史版本只有 `allowedModelIds` 时仍能显示
5. `modelQuota` 只对自动解析出的模型池可编辑

### 7.2 推荐跑的测试

```sh
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  ui/src/ui/ports/platform/pricing/plan-detail-edit.browser.test.ts \
  ui/src/ui/ports/platform/pricing/page.browser.test.ts \
  ui/src/ui/ports/platform/pricing/plan-form-helpers.node.test.ts \
  ui/src/ui/ports/platform/pricing/plan-version-actions.node.test.ts
```

如果你改了后端保存辅助逻辑，再补：

```sh
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/server-methods/platform-plan-bundle.test.ts
```

---

## 8. Stop Conditions

出现以下情况请暂停，不要硬做：

1. 你发现员工端/企业端运行时强依赖手工 `allowedModelIds`，而自动投影会直接打断主链
2. 你发现必须同时重写 `Credits` 结构才能完成本任务
3. 你必须引入新的预算概念（如 `ModelBudget`）才能让页面工作 → **Phase 4 已交付**；仅当需改写 Credits 主链时才暂停
4. 你需要大改资源目录后端协议
5. 你发现当前 shared tree 中这些热文件已有他人 WIP 且无法局部编辑

---

## 9. 交付格式

完成后请把结果交回 `codex` 验收，并同时给出：

1. 改了哪些文件
2. 套餐页现在如何表现：
   - Tier 主配置
   - 模型池自动投影
   - modelQuota 高级控制
3. 保存时请求体现在是什么样
4. 哪些旧数据兼容逻辑被保留
5. 跑过哪些测试
6. 哪些风险明确留给下一阶段

---

## 10. 最终验收标准

`codex` 会按下面标准验收：

1. **语义是否清晰**
   - Tier 是主配置
   - 模型池是自动投影
   - modelQuota 是高级控制
2. **前台是否不再双配**
   - 用户不再需要手工维护 Tier + 模型两份真相
3. **保存链路是否兼容**
   - 后端仍拿到 `allowedModelIds`
   - 但它来自 Tier 自动解析
4. **旧版本是否不被打坏**
   - 历史仅有 `allowedModelIds` 的版本仍能显示
5. **范围是否守住**
   - 没有越界去做 Credits v2、runtime 主链重构
   - Phase 4 `ModelBudget` 已交付且与 Credits 总预算口径分离（只读核算，不入 `record-credit-usage` 主链）
   - 未改 commerce / order / subscription lifecycle

如果以上任一条不成立，本次任务不通过。
