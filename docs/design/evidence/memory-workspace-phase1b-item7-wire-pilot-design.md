# Phase 1B Item 7：接线 pilot 设计契约 + S26/S27 诚实退休再评估（design-only）

本文件是**设计/只读评估**，不含任何实现。目标：定义 `runEmployeeStewardCutoverPilot` 如何接入已验收的 `provisionEmployeeStewardCutoverWorkspace`（PR #679，独立审查 accepted），并**诚实地**再评估 S26/S27 现在能否退休。

- 任务：`kiro-data-governance-phase1b-item7-wire-pilot-design`，owner=`kiro-data-governance`，issue #692。
- 基线：`origin/main` `49f59c3375`。
- 本任务**不做**：改任何代码、接线 pilot、退休 S26/S27、改 retirement scan、写生产 Catalog、启用 schema v2、解锁 Phase 1B、部署/切 LIVE、执行 I3、申请 Item 7 met。

## 一、现状（已核实的代码事实）

- **pilot 创建流程** `src/gateway/workspace-resolver/steward-write.ts:262 runEmployeeStewardCutoverPilot`：
  1. `sourceRoot = resolveEmployeeStewardSourceWorkspaceDir(userId, stateDir)`（**S26 @279**，主机路径推导）
  2. `targetRoot = resolveEmployeeStewardTargetWorkspaceDir({tenantId,userId,stateDir})`（**S27 @280**，主机路径推导）
  3. `fs.mkdirSync(sourceRoot)`（第 285 行，内联 `void import("./item7-w4-shadow.js")` 触发 S26/S27 只读影子）
  4. `buildEmployeeStewardCutoverCatalog({tenantId,userId,sourceRoot,targetRoot})` —— 由主机路径**就地合成内存 catalog**
  5. `createWorkspaceCutoverOperation(...)` + 步进 `prepared → write_frozen → copied_or_adopted(verifiedCopy) → verified → dual_read_verified → resolver_write_cutover`
- **读路径** `steward-write.ts:141 resolveEmployeeStewardWritableWorkspaceDir`（**S24/S25 已退休**）：`sourceRoot` 经 `resolveWorkspaceLocator`（canonical/active）、`targetRoot` 经 `resolveWorkspaceTargetBinding`（compatibility/read_only）**从传入的 `params.catalog` 读**；catalog 无绑定则 sourceRoot/targetRoot 为空、走空 catalog（resourceId=""）。即：读路径**要求 catalog 里已存在绑定**。
- **provision 命令** `provision-steward-cutover.ts`（#679）：从**可信传入的 placement**（`sourceRoot`/`targetRoot`）建 source canonical/active + target compatibility/read_only 绑定，用**内存 Catalog + 默认内存 cutover store**，发 receipt + fencing operation，`materialize=true` 时才 mkdir/copy；**不写生产 Catalog、不调用 S26/S27 主机路径 resolver**。

## 二、核心难点：placement 的来源（决定 S26/S27 能否退休）

`provisionEmployeeStewardCutoverWorkspace` 把 **placement（source/target 根）当作可信输入**，它**不产生** placement。因此：

> 仅把 pilot 接到 provision，并**不能**退休 S26/S27——pilot 仍需要从**某处**得到 source/target 根传给 provision。若那"某处"仍是 `resolveEmployeeStewardSourceWorkspaceDir`/`resolveEmployeeStewardTargetWorkspaceDir`，则 S26/S27 只是被搬进 provision 的调用方，并未退休。

诚实退休 S26（source）要求：pilot（及稳态）从**持久 Catalog 绑定**读到 source 根（经 `resolveWorkspaceLocator`），而不是主机路径推导。S27（target）同理（经 `resolveWorkspaceTargetBinding`）。这要求先解决 placement 的**权威来源（SoT）**与**首次建绑（bootstrap）**问题。

## 三、目标接线契约（未来实现时遵循，本轮不实现）

1. **首次建绑（bootstrap）**：由 provision 在**持久 Catalog SoT** 建立 source canonical/active + target compatibility/read_only 绑定（受权限门禁、幂等、fail-closed；见 §四）。首次 placement 策略是 provision/SoT 的职责，不由 pilot 的主机路径 resolver 决定。
2. **pilot 接线**：`runEmployeeStewardCutoverPilot` 改为
   - 调 `provisionEmployeeStewardCutoverWorkspace({tenantContext, actor, ownershipProof, sourceRoot, targetRoot, cutoverStore, materialize})` 建绑 + receipt + fencing operation；
   - 之后 source 经 `resolveWorkspaceLocator`（canonical/active）、target 经 `resolveWorkspaceTargetBinding`（compatibility/read_only）**从 provision 建立的 Catalog 读**；
   - 复用 provision 的 `operation`（fencing）而非另建，保持单一 fencing。
