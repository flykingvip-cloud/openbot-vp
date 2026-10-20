# 对话、记忆与协作组优化方案（专家对齐稿）

| 字段         | 值                                                                                                                                                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档 ID      | `conversation-memory-collaboration-optimization-plan-2026-08-18`                                                                                                                                                                                                                                         |
| 版本         | **rev.4.1.10**                                                                                                                                                                                                                                                                                           |
| 日期         | 2026-08-19                                                                                                                                                                                                                                                                                               |
| 状态         | **正式实施基线（契约 finalized）**                                                                                                                                                                                                                                                                       |
| rev.4.1 结论 | Architecture and governance boundaries **accepted**. CQ-O0 implementation **authorized**. CQ-O0 production evidence **complete**（2026-08-19 窗口）. CQ-O1a design **Approved**（#500）；implementation **complete**（#506）. CQ-O1b design **accepted**, implementation **blocked**. CQ-A2 **blocked**. |
| 关联 spec    | `.kiro/specs/memory-workspace-platform-remediation/`（**CQ-O\*** 独立命名）                                                                                                                                                                                                                              |
| 部署授权     | `deployAuthorized=false`                                                                                                                                                                                                                                                                                 |

---

## 0.2 rev.4.1.10 变更摘要（CQ-O1a 实现签收）

| #   | 过期措辞                       | 修正                                                                                          |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| 1   | O1a implementation in progress | #506 已合入 `main`（`6c20a36170f76c4bc34e27e34b01ef9d7372618e`）；implementation **complete** |
| 2   | §7.1.6 仍写尚未 Approved       | 设计 #500 Approved；实现 #506；`acquireSyncAuth` 已落地                                       |
| 3   | O1b 因「等 O1a」阻断           | O1a 完成；O1b 仍被 golden fixture / capability schema 阻断                                    |
| 4   | 与 U0 并行轨道混淆             | U0 不取代本轨道；不接线 `MemoryWorkspaceHandle`、不回退 #506、不为 CogniWeave 另开 acquire    |

本修订是文档债（对齐已合入代码）。**不**授权 O1b、U1 Handle 接线、schema v2 写、Catalog 写、LIVE、`deployAuthorized=true`。

---

## 0. rev.4.1 变更摘要（第六轮 — 契约 finalized）

| #   | 复审意见                                     | rev.4.1 修正                                                                                |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | summary 与 ops 共用 Base 泄露路径            | §6.3.1 拆为 `HealthReportOps` / `HealthReportSummary`；`scope.denied` 用最小 error envelope |
| 2   | snapshot hash 用 Object.keys(entries) 不可靠 | §6.4.2 `canonicalizeProbeSnapshot()` 固定 entry 字段序                                      |

---

## 0.1 rev.4 变更摘要（第五轮复审）

| #   | 复审意见                               | rev.4 修正                                                                        |
| --- | -------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | CQ-O0「启动」与「生产采集」混写        | §6.0 / §12.2 拆为 **implementation authorized** vs **production capture blocked** |
| 2   | probe 失败 envelope 无正式 schema      | §6.3.1 `HealthReport` success/error **union**                                     |
| 3   | probe 完整性 hash 算法未固定           | §6.4.2 canonical snapshot 规范                                                    |
| 4   | RPC scope 缺实现映射                   | §6.3.2 scope 注册与 403 payload                                                   |
| 5   | `acquireSyncAuth` 仅为设计名词         | §7.1.6 operation-boundary **design review** 前置                                  |
| 6   | `single_owner` 映射须 golden test 决定 | §7.2.2 **provisional** 标记                                                       |
| 7   | capability matrix 缺 retention         | §7.4.1 message retention 规则                                                     |
| 8   | §12.2 重复签收项                       | 已清理                                                                            |

---

## 1. 分阶段授权状态（rev.4 正式实施基线）

| 阶段       | 设计                | 本地实现                                       | 生产 evidence                          | 实现 PR 合并                                          |
| ---------- | ------------------- | ---------------------------------------------- | -------------------------------------- | ----------------------------------------------------- |
| **CQ-O0**  | ✅ Authorized       | ✅ Authorized（见 §6.9 首个 green checkpoint） | ✅ **Complete**（2026-08-19 窗口归档） | #494 已合入 `main`；生产 gateway-dist-keep-ui overlay |
| **CQ-O1a** | ✅ Approved（#500） | ✅ **Complete**（#506）                        | —                                      | ✅ #506 已合入 `main`                                 |
| **CQ-O1b** | ✅ Accepted         | ⛔ **Blocked**                                 | —                                      | ⛔ Blocked                                            |
| **CQ-A2**  | —                   | ⛔ **Blocked**                                 | ⛔ Blocked                             | ⛔ Blocked                                            |

**CQ-O0 签收措辞（2026-08-19 生产采集通过）：**

