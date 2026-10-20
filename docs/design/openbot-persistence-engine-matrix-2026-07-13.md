# OpenBot 持久化引擎矩阵（架构附录）

> **状态**：草案 → 建议并入 `openbot-saas-tenant-data-architecture.md` 附录  
> **日期**：2026-07-13  
> **关联**：OQ-1（L1 JSON vs SQLite）、tenant-context-propagation、Data Space、agent-growth / AI workforce governance  
> **一句话**：OpenBot **不是**「全站 SQL」或「全站 JSON」二选一；而是 **按数据类选引擎**，隔离键优先于引擎。

---

## 1. 原则（冻结建议）

### 1.1 三类数据（新增 store 必须声明一类）

| 类 ID | 名称                  | 典型诉求                                    | **默认引擎**                                              | 反模式                   |
| ----- | --------------------- | ------------------------------------------- | --------------------------------------------------------- | ------------------------ |
| **D** | Document / 控制面文档 | 整图读写、import/export、低频更新、租户分片 | **JSON 文件**（原子写 + 锁）                              | 无查询需求却上共享 SQL   |
| **Q** | Query / 索引与流水    | FTS、向量、高基数 append、按条件过滤        | **嵌入式 SQLite**（per-agent / per-kb / per-tenant 文件） | 大表塞进单 JSON 反复重写 |
| **E** | Ephemeral / 运行时    | 热会话、可重建 cache                        | **文件**（json / jsonl）                                  | 把 L3 当唯一真相源做迁移 |

### 1.2 引擎阶梯（12–24 个月）

```text
现在 ──►  per-tenant / per-agent 分片文件（JSON 为主 + SQLite 局部）
         │
下一阶 ──►  L1 热点域 optional SQLite 后端（seat-assets 已具备）
         │
再后  ──►  仅 L0 平台分析 / 跨租户报表 / 合规审计 考虑托管 SQL
```

**不在 v1 范围**：默认中心化 Postgres/RDS 吃掉 L1/L2/L3。

### 1.3 与 OQ-1 对齐

| 裁决                          | 含义                                                 |
| ----------------------------- | ---------------------------------------------------- |
| **P3 前 L1 = JSON 分片**      | 与当前 SaaS / 共享 Gateway 一致                      |
| **量大后迁 B（SQLite 分片）** | 按 **租户文件** 升级，不是突然全局 DB                |
| **隔离键**                    | `tenantId` / `userId` / `agentId` 路径优先于「库名」 |

### 1.4 模块落地门禁

1. 新增持久化模块必须在 PR 描述写明：`class=D|Q|E`、`engine=json|sqlite|other`、`shard-key=`。
2. **禁止半吊子**：只写 SQL DDL、无 runtime backend、又与 JSON 双写且无投影约定。
3. 逻辑 schema（如 `db-schema.ts`）须标注 `runtime-status: aspirational | wired | dual`。
4. 多租户：新 store 必须可落 `tenants/<tid>/...` 或明确 L0 全局；禁止默认再堆全局 `~/.openbot/*.json` 吃多租户业务态。

---

## 2. 全表：当前引擎 / 数据类 / 12 个月目标

图例：

- **引擎**：`JSON` · `SQLite` · `JSON|SQLite`（可配置） · `DDL-only`（仅契约） · `file/jsonl`
- **层级**：L0 平台 · L1 租户控制面 · L2 用户数据 · L3 运行时 · X 横切密钥

