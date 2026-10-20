# OpenBot 与 CogniWeave 统一记忆系统整改方案

| 字段     | 值                                                                                                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 文档 ID  | `openbot-cogniweave-unified-memory-remediation-2026-08-19`                                                                                                                                                                                                                                                                                                               |
| 日期     | 2026-08-19                                                                                                                                                                                                                                                                                                                                                               |
| 版本     | **rev.1.2（accepted）**                                                                                                                                                                                                                                                                                                                                                  |
| 状态     | **独立架构验收 accepted。授权 U0-only。U1+ / unlock / LIVE / schema-v2-write / miss=deny / item7-delete-before-U1-ready 均未授权。不是 Phase 1B unlock，不是生产写路径，不是 CogniWeave 切主。**                                                                                                                                                                         |
| 适用范围 | OpenBot 多租户平台、Workspace、Memory Asset、CogniWeave、索引、检索、迁移与云同步                                                                                                                                                                                                                                                                                        |
| 不取代   | [工作区身份整改 2026-08-14](./memory-workspace-identity-remediation-2026-08-14.md)；[对话/记忆/协作组优化 2026-08-18](./conversation-memory-collaboration-optimization-plan-2026-08-18.md) §7.1.6；CQ-O1a 实现 `src/memory/acquire-sync-auth.ts`（#500 设计 / #506 合入）；canonical unlock receipt `docs/design/evidence/memory-workspace-phase1b-unlock-decision.json` |
| 前一复审 | rev.1.1：Changes Required。不得回复「§14 全部接受」。                                                                                                                                                                                                                                                                                                                    |

## 0. 确认前必读

### 0.1 本文授权什么、不授权什么

| 轨道                           | 本文是否开工             | 说明                                                                                                             |
| ------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **U0 边界冻结**                | **是（rev.1.2 已签署）** | 合同、只读盘点、阻断测试、冻结新后端。不改生产 resolver，不写 Catalog，不迁库                                    |
| **U1 Handle dark integration** | 否                       | 前置：item 2 met、item 6 met、canonical unlock **issued**。**不要求** item 7 已归零                              |
| **U2 单写 / shadow read**      | 否                       | 须 U1 新入口已验证可承接旧调用                                                                                   |
| **item 7 旧调用点 37→0**       | 否                       | **U1/U2 的退出门禁**，不是 U1 开工前置                                                                           |
| **U3 受控迁移**                | 否                       | 须 item 7 随替换归零后；导入前必须重新采集生产快照                                                               |
| **U4 切读 / I3**               | 否                       | 须 item 7 = 0；I3 另授权                                                                                         |
| **CQ-O1a / O1b**               | 独立                     | #506 已合入 builtin `acquireSyncAuth`。本文不得回退。O1b 仍 blocked                                              |
| **Phase 1B unlock / LIVE**     | 独立 reviewer            | 本文不能签发 `phase1bExecutionBlocked=false` 或 `deployAuthorized=true`。`deployAuthorized` 与 LIVE 始终另行授权 |

### 0.2 rev.1.2 相对 rev.1.1 的修正

1. **阶段顺序**：unlock 后先做 U1 dark Handle，再 U2，再随替换把 item 7 降到 0；禁止「先 item 7=0 再 U1」。
2. **Handle 完整性**：缺 resourceId / Memory Asset / tenant / binding / fencing 时 **不构造 Handle**，返回结构化 denial。
3. **SoT 引用**：删除不存在的 `memory-search-operation-boundary-2026-08-18.md` 作为必引路径；改引 CQ 计划 §7.1.6 与 #500/#506 / `acquire-sync-auth.ts`。
4. **tasks.md** 与 scorecard 对齐：item 4 = met；schema v2 写路径仍关闭。
5. **生产事实**改为 2026-08-19 时点快照：有 `capturedAt`、LIVE SHA、evidence 路径；无生产主机 IP；U3 前必须重采。
6. **cloud tenantId** 从 Handle 派生；配置值只做一致性校验，mismatch 立即拒写。

### 0.3 保持不变的硬性不变量