> **Phase 0 实现：通过。**  
> **Phase 1 实现：通过。**  
> **CQ-O0 implementation 轨道：通过。**  
> **CQ-O0 overall：complete。** 首份生产 evidence 已脱敏归档。  
> identity / schema / mutation / redaction / tests 全部 `passed`。 CQ-O1a 设计 Approved（#500）；实现 complete（#506）。O1b / CQ-A2 继续阻断。

---

## 2. 产品结论（已签收 ✅）

> **对话传输与推理主链路大体可用；记忆检索的可信度与可观测性不足；协作组的调度可解释性与消息可见性不足。**

---

## 3. 授权边界与治理约束（已签收 ✅）

### 3.1 阶段命名

| 阶段       | 含义                         |
| ---------- | ---------------------------- |
| **CQ-O0**  | 只读可观测性                 |
| **CQ-O1a** | 记忆检索用户反馈             |
| **CQ-O1b** | 协作组 UX                    |
| **CQ-A2**  | Phase 1A/1B 架构（独立阻断） |

### 3.2 禁止事项

批量 reindex、绕过 v1-root-guard、Phase 0 inventory 写 Catalog、resolver/schema v2 写、先改 UI、`podman cp` 工作树脚本、**在 production-capture gate 解除前采集生产 evidence**、回退 #506、把 `MemoryWorkspaceHandle` 接入 builtin search（U1，须 unlock）、为 CogniWeave 另开 destructive acquire。

### 3.3 权限边界铁律

```text
status / health report  → 只读推导，不 re-read env grant，不授权写操作
search 路径             → 只读查询；search 不能伪造 operation auth
onSearch sync（若启用） → 必须经过 operation boundary（§7.1.6）
maintenance grant       → 仅在显式 destructive 操作入口校验
```

---

## 4. 三层记忆模型与状态契约（已签收 ✅）

### 4.1 三层定义

| 层             | 含义                       |
| -------------- | -------------------------- |
| **storage**    | durable Markdown           |
| **continuity** | snapshot（忽略 `memory/`） |
| **index**      | SQLite / vector / FTS      |

### 4.2 MemoryUserStatus 正交维度

对齐 `src/memory/v1-root-guard.ts`（`KNOWN_CONFLICT_SQLITE_BASENAMES` 已废弃为空；fingerprint = 规范化 realpath；grant 绑定 `normalizeSqliteInstanceId`）。

字段：`storage`、`authority`、`rootTopology`、`topologyEvidence`、`destructiveOps`、`search`、`documentState`、`searchableDocumentCount`、`reasonCode`、`reason`、`backend`。

### 4.2.2 MemorySearchToolStatus（已签收 ✅）

| 场景               | availability | documentState | queryOutcome   |
| ------------------ | ------------ | ------------- | -------------- |
| 索引 0 文档        | `ready`      | `empty`       | `no_match`     |
| 索引有文档，0 命中 | `ready`      | `populated`   | `no_match`     |
| guard 拒绝         | `denied`     | `unknown`     | `not_executed` |

**`empty` 不得作为 `availability` 值。**

### 4.2.3 reasonCode 命名空间（已签收 ✅）

`storage.*` / `authority.*` / `topology.*` / `destructive.*` / `search.*` / `query.*` / `probe.*` / `scope.*` — 未知状态用 `*.unknown`；禁止复用。

### 4.4 stale 与元数据

不可判定 → `search.unknown`；`lastSyncAt` / `lastRebuildAt` 暂无则 `null`。

---

## 5. 总体实施顺序（已签收 ✅）

```text
CQ-O0 impl ──→ CQ-O0 prod evidence ──→ CQ-O1a（#506 complete） ──→ CQ-O1b impl（仍 blocked）
                                              ↘
                                           CQ-A2（独立阻断）

U0（CogniWeave 统一记忆边界冻结）与本轨道并行，互不取代。U0 不得回退 #506；本轨道不得承接 U1 Handle 接线。
```

---

## 6. CQ-O0 — 生产可观测性

### 6.0 双轨授权

| 轨道                            | 状态          | 允许                                                                  | 禁止                                     |
| ------------------------------- | ------------- | --------------------------------------------------------------------- | ---------------------------------------- |
| **Design / Implementation**     | ✅ Authorized | `health-probe.ts`、T-1..T-8、import restriction、scope 测试、CLI 设计 | 改 MemoryManager、改 UI、生产写入        |
| **Production Evidence Capture** | ✅ Complete   | 授权窗口内只读 `memory health --json --redact` 并归档                 | 改 MemoryManager、写路径、未授权窗口采集 |

**解除 production capture 阻塞须同时满足：**

- [x] 操作员指定（`ceo` / CEO；handoff 2026-08-18）
- [x] 采集时间窗口确认（`2026-08-19T00:40:00+08:00/2026-08-19T01:10:00+08:00`）
- [x] 运行镜像 SHA 与 build-info 对齐确认（容器 `.Id` + commit `34595862f785…`）
- [x] 脱敏归档路径确认（`docs/design/evidence/conversation-memory-cq-o0/2026-08-18/`）

