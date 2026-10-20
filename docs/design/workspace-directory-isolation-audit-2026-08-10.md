# OpenBot 工作区目录隔离 — 架构核查报告（专家验收稿）

| 字段                 | 内容                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **状态**             | **有条件通过**（v1.4.2 · **文档方向通过；证据摘要有条件通过；探针门禁已按复审阻断项加固，待复验；实施基线不通过**）                                                                                                                                           |
| **日期**             | 2026-08-10 · v1.4.1 → **v1.4.2（探针：realpath 物理边界 / 全局 MAX_FILES / --compare 完整门禁 / summary.limits）**                                                                                                                                            |
| **核查范围**         | SaaS 托管 Gateway 工作区物理布局与运行时解析路径                                                                                                                                                                                                              |
| **生产样本（脱敏）** | host `<production-gateway-host>` · container `<gateway-container>` · tenant `<sample-tenant>` · user `<sample-user>`                                                                                                                                          |
| **证据编号**         | 历史 `workspace-isolation-20260810-001`；探针门禁复审夹具 `workspace-isolation-20260812-v142-gate`（见 [v142 gate summary](./evidence/workspace-isolation-20260812-v142-gate.summary.json) · [handoff](./evidence/workspace-isolation-v142-gate-handoff.md)） |
| **核查性质**         | 只读代码对照 + 生产只读盘点；**未**执行目录合并或写路径切换                                                                                                                                                                                                   |
| **读者**             | 平台架构、安全评审、Gateway、运维、产品                                                                                                                                                                                                                       |

---

## 0. 审查与签署结论

### 0.0 当前签署立场

| 项                                            | 内容                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **签署结论**                                  | **有条件通过，修改后复审** — **不得**作为最终实施方案直接签署                                                                                                                                                                                                     |
| **方向**                                      | 路径分裂、无「企业共享机器人」、岗位可交接、协作走小组 — **通过**                                                                                                                                                                                                 |
| **证据摘要**                                  | **有条件通过**（脱敏 summary + evidence-id；历史计数依赖受控 raw/snapshot）                                                                                                                                                                                       |
| **探针脚本**                                  | **待复验**（v1.4.2：`realpath` 物理边界；全局 `MAX_FILES`；`--compare` 含 truncated/errorCount/scriptSha256/probeUtc/limits；summary 保留 `limits`）                                                                                                              |
| **实施基线**                                  | **不通过** — C1–C19 工程项未闭合；**C19 不得关闭**直至受控环境按 §4.4 复验通过                                                                                                                                                                                    |
| **v1.4.2 探针门禁（相对 v1.4.1 复审阻断项）** | ① 符号链接物理越界：`realpath` + `lstat`，禁止仅 `path.resolve/relative` + 跟随链接的 `statSync` ② `--compare` 必须比对 `stats.truncated` / `errorCount` / `probe.scriptSha256` / `probeUtc` / `limits` ③ `MAX_FILES` 跨分类全局累计 ④ 脱敏 summary 输出 `limits` |

### 0.0a 正式产品前提

> **OpenBot 没有「企业共享机器人」核心类别。**  
> `scope:"shared"` + `ownerType:"position"` = **岗位可交接 AgentAsset**（单一责任使用者）。  
> **机器人协作 / 多人共同调用 / 团队任务执行** → 仅 Collaboration Group。  
> 企业知识、制度、策略、只读模板等租户共享数据 **允许**（非机器人共享）。

#### 服务端分类结果（fail-closed · C14）

```ts
type OwnershipProof =
  | { source: "registry"; ownerType: "user" | "membership"; ownerId: string; agentAssetId: string }
  | { source: "explicit_binding"; ownerType: "user"; ownerId: string; agentAssetId: string };

type ClassificationResult =
  | { kind: "employee_private"; userId: string }
  | { kind: "user_owned"; userId: string; proof: OwnershipProof }
  | { kind: "position_owned"; agentAssetId: string; seatId: string }
  | { kind: "group_owned"; groupId: string }
  | { kind: "unknown"; reason: string };
```

