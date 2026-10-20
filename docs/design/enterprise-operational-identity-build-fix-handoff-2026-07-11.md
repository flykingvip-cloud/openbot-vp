# 任务指令：修复 `enterprise-operational-identity` 未完成功能导致的构建红 — 交给 `codex-oig`

> **收件人（主责）**：`codex-oig`（spec `operational-identity-governance` owner；`paths:` 含 `src/gateway/enterprise-operational-identity**` + 运营身份 UI）  
> **协作方**：`kiro-enterprise-tsgo`（owns enterprise UI 端口状态，见 Group E）；knowledge-universe agent（1 处，见 Group H）  
> **发起**：SaaS tenant-import 线（tenant-import 模块 tsgo 0 错、单测全绿，不涉本问题）  
> **日期**：2026-07-11  
> **目标**：`pnpm build` 归零、`pnpm tsgo` 归零

---

## 0. 背景与边界

- `pnpm build` 当前红。经排查，**全部报错都在你（codex-oig）进行中的 `enterprise-operational-identity` 功能**（gateway store/identity/providers + 企业 UI）——是**功能未完成**（缺模块、缺状态字段/方法、类型联合未收敛），不是已完成代码的 bug。
- 这些文件是你的**未提交 WIP**（`M`/`??`）；我（tenant-import 线）**不代造你的设计**，仅修了 2 处纯语法错误（见 §1），其余按根因整理如下，请你收尾。

## 1. 已替你修好的 2 处（勿重复，纯语法收敛）

