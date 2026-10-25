# SAR A4：物化身份与持续授权

- 日期：2026-10-18（Asia/Shanghai）
- Docs refresh：2026-10-25（Asia/Shanghai）— 仅刷新设计报告基线，供 opencli 阶段验收；不改实现
- 仓库：https://github.com/flykingvip-cloud/openbot-vp
- 分支：`feat/sar-a4-projection-identity-auth`
- 基线：`origin/main` tip `7c111408fd7dea24c6384b65db3e76658879647c`（A4 实现已随 recovery snapshot 落在新仓 main；本 PR 仅 docs refresh）
- 专家闸门：`expert-e0-e5-acceptance-2026-10-18.md` §身份边界 / A4
- 路径：Path C；复用 `SeatActionGrant` + `AccountBinding`；不扩新架构/目录
- 正式执行接入：**仍暂缓**

## 结论（诚实）

**已打通**：网站投影物化在 `resolveProjectionExecutionIdentity()` 核验「桥 owner ≠ 持续执行委托」；无有效物化席位授权、账户授权缺失/撤销时 fail-closed；管理员仅创建投影不能获得私人账户访问；执行账户权限与知识下游可见范围分别校验。

**未宣称 / 仍缺**：

| 项 | 状态 |
|----|------|
| 企业外站真实会话实测 | ❌ |
| E0–E5 整体可用 | ❌ |
| §R5 真实会话 PASS | ❌ |
| A5 双中心真实浏览器闭环 | ❌ 未做 |
| 正式执行接入放开 | ❌ 仍暂缓 |
| 新「委托」管理 UI / RPC | ❌ 本阶段复用既有 `SeatActionGrant` 与 `AccountBinding` 模型，未新增独立委托对象 |

## 打通路径（一句话）

`runProjectionMaterialization` / scheduled → `resolveProjectionExecutionIdentity` → 桥 owner + **活跃** `SeatActionGrant(MATERIALIZER_SEAT)` + **现存匹配** `AccountBinding` → 才注入 `userId`/`employeeId`；否则 `PROJECTION_EXECUTION_DELEGATION_MISSING` / `PROJECTION_ACCOUNT_AUTH_REVOKED` / `PROJECTION_EXECUTION_IDENTITY_MISSING`；下游可见仍走 `KnowledgeVisibilityPolicy`（与执行权正交）。

## 专家四测对照

| # | 复验项 | A4 后 |
|---|--------|--------|
| 1 | 桥中有 owner、无有效执行委托 → 拒绝 | **PASS**：缺物化席位 `SeatActionGrant` → `PROJECTION_EXECUTION_DELEGATION_MISSING`；provider 不调用 |
| 2 | 委托或账户授权撤销后，定时物化不再读取 | **PASS**：`revokeSeatActionGrant` 或删除 `accountBindings` 后 scheduled `failed≥1` 且不再进 provider |
| 3 | 管理员不能仅通过创建投影获得私人账户访问权 | **PASS**：创建投影不发明委托；身份恒为桥 owner，非 admin |
| 4 | 执行账户权限 ⊥ 下游可见范围 | **PASS**：有执行权可物化；无可见策略则 restricted；加可见策略可见仍无下游执行 grant |

## 实现要点

1. `src/gateway/enterprise-data/knowledge-publication.ts` — `resolveProjectionExecutionIdentity`
   - 网站路径：桥 owner 必需；`AccountBinding` 须匹配 tenant/user/binding；`MATERIALIZER_SEAT_ID` 须有未撤销 `SeatActionGrant`
   - 非网站路径：仍仅返回 `{ sourceId }`（本阶段不扩凭证连续授权模型）
2. 测例：`sar-a4-projection-identity-auth.test.ts`（专家四测 + 物化路径拒读）
3. `knowledge-publication.test.ts` — 网站夹具登记 `registerCallerAccountBinding`，与持续授权核验一致

## 风险

- 生产若仅有桥、无物化席位 grant 或无 `AccountBinding`，网站物化将 fail-closed（正确；≠ 外站已打通）。
- ControllableTestSite / 夹具 provider ≠ 企业外站真实账户浏览器会话。
- 执行委托语义落在既有 `SeatActionGrant`（席位×动作），未引入「按 sourceId 的独立委托」表；若产品后续要 owner 显式签发 source 级委托，需另阶段扩展（本阶段不扩架构）。