| 分类                 | 判定（必须有正向证明）                                                                      | 目标存储                                               |
| -------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **employee_private** | 内置 steward 会话形态命中（`extractEmployeeStewardUserIdFromSessionKey` 等）                | `users/<userId>/OpenBot/agents/main/…`                 |
| **user_owned**       | **明确** user/membership owner binding + `agentAssetId`（`OwnershipProof`）                 | `users/<userId>/OpenBot/agent-assets/<agentAssetId>/…` |
| **position_owned**   | Registry **成功加载**且 `primaryOwner.ownerType === "seat"`（含 `seatId` + `agentAssetId`） | `tenants/<tenantId>/agent-assets/<agentAssetId>/…`     |
| **group_owned**      | 协作空间 groupId + ACL                                                                      | `collaboration/groups/<groupId>/…`                     |
| **unknown**          | Registry 缺失/损坏/读取失败、无绑定、冲突、歧义                                             | **阻断写入**；迁移进隔离清单                           |

**硬规则：**

- 「找不到岗位绑定」**≠** user_owned。
- Registry 文件缺失/损坏时加载器返回空仓（`loadAgentRegistryStore` catch → empty）——分类层必须把该情况标为 **`unknown` 并阻断写入**，不得当成「无 seat → 个人」。

```21:42:src/gateway/agent-registry/store.ts
/**
 * Loads the registry, tolerating a missing or malformed file by returning an empty
 * store. Reads never throw, so an authorization path can always evaluate (and, with
 * no assets, fail closed) instead of erroring out.
 */
export async function loadAgentRegistryStore(
  storePath = resolveAgentRegistryStorePath(),
): Promise<AgentRegistryStore> {
  try {
    // ...
  } catch {
    return createEmptyAgentRegistryStore();
  }
}
```

> 注：空 Registry 对**授权列表**可 fail-closed；对**资产分类/写路径选择**若把「无记录」当成 user_owned 则变成 **fail-open 写串目录**。分类器必须区分这两种语义。

**禁止：** 用 `agentId === "main"` 或路径猜测分类。

#### 三类关系模型

| 模型              | 目的                 | 使用关系                                             |
| ----------------- | -------------------- | ---------------------------------------------------- |
| 个人 / 岗位机器人 | 日常工作             | 唯一责任使用者                                       |
| 交接与继承        | 轮岗/离职            | AgentAsset 长期资产可继承；user interaction 默认不转 |
| 协作小组          | 机器人协作与团队执行 | ACL；不吞并 Primary                                  |

### 0.1 一句话结论

**方向正确；实施仍不可签。分类必须 fail-closed（unknown 阻断写）；全体普通机器人（含个人）以稳定 `agentAssetId` 为存储主键；岗位 cwd 与私人草稿靠写入协议分离；inheritMode 语义冻结；仓库正文脱敏并以可执行探针 + 证据编号复验。**

### 0.2 意图对照（摘要）

| 意图                           | 现状                                                      | 判定                              |
| ------------------------------ | --------------------------------------------------------- | --------------------------------- |
| 分类 fail-closed               | 「无 seat」易被当成 user-owned；Registry 故障返回空仓     | ❌ C14                            |
| 稳定 AgentAsset 存储           | 岗位有 assetId；个人仍绑可变 agentId                      | ❌ C16                            |
| 写协议区分岗位成果 vs 私人草稿 | 仅目录定义，工具默认可写进可继承树                        | ❌ C17                            |
| inheritMode 冻结               | 代码默认 `full`，语义未定义                               | ❌ C18                            |
| P0-A/B + 受控打开              | 共享根无校验扫描仍在                                      | ❌ C1                             |
| 证据可复验且脱敏               | 正文/summary 已脱敏；探针 v2 支持 raw/redacted 与派生比对 | ⚠️ C15 文档侧通过；C19 待受控复审 |

### 0.3 安全总评

| 维度                          | 评级           |
| ----------------------------- | -------------- |
| P0-A 共享根读取               | **危**         |
| P0-B 全租户枚举               | **危**         |
| 分类 fail-open → 写串个人目录 | **危**         |
| 迁移无归属 / steward 误交接   | **危**         |
| cwd 把草稿写入可继承树        | **高**         |
| full 默认吞并私人历史         | **高**         |
| 仓库泄露生产标识              | **高（合规）** |

### 0.4 解除条件（C1–C19）