2026-08-19 窗口内采集 **passed**：`probeUtc=2026-08-18T16:40:26.753Z`，`mutationsDetected=false`。归档见同目录 redacted JSON / manifest / sha256 / capture receipt。

### 6.2 Agent 分类与 topologyEvidence

#### 6.2.1 证据强弱规则（已签收 ✅）

| topologyEvidence       | 可设 multiple | 可设 destructiveOps=denied |
| ---------------------- | ------------- | -------------------------- |
| `sidecar-fingerprints` | ✅            | ✅                         |
| `runtime-binding`      | ✅            | ✅                         |
| `inventory-only`       | ❌            | ❌                         |
| `unknown`              | ❌            | ❌                         |

#### 6.2.2 分类 taxonomy

| 分类键                | 条件                                                           |
| --------------------- | -------------------------------------------------------------- |
| `registered-single`   | sidecar 1 fingerprint 且与 incoming 一致                       |
| `authority-unknown`   | sidecar 无 fingerprint                                         |
| `topology-multiple`   | `topologyEvidence ∈ { sidecar-fingerprints, runtime-binding }` |
| `topology-mismatch`   | 登记 fingerprint ≠ normalizeRootFingerprint(workspace)         |
| `topology-unobserved` | workspace 不可解析                                             |

### 6.3 交付物

#### 6.3.1 `HealthReport` — success / error union（rev.4.1 正式 schema）

**rev.4.1 修正：** ops 与 summary **不共用**含路径字段的 base；`scope.denied` 使用独立最小 envelope。

```typescript
type ProbeArtifactDiff = {
  preSnapshotHash: string;
  postSnapshotHash: string;
  mutationsDetected: boolean;
  changedPaths?: string[];
};

/** 所有成功报告共享的元数据（不含路径） */
type HealthReportMeta = {
  schema: "memory-health-report/v2";
  instanceSha: string;
  probeModuleSha: string;
  probeModuleVersion: string;
  probeUtc: string;
};

/** ops 成功 — 含绝对路径，仅 platform/admin scope */
type HealthReportOpsOk = HealthReportMeta & {
  reportKind: "ops";
  status: "ok";
  reasonCode: "probe.ok";
  callerScope: "platform" | "steward" | "tenant";
  authorizedAgentIds: string[];
  runtime: { stateDir: string; tenantsRoot?: string | null };
  agents: MemoryOpsStatus[];
  groups: GroupOpsStatus[];
  probeIntegrity: ProbeArtifactDiff & { mutationsDetected: false };
};

/** summary 成功 — 无绝对路径，无 runtime */
type HealthReportSummaryOk = HealthReportMeta & {
  reportKind: "summary";
  status: "ok";
  reasonCode: "probe.ok";
  callerScope: "steward" | "tenant";
  authorizedAgentIds?: string[];
  agents: MemoryUserStatus[];
  groups?: GroupUserStatus[];
};

/** probe 失败 — 无 agents/groups/runtime（ops 路径） */
type HealthReportProbeInvalid = HealthReportMeta & {
  reportKind: "ops";
  status: "invalid";
  reasonCode: "probe.invalid";
  reason: string;
  callerScope: "platform" | "steward" | "tenant";
  agents?: never;
  groups?: never;
  runtime?: never;
  authorizedAgentIds?: never;
  probeIntegrity?: ProbeArtifactDiff;
};

/** scope 拒绝 — 最小 envelope，无任何路径或 agent 数据 */
type HealthReportScopeDenied = {
  schema: "memory-health-report/v2";
  status: "denied";
  reasonCode: "scope.denied";
  reason: string;
  probeUtc: string;
};

type HealthReport =
  | HealthReportOpsOk
  | HealthReportSummaryOk
  | HealthReportProbeInvalid
  | HealthReportScopeDenied;
```

**实现铁律：**

- `HealthReportSummaryOk` **不得**含 `runtime`、`indexPath`、`workspaceRoot`
- `HealthReportScopeDenied` **不得**复用 ops meta 或夹带 `authorizedAgentIds`
- `probe.invalid` **不得**与 `agents[]` 并存

#### 6.3.2 RPC scope 实现映射（rev.4）