- CogniWeave 是唯一认知事实与检索内核。
- OpenBot 是唯一治理、授权和运行时入口。
- Data Governance Catalog 是唯一治理 SoT。
- CogniWeave canonical store 不是第二 Catalog。
- schema v2 不保存完整认知事实或 embedding 主存。
- U0（若日后签署）不写 Catalog、不迁库、不改生产 Resolver。
- cloud sync 不得成为独立 tenant 通道。
- #506 不得回退。O1b 保持 blocked。
- 本文不构成 unlock、LIVE 或切主授权。
- `unlock=not-issued`；`phase1bExecutionBlocked=true`；`deployAuthorized=false`；`LIVE=forbidden`。

---

## 1. 执行结论

> **CogniWeave 是唯一认知记忆内核；OpenBot 是唯一平台治理与运行时接入层；OpenBot 中与 CogniWeave 重复的记忆引擎能力按波次退役。**

这不是把 CogniWeave 和 OpenBot Memory 长期并列维护，也不是把租户治理、Workspace Catalog 和迁移状态机搬进 CogniWeave。

```text
OpenBot Governance Plane
  TenantContext / membership / AgentAsset / group
  DataGovernanceEnvelope / resourceId / StorageBinding
  authorization / lifecycle / fencing / cutover / retirement
              |
              v
OpenBot Memory Facade
  resolveWorkspaceResource -> MemoryWorkspaceHandle | StructuredDenial
  operation authorization / audit / compatibility boundary
              |
              v
CogniWeave Cognitive Plane
  atoms / claims / evidence / relations
  distillation / provenance / graph / vector / hybrid retrieval
```

上图是终态，不是 2026-08-19 运行时。当前生产默认仍是 builtin agent 名 sqlite；CogniWeave manager 仍用 `stableId(stateDir)` 当 workspace 身份。

**替换不得先拆旧路：** item 7 旧调用点必须在 U1/U2 新入口可承接之后才逐步删除。要求 item 7 先归零才能做 U1，会形成执行死锁。

---

## 2. 当前现状

### 2.1 Canonical SoT（签署前已对齐）

| 项     | 状态           | 说明                                                            |
| ------ | -------------- | --------------------------------------------------------------- |
| unlock | **not-issued** | `memory-workspace-phase1b-unlock-decision.json`                 |
| item 2 | **not-met**    | 生产 Catalog 覆盖未成立                                         |
| item 3 | **met**        | 暗写开关接受；`enablesProduction=false`                         |
| item 4 | **met**        | 暗 `files_v2`/`chunks_v2`；`SCHEMA_V2_ENABLED=false`；写仍走 v1 |
| item 5 | **met**        | `wiredToProductionResolver=true`                                |
| item 6 | **not-met**    | 可评审 drill ≠ 生产 sqlite snapshot                             |
| item 7 | **not-met**    | 活点未归零；unlock 前不删现活写点                               |

`tasks.md` 中「item 2/4/6/7 保持 not-met」已标为过时快照，不得再引用。

### 2.2 已经形成的正确基础

- Data Governance Catalog 是唯一治理 SoT。
- 契约层持久工作区身份为 `resourceId`（生产形态见 §2.5 时点快照）。
- Workspace memory role 与独立 Memory Asset 已区分。
- `src/memory/search-manager.ts` 已接入 CogniWeave manager。
- `src/memory/cogniweave-manager.ts` 承担 source、scope、distillation、搜索和 cloud sync 适配。
- v1 root guard、治理 fingerprint、manager cache invalidation 已存在。
- CQ-O0 生产只读 health 已归档。
- CQ-O1a：#500 设计批准；#506 合入 builtin `acquireSyncAuth` + `scheduleAuthorizedSearchSync`（证据：`src/memory/acquire-sync-auth.ts`，PR <https://github.com/gmood2008/openbot/pull/506>）。

### 2.3 当前重复体系

```text
memory backend = builtin | qmd | cogniweave
                       |
                       +-- builtin MemoryIndexManager
                       +-- QMD manager + builtin fallback
                       +-- CogniWeaveMemoryManager
```

### 2.4 已识别的 P0 风险（代码已核对）