| #   | 域 / 模块                        | 代表路径 / 文件                                                       | 当前引擎         | 类     | 层级      | 12 个月目标                                   | 备注                                                                                                       |
| --- | -------------------------------- | --------------------------------------------------------------------- | ---------------- | ------ | --------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Gateway 主配置                   | `openbot.json`                                                        | JSON             | D      | L0/主机   | **保持 JSON**                                 | 部署与 bootstrap 契约                                                                                      |
| 2   | Platform auth                    | `openbot-platform-auth.json`                                          | JSON             | D      | L0        | **保持 JSON**；超大后可考虑 SQLite 用户索引   | Q-A：全局 membership 权威                                                                                  |
| 3   | Platform auth slice（导入）      | `control-plane/platform-auth-slice.json`                              | JSON             | D      | L1 迁移物 | 保持 JSON                                     | 非 runtime 权威                                                                                            |
| 4   | Seat assets                      | `seat-assets.json` 或 sqlite                                          | **JSON\|SQLite** | D      | L1        | 默认 JSON；租户规模上去 **per-tenant SQLite** | 已有 backend + 迁移脚本；说明见 [seat-assets 存储](./openbot-enterprise-seat-assets-storage-2026-07-13.md) |
| 5   | Enterprise data                  | `enterprise-data.json` 等                                             | JSON             | D      | L1        | 保持 JSON；连接器元数据过大时拆分             | 与 vault 密钥分离                                                                                          |
| 6   | Billing / credits / ledger       | `openbot-billing-*.json`, `*-credits*.json`, usage                    | JSON             | D→Q    | L0/L1     | **流水类**逐步 SQLite 或按日分片 JSON         | 账本适合 append                                                                                            |
| 7   | Plan / entitlement / routing     | `openbot-plan-*.json`, resource tiers                                 | JSON             | D      | L0        | 保持 JSON                                     | 配置面                                                                                                     |
| 8   | Tenant config                    | `openbot-tenant-config.json`                                          | JSON             | D      | L0 keyed  | 保持 JSON + tenant 过滤                       | 非 per-file L1                                                                                             |
| 9   | Policy engine                    | policies store JSON                                                   | JSON             | D      | L0/L1     | 保持 JSON                                     |                                                                                                            |
| 10  | Node seat binding                | supervisor binding JSON                                               | JSON             | D      | L0/L1     | 保持 JSON                                     |                                                                                                            |
| 11  | Supervisor tasks                 | per-task JSON under state                                             | JSON             | D/E    | L3        | 保持 JSON；归档可迁 L2                        |                                                                                                            |
| 12  | **Agent growth**                 | `{agentDir}/growth-status.json` 等                                    | **JSON**         | D      | L3/agent  | **保持 JSON**                                 | 整图快照；非报表库                                                                                         |
| 13  | Working style / ops metrics      | 同 agentDir `*.json`                                                  | JSON             | D      | L3/agent  | 保持 JSON                                     | 与 growth 同模式                                                                                           |
| 14  | AI workforce `db-schema.ts`      | `ai_assets/runs/metrics…` DDL                                         | **DDL-only**     | Q 目标 | L1/分析   | **接线 SQLite 投影** 或标 aspirational        | 勿与 growth JSON 双写无约定                                                                                |
| 15  | Asset incubation                 | session/adoption JSON 数组                                            | JSON             | D/E    | L0/L3     | 事件量大则 SQLite                             | 现为整文件数组                                                                                             |
| 16  | Collaboration learning apps      | `learning-asset-applications.json`                                    | JSON             | D      | L2/L3     | 保持 JSON                                     |                                                                                                            |
| 17  | Knowledge index / FTS / vec      | `kb-index` SQLite                                                     | **SQLite**       | Q      | L2        | **保持 SQLite**                               | 正确用例                                                                                                   |
| 18  | Knowledge governance / claims    | SQLite stores                                                         | SQLite           | Q      | L2        | 保持 SQLite                                   |                                                                                                            |
| 19  | Memory search / embedding        | `memory/{agentId}.sqlite`                                             | SQLite           | Q      | L2/L3     | 保持 SQLite                                   |                                                                                                            |
| 20  | Mention state journal            | `mentions.sqlite`                                                     | SQLite           | Q      | L2        | 保持 SQLite                                   | append 日志                                                                                                |
| 21  | Sessions                         | `sessions.json` / transcripts                                         | file/json(l)     | E      | L3        | 保持文件；租户路径隔离                        | B4 session 寻址                                                                                            |
| 22  | Auth profiles / device auth      | `auth-profiles.json` 等                                               | JSON             | D/X    | L3/agent  | 保持 JSON；密钥走 vault                       |                                                                                                            |
| 23  | Encrypted secrets / OI secrets   | `openbot-*-secrets.json`                                              | JSON+加密        | X      | L0/L1     | 保持；多租户分路径                            | 永不进 import 包                                                                                           |
| 24  | Cron / canvas / credentials dirs | state 子树                                                            | 文件混合         | E/D    | L3        | 保持；租户化跟随 B4/D7                        |                                                                                                            |
| 25  | Tenant import jobs               | `openbot-tenant-import-jobs.json`                                     | JSON             | D      | L0        | 保持 JSON                                     | 作业状态                                                                                                   |
| 26  | Data export manifest             | export 包内 JSON                                                      | JSON             | D      | L2        | 保持                                          |                                                                                                            |
| 27  | Guidance progress                | `CONFIG_DIR/guidance-progress/<tid>/<uid>/<scope>/<entityId>.json`    | JSON             | D      | L1/L2     | 保持 JSON                                     | Orchestrator P1；键 `tenantId+userId+scope+entityId`；非 Growth FSM                                        |
| 28  | Guidance suppression             | `CONFIG_DIR/guidance-suppression/<tid>/<uid>/<scope>/<entityId>.json` | JSON             | D      | L1/L2     | 保持 JSON                                     | Orchestrator P2；频率上限 / 全局抑制 / 版本化重入                                                          |
| 29  | Guidance metrics                 | `CONFIG_DIR/guidance-metrics/<tid>/<uid>/events.jsonl`                | file/jsonl       | E      | L3        | 量大后可迁 SQLite journal                     | Orchestrator P3；append-only；脱敏 + fail-soft；非 incubation `guidance_event`                             |

---

## 3. 焦点解读（回应「db-schema vs agent-growth」）

### 3.1 为何可以并存