| #       | 条件                                                                                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1**  | 去无校验共享根扫描 + 受控打开（artifactId / capability / 显式投递 / 非文件名映射）                                                                                                                                   |
| **C2**  | 候选根仅权威 tenant + 正确资产键                                                                                                                                                                                     |
| **C3**  | 写/D7/读原子切换；回滚不造双主                                                                                                                                                                                       |
| **C4**  | 废除企业共享机器人类别表述                                                                                                                                                                                           |
| **C5**  | 协作 TenantContext + 与 Primary 物理分离 + 双租户同 groupId 测                                                                                                                                                       |
| **C6**  | 证据以 evidence-id + 脱敏 summary + 受控原文包管理（仓库无真实主机/UUID）                                                                                                                                            |
| **C7**  | 共享根负向测试                                                                                                                                                                                                       |
| **C8**  | 岗位 Primary = `agentAssetId`                                                                                                                                                                                        |
| **C9**  | 分类不靠 agentId 猜测                                                                                                                                                                                                |
| **C10** | 迁移归属元数据；unknown 不自动继承                                                                                                                                                                                   |
| **C11** | D1c：岗位 SoT = `agentAssetId`                                                                                                                                                                                       |
| **C12** | 私人会话默认不转；选择性授权+审计；禁止无分类吞历史                                                                                                                                                                  |
| **C13** | 可执行只读探针 + 固定 schema + script SHA + 脱敏结果（见 §4 / scripts）                                                                                                                                              |
| **C14** | Registry 缺失/损坏/歧义 → `unknown`，**不得**回退 user_owned；unknown **阻断写入**                                                                                                                                   |
| **C15** | 仓库正文与 summary 脱敏；真实标识仅受控审计系统                                                                                                                                                                      |
| **C16** | 普通个人机器人亦用稳定 `agentAssetId`（路径见 §2.1）；steward 为系统例外                                                                                                                                             |
| **C17** | user draft → publish/promote → position artifacts 协议 + 工具写入能力门禁                                                                                                                                            |
| **C18** | 冻结 `full` / `selective` / `omitted`（§2.4）；含旧客户端与 pending offer                                                                                                                                            |
| **C19** | 探针满足生产受控门禁：safe segment + containment；stdout-only；raw/redacted；确定性 summary 派生/比对；`summarySha256` 算法可复算；`PROBE_AT`；扫描资源上限与 `truncated/errors/bytesRead`；受控环境按 §4.4 复验通过 |

---

## 1. 文档目的

回答：现状是否符合架构与岗位语义？多目录根因？安全是否阻断扩读？**实施基线可否签署？** → **否（至 C19）**。

关联：[Data Space](./openbot-data-space-model-v1-2026-07-10.md) · [SaaS 租户架构](./openbot-saas-tenant-data-architecture.md) · [租户上下文](./tenant-context-propagation-plan-2026-07-11.md) · [Isolation hard rules](./isolation-layers-hard-rules-2026-08-06.md) · [Seat binding](./agent-seat-binding-tenant-isolation-2026-08-04.md)

---

## 2. 目标态模型（v1.4）

### 2.1 存储布局（全体普通机器人 = AgentAsset）

```text
tenants/<tenantId>/
├── agent-assets/<agentAssetId>/                 # position-owned Primary SoT
│   ├── workspace/                               # 岗位业务执行 cwd
│   ├── memory/                                  # 已批准可继承
│   └── artifacts/                               # 正式成果（含 promote 后）
├── users/<userId>/OpenBot/
│   ├── agents/main/…                            # employee_private steward（系统例外）
│   ├── agent-assets/<agentAssetId>/             # user_owned 个人机器人 Primary
│   │   ├── workspace/
│   │   ├── memory/
│   │   └── artifacts/
│   └── agent-interactions/<agentAssetId>/       # 对某机器人的私人交互（默认不继承）
│       ├── conversations/
│       ├── drafts/                              # 未提交草稿
│       └── personal-memory/
└── collaboration/groups/<groupId>/              # 机器人协作 / 团队执行
```

**绑定：** `positionId → agentAssetId[]`（换岗改绑定，默认不搬盘）。  
**运行时：** `agentId` 仅为 slug；经 **tenant-scoped 精确映射** → `agentAssetId`。

### 2.2 写入协议（C17 · 解决 cwd 与私人草稿矛盾）

