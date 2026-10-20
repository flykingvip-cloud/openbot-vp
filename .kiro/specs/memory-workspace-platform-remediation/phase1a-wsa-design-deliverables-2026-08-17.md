# Phase 1A WS-A 设计交付物

日期：2026-08-17  
Owner：`codex-workspace-architecture`  
基线：`origin/main`（执行前必须重新 fetch 并通过 ancestry gate）

## 1. 交付范围

本文件是 WS-A 的设计/契约落地，不是生产写路径切换。它冻结三项边界：

1. Data Governance Catalog / StorageBinding store 与 Workspace 只读投影 adapter；
2. `DataGovernanceEnvelope` 的 Workspace typed view；
3. 基于 `platform-auth` 的 employee/group authority adapter。

Phase 1A 不把 Phase 0 inventory 或 catalog candidate 写入生产 Catalog，不改变 resolver、memory、LIVE 或部署开关。

## 2. 单一权威与身份规则

### 2.1 Catalog SoT

唯一持久 SoT 是 Data Governance Catalog（当前实现入口为
`src/gateway/data-governance/catalog-store.ts`）。WorkspaceResourceCatalog 只能作为
只读 projection adapter；它不得拥有独立持久化、缓存回写或现场合成能力。

Catalog record 的最小形状为：

```ts
type WorkspaceCatalogRecord = {
  envelope: WorkspaceEnvelope;
  bindings: StorageBinding[];
};
```

Store 设计必须保留既有治理能力：

- `get(resourceId)` / `list(resourceType)` 为读取入口；
- `put` / `compareAndPut` / `remove` 仅属于治理 store 的受控管理面，不由 Workspace adapter 暴露；
- record 的 `resourceId` 必须与 envelope、每个 binding 和 receipt 中的身份一致；
- `governanceVersion` 与文件 revision 用于 CAS 和丢失更新保护；
- terminal lifecycle（retired/purged 等）不可被普通 put 覆盖；
- metadata-only，禁止写入 transcript、embedding 或 memory atom body。

### 2.2 Binding 维度

`StorageBinding` 同时保留数据角色与物理存储信息，不能用一个 enum 混淆：

```ts
type StorageBinding = {
  bindingId: string;
  resourceId: string;
  dataRole: "workspace" | "memory" | "continuity" | "artifact";
  bindingRole: "canonical" | "compatibility";
  storageKind: string;
  objectKey: string;
  backend: "personal-local" | "managed";
  state: "active" | "read_only" | "retired";
  fencingToken?: string;
};
```

同一 `resourceId` 每个 `dataRole` 最多一个 active canonical binding；compatibility binding
必须有迁移 receipt、生命周期和回滚出处。任何缺失、重复或跨 tenant binding 都进入
quarantine/disposition，不得进入 normal Catalog。

## 3. Workspace Envelope typed view

Workspace 不是第二种 envelope，也不新增 `WorkspaceIdentity` 持久 SoT：

```ts
type WorkspaceEnvelope = DataGovernanceEnvelope & {
  resourceType: "workspace";
  extension: {
    workspaceKind: "employee_private" | "agent_primary" | "group_shared";
    agentAssetId?: string;
    departmentId?: string;
  };
};
```

约束：

- 磁盘、Catalog、RPC、receipt 和 SQLite 分区键只持久 `resourceId`；
- `workspaceId` 只能是 TypeScript 语义别名，不得成为第二持久字段；
- `agentId` 只能作为 tenant 内 runtime slug，必须先解析到 durable `agentAssetId`；
- `departmentId` 是 scope/grant 维度，不是物理父目录；
- owner、scope、lifecycle、legal hold、version 均继承治理 Envelope，不重复定义；
- adapter 只能从已有治理 record 投影 typed view，不能从 path/realpath/display name 合成身份。

## 4. WorkspaceResourceCatalog 只读 adapter

Adapter 接口：

```ts
type WorkspaceResourceCatalogAdapter = {
  get(resourceId: string): Promise<WorkspaceCatalogRecord | null>;
  getCanonicalBinding(params: {
    resourceId: string;
    dataRole: StorageBinding["dataRole"];
  }): Promise<StorageBinding | null>;
  listForTenant(tenantId: string): Promise<WorkspaceCatalogRecord[]>;
  project(record: CatalogRecord): WorkspaceEnvelope;
};
```