|          | **agent-growth JSON**      | **db-schema SQL**                                |
| -------- | -------------------------- | ------------------------------------------------ |
| 语义     | 单个机器人的产品成长态快照 | 治理/分析域的关系模型（资产、run、日指标、异常） |
| 访问模式 | 读改写整文档               | 按时间/asset 过滤、聚合                          |
| 生命周期 | 随 agent 目录走            | 可跨 agent 报表                                  |
| 现状     | **runtime 真相**           | **逻辑契约为主**（尚未成为默认权威存储）         |

**推荐关系（目标态）**：

```text
agent-growth JSON  ──(事件/投影)──►  governance SQLite（db-schema 表）
        ▲ 运行时读写                         ▲ 看板 / 异常 / 成本曲线
```

- **禁止**把 growth-status 直接改成共享 SQL 表，却让 seat/auth 仍是 JSON——多一种一致性税。
- **允许**日后用 SQLite 存 `ai_runs` / `ai_metrics_daily`，从 run 事件灌库；growth-status 仍可 JSON。

### 3.2 `db-schema.ts` 处置（工程）

建议文件头增加（实施 PR 可跟）：

```ts
/**
 * Logical schema for AI workforce governance analytics.
 * runtime-status: aspirational | dual-projection
 * Authoritative product state for agent growth remains JSON under agentDir
 * (see src/gateway/agent-growth/*). Wire via ensure*Schema(db) before use.
 */
```

若 2 个迭代内不接线 SQLite：在模块 README 标明 **DDL-only**，避免评审误判「已上 SQL」。

---

## 4. 决策树（新功能写库时用）

```text
需要全文/向量/大量 append 查询？
  ├─ 是 → SQLite 文件（Q），shard = tenant 或 agent 或 kb
  └─ 否 → 需要整图读写 / import / 配置？
        ├─ 是 → JSON（D），shard = tenant/user/agent 路径
        └─ 否 → 可丢弃热态？
              ├─ 是 → 文件 E
              └─ 否 → 回到 D 或 Q，并补备份策略
```

**只有**同时满足：跨租户聚合 + 强一致事务 + 多写者 时，再评估托管 SQL（且优先 L0）。

---

## 5. 12 个月路线图（可排期）

| 季度           | 动作                                                                      | 成功标准                  |
| -------------- | ------------------------------------------------------------------------- | ------------------------- |
| **Q0（现在）** | 发布本矩阵；标注 db-schema aspirational；新 store 强制 class/engine       | PR 模板有字段             |
| **Q1**         | L1 热点：seat-assets / 可选 billing ledger 试点 per-tenant SQLite         | 大租户开关验证            |
| **Q1–Q2**      | governance：`ai_runs`/`metrics` SQLite 投影（可选），agent-growth 仍 JSON | 看板不扫全量 JSON         |
| **Q2+**        | incubation/session 事件若爆量 → SQLite journal                            | 单文件 JSON 不再线性恶化  |
| **按需**       | L0 平台审计/财务报表 → 托管 SQL                                           | 不影响租户 L1/L2 路径模型 |

---

## 6. 与多租户共享 Gateway 的关系

| 能力          | 依赖                                                               |
| ------------- | ------------------------------------------------------------------ |
| 租户隔离      | **路径 / shard key**（tenant-context），不是换 Postgres            |
| MULTITENANT   | 同一套 JSON/SQLite **文件布局** 下按会话寻址                       |
| tenant-import | 以 **JSON 控制面分片 + L2 目录** 为包格式友好；全库 SQL 会加重导入 |

因此：**共享 Gateway 主线上的正确投入顺序**仍是「隔离与寻址 → 分片存储健康 → 局部 SQLite 升级」，而不是先统一数据库。

---

## 7. 验收清单（附录入库时）

- [x] 本文件链到 `openbot-saas-tenant-data-architecture.md`（§OQ-1 旁）
- [x] `db-schema.ts` runtime-status 标注完成
- [x] agent-growth 文档一句写明「权威 = JSON agentDir」
- [x] seat-assets 文档写明 JSON 默认 + SQLite 可选（[openbot-enterprise-seat-assets-storage-2026-07-13](./openbot-enterprise-seat-assets-storage-2026-07-13.md)）
- [x] 新增 store PR 模板含 `class` / `engine` / `shard-key`（`.github/pull_request_template.md`，2026-07-13）

---

## 8. 最终判断（复述）

| 问题                     | 答案                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------- |
| 持久化走 SQL 还是 JSON？ | **按类混合**：控制面/成长态默认 **JSON**；检索/流水 **SQLite**；中心 SQL 仅远期 L0 |
| 现在该推哪边？           | **巩固分片 JSON + 已有 SQLite 查询域**；不要为统一而统一                           |
| agent-growth JSON 对吗？ | **对**                                                                             |
| db-schema SQL 对吗？     | **作逻辑/分析模型可以**；作当前 runtime 权威 **还不是**                            |

---

**维护**：变更默认引擎须改本表 + OQ 纪要；禁止静默双写。