| 通道                                        | 用途                                                         | 谁可写                                         |
| ------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- |
| **position / personal Primary `workspace`** | 业务执行、岗位/个人长期上下文、正式工作文件                  | 仅对应资产的授权工具能力（如 `write.primary`） |
| **`agent-interactions/…/drafts` 等**        | 私人会话、未提交草稿、个人备注                               | 仅 `write.interaction`；**默认不随岗继承**     |
| **`publish` / `promote`**                   | user draft → 审批/提交 → 目标资产 `artifacts/`（或批准记忆） | 显式 RPC/工具；留下审计                        |

**规则：**

1. 岗位会话默认 cwd = `tenants/…/agent-assets/<id>/workspace`。
2. 模型**不能**靠任意相对路径把草稿写进 Primary 并自称「私人」。
3. 需要私人草稿时，工具层必须切换到 interaction 根（或专用 tool），而非「同一 cwd 靠约定」。
4. 进入可继承面的唯一正规路径 = **promote/publish**（或管理员批准的记忆晋升）。

### 2.3 文件归属元数据（迁移 · C10）

```json
{
  "assetKind": "position" | "personal" | "group" | "employee_private" | "unknown",
  "tenantId": "…",
  "ownerUserId": "…",
  "seatId": "…",
  "agentAssetId": "…",
  "sourceSessionKey": "…",
  "classification": "business_deliverable" | "approved_memory" | "private_session" | "private_draft" | "credential_ref" | "other",
  "approvedForHandover": false
}
```

`unknown` → 隔离清单人工裁决；**禁止**默认迁入岗位 Primary。

### 2.4 inheritMode 冻结（C18）

对齐并收紧 `enterprise-seat-assets-store` 中 `inheritMode: "full" | "selective"`（今日默认 `full`）：

| 值                          | 含义                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **`full`**                  | 交接**全部岗位资产**（AgentAsset workspace/memory/artifacts 中已分类可继承部分）。**永远不含**任何 user-private / agent-interactions 数据 |
| **`selective`**             | 岗位资产**子集** + **经批准**的业务会话（asset_review + 授权 + 审计）                                                                     |
| **`omitted`**（客户端未传） | 服务端按 **`selective-safe`** 默认：等同保守 selective（默认不转会话；仅明确岗位资产子集策略）                                            |
| **历史 pending offer**      | 以创建时写入的 mode 解释；若 mode=`full`，执行时仍**剥离** user-private；若无法证明岗位归属则跳过并审计告警                               |

**禁止：** full = 复制前任全部用户历史。  
**验收：** 默认拒绝私人会话、选择性批准、审计、原用户撤权。

### 2.5 协作与 I-W8

**I-W8（修订保留）：** 机器人协作与团队执行共享仅通过协作小组；Group 与 Primary 物理/权限分离；显式投递。不禁止企业知识等租户共享数据。

### 2.6 不变量（增量）

| ID        | 内容                                                                         |
| --------- | ---------------------------------------------------------------------------- |
| **I-W7**  | 岗位 Primary 绑定 `agentAssetId`，不绑当前 userId；**不适用于** steward      |
| **I-W8**  | 见上                                                                         |
| **I-W9**  | managed 仅权威 tenant                                                        |
| **I-W10** | 分类不靠 agentId 猜测；unknown 不自动继承                                    |
| **I-W11** | 分类 fail-closed：Registry 故障/缺失/冲突 → unknown，**阻断写入**            |
| **I-W12** | 普通机器人（非 steward）一律稳定 `agentAssetId` 物理根；agentId 仅运行时映射 |
| **I-W13** | 可继承写入仅经 primary 授权能力或 promote/publish；interaction 默认不可继承  |

---

## 3. 实然（摘要）

- 员工 steward → `employees/<uid>/workspace`（employee_private 意图正确）。
- D7 → 扁平 `users/…/workspace`。
- 岗位创建已写 Registry `agentAssetId` + seat owner，**盘上未统一**。
- `workbench.steward-file.read`：无校验 canvas/host-skill + 枚举全部租户（P0-A/B）。
- 协作 store 无 TenantContext。
- `inheritMode` 默认 `full`（`enterprise-seat-assets-store.ts`）。

---

## 4. 生产证据（脱敏 · 可复验）

### 4.1 证据指针