`src/memory/cogniweave-manager.ts` 构造函数：

1. `workspaceId = stableId("ws", path.resolve(stateDir))` — 路径哈希当身份。
2. Scope 长期携带 `agentId`。
3. 自行 `resolveAgentWorkspaceDir` / `resolveStateDir` / `resolveDataRoot`。
4. 多后端写入与生命周期边界未冻结。
5. schema v2 若存完整认知事实，会成第二事实库。
6. sessionKey 不能替代 membership/grant。
7. 双迁移状态机风险。
8. `governance.ownershipProof` 只约束 CogniWeave 托管路径；builtin/QMD 仍按 `agentId` 建 manager。
9. cloud sync 配置含独立 `tenantId` 字段；U1 前不得把它当第二租户来源。

### 2.5 生产只读时点快照（须重采）

**不是永久常量。** U3 开工前必须重新采集并替换本快照。

| 字段                                        | 值                                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| evidence                                    | `docs/design/evidence/openbot-cogniweave-unified-memory-prod-readonly-snapshot-2026-08-19.json`                                                                         |
| evidence SHA-256                            | `docs/design/evidence/openbot-cogniweave-unified-memory-prod-readonly-snapshot-2026-08-19.sha256`（`e9c5a81ab9699212230447c653c4d4b3f19a0626cf1cedb04a1196d20864aadc`） |
| capturedAt                                  | `2026-08-19T06:00:00.000Z`                                                                                                                                              |
| host                                        | gateway host（不记录公网地址）                                                                                                                                          |
| container                                   | `openbot-gateway-rc`                                                                                                                                                    |
| LIVE baseline SHA                           | `34595862f785c90a4e0e30587db33690c2e139d2`（容器 `build-info.commit`）                                                                                                  |
| 关联 CQ-O0 receipt                          | `docs/design/evidence/conversation-memory-cq-o0/2026-08-18/cq-o0-production-capture-receipt.json`                                                                       |
| Catalog                                     | 11 条；`resourceId` 形态为 opaque UUID，不是 `ws:…:user:…:asset:…`                                                                                                      |
| `uniqueUserOwnedInCatalog`（按 `ws:` 形态） | 0                                                                                                                                                                       |
| 权威 1:1 equivalent                         | **4**（时点）；禁止把多 asset occupancy 当成 unique                                                                                                                     |
| 授权布局 `resource-*.sqlite`                | **0**                                                                                                                                                                   |
| agent 名 sqlite                             | 12；副本 `integrity_check` 12/12 ok                                                                                                                                     |
| item 7 活点                                 | 37（freeze baseline 38）                                                                                                                                                |

---

## 3. 目标架构与责任边界

### 3.1 OpenBot 唯一负责

tenant / membership / AgentAsset / group；`TenantContext`；`DataGovernanceEnvelope` 与 `resourceId`；Memory Asset 与 Workspace 关联（独立治理资源，不共用 ID）；StorageBinding；权限；lifecycle / legal hold / retention / quarantine；fencing / cutover / rollback / retirement / I3；生产部署授权与审计 receipt。

OpenBot 不再维护第二套认知事实模型。

### 3.2 CogniWeave 唯一负责

atom / claim / evidence / relation / distillation / graph / hybrid retrieval / derived index / journal replay / 认知 export-import。

不负责：membership SoT、Workspace Catalog、AgentAsset 注册、StorageBinding canonical、物理目录迁移、生产部署授权、跨租户裁决。**不负责补全缺失的 Handle 字段。**

### 3.3 存储边界

| 存储                       | 唯一职责                                         | 禁止存储                                       |
| -------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| Data Governance Catalog    | envelope、binding、authority、lifecycle、version | atom、embedding、membership 副本               |
| CogniWeave canonical store | atom、claim、evidence、relation、认知派生索引    | 第二套 tenant、membership、Workspace lifecycle |
| OpenBot schema v2          | workspace 分区、安全操作、兼容迁移、防误删元数据 | 完整认知事实或 embedding 主存                  |
| QMD/builtin legacy         | 阶段性只读兼容                                   | 新的长期写入事实源                             |