| 项                      | 规范                                                                                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scope 常量**          | 新增 `PLATFORM_SCOPE = "operator.platform"` 于 `src/gateway/method-scopes.ts`（与 `ADMIN_SCOPE`、`READ_SCOPE` 并列）                                                                               |
| **Method 注册**         | `METHOD_SCOPE_MAP["doctor.memory.health"] = PLATFORM_SCOPE`<br>`METHOD_SCOPE_MAP["doctor.memory.health.summary"] = ADMIN_SCOPE`<br>`METHOD_SCOPE_MAP["doctor.memory.health.tenant"] = ADMIN_SCOPE` |
| **platform 认证**       | platform service token / operator.platform role（gateway auth layer）                                                                                                                              |
| **admin/steward 认证**  | 现有 tenant admin token + enterprise membership                                                                                                                                                    |
| **tenant binding**      | CQ-O0：`resolveTenantContext(caller)` ∩ `agents.list[]`；后续：Catalog AgentAsset binding                                                                                                          |
| **跨 seat**             | `doctor.memory.health.tenant`：**禁止**跨 seat；仅 caller tenant 内 agent                                                                                                                          |
| **跨 tenant 聚合**      | 仅 `doctor.memory.health`（platform scope）                                                                                                                                                        |
| **403 payload**         | `{ ok: false, error: { code: "403", reasonCode: "scope.denied", reason: "..." } }`（协议 `ErrorShape.code` 为字符串；顶层 `reasonCode`/`reason`，不放 `details`）                                  |
| **agent session token** | 任何 health RPC → 403；harness：`gateway-method-auth.test.ts` 新增用例                                                                                                                             |
| **status 兼容**         | `doctor.memory.status` 保持 READ scope；不扩展为多 agent；health 不替换 status                                                                                                                     |

#### D-O0-2：`memory-health-summary/v2`

即 `HealthReportSummaryOk`；与 ops schema **类型级分离**（§6.3.1）。

#### D-O0-3：镜像内置 CLI

`openbot memory health --json`；禁止 `podman cp` 工作树脚本。

### 6.4 独立 read-only probe

#### 6.4.1 Probe 遵守项（T-1..T-8，已签收 ✅）

SQLite readonly；不 ensure schema；缺失 sqlite 时不创建目录；WAL/SHM 不变；无 chokidar；无 embedding 请求；并发 probe 无 mtime 变化；失败 → invalid union。

#### 6.4.2 Probe 完整性 snapshot 算法（rev.4 固定）

**目的：** `preSnapshotHash` / `postSnapshotHash` 跨平台稳定可复算。

| 规则                  | 规范                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **路径集合**          | 每个 agent：`workspaceRoot` 下 `memory/` + `MEMORY.md` + `memory.md`；`indexPath` + `{indexPath}-wal` + `{indexPath}-shm` + `{indexPath}.v1-root-guard.json` |
| **路径排序**          | UTF-8 字典序                                                                                                                                                 |
| **symlink**           | 记录 `lstat` 类型；若为 symlink，存 `{ path, type:"symlink", target: readlink }`；hash 内容含 target                                                         |
| **缺失 WAL/SHM**      | 编码为 `{ path, present: false }`；**不**视为 mutation                                                                                                       |
| **mtime 精度**        | Unix ms（`stat.mtimeMs`）                                                                                                                                    |
| **size**              | `stat.size`；目录 `size: null`                                                                                                                               |
| **content hash**      | 文件：`sha256(content)`；目录/缺失：省略 content hash                                                                                                        |
| **canonical 函数**    | `canonicalizeProbeSnapshot(entries)` — 见下                                                                                                                  |
| **entry 字段序**      | 固定顺序：`path` → `present` → `type` → `size` → `mtimeMs` → `contentSha256` → `symlinkTarget`；仅输出已定义字段                                             |
| **entry 排序**        | 先按 `path` UTF-8 字典序排序                                                                                                                                 |
| **序列化**            | 每个 entry 按固定 key 顺序生成 `key=value` 段，段之间用 `\|` 连接；entries 之间用 `\n` 连接                                                                  |
| **snapshot hash**     | `sha256(canonicalizeProbeSnapshot(entries))` hex                                                                                                             |
| **禁止**              | `JSON.stringify(entries, Object.keys(entries).sort())` 等对数组索引排序的做法                                                                                |
| **测试**              | 同一输入不同构造顺序 → 相同 hash；固定 fixture 跨平台复算                                                                                                    |
| **probe 临时文件**    | 写入 `$TMPDIR/openbot-health-probe/<probeId>/`；**排除**在 snapshot 外                                                                                       |
| **并发隔离**          | 每次 probe 独立 `probeId`（uuid）；禁止共享临时目录                                                                                                          |
| **mutationsDetected** | `preSnapshotHash !== postSnapshotHash`                                                                                                                       |

#### 6.4.3 测试 fixture T-1..T-8（首个 checkpoint 部分完成 ⚠️）

| 用例 | 状态 | 说明                                                                                                          |
| ---- | ---- | ------------------------------------------------------------------------------------------------------------- |
| T-1  | ✅   | missing sqlite 不创建文件                                                                                     |
| T-2  | ✅   | 真实 SQLite：主库 + WAL size/mtime/header 不变；SHM size/content hash 不变（Node 只读打开可能刷新 SHM mtime） |
| T-3  | ✅   | 合法空 SQLite：`sqlite_master` 无 user 表、无 WAL/SHM、指纹不变                                               |
| T-6  | ✅   | 并发 probe 不 mutate snapshot                                                                                 |
| T-7  | ✅   | `probe.invalid` envelope + `runOpsHealthProbe` 端到端                                                         |
| T-8  | ✅   | RPC：`doctor.memory.health` READ caller 负向 + scope-denied（`gateway-method-auth.test.ts`）                  |