| 字段                                | 值                                                                                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **evidence-id（历史）**             | `workspace-isolation-20260810-001`（v1.4.1 前产物；**不得**作为 v1.4.2 `--compare` 期望）                                                                                              |
| **evidence-id（门禁夹具）**         | `workspace-isolation-20260812-v142-gate`（[summary](./evidence/workspace-isolation-20260812-v142-gate.summary.json) · [handoff](./evidence/workspace-isolation-v142-gate-handoff.md)） |
| **仓库摘要（历史）**                | [docs/design/evidence/workspace-isolation-20260810-001.summary.json](./evidence/workspace-isolation-20260810-001.summary.json)                                                         |
| **探针脚本**                        | [scripts/audit/workspace-isolation-probe.mjs](https://github.com/upbeyond/openbot/blob/main/scripts/audit/workspace-isolation-probe.mjs)                                               |
| **scriptSha256**                    | `a6fcf2ad9c8ca2983290c2618275be899efc2f9a596df7d3e1205489f087b5dc`                                                                                                                     |
| **raw schema**                      | `workspace-isolation-probe/v2`（`--mode raw-controlled`）                                                                                                                              |
| **summary schema**                  | `workspace-isolation-evidence-summary/v1`（`--mode summary-redacted`）                                                                                                                 |
| **PROBE_AT / probeUtc（历史）**     | `2026-08-10T00:18:54Z`                                                                                                                                                                 |
| **PROBE_AT / probeUtc（门禁夹具）** | `2026-08-12T07:00:00Z`                                                                                                                                                                 |
| **受控原文包**                      | `<controlled-audit-store>` / `workspace-isolation-20260810-001-raw`（**不入 git**）                                                                                                    |

### 4.2 路径分类计数（脱敏 pattern）

| 类           | pathPattern                                                                | deliverableCount | recentCount(14d) |
| ------------ | -------------------------------------------------------------------------- | ---------------- | ---------------- |
| A_employee   | `{stateDir}/agents/main/employees/<sample-user>/workspace`                 | 39               | 28               |
| B_flat_l2    | `{stateDir}/tenants/<sample-tenant>/users/<sample-user>/OpenBot/workspace` | 27               | 25               |
| C_agent_main | `…/OpenBot/agents/main/workspace`                                          | 16               | 16               |
| D_skill_l2   | `…/OpenBot/workspace-bot-skill`                                            | 506              | 499              |
| E_skill_host | `{stateDir}/workspace-bot-skill`                                           | 35               | 35               |
| F_canvas     | `{stateDir}/canvas`                                                        | 4                | 3                |

集群（摘要）：tenants **10** · user_dirs **50**。

### 4.3 跨类哈希冲突（节选）

仓库 summary 中 basename 已脚本内脱敏为 `file-<sha12>.<ext>`；比对请用内容指纹（classId+sha256+size）。完整矩阵见 evidence summary JSON。

> **历史复现说明：** 对**当前**生产目录重跑只能验证「现状」。复现本 evidence-id 的计数/矩阵需要 `PROBE_AT=2026-08-10T00:18:54Z` **以及**对应时点的只读快照或受控 raw bundle。

### 4.4 复验步骤（可执行 · stdout-only）

在**受控审计环境**执行（shell 负责把 stdout 重定向到 `/tmp` 或采集器；**禁止**把输出写进 `OPENBOT_STATE_DIR`）：

```bash
# 1) 校验探针脚本未被篡改
shasum -a 256 scripts/audit/workspace-isolation-probe.mjs
# 期望: a6fcf2ad9c8ca2983290c2618275be899efc2f9a596df7d3e1205489f087b5dc

# 2) raw-controlled（含真实 tenant/user — 仅受控库留存）
OPENBOT_STATE_DIR="<stateDir-from-controlled-snapshot>" \
SAMPLE_TENANT="<sample-tenant>" \
SAMPLE_USER="<sample-user>" \
PROBE_AT=2026-08-10T00:18:54Z \
RECENT_DAYS=14 \
node scripts/audit/workspace-isolation-probe.mjs --mode raw-controlled \
  > /tmp/workspace-isolation-20260810-001.raw.json

# 3) 确定性派生 redacted summary，并与**同代**仓库摘要比对门禁字段
# 注意：历史 `001.summary.json` 为 v1.4.1 前产物（旧 scriptSha256、无 limits）；
# v1.4.2 `--compare` 会因 scriptSha256/limits 缺失而失败——应用新 evidence-id 落盘后再比。
cat /tmp/workspace-isolation-20260810-001.raw.json \
  | node scripts/audit/workspace-isolation-probe.mjs \
      --mode summary-redacted \
      --evidence-id workspace-isolation-20260810-v142 \
      > /tmp/workspace-isolation-20260810-v142.summary.derived.json
```

**安全属性（脚本强制）：**

- `SAMPLE_TENANT` / `SAMPLE_USER` 必须是单一安全路径段（拒绝 `.` / `..` / `/` / `\` / NUL）
- 所有扫描根与条目使用 **`realpath` 物理 containment**（`lstat` 检测符号链接；越界链接记入 `errors` 且不纳入交付物）
- **无** `OUTPUT_PATH` / **无** `writeFileSync`；仅 stdout
- `raw-controlled` 含真实身份；`summary-redacted` 在脚本内替换 tenant/user，并将 basename 变为 `file-<sha12>.<ext>`，并保留 `limits`
- 默认上限：`MAX_FILES=20000`（**跨分类全局累计**）、`MAX_DEPTH=24`、`MAX_BYTES_READ=256MiB`；输出 `stats.truncated` / `errorCount` / `seenFiles` / `bytesRead`
- `--compare` 必须同时匹配：`pathSummary` / `cluster` / 重复内容指纹 / `stats.truncated` / `stats.errorCount` / `limits` / `probeUtc` / `probe.scriptSha256`

### 4.5 `summarySha256` 算法（规范性）

```text
summaryWithoutSha = clone(summary); delete summaryWithoutSha.summarySha256
bytes = UTF-8( JSON.stringify(summaryWithoutSha, null, 2) + "\n" )
summarySha256 = SHA-256(bytes)
```

- 序列化必须使用 **Node `JSON.stringify(obj, null, 2)`** 与脚本产出的**键插入顺序**（勿用任意 jq pretty-print 变体冒充同一摘要，除非已验证字节级一致）。
- 仓库 summary 字段 `summarySha256Algorithm` 重复记载该算法。
- 校验示例：

```bash
node -e '
const fs=require("fs"); const crypto=require("crypto");
const j=JSON.parse(fs.readFileSync("docs/design/evidence/workspace-isolation-20260810-001.summary.json","utf8"));
const expect=j.summarySha256; delete j.summarySha256;
const got=crypto.createHash("sha256").update(JSON.stringify(j,null,2)+"\n").digest("hex");
if (got!==expect) { console.error("mismatch", {expect,got}); process.exit(1); }
console.log("summarySha256 ok");
'
```

---

## 5. 根因（增量）

```text
Registry load 失败 → 空仓
  →「无 seat 绑定」被当成 user_owned   ← fail-open（C14）
打开成果 → 共享根文件名扫描           ← P0-A
岗位/个人路径未统一到 agentAssetId     ← C16
默认 cwd=Primary 且无 write 通道门禁    ← 草稿进可继承树（C17）
inheritMode 默认 full 语义不清         ← C18
```

---

## 6. 风险登记（增量）

| ID          | 风险                                   | 严重度     |
| ----------- | -------------------------------------- | ---------- |
| **P0-A/B**  | 共享根 / 全租户枚举                    | 危         |
| **R16**     | Registry 空仓 → 岗位机器人写入用户目录 | **危**     |
| **R12/R13** | 迁移误分类 / 无元数据继承              | 危         |
| **R17**     | 工具默认写 Primary 污染可继承面        | 高         |
| **R14**     | full 吞私人历史                        | 高         |
| **R18**     | 仓库提交真实生产标识                   | 高（合规） |

---

## 7. 收敛方案（草案）

### 7.1 解析

```ts
// agentId → agentAssetId via tenant-scoped map (exact); miss → unknown (no write)
// ClassificationResult as §0.0a; unknown blocks resolvePrimaryWorkspace for writes
```

### 7.2 P0-A/B DoD

去文件名扫描共享根 **∧** 受控打开仍可用（artifactId / capability / 显式投递 / ID 映射）。

### 7.3 阶段

P0 热修 → 分类器 fail-closed + AgentAsset 路径原子切换 → 带元数据迁移 → 写入协议/工具能力 → inheritMode 兼容 → 组租户化。

### 7.4 回滚

整包原子回退；禁止恢复无校验共享根扫描；禁止把 unknown 当 user_owned。

---

## 8. 决策点（预填）

| ID      | 决议                                                            |
| ------- | --------------------------------------------------------------- |
| **D1c** | 岗位 SoT = `tenants/…/agent-assets/<agentAssetId>`              |
| **D1g** | 个人 SoT = `users/…/OpenBot/agent-assets/<agentAssetId>`（C16） |
| **D1e** | steward = `users/…/agents/main/…` 系统例外                      |
| **D11** | 分类：无正向证明 → unknown；Registry 故障 → unknown             |
| **D12** | 写入协议 §2.2；promote 唯一正规晋升路径                         |
| **D13** | inheritMode：`full`/`selective`/`omitted` 按 §2.4               |
| **D14** | 仓库仅 evidence-id + 脱敏 summary；原文受控库                   |

---

## 9. 验收清单

### 9.1 文档

- [x] 方向通过（语义 + P0 风险意识）
- [x] 分类 fail-closed 类型与 C14
- [x] 正文脱敏 + evidence-id
- [x] 个人/岗位双 AgentAsset 布局
- [x] 写入协议 / inheritMode 冻结文案
- [x] 探针 v2 门禁文案（safe segment / stdout-only / raw·redacted / PROBE_AT / limits / summarySha256）
- [x] 脱敏 summary + evidence-id（有条件通过）
- [ ] 探针受控环境复审勾选「通过」（C19）
- [ ] **实施基线签署**：C1–C19 工程与兼容落地后复审

### 9.2 工程（未勾选 = 未完成）

- [ ] C1–C12、C14–C18 实现与测试
- [ ] C13/C19：受控快照上按 §4.4 复跑 raw→summary→compare，并归档 raw bundle
- [ ] C15：合并前确认本文件与 summary 无真实主机/用户 UUID

---

## 10. 附录

### A. 路径速查

```text
steward:     users/<userId>/OpenBot/agents/main/...
personal:    users/<userId>/OpenBot/agent-assets/<agentAssetId>/...
position:    tenants/<tenantId>/agent-assets/<agentAssetId>/...
interaction: users/<userId>/OpenBot/agent-interactions/<agentAssetId>/...
group:       tenants/<tenantId>/collaboration/groups/<groupId>/...
```

### B. 修订历史

| 版本       | 说明                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0–v1.2  | 分裂态、P0、岗位语义（含 steward 误判，已废）                                                                                                              |
| v1.3       | 分类表、AgentAsset 岗位 SoT、C9–C13                                                                                                                        |
| v1.4       | fail-closed 分类、脱敏、全量 AgentAsset、写入协议、inheritMode、C14–C19                                                                                    |
| **v1.4.1** | **探针加固**：safe segment + containment；删除 OUTPUT_PATH；raw/redacted；summary 派生与 `--compare`；`summarySha256` 算法；`PROBE_AT`；扫描上限与错误报告 |
| **v1.4.2** | **复审阻断项**：`realpath` 物理边界；全局 `MAX_FILES`；`--compare` 强制 stats/errorCount/scriptSha256/probeUtc/limits；summary 保留 `limits`               |

---

## 11. 签署栏

| 角色           | 结论                                                                | 日期       |
| -------------- | ------------------------------------------------------------------- | ---------- |
| 安全 / 架构    | **文档方向通过 · 证据摘要有条件通过 · 探针待复审 · 实施基线不通过** | 2026-08-10 |
| 产品           | 方向通过（§0.0a）                                                   | 2026-08-10 |
| Gateway / 运维 | 待 C1–C19 / 探针受控复验                                            |            |

**最终意见（采纳并跟进）：** 架构正文维持「产品语义与安全方向通过」；证据摘要有条件通过；探针在 **v1.4.2** 已关闭上一轮门禁阻断项（物理越界 / compare 证据不全 / MAX_FILES 分类重置 / summary 缺 limits），**须受控环境按 §4.4 复验后方可标通过**；**C19 不得关闭**；整体**实施基线继续不通过**。
