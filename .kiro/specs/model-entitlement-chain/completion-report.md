# model-entitlement-chain 完成报告（P1–P4）

> 关联：`design.md`、`tasks.md`、`seat-asset-unification-assessment.md`。
> 范围：平台→套餐→企业→员工 大模型授权链 + 收敛冗余（目标 A/B）。
> 状态：**全部 16 项任务通过验收**（含 P1 整改 7.1–7.5、P2 UI 接入 11.1/12.1/12.2）。

## 1. 通过状态总览

| 阶段                   | 任务                  | 状态 | 验证                                                                                                                                           |
| ---------------------- | --------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 运行时 hard-deny    | 1–7 + 7.1–7.5         | ✅   | EffectiveModelSet 内核 / 独立授权 store / hard-deny 过滤 / employee chat gate / 灰度开关 + doctor 观测 / 端到端验收                            |
| P2 套餐绑定 + 操作面   | 8–12 + 11.1/12.1/12.2 | ✅   | PlanVersionModelBinding 旁路表 / 订阅投影（事件触发 + 改绑定即刷新存量）/ 平台·企业 RPC（治理三层防御）/ 企业授权面板 + 员工只读视图接入主表面 |
| P3 aor_enhanced 选路   | 13 / 13.1 / 14        | ✅   | EffectiveModelSet 内保集合重排 / 双模式候选一致性 / bandit 回写 + **路由解释写入链路收口**                                                     |
| P4 凭证收敛 + 资产评估 | 15 / 15.1 / 16        | ✅   | catalog 模式单源可追溯（含 SecretRef）/ Property 6 属性测试 / 不收编 seat asset 决策文档                                                       |

### 回归门（本轮收口复跑）

- `pnpm build`：通过，无 `error TS` / `INEFFECTIVE_DYNAMIC_IMPORT` / 循环依赖告警。
- `pnpm exec vitest run src/gateway/model-entitlement src/agents/model-auth src/auto-reply/reply/agent-runner-execution`：**116 测试全绿（17 文件）**。
- `pnpm tsgo`：本 spec 触碰的文件**零类型错误**（其余报错均属并行 spec：`agent-tenant`、`billing/*`、`ui/*`，与本改造无关）。

## 2. 关键不变量（已落地 + 测试）

- **hard deny（Property 7）**：运行时实际候选 ⊆ EffectiveModelSet；primary/fallback/AOR 选出/explicit 候选全部受限，不得越过（`applyEntitlementHardDeny` 在候选解析后统一应用）。
- **两态区分（Property 3）**：`missing`（未配置/未迁移）按灰度开关放行；`resolved` 空集 = hard deny 零出网（`MODEL_ENTITLEMENT_EMPTY`）。
- **包含链单调（Property 2）**：员工有效集 ⊆ 企业 entitlement ⊆ planVersion 绑定 ⊆ 平台目录。
- **双模式一致（Property 4）**：native 与 aor_enhanced 候选**集合恒等**，仅排序不同（保集合重排）。
- **凭证单源可追溯（Property 6，P4 catalog 模式）**：同一 provider 解析唯一且可追溯到 `credentialRef`。

## 3. 回退开关（出问题时的紧急止血）

| 开关                                                                     | 默认            | 作用                                                                                                                  |
| ------------------------------------------------------------------------ | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `gateway.platform.models.entitlement.enforce`                            | `missing-allow` | `off` = 完全不强制（回到现状）；`missing-allow` = 未配置放行、已解析空集 hard deny；`strict` = 未配置也拒绝           |
| `gateway.platform.models.mode`                                           | `native`        | `native` = 跳过 AOR selector（直接用 `EffectiveModelSet ∩ agents.defaults.model`）；`aor_enhanced` = AOR 在集合内选路 |
| `gateway.platform.models.credentials.mode`                               | `legacy`        | `legacy` = 现状多源 key 链（行为零变化）；`catalog` = 平台目录凭证单一权威、优先于 ambient env，可随时切回            |
| `gateway.platform.models.aor.enableBandit` / `enableRoutingExplanations` | —               | 关闭即停止 bandit 回写 / 路由解释写入，不影响选路与主链                                                               |

**最稳回退组合**：`mode=native` + `entitlement.enforce=off` + `credentials.mode=legacy` = 完全回到改造前路径。

## 4. 剩余技术债 / 后续增强

1. **AOR 反馈强度**：当前以「运行完成」为成功信号（score=1），完整 evaluator / LLM-judge 评分为后续增强（`recordAorRunFeedback` 已预留 `score`/`costUsd`）。
2. **平台模型目录真源**：P1–P4 以 `cfg.models.providers.*` 为平台目录事实载体；独立 `PlatformModelCatalogStore`（带 `credentialRef` 槽）为后续演进项。
3. **credentials catalog 灰度推广**：默认仍 `legacy`；启用 `catalog` 前建议依据 doctor `credential_convergence` 观测先消除多源 key 冲突（doctor 已给出 info/warning 提示）。
4. **seat asset 统一建模**：本轮维持独立并行层（见评估文档）；仅当模型许可出现「可交接资产」语义且权威来源统一时重估。
5. **员工区块首帧重试**：`employee-model-access-section` 采用有限次重试（20×500ms）等待 client 注入；后续可改为连接事件驱动以更精确。
6. **method-scopes 全量分类**：本 spec 方法已分类并 pin 到 session-domain；仓库仍有其他并行 spec 的未分类方法（`method-scopes.test.ts` 既有失败），不属本 spec 范围。

## 5. 主要交付物（文件）

- 内核/存储：`src/gateway/model-entitlement/{types,effective-set,enterprise-model-entitlement-store,seat-model-grant-store,model-grant-audit,resolve-effective-model-set,plan-version-model-binding-store,entitlement-projection,entitlement-config}.ts`
- 运行时 gate / 过滤 / 选路：`employee-model-gate.ts`、`aor-selection.ts`、`aor-feedback.ts`、`src/agents/model-fallback.ts`（`applyEntitlementHardDeny` / `applyPreferredModelOrder`）、`src/auto-reply/reply/agent-runner-execution.ts`
- 凭证收敛（P4）：`src/agents/model-credential-source.ts` + `src/agents/model-auth.ts`（catalog hook）
- RPC：`src/gateway/server-methods/model-entitlement-management.ts`、`employee-model-access.ts`（+ 注册、session-domain/method-scopes 治理）
- 配置：`src/config/types.gateway.ts`、`zod-schema.ts`、`schema.help.ts`、`schema.labels.ts`
- doctor 观测：`src/gateway/model-entitlement/doctor-checks.ts`（key 冲突 / entitlement 缺失 / 凭证收敛就绪度）
- UI：`ui/src/ui/capability/model-authorization/*`、`ui/src/ui/views/{model-authorization-panel,employee-model-access,employee-model-access-section}.ts`
- 文档：`design.md`、`seat-asset-unification-assessment.md`、本报告