#### 6.4.4 CI 三层 guard（首个 checkpoint 已交付 ✅）

Import restriction（Oxlint `no-restricted-imports` on `health-probe.ts`）+ DI factory（`health-probe.factory.ts`）+ vitest spy（`health-probe.di-guard.test.ts`）+ oxlint 负向 fixture 测试。

### 6.5 生产 CLI 与 evidence 归档

本地已提供 `openbot memory health --json --redact` + `redactHealthReportForArchive()`。SHA 不匹配 / 脱敏失败 / mutation → fail-closed；原始 ops report 不得直入 `docs/`。

2026-08-19 窗口内已完成生产采集并归档（见 `docs/design/evidence/conversation-memory-cq-o0/2026-08-18/`）。后续采集仍须新窗口；原始 ops report 不得直入 `docs/`。

### 6.6 RPC 负向测试 harness

| 用例                             | harness 位置                                                                |
| -------------------------------- | --------------------------------------------------------------------------- |
| READ → `doctor.memory.health`    | `src/gateway/server-methods/doctor.test.ts` + `gateway-method-auth.test.ts` |
| tenant A → tenant B agent        | `doctor-memory-health.test.ts`                                              |
| agent session token → health RPC | `gateway-method-auth.test.ts`（role=node → 403 `scope.denied`）             |

### 6.7 CQ-O0 验收标准

| ID      | 标准                           | 轨道                                                     |
| ------- | ------------------------------ | -------------------------------------------------------- |
| AC-O0-1 | HealthReport union schema 校验 | impl（TypeBox union + leak 负向）                        |
| AC-O0-2 | T-1..T-8 + 三层 CI guard       | impl（**Phase 1 实现通过**）                             |
| AC-O0-3 | RPC 负向测试                   | impl（READ + node session + 403 `scope.denied`）         |
| AC-O0-4 | snapshot hash 跨平台复算测试   | impl（checked-in fixture JSON）                          |
| AC-O0-5 | 首份脱敏 evidence 归档         | **prod**（2026-08-19 窗口 passed）                       |
| AC-O0-6 | 操作员 + 时间窗口记录          | **prod**（`ceo` + `2026-08-19T00:40:00+08:00/01:10:00`） |

### 6.8 工期：10–14 工作日（impl）；prod capture 另计

### 6.9 首个 green checkpoint（CQ-O0 impl 唯一授权范围）

**必须仅包含：**

| 文件 / 交付                                               | 允许 |
| --------------------------------------------------------- | ---- |
| `src/memory/health-probe.ts`                              | ✅   |
| `src/memory/health-probe.test.ts`（T-1..T-8）             | ✅   |
| Oxlint import restriction 配置                            | ✅   |
| `src/memory/health-report.ts` 类型                        | ✅   |
| `src/memory/health-probe-snapshot.ts` + canonicalize 测试 | ✅   |

**必须不包含：**

- `src/memory/manager.ts` 修改
- UI 修改
- 生产 CLI 镜像接线（可后续 PR）
- RPC 注册（可后续 PR）
- 生产 evidence 采集

---

## 7. CQ-O1 — 用户反馈与协作组 UX

### 7.1 CQ-O1a — **DESIGN APPROVED / IMPLEMENTATION COMPLETE**

#### 7.1.1–7.1.4（已签收设计方向）

tool 三维 status；onSearch 10 场景矩阵；denied/unknown 零 sync — 见 rev.3，不再重复。

#### 7.1.5 CQ-O1a 阻断条件

- [x] CQ-O0 首份 production evidence 归档
- [x] §7.1.6 operation-boundary design review **Approved**（#500）
- [x] §7.1.4 矩阵纳入 CI（`src/memory/manager-search-operation-boundary.test.ts`）
- [x] 设计批准后 `manager.ts` onSearch 改走 `acquireSyncAuth`（#506 complete）

#### 7.1.6 Operation Boundary Design Review（rev.4 新增 — 已 Approved / 已落地）

rev.4 时 `acquireSyncAuth` 仅为设计名词。#500 批准独立设计；#506 已在 builtin search 落地（`src/memory/acquire-sync-auth.ts`，`scheduleAuthorizedSearchSync`）。契约如下（实现须保持，不得再开第二条 acquire）：

```typescript
/** 设计评审交付 — 非实现授权 */
type AcquireSyncAuthRequest = {
  op: "sync"; // 仅此 op；search 不能申请 prune/reset/rebuild
  reason: "search" | "manual";
  agentId: string;
  sqliteInstanceId: string; // normalizeSqliteInstanceId
  workspaceFingerprint: string;
};

type AcquireSyncAuthResult =
  | {
      ok: true;
      auth: V1OperationAuth; // 已有 brand；仅覆盖 op=sync 及 v1OperationCoversDestructive 允许的嵌套 prune
      expiresAt: string; // ISO8601；≤ 单次 search 超时预算
      holder: "single-flight"; // 仅 single-flight leader 持有
    }
  | {
      ok: false;
      reasonCode:
        | "destructive.denied"
        | "destructive.grant-required"
        | "authority.unknown"
        | "topology.multiple"
        | "auth.expired"
        | "auth.mismatch";
      reason: string;
    };
```