---

## 4. 统一身份契约

### 4.1 三种身份必须分开

```text
OpenBot resourceId          = Workspace 的唯一持久治理身份
memoryAssetResourceId       = 记忆资产的独立治理身份（sourceWorkspaceResourceId 关联 Workspace）
atomId                      = CogniWeave 内部认知对象身份
```

- `agentId` 仅 runtime slug。
- path / realpath / stateDir / display name 不能生成业务身份。
- **unlock 前不得发明 `memoryAssetResourceId`，也不得写入生产 Catalog。**

### 4.2 Handle 必须完整；否则结构化拒绝

`MemoryWorkspaceHandle` 只表示已经授权、可消费的对象。下列任一缺失时，**不得构造 Handle**（包括不得构造缺字段的半合法对象）：

- Workspace `resourceId`
- Memory Asset
- tenant
- binding
- fencing token / governanceVersion

Resolver / Facade 返回结构化 denial，CogniWeave 不得补全：

```ts
type MemoryWorkspaceDenial =
  | "missing_workspace_resource"
  | "missing_memory_asset"
  | "ambiguous_agent_asset"
  | "tenant_mismatch"
  | "missing_binding"
  | "stale_fencing_token";

type MemoryWorkspaceResolveResult =
  | { ok: true; handle: MemoryWorkspaceHandle }
  | { ok: false; reasonCode: MemoryWorkspaceDenial; reason: string };
```

```ts
type MemoryWorkspaceHandle = {
  resourceId: string;
  memoryAssetResourceId: string;
  tenantId: string;
  agentAssetId?: string; // 仅当权威唯一时出现；ambiguous 走 denial，不进半完整 Handle
  bindingId: string;
  canonicalObjectKey: string;
  governanceVersion: number;
  fencingToken: string;
  lifecycle: "active" | "read_only" | "moving" | "recovery_required" | "retired" | "purged";
  permissions: {
    search: boolean;
    ingest: boolean;
    distill: boolean;
    prune: boolean;
    reset: boolean;
    export: boolean;
  };
};
```

U0（签署后）：只落类型与「缺件 → denial、从不返回不完整 Handle」测试。
U1：manager 只接受完整 Handle；stateDir 只作物理配置。

---

## 5. 统一 Scope 映射

| OpenBot 授权资源 | CogniWeave scope                                                    |
| ---------------- | ------------------------------------------------------------------- |
| employee_private | `resourceId + private + user/seat`                                  |
| agent_primary    | `resourceId + private + agentAssetId`                               |
| group_shared     | `resourceId + shared + groupId`                                     |
| department       | 只影响 OpenBot grant                                                |
| Memory Asset     | `memoryAssetResourceId` 关联认知资产，不替代 Workspace `resourceId` |

OpenBot 先裁决。sessionKey 不能单独提升为 shared。

---

## 6. 生命周期和迁移边界

OpenBot cutover/fencing/retirement 是唯一物理迁移状态机。CogniWeave 只做认知数据操作。

**cloud sync：** `tenantId` **从 Handle 派生**。配置里的 tenant 字段只做一致性校验；与 Handle.tenantId 不一致立即拒写。配置值不是第二租户来源。

```text
OpenBot:     active -> read_only -> moving -> recovery_required -> retired -> purged
CogniWeave:  active -> tentative -> conflicted -> deprecated
```

Workspace `retired/purged` 后禁止 CogniWeave 新写入。Atom `deprecated` ≠ Workspace retired。destructive 必须带 `resourceId`、`bindingId`、`governanceVersion`、`fencingToken`、`operationId`。

CQ-O1a：search 不得 `createV1OperationAuth`，不得直接 begin rebuild/reset/prune。CogniWeave 路径不得另开 destructive 入口。

---

## 7. 分阶段整改计划

正确顺序（禁止 item 7=0 作为 U1 开工前置）：

```text
rev.1.2 复审签署
  → U0 边界冻结
  → item 2 + item 6 诚实 met
  → 独立 unlock issued
  → U1 Handle dark integration
  → 验证新入口可承接旧调用
  → U2 CogniWeave 单写 / shadow read
  → item 7 旧调用点随替换逐步 37 → 0
  → U3 受控迁移（先重采生产快照）
  → U4 切读；I3 另授权
```