3. **解析顺序 + fail-closed**：catalog miss / tenant 不符 / grant 失败 / 重复 canonical / target 非唯一 → 一律 fail-closed；**禁止**主机路径回退、`process.cwd()`、旧 source root 回退。
4. **身份/授权直传**：pilot 向 provision 传**服务端可信** `tenantContext`/`actor`/`ownershipProof`/`placement`；provision 已按 `validateWorkspaceLocatorQuery` 同等姿态校验（#679 审查已确认）。
5. **DataRole / BindingRole**：pre-cutover source=canonical/active、target=compatibility/read_only；cutover 后交换（`buildEmployeeStewardCutoverCatalog(..., cutoverState:"post")` 的既有语义）。

## 四、前置依赖：持久 Catalog SoT（本轮最大缺口）

provision 默认**内存 Catalog + 内存 cutover store**，进程结束即失。要让 pilot/稳态**读到先于本次运行就存在的绑定**（S26/S27 诚实退休的前提），必须先有**持久 Catalog SoT**：

- 明确持久 Catalog 的存储与写入面（谁、何时、如何写；provision 写入需**显式授权、默认关闭**，当前 `productionCatalogWrite=none` 必须保持直到单独授权）。
- 幂等建绑 + 重复 canonical 处理（写时强制唯一，读侧 `multi_binding`/`catalog_ambiguous` 已 fail-closed）。
- rollback / quarantine / cutover receipt（provision 已具 receipt + fencing；持久化需补回滚与隔离语义）。
- 这是一个**独立设计+实现+审查**的子任务，**不在本设计的实现范围**，也**不得**在本轮触发任何生产写。

## 五、S26/S27 诚实退休再评估（结论）

**结论：现在不能诚实退休 S26/S27。**

理由：

1. **pilot 未接线** provision（仍在 `steward-write.ts:279/280` 主机路径推导）。
2. **无持久 Catalog SoT**：provision 为内存，稳态不存在可读的持久绑定；测试 seed 不能作为生产前置证明（沿用 S26 Semantic Gate CR #677 的判定）。
3. **placement 权威来源未定**：退休 S26/S27 要求 placement 来自 Catalog，而非主机 resolver；该来源尚未设计落地。

因此保持：`remaining=12`、`liveWriteWatchIndex=12`、`sites.length=12`、S26/S27 = not-retired、`item7=not-met`、`phase1bExecutionBlocked=true`、`productionCatalogWrite=none`、LIVE=forbidden。

## 六、分阶段门禁（每阶段独立授权 + 独立验收；本轮仅 G1）

- **G1（本任务）**：本设计契约 + 再评估 + 只读验证。**不实现**。
- **G2**：持久 Catalog SoT 设计+实现+独立审查（含授权的写入面，默认关闭）。
- **G3**：pilot 接线实现（behind flag / 非生产），source/target 经 Locator 读、复用 provision fencing；**不**退休。
- **G4**：G3 的独立实现审查（accepted 方可继续）。
- **G5**：退休 **S26**（pilot 从 Catalog 读 source 后，移除 `steward-write.ts:279` 主机路径调用）；真实 `buildInventory` 扫描 `remaining 12→11`；独立退休验收。
- **G6**：退休 **S27**（同理，target）；`remaining 11→10`；独立验收。
- Item 7 met / Phase 1B unlock / 生产 Catalog / LIVE 均在所有阶段 + 显式授权后才评估，**非本设计授予**。

## 七、非目标与边界（本轮）

不接线 pilot、不改 `steward-write.ts`/`provision-steward-cutover.ts`/任何代码、不退休、不改 scan、不写生产 Catalog、不启用 schema v2、不解锁 Phase 1B、不执行 I3、不部署/切 LIVE、不申请 Item 7 met。仅新增本设计 `.md` + 只读验证 `.test.mjs` + handoff。

## 八、观察（供 G2/G3 参考，非本轮动作）

- pilot 第 285 行与读路径第 154 行均有既有的 fire-and-forget `void import("./item7-w4-shadow.js").then(...)`（S24/S25 与 S26/S27 只读影子），无 catch；G3 接线时宜一并收敛为受控调用（避免未处理 rejection）。
- provision 经共享 builder 触发的 `item7-w3-shadow`（S21）同为只读影子（#679 审查已确认 `productionCatalogWrite:false`）。

— kiro-data-governance