| 设计项        | 须回答                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------- |
| auth 生命周期 | 绑定 single-flight promise；sync 完成或超时即失效                                         |
| 嵌套 prune    | sync 内 prune 须 `v1OperationCoversDestructive("sync","prune")`；reset/rebuild **不**覆盖 |
| 谁持有 auth   | single-flight leader；follower await 同一 promise，不重复 acquire                         |
| 防伪造        | auth 仅由 operation boundary 构造；search 入口不可 `createV1OperationAuth`                |
| env grant     | 仅在 boundary 内 re-read；status 路径不读                                                 |
| 错误码        | 见 `AcquireSyncAuthResult`                                                                |

**交付路径：** `docs/design/memory-search-operation-boundary-2026-08-18.md`（#500 Approved）+ `src/memory/acquire-sync-auth.ts`（#506 implemented）。search 调用点：`src/memory/manager.ts:278` → `src/memory/manager-sync-ops.ts:1448`。

三维 status 契约仍以 CQ-O0 HealthReport 为准；本轨道 **不** 另开一套 UI。

---

### 7.2 CQ-O1b — 设计 Accepted；实现 Blocked

#### 7.2.2 映射表

| openDiscussion | responseMode           | mention | derived mode                  | 状态                                |
| -------------- | ---------------------- | ------- | ----------------------------- | ----------------------------------- |
| false          | \*                     | false   | `mention_only`                | **confirmed**                       |
| false          | \*                     | true    | 按 responseMode               | confirmed                           |
| true           | `lead_plus_supplement` | \*      | `lead_first_others_on_demand` | confirmed                           |
| true           | `debate_or_brainstorm` | \*      | `open_discussion`             | confirmed                           |
| true           | `single_owner`         | \*      | `mention_only`                | ⚠️ **provisional** — 须 golden test |
| \*             | 其他                   | \*      | `unmapped`                    | confirmed                           |

**`single_owner` 行规则（rev.4）：**

- **不能**仅凭文档指定为最终契约
- golden test 对照 `decision-engine.ts` 当前实际输出：
  - 若输出与 `mention_only` 一致 → 升级为 **confirmed**
  - 若不一致 → 改为 **`unmapped`**，或产品单独立项批准行为变更 + 兼容迁移
- 在 golden test 通过前，**不得**把该映射写入 UI 文案或 API 保证

#### 7.2.4 unmapped fail-safe（已签收 ✅）

允许发送；legacy 降级；须 audit；不升级 denied。

#### 7.2.5 golden test 交付（设计签收条件）

- `discussion-mode-derived.test.ts`
- decision-engine fixture 快照
- visibleLimit 0/1/N；round immutability；老客户端忽略字段回归

#### 7.4 optional suggestion — capability matrix

##### 7.4.1 Message retention 与 replay（rev.4）

| 项                       | 规范                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| **完整 body 存储**       | canonical transcript 存 stub；完整 body 存 **collaboration message store**（与 transcript 同 ACL 域） |
| **retention**            | 默认 ≥ 90 天（可配置）；与 group transcript retention 对齐                                            |
| **replay 超 retention**  | 返回 stub + `reasonCode: retention.expired`；UI 显示「内容已过期」                                    |
| **messageId 稳定性**     | UUID v4；进程重启不变；写入 canonical 时分配                                                          |
| **replay ACL**           | 重新检查 caller 对 group/seat 的 read 权限；不继承旧 session 权限                                     |
| **outbound unsupported** | 仍写 **audit**；outbound 标记 `unsupported` 不阻止 audit MUST                                         |
| **system_notice**        | canonical + replay + audit **MUST**；UI optional；outbound N/A                                        |

##### 7.4.2 Capability matrix

JSON schema 路径（待建）：`docs/design/schemas/collaboration-message-capability/v1.json`

硬门禁：canonical / ui / replay / audit 四项 MUST；outbound 按 matrix 机器校验。

#### 7.5 CQ-O1b 设计签收条件

- [x] derived mode 方向
- [x] unmapped fail-safe
- [x] retention 规则 §7.4.1
- [ ] decision-engine golden fixture 计划
- [ ] capability matrix JSON Schema 入库
- [x] **实现 PR 阻断直至 CQ-O1a 完成**（#506 已满足；O1b 仍被 golden fixture / capability schema 阻断）

---

## 8. 待调查项（已签收 ✅）

session split-brain；group storage consistency — 不变。

---

## 9. CQ-A2 — 独立阻断（已签收 ✅）

阻断：Catalog authority、Resolver write switch、schema v2 写、migration/reindex、P1–P8 retirement、LIVE deployment。

---

## 10. 链路保真（已签收 ✅）

---

## 11. 风险登记