Adapter 明确不提供 `put`、`compareAndPut`、`remove`、`synthesize` 或任何 fallback。
Managed 场景中 Catalog miss、多 canonical、tenant mismatch、unknown authority 和
quarantine 状态只返回结构化诊断；Phase 1B 解锁前不得把 miss=deny 接入生产 resolver。

读取一致性要求：同一次操作沿用同一 `resourceId`、治理版本和 binding 快照；cache key
至少包含 `tenantId/resourceId/governanceVersion`，不能用 path、agentId 或用户显示名代替。

## 5. Employee / group authority adapter

权威来源：复用 `src/gateway/platform-auth/memberships.ts` 及 tenant-scoped group Registry。
WS-A 只定义读模型，不新建 membership 表或 workspace-resolver 下的 group store。

```ts
type WorkspaceAuthorityQuery = {
  tenantId: string;
  userId?: string;
  seatId?: string;
  groupId?: string;
  agentAssetId?: string;
  departmentId?: string;
};

type WorkspaceAuthorityDecision = {
  allowed: boolean;
  scopes: string[];
  denyReason?:
    | "unknown_tenant"
    | "unknown_membership"
    | "membership_conflict"
    | "agent_asset_unassigned"
    | "group_not_found"
    | "department_scope_mismatch";
};
```

决策规则：

- 显式 session membership 优先；无绑定时只能走现有唯一 membership 兼容路径；
- unknown tenant、unknown membership、冲突 membership 和未证明 AgentAsset 均 fail closed；
- group 是独立 tenant resource，department 只改变 grant/scope，不移动目录；
- employee transfer、agent handover、cross-department group 只改变 authority/binding，不改变物理根；
- adapter 不负责写 membership、迁移目录或生成 Catalog record。

## 6. Offline bootstrap / coverage 诚实性

Phase 0 candidate 只能作为离线 shadow-compare 输入：

```text
candidate inventory
  -> authority proof / tenant classification
  -> normal | pending_authority | unknown | conflict | quarantine
  -> design comparison report
```

candidate 不得直接调用 Catalog `put`。在真实持久 Catalog 尚未产生 record 前，coverage 必须
继续报告 `0%`：employee_private、agent_primary、group_shared 三项均不得被 candidate
数量伪装为已覆盖。unknown/conflict/quarantine 只进入 disposition 清单。

## 7. 迁移、回滚与可观测性设计

- 每个 binding 变更携带 source/target `resourceId`、expected governance version、fencing token、receipt；
- compare-and-put 冲突必须可重试且不能覆盖较新的 governance version；
- adapter 记录 `tenantId/resourceId/dataRole/bindingId/governanceVersion`，不记录敏感内容；
- rollback 只恢复已证明的 binding/receipt，不删除 unknown/quarantine；
- 正常 Catalog、adapter projection、authority decision 的指标必须可区分 miss、conflict、quarantine 和 deny reason；
- 任何实现若需要新 SoT、path identity、resolver fallback 或 memory schema v2，必须退回设计评审。

## 8. 明确禁止与验收门

本交付不做以下任何事：

- 修改 `src/gateway/workspace-resolver/**`；
- 修改 `src/memory/**` 生产实现或启用 schema v2；
- 将 Catalog miss 改为生产 deny；
- 从 inventory/candidate 写 Catalog SoT；
- 改 `deployAuthorized`、LIVE、Phase 1B 或生产部署；
- 创建第二套 WorkspaceIdentity、membership 或 group SoT。

验收必须同时满足：

1. design review、catalog contract、membership contract 与本文一致；
2. 持久 Catalog coverage 仍如实为 0%；
3. adapter 的写方法在类型/契约层不可见；
4. resourceId 是唯一持久主键，department 只在 scope/grant 出现；
5. unknown/conflict/quarantine 没有 normal Catalog admission；
6. Phase 1B 仍 blocked，LIVE 仍 forbidden。