| 文件                                                                       | 修复                                                                                                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/gateway/platform-auth-email.ts`                                       | 删除重复的 `export type PlatformAuthSmtpConfig = SmtpConfig;`（53/55 行完全重复）                                                                            |
| `ui/src/ui/ports/enterprise/views/enterprise-surfaces.browser.test.ts:333` | 未加引号的对象键 `wechat-official: 1` → `"wechat-official": 1`（兄弟键 `"enterprise-email"` 本就带引号）——此前它级联出 36 个 `TS1005/1128/1109` 语法错，已消 |

> 修完这两处后，剩余 **~37 个语义错**（下方 Group A–H）才显现出来，全部需要你的设计判断。

## 2. 按根因分组的待修项（含精确 file:line）

### Group A — provider 联合类型未收敛（~10 处，**根因项，优先**）

报错：`Type 'EnterpriseOperationalIdentityProvider | LegacyOperationalIdentityProvider' is not assignable to type 'EnterpriseOperationalIdentityProvider'`

- `src/gateway/enterprise-operational-identity.ts:528, 777, 787, 795, 829`
- `src/gateway/enterprise-operational-identity-access.ts:226, 272, 383`
- `src/gateway/enterprise-operational-identity-providers/identity-api-envelope.ts:41`
- `src/gateway/enterprise-operational-identity-store.ts:399, 494`

**根因**：新引入的 `LegacyOperationalIdentityProvider` 进入了联合，但赋值目标/调用参数仍要求收窄后的 `EnterpriseOperationalIdentityProvider`。  
**你需决策并实现**：在联合边界加**归一/窄化 helper**（legacy → enterprise 规范化），或放宽下游类型接受联合。请全局统一一种策略（避免逐处 `as`）。

### Group B — 审计元数据值类型（3 处）

报错：不可赋值给 `EnterpriseAuditMetadataValue`

- `src/gateway/enterprise-operational-identity-store.ts:468`（`{ key: string; satisfied: boolean }[]`）
- `src/gateway/enterprise-operational-identity-store.ts:472, 473`（`string[] | undefined`）

**你需决策**：扩展 `EnterpriseAuditMetadataValue` 联合以接受「数组 / 结构化对象数组」，或把这些值在写审计前序列化为已支持的形状。

### Group C — credential-readiness `never` 收窄 bug（2 处）

- `src/gateway/enterprise-operational-identity-providers/credential-readiness.ts:131`（`Property 'ok' does not exist on type 'never'`）
- `src/gateway/enterprise-operational-identity-providers/credential-readiness.ts:132`（`Property 'detail' ...`）

**根因**：判别联合被过度收窄为 `never`（多半是分支/结果类型定义缺一支）。修正结果类型或分支收窄。

### Group D — wechat-official（4 处）

- `src/gateway/enterprise-operational-identity-wechat-official-api.ts:129`：`Buffer` 不可赋值给 `BlobPart` → 用 `new Blob([new Uint8Array(buf)])` 或 `Uint8Array` 包装。
- `src/gateway/enterprise-operational-identity-wechat-official-execution.test.ts:67, 80, 94`：测试 fixture 缺 `EnterpriseOperationalIdentityCredentialSecret` 必填字段 `credentialBindingId, tenantId, connectorId, kind, createdAt` → 补全 fixture。

### Group E — 企业 UI 端口状态缺字段/方法（~13 处，**需与 `kiro-enterprise-tsgo` 协作**）

`render-model.ts` / `port-state.ts` 引用了 `EnterprisePortState` / `EnterpriseLensSource` 上**尚未声明**的成员：

- 缺状态键：`ui/src/ui/ports/enterprise/port-state.ts:155, 156`（`enterpriseOperationalIdentityDetailId`、`enterpriseOperationalIdentityDetailTab`）；连带 `259, 266`（KeyList/派生类型不满足）。
- 缺方法：`ui/src/ui/ports/enterprise/render-model.ts:773`（`saveEnterpriseIdentityCredentialConfig`）、`788`（`openEnterpriseIdentityRevokeConfirm`）、`791`（`closeEnterpriseIdentityRevokeConfirm`）、`797`（`revokeEnterpriseOperationalIdentity`）、`803`（`verifyEnterpriseOperationalIdentity`）。
- `render-model.ts:765, 766`：`unknown` 未收窄到 `string` / `"audit"|"policy"|"security"|"usage"`。

**协作点**：`EnterprisePortState` / `EnterpriseLensSource`（`port-state.ts`、`view-types.ts`、`semantic/enterprise-read-model.ts`）由 **`kiro-enterprise-tsgo`（ops-decommission）** 拥有。请你把「需要新增的状态字段 + action 方法签名」列给 kiro-enterprise-tsgo 一起加，或经其同意后由你加——**勿各改各的导致端口状态分叉**。

### Group F — 缺失控制器模块（2 处）

报错：`Cannot find module '../../controllers/enterprise-operational-identity.ts'`

- `ui/src/ui/ports/enterprise/semantic/enterprise-read-model.ts:280`
- `ui/src/ui/ports/enterprise/views/enterprise-identity-provider-config-fields.ts:2`

**你需创建** `ui/src/ui/controllers/enterprise-operational-identity.ts`（该文件当前不存在），或修正引用路径（若已改名）。

### Group G — 缺导入 / 隐式 any（~5 处）

- `ui/src/ui/ports/enterprise/views/enterprise-access-control-surface.ts:1589`：`Cannot find name 'renderEnterpriseIdentityAssetsSection'` → 从新文件 `views/enterprise-identity-assets-section.ts`（已存在，untracked）**加 import**。
- `ui/src/ui/ports/enterprise/views/enterprise-identity-provider-config-fields.ts:31, 59, 108, 171`：参数 `entry`/`field`/`check` 隐式 any → 补参数类型。

### Group H — 与运营身份无关的 1 处（转交 knowledge-universe agent）

- `ui/src/ui/views/knowledge-universe-governance-claim-conflict.ts:196`：`Type 'true' is not assignable to type 'false'` → 属 knowledge-universe 功能，请单独转交该 owner。

## 3. 验收门禁（Definition of Done）

1. `pnpm tsgo` → **0 错误**。
2. `pnpm build` → **`✓ built`，0 hard-error**。
3. 相关单测：`OPENBOT_TEST_PROFILE=low pnpm test --run src/gateway/enterprise-operational-identity* ui/src/ui/ports/enterprise/**` 全绿（尤其 Group D 的 wechat-official 执行测试、Group E 的 enterprise-surfaces browser 测试）。
4. 提交按多 agent 规范：`scripts/committer` 限定到你的 `paths:`；commit trailer `Task: operational-identity-governance` / `Agent: codex-oig`；落地前 `bun scripts/agent-attribution.ts`。
5. Group E 若改到 `kiro-enterprise-tsgo` 的端口文件，须先协调（见该组）。

## 4. 备注

- tenant-import / `platform.tenant.*` / `tenant-store-paths` / `register.platform`（SaaS 租户导入线）**tsgo 0 错、单测全绿**，与本问题无关，勿动。
- 本文件仅为诊断与任务分派，不含对你功能设计的改写——具体类型/状态/控制器实现由你按 `operational-identity-governance` 的 design/requirements 决定。