| ID   | 风险                               | 缓解                      |
| ---- | ---------------------------------- | ------------------------- |
| R-12 | 声称 CQ-O0 完成但未 prod evidence  | §6.0 双轨                 |
| R-13 | invalid 报告夹带 agents[]          | union schema §6.3.1       |
| R-14 | single_owner 映射错误              | provisional + golden test |
| R-15 | acquireSyncAuth 未定义即改 manager | §7.1.6 设计评审门禁       |

---

## 12. 专家签收清单（rev.4）

### 12.1 已签收（不再讨论）

- [x] §2 产品结论
- [x] §3 禁止事项与权限边界
- [x] §4 三层模型与 status 契约（含空索引三维、reasonCode 命名空间）
- [x] §5 实施顺序
- [x] §6.2.1 topologyEvidence 强弱规则
- [x] §8 调查项
- [x] CQ-A2 阻断
- [x] CQ-O1b 设计方向、unmapped、retention 原则

### 12.2 CQ-O0 — 双轨签收

**Phase 1 RPC（✅ 实现通过 — CQ-O0 overall complete）：**

- [x] `doctor.memory.health` / `.tenant` / `.summary` RPC 注册（专家已确认）
- [x] `PLATFORM_SCOPE = operator.platform` + READ 分离（专家已确认）
- [x] T-8 / scope-denied harness（专家已确认）
- [x] P1 修复：RPC 集成测试走真实 `runOpsHealthProbe`（DI，无全局 mock 泄漏）
- [x] P1 修复：`probeModuleSha` 来自 `dist/build-info.json` / 已发布 `.js`，不读 `.ts`
- [x] P2 修复：`listAgentProbeWatchPaths` 在 integrity 采集前确定
- [x] agent/node session token 负向：403 + 顶层 `reasonCode=scope.denied` / `reason`（不再放 `details`）
- [x] handler 级跨租户：tenant A 请求 tenant B agent → `HealthReportScopeDenied`，不调用 probe
- [x] AC-O0-4 固定 snapshot fixture（canonical + sha256 入库复算）
- [x] HealthReport TypeBox union schema（AC-O0-1）
- [x] Phase 1 完整验收签收（handoff 2026-08-18：Phase 1 实现通过）
- [x] Phase 1 方法分类：`doctor.memory.health*` 不在 READ_SCOPE
- [x] 当前工作树 `method-scopes.test.ts` 全绿（既有未分类方法已由其他任务补齐；**不属于本 Phase 所有权**）

**首个代码 checkpoint（⚠️ 有条件通过）：**

- [x] 独立 read-only probe（`health-probe.ts` 未 import manager/chokidar/memory-schema）
- [x] HealthReport success/error union（§6.3.1）；`scope.denied` 最小 envelope
- [x] Probe snapshot hash 算法（§6.4.2）；`canonicalizeProbeSnapshot` 固定字段序
- [x] 三层 CI guard（Oxlint + DI factory + spy）
- [x] T-1..T-8 + RPC scope 映射

**CQ-O0 阶段状态：** Phase 0 实现通过；Phase 1 实现通过；implementation 轨道通过；**生产 evidence 已归档（2026-08-19 窗口 `passed`），CQ-O0 complete**。

**Production Evidence Capture（✅ Complete）：**

- [x] 操作员指定（`ceo` / CEO）
- [x] 采集时间窗口（`2026-08-19T00:40:00+08:00/2026-08-19T01:10:00+08:00`）
- [x] 运行身份确认（授权 inspect `.Id` + `build-info.commit=34595862f785…` 匹配）
- [x] 归档路径确认
- [x] 首份脱敏 evidence（见 `docs/design/evidence/conversation-memory-cq-o0/2026-08-18/`）

### 12.3 CQ-O1a — **DESIGN APPROVED / IMPLEMENTATION COMPLETE**

- [x] CQ-O0 prod evidence
- [x] §7.1.6 operation-boundary design review Approved（#500）
- [x] 10 场景矩阵纳入 CI
- [x] CQ-O1a implementation complete（#506：S1–S10 绿；未越权改写路径）

### 12.4 CQ-O1b — 设计 Accepted / 实现 Blocked

- [x] 设计方向
- [ ] golden fixture + `single_owner` provisional 决议
- [ ] capability matrix JSON Schema
- [ ] **禁止实现 PR 合并**

---

## 13. 附录

### A. 关键路径

| 领域               | 路径                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| v1-root-guard      | `src/memory/v1-root-guard.ts`                                                                         |
| onSearch 实现      | `src/memory/manager.ts:278` → `scheduleAuthorizedSearchSync`（`src/memory/manager-sync-ops.ts:1448`） |
| acquireSyncAuth    | `src/memory/acquire-sync-auth.ts`（#506）                                                             |
| method scopes      | `src/gateway/method-scopes.ts`                                                                        |
| decision-engine    | `src/gateway/collaboration-dispatch/decision-engine.ts`                                               |
| **CQ-O0 首个 PR**  | `src/memory/health-probe.ts`                                                                          |
| O1a 设计/实现      | `docs/design/memory-search-operation-boundary-2026-08-18.md`（#500 Approved / #506 Implemented）      |
| CQ-O0 历史采集指令 | `docs/design/conversation-memory-cq-o0-cursor-handoff-2026-08-18.md`（**已废止**；不得重跑）          |
| capability schema  | `docs/design/schemas/collaboration-message-capability/v1.json`（待建）                                |

