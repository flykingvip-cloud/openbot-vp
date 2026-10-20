# 交接指令：P1 — L1 控制面按租户解析（tenant-context-propagation）

> **发起 agent**：`kiro`（spec `tenant-context-propagation`，P0 已合入）
> **P1 owner = `kiro`**（已指派）；**收件/协调**：关联面 owner（见 §5，L1 调用点所在文件 loom 无归属，须与各领域 owner 协调）
> **日期**：2026-07-11
> **前置阅读**：`.kiro/specs/tenant-context-propagation/{requirements,design,tasks}.md`（已按专家评审修订）

---

## 0. 你要建立在的基础（P0 已合入，勿改契约）

- `src/gateway/tenant-context.ts`：`async resolveTenantContext(client)` / `requireTenantContext(client)` → `TenantContext{tenantId,userId,domain}`。**membership-only 权威**（email→user→membership→enterpriseId），`sessionTenantId` 仅交叉校验，缺 membership **fail-closed**（评审 高危2 已修）。
- `src/gateway/tenant-store-paths.ts`：`resolveControlPlaneStorePathForContext(ctx, FILE)`、`resolveDataRootForContext(ctx,cfg)`（**回退仅按数据模式；managed+无 ctx 抛错**，评审 高危1 已修）、`assertWithinTenantRoot(ctx,resolved)`（R6）。常量 `TENANT_SEAT_ASSETS_FILE` / `TENANT_ENTERPRISE_DATA_FILE` / `TENANT_PLATFORM_AUTH_FILE`。
- **契约（不可回退）**：local(`!managed`) 逐字节零变化；managed 缺 ctx **抛错不回退全局**；hint 不做权威。

## 1. P1 目标与**真实范围**（比 spec 摘要大）

目标：managed 模式下每租户只读写自己的 L1 控制面切片（`tenants/<tid>/control-plane/`）。

**真实 blast radius**（已在代码核对，非 spec 说的少量站点）：默认落全局的 loader 调用点约 **30+**：

- `loadEnterpriseSeatAssetsStore()` 默认调用 **~20 处**：`enterprise-operational-identity-runtime.ts`(×6)、`enterprise-operational-identity.ts`(×6)、`enterprise-seat-assets.ts`(×5+)、`enterprise-data/enterprise-data-seat-context.ts`(×2)、`employee-workbench-scope.ts` 等。
- `loadEnterpriseDataStore()` 默认调用 **~12 处**：`enterprise-data/*`（agent-data-planner / connector-oauth / capability-agent-invoke-runtime×2）、`knowledge/*`（source-bundle / router / capability-invoke-runtime / server-methods/knowledge）、`server-methods/enterprise-data.ts`、`enterprise-data-planner.ts`、`billing/resolve-pending-governance-approvals.ts`、`enterprise-operational-identity.ts`。

**关键难点（threading）**：这些调用点很多是**深层 runtime 函数，不在 request handler 直接层**（无 `client`/`ctx`）。把 `ctx` 送到它们那里本身是主要工作量——不是「改个参数」。

## 2. 两个设计问题（**已裁决**，已写入 spec）

- **Q-A：`platform-auth` = 全局（已定）。** 保持**全局 authority store**，不进 per-tenant L1——它是 login→tenant 的 membership 权威（P0 `resolveMembershipAuthority` 全局读它；per-tenant 会 chicken-and-egg）。`platform-auth-slice.json` 仅迁移物。spec R3.4 已更新：**per-tenant L1 = `seat-assets` + `enterprise-data`**；`organization` 派生自全局 platform-auth + per-tenant seat-assets。
- **Q-B：显式透传（已定，非 AsyncLocalStorage）。** 请求边界解析一次 `ctx`，向下传 `ctx` 或预计算 `storePath`/locator seam；隔离边界要可静态审计 / grep / leakage test。ALS 后续再作易用性封装。spec 已记为 **D8**。

## 3. 转换模式（DI 已就绪，逐点改）