| 门                      | 前置                                  | 退出                                                           |
| ----------------------- | ------------------------------------- | -------------------------------------------------------------- |
| U0                      | 本文签署                              | 合同、盘点、阻断测试绿；无生产写                               |
| U1                      | item 2 met、item 6 met、unlock issued | 完整 Handle 或结构化 denial；新入口可承接；**不要求 item 7=0** |
| U2                      | U1 退出                               | 新数据单写；shadow read；隐式 fallback 写入禁止                |
| item 7 → 0              | U1/U2 替换进行中                      | 旧调用点归零 = **U1/U2 退出门禁** 与 **U4 前置**               |
| U3                      | item 7=0；新快照已重采                | 按 `resourceId` 导入；quarantine 不猜归属                      |
| U4 / I3                 | item 7=0；shadow/负向测试绿           | 切读；I3 另授权                                                |
| LIVE / deployAuthorized | 始终另行授权                          | 本文永不签发                                                   |

### Phase U0：统一边界冻结

签署后唯一可开工项。交付：映射契约（不写 Catalog）；完整 Handle + denial 类型；schema v2 边界；lifecycle/cloud 关系图；三后端 owner/写入/退役矩阵；`stableId(stateDir)` / `agentId` scope / 自解析路径的阻断测试。

门禁：不改生产 resolver；不开 schema v2 写；不新增第二 Catalog；不删现活 item 7 写点；不对生产 sqlite 做破坏性 drill。

### Phase U1：Handle dark integration（blocked）

前置：item 2 met、item 6 met、unlock issued。不前置 item 7=0。

工作：Resolver → 完整 Handle 或 denial；CogniWeave manager 只收 Handle；去掉 `stableId(stateDir)`；`Scope.workspaceId = resourceId`。旧 `resolveAgentWorkspaceDir*` 调用点此时仍可存在，由 U1/U2 逐步替换。

### Phase U2：单写 / shadow read（blocked）

新 ingest/distill/atom 只进 CogniWeave；builtin/QMD 只读 + shadow。禁止隐式 fallback 写入。确认后、U2 前禁止 **扩大** 双写，不等于生产已单写。

### item 7 退役（U1/U2 退出，非 U1 前置）

随新入口替换删除旧写点。`cursor-fable` 不做 Retirement。不改 Phase 0 freeze baseline 来假绿。I3 在归零且另授权之前关闭。

### Phase U3：受控迁移（blocked）

前置：item 7=0；**重新采集** §2.5 类快照。禁止按 agentId 整库回填、按目录名猜 owner。2026-08-19 的「1:1=4 / UUID Catalog / 无 resource-\*.sqlite」不得当永久输入。

### Phase U4：切读与 I3（blocked）

前置：item 7=0。builtin/QMD 只留显式 repair 工具。I3 / 删旧分支另授权。

### Phase U5：稳定演进（blocked）

新后端必须走 CogniWeave adapter。

---

## 8. 负向测试与验收门禁

- path/stateDir 变化不改变 `resourceId` 或 CogniWeave scope。
- `agentId` 变化不得访问旧 `agentAssetId` 记忆。
- tenant mismatch、缺 membership/AgentAsset/proof → denial，不构造 Handle。
- sessionKey 不能把 private 提升为 shared。
- cloud 配置 tenant 与 Handle.tenantId 不一致 → 立即拒写。
- stale fencing → `stale_fencing_token`，不构造 Handle。
- retired/purged Workspace 禁止 CogniWeave ingest/distill/prune/reset。
- Catalog miss 不得 path fallback。
- schema v2 不得成为第二认知事实库。
- 同一 `resourceId` 不得多 active canonical memory binding。

---

## 9. 迁移与发布门禁（U4）