### B. 修订历史

| 版本       | 日期       | 说明                                                                                                                    |
| ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| rev.1      | 2026-08-18 | 初稿                                                                                                                    |
| rev.2      | 2026-08-18 | 实现契约修正                                                                                                            |
| rev.3      | 2026-08-18 | 四项 CQ-O0 补充                                                                                                         |
| rev.4      | 2026-08-18 | 复审基线：O0 impl/prod 双轨；HealthReport union；snapshot 算法；operation-boundary 前置；retention                      |
| rev.4.1    | 2026-08-18 | ops/summary 类型分离；scope.denied 最小 envelope；canonicalizeProbeSnapshot                                             |
| rev.4.1.1  | 2026-08-18 | 首个代码 checkpoint 有条件通过；T-8/RPC deferred；生产 gate 继续阻断                                                    |
| rev.4.1.2  | 2026-08-18 | Phase 1 RPC：`doctor.memory.health` + scope 映射 + T-8/负向 harness                                                     |
| rev.4.1.3  | 2026-08-18 | Phase 1 首次验收阻断后的修复：真实 probe 集成、build-info SHA、watch path 预采集                                        |
| rev.4.1.4  | 2026-08-18 | Phase 1 复验补丁：403 顶层字段、跨租户 RPC envelope、AC-O0-4 fixture                                                    |
| rev.4.1.5  | 2026-08-18 | Phase 1 实现签收通过；生产采集 fail-closed（`window_closed`）；CQ-O0 overall 仍未 complete                              |
| rev.4.1.6  | 2026-08-18 | 本地落地 `openbot memory health --json --redact` 与归档脱敏函数；生产镜像仍无此 CLI；CQ-O0 overall 仍未 complete        |
| rev.4.1.7  | 2026-08-18 | 生产镜像+新窗口采集 fail-closed：`delivery_gate`（CLI 不在 origin/main；共享脏树不可作镜像源）                          |
| rev.4.1.8  | 2026-08-19 | #494 合入主干后 gateway-dist-keep-ui overlay；2026-08-19 窗口生产采集 passed；CQ-O0 complete；O1a 仍阻断                |
| rev.4.1.9  | 2026-08-19 | #500 批准 O1a operation-boundary；实现授权（未标 CQ-O1a complete）                                                      |
| rev.4.1.10 | 2026-08-19 | #506 合入；CQ-O1a implementation complete；废止 CQ-O0 cursor handoff 执行指令；O1b 仍 blocked；`deployAuthorized=false` |

---

## 14. 下一步行动（rev.4 唯一授权）

| #        | 行动                                                                           | 负责                     | 状态                                                                                  |
| -------- | ------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------- |
| 1        | **`health-probe.ts` + T-1..T-7 + 三层 CI guard**                               | cursor-memory-wsc        | ✅ Phase 0 实现通过                                                                   |
| 2        | HealthReport union 类型 + snapshot hash 实现                                   | cursor-memory-wsc        | ✅ 已交付（checkpoint 内）                                                            |
| 3        | RPC scope + T-8 + 负向测试                                                     | cursor-memory-wsc + DGV2 | ✅ Phase 1 实现通过                                                                   |
| 4        | 镜像内置 CLI                                                                   | cursor-memory-wsc        | ✅ origin/main `34595862f785` gateway-dist-keep-ui overlay；`memory health` 已在 LIVE |
| 5        | **人类指定**：生产操作员 + 时间窗口                                            | 操作员                   | ✅ `2026-08-19T00:40:00+08:00/2026-08-19T01:10:00+08:00`；采集 passed                 |
| 6        | operation-boundary 设计文档                                                    | cursor-memory-wsc        | ✅ #500 Approved                                                                      |
| 6a       | O1a 实现：`acquireSyncAuth` + S1–S10                                           | cursor-memory-wsc        | ✅ #506 complete（`6c20a36170f76c4bc34e27e34b01ef9d7372618e`）                        |
| 7        | decision-engine golden fixture **设计**                                        | collaboration owner      | O1b                                                                                   |
| **禁止** | UI、Resolver write、schema v2、Catalog、O1b/A2 实现、U1 Handle 接线、回退 #506 | —                        | —                                                                                     |

---

_rev.4.1.10：Architecture and governance boundaries accepted. CQ-O0 complete. CQ-O1a design Approved via #500; implementation complete via #506. CQ-O1b design accepted, implementation blocked (golden fixture / capability schema). CQ-A2 independently blocked. U0 is a parallel track and does not replace this plan._

_本文档不代表 `deployAuthorized=true` 或任何 LIVE migration 授权。_