`seat-assets` 与 `enterprise-data` 的 loader **已接受可选 `storePath`**（`loadEnterpriseSeatAssetsStore(storePath?)`、`loadEnterpriseDataStore(storePath?)`），无需改 store 实现（R3.2 对它们已满足）。逐调用点：

```ts
// before（默认全局）
const seatStore = await loadEnterpriseSeatAssetsStore();
// after（managed 按租户；ctx 由 Q-B 机制取得）
const seatStore = await loadEnterpriseSeatAssetsStore(
  resolveControlPlaneStorePathForContext(ctx, TENANT_SEAT_ASSETS_FILE),
);
```

`enterprise-data` 同理用 `TENANT_ENTERPRISE_DATA_FILE`。**local 模式**：`ctx` 为 null（P0 契约），此时**必须**退回默认全局 loader（不传 storePath）——保持零变化。建议封一个小 helper：`managed && ctx ? perTenantPath : undefined`，避免每处重复判断。

## 4. `organization` 不是独立 store

`enterprise.organization.snapshot`（`server-methods/enterprise-organization.ts`）**派生自** `loadPlatformAuthStore` + `loadEnterpriseSeatAssetsStore`。故 organization 的租户隔离**由 §3 的 seat-assets + Q-A 的 platform-auth 决定决定**，无独立 DI 目标。勿再为它单独建 per-tenant store。

## 5. 归属与协调（文件当前 loom 无归属）

上述文件在 `.loom/registry.yaml` **均无 task 归属**。因此：

- **操作者**：为 P1 指派 owner（或由 kiro 在 spec 下接管）+ 开隔离 worktree。
- 调用点**聚集在其他 spec 的领域**，须协调这些 owner（他们最懂各自 handler 的 ctx 来源）：
  - `enterprise-operational-identity*`（~12 处）→ `operational-identity-governance:codex-oig`。
  - `enterprise-data/*` + `knowledge/*`（~10 处）→ enterprise-data / knowledge 各自 owner。
  - `billing/*`、`employee-workbench-scope.ts` → 对应 owner。
- 因跨多领域，**建议 P1 子分期**：**P1a = seat-assets**（先做，覆盖 seat 相关面）；**P1b = enterprise-data**（含 knowledge 读取面）。各自独立 leakage 测试门禁。

## 6. 约束（硬门禁）

1. **local 零变化**：`!managed` 或无 ctx → 走原默认 loader，行为逐字节不变。
2. **managed fail-closed**：managed 下需要租户数据却拿不到 ctx → 抛错（复用 `requireTenantContext` / `resolveDataRootForContext` 的 fail-closed），**绝不**默认落全局。
3. **单一寻址出口**：路径一律经 `resolveControlPlaneStorePathForContext`；不新增直拼 `CONFIG_DIR`/默认 loader 的 handler（P4 会加 CI 守卫拦这个，评审 中5）。
4. **leakage 门禁（R3.3 / R7.1）**：本阶段合入必须带「双租户会话，A 读不到 B 的 seat/enterprise-data」测试，绿了才能 land。
5. 不在共享脏树上做：worktree 隔离，按 P1a→P1b land。

## 7. 验证

```bash
OPENBOT_TEST_PROFILE=low pnpm test --run src/gateway/tenant-store-paths.test.ts <各面 L1 测试>
pnpm tsgo   # 确认无新错
# leakage：双租户 provision → 各自写 L1 → A 会话读，断言看不到 B
```

## 8. 给操作者的一句话

P1 不是「~15 个改点」的小活，而是 **~30+ 深层调用点跨 4 个领域 + 2 个待裁决设计问题（platform-auth 全局性、ctx 线程机制）**。请先裁决 §2，再指派 owner + 开 worktree，按 §5 子分期推进。我（kiro）持有基础层（tenant-context / tenant-store-paths），可配合各面 owner 对接口与 leakage 测试。

有疑问或裁决了 §2，回我，我据此更新 spec（R3.4 platform-auth 归类 + 新增 D8 ctx 线程决策）。