1. `origin/main` ancestry gate。
2. 生产 Catalog / Memory Asset / Binding 证据完整，且不是 host/evidence SoT。
3. Resolver 与 Handle 同一发布单元。
4. schema v2 写若启用须与 write switch 同发布单元；当前写路径关闭。
5. v1 root guard + **生产** sqlite 只读 snapshot；mkdtemp drill 不算 item 6 met。
6. shadow compare 与跨租户负向测试绿。
7. builtin/QMD 生产写点为零，或有批准的只读例外。
8. `productionWriteWatchIndex=0` 后才允许 I3。
9. `deployAuthorized` 独立授权。

---

## 10. 责任分工

| 能力                                       | Owner                                    |
| ------------------------------------------ | ---------------------------------------- |
| Tenant / membership / AgentAsset / Catalog | Data Governance                          |
| Resolver / Handle                          | 现有 Resolver owner，与治理协同          |
| CogniWeave SDK                             | CogniWeave owner                         |
| Memory facade                              | OpenBot Memory owner                     |
| schema v2 / v1 guard                       | Memory + SRE                             |
| cutover / fencing                          | Storage-cutover + SRE（不做 Retirement） |
| item 7 retirement                          | Data Governance，单一 lander             |
| CQ-O1a/O1b                                 | 独立 CQ owner，不并入 U1 施工单          |
| unlock / LIVE                              | 独立 reviewer                            |

---

## 11. 当前禁止事项

U0 已授权。unlock issued 前禁止：

- 第二 Resolver / 第二 Catalog / 第二 lifecycle SoT
- 用 path、stateDir、sessionKey、display name 推导授权
- 用 `agentId` 作长期记忆主键
- 构造不完整 Handle
- 扩大双写；开启 schema v2 写或 miss=deny
- LIVE、重索引、删除旧根、`deployAuthorized=true`
- 自签 unlock
- 在 U1 新入口未承接前删除 item 7 现活写点
- 把 occupancy 多 asset 或 UUID Catalog 改口径打成 item 2 met

---

## 12. 任务拆分

### 12.1 仅在 rev.1.2 签署后可做（U0）

1. 冻结 Boundary Contract（可作本文附录，不另起 SoT）。
2. 只读盘点 builtin / QMD / CogniWeave 生产读写点。
3. 阻断测试：`stableId(stateDir)`、`agentId` 长期 scope、自解析路径、**不完整 Handle 不可构造**。
4. 冻结新后端与新 canonical store。
5. CQ 计划文档与 #506 对齐（文档债）。

### 12.2 签署后仍不做

1. 生产 Catalog persist Memory Asset 或发明 resourceId。
2. U1 manager 接线（须 unlock）。
3. U3 导入（须 item 7=0 且重采快照）。
4. 在新入口未承接前删除旧写点。
5. schema v2 写或生产切读。

---

## 13. 完成标准

终态：CogniWeave 唯一认知核；OpenBot 唯一治理入口；生产 Catalog 上 `resourceId` 成立；无第二 Catalog/状态机；builtin/QMD 不再生产双写；schema v2 非认知主存；迁移/删除/forget/export/恢复可审计可回滚；item 7=0 且有 retirement receipt。

U0 完成标准（仅签署后适用）：合同、盘点、阻断测试绿、无生产写。

---

## 14. 复审对照（rev.1.2 accepted · U0-only）

| #   | rev.1.1 批复       | rev.1.2                                                 |
| --- | ------------------ | ------------------------------------------------------- |
| 1   | 目标分层同意       | 保持                                                    |
| 2   | 顺序要改           | §7 已改为 unlock → U1 dark → U2 → item 7 归零 → U3 → U4 |
| 3   | 修引用             | 已改为 CQ §7.1.6 + #500/#506 + `acquire-sync-auth.ts`   |
| 4   | Handle 不得半合法  | §4.2 不构造；结构化 denial                              |
| 5   | schema v2 不变量   | 保持                                                    |
| 6   | tenantId 强化      | 从 Handle 派生；配置只校验                              |
| 7   | CQ 独立 + 真实证据 | #506 URL 与源文件                                       |
| 8   | 时点快照           | §2.5 + evidence JSON；无主机 IP；U3 须重采              |

```text
reviewedBy: codex-workspace-architecture
reviewedAt: 2026-08-19T07:33:28Z
decision: accepted
authorizes: U0-only
doesNotAuthorize: U1+ / unlock / LIVE / schema-v2-write / miss=deny / item7-delete-before-U1-ready
```

---

## 附录 A. U0 Boundary Contract（不另起 SoT）

本附录冻结 U0 合同。实现入口：`src/memory/memory-workspace-handle.ts`、`src/memory/u0-boundary-freeze.ts`。不是 Catalog、不是 unlock、不是 U1 接线。

### A.1 身份与存储

| 对象                       | 唯一职责                                               |
| -------------------------- | ------------------------------------------------------ |
| OpenBot `resourceId`       | Workspace 持久治理身份                                 |
| `memoryAssetResourceId`    | Memory Asset 独立治理身份                              |
| CogniWeave `atomId`        | 认知对象身份                                           |
| Data Governance Catalog    | 唯一治理 SoT                                           |
| CogniWeave canonical store | 唯一认知事实与检索核                                   |
| schema v2                  | 分区/兼容元数据；`SCHEMA_V2_ENABLED=false`；非认知主存 |

### A.2 Handle 完整性

缺 `resourceId` / Memory Asset / tenant / binding / fencing 时不得构造 `MemoryWorkspaceHandle`。Resolver 返回结构化 denial。CogniWeave 不补全字段。Handle 品牌为模块私有 `Symbol()` + `WeakSet`，不导出、不使用 `Symbol.for`。`governanceVersion` 须为正整数；`permissions` 六个字段须为 boolean。`lifecycle=retired/purged` 时 ingest/distill/prune/reset 必须全部为 false。

### A.3 cloud tenant

`tenantId` 从完整 Handle 派生。配置值只做一致性校验；mismatch → `tenant_mismatch` 拒写。

### A.4 后端冻结

生产记忆后端仅 `builtin | qmd | cogniweave`。U0 禁止新增第四后端或第二 canonical store。新后端须等 U5 adapter。

### A.5 P0 债务（U1 才拆除）

`src/memory/cogniweave-manager.ts` 仍用 `stableId(stateDir)`、`agentId` scope、自解析 `resolveAgentWorkspaceDir` / `resolveStateDir` / `resolveDataRoot`。U0 只冻结这些调用点，不删除。

### A.6 lifecycle / cloud 关系图

```text
OpenBot lifecycle (unique physical/governance machine)
  active -> read_only -> moving -> recovery_required -> retired -> purged
        |
        | Handle.tenantId / fencingToken / governanceVersion
        v
CogniWeave cognitive lifecycle (unique fact machine)
  active -> tentative -> conflicted -> deprecated
        |
        | cloud sync tenantId := Handle.tenantId
        | configured cloud tenant = consistency check only
        v
  mismatch -> tenant_mismatch denial; no write
```

Workspace `retired/purged` 禁止 CogniWeave ingest/distill/prune/reset。Atom `deprecated` ≠ Workspace retired。配置 tenant 不是第二租户来源。

### A.7 三后端 owner / 当前读写 / 终态 / 退役

| 后端       | 当前 owner                    | 当前读写                                                           | 终态                  | 退役阶段                          |
| ---------- | ----------------------------- | ------------------------------------------------------------------ | --------------------- | --------------------------------- |
| builtin    | cursor-memory-wsc             | `manager.ts` search/sync；`manager-sync-ops.ts` reset/prune        | 只读兼容或显式 repair | U1/U2 承接后 item 7 → 0，再 U4/I3 |
| qmd        | cursor-conversation-lifecycle | `qmd-manager.ts` search/sync/repair；失败可 fallback builtin 写    | 只读兼容              | 同上；U0 不删 fallback            |
| cogniweave | cursor-conversation-lifecycle | `cogniweave-manager.ts` search/sync/distill/lifecycle；cloud drain | 唯一认知核            | U1 改收完整 Handle；不在 U0 接线  |

U0 不接管 `cogniweave-manager.ts` / `search-manager.ts` / `qmd-manager.ts`。这些路径仍属既有 owner。U0 只新增 Handle/freeze 文件并只读扫描。
