# OpenBot Data Space & Agent Workspace 数据模型设计 v1.0

> **状态：架构冻结草案** | 创建：2026-07-10 | 前置：[数据目录产品规格](/design/openbot-data-directory-product-spec-2026-07-10)  
> **目的**：在 Phase 1 研发前冻结「数据空间」语义，避免 workspace / memory / conversation / tenant 在 6 个月内演化为技术债。  
> **读者**：产品、Gateway、Mac App、企业端、安全评审

---

## 1. 结论先行

1. **废弃「用户配置 workspace 路径」**；引入统一概念 **OpenBot Data Space（数据空间）**。
2. **三层模型**：`Data Root` → `Agent Space | Shared Space` → `workspace / memory / artifacts / conversations`。
3. **`agents.defaults.workspace` 降级为兼容别名**，v1 内部由 `data.root` + `agents/<id>/workspace` 派生；新代码不得再把它当「用户数据根」。
4. **Memory 分四类 + 生命周期**；删除 Agent 时必须定义 memory 处置策略。
5. **Conversation 分 runtime 与 archive**：runtime 在 state dir；**用户可迁移/可导出的是 archive**。
6. **SaaS 租户边界**：`tenant → user → OpenBot` + `tenant/shared` 企业共享区。
7. **存储分层**：Primary = Local SSD；Backup = NAS/Cloud；Archive = Enterprise policy。

---

## 2. 概念层次

```text
                    OpenBot Data Space
                            |
                         User
                            |
                       Data Root                    ← 用户可见、可迁移、可导出
                    (~/OpenBot 或 SaaS provision)
                            |
         +------------------+------------------+
         |                                     |
   Agent Spaces                          Shared Space
   (per agent_id)                    (跨 Agent / 企业)
         |                                     |
   +-----+-----+-----+-----+              knowledge/
   |     |     |     |     |              templates/
 workspace memory artifacts conversations
```

### 2.1 术语表

| 术语                        | 定义                                                                          | 用户可见            |
| --------------------------- | ----------------------------------------------------------------------------- | ------------------- |
| **State Dir**               | `~/.openbot/` 系统运行态：config、credentials、runtime session 索引、identity | 否（仅 doctor/CLI） |
| **Data Root**               | 用户数据空间物理根；配置键 `data.root`                                        | 是                  |
| **Agent Space**             | 单个智能体（机器人）的隔离数据区；路径 `{data.root}/agents/<agentId>/`        | 是（聚合展示）      |
| **Shared Space**            | 跨 Agent 共享资产；路径 `{data.root}/shared/`                                 | 是                  |
| **Workspace**               | Agent 的 **cwd**（工具相对路径、AGENTS.md、skills、项目文件）                 | 是（进阶）          |
| **Memory**                  | 长期记忆资产（结构化，非原始 transcript）                                     | 是（隐私中心）      |
| **Artifacts**               | Agent 产出物（报告、导出、生成文件）                                          | 是                  |
| **Conversations (archive)** | 已归档对话历史（用户数据，可导出）                                            | 是                  |
| **Runtime Session**         | 活跃/近期会话运行时（jsonl 热数据）                                           | 否                  |

### 2.2 与旧概念对照

| 旧概念                                    | v1 处置                                                               |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `agents.defaults.workspace`               | **兼容派生**：默认 agent → `{data.root}/agents/<defaultId>/workspace` |
| `agents.list[].workspace` 绝对路径        | **废弃用户配置**；仅迁移期读取，新装禁止 UI 写入                      |
| `~/.openbot/agents/<id>/sessions/*.jsonl` | **Runtime**；定期/按需归档到 Agent Space                              |
| `~/OpenBot/workspace`（扁平）             | **废弃**；改为 per-agent workspace                                    |
| `~/OpenBot/bots/`                         | 更名为 **`agents/`**（与 `agentId` 一致）                             |

---

## 3. 物理目录规范（本机 Data Root）

默认：`~/OpenBot/`（`data.root`）

```text
~/OpenBot/
├── agents/
│   └── <agentId>/                    # 例：main, sales-agent
│       ├── workspace/                # cwd；AGENTS.md, skills/, 项目文件
│       ├── memory/
│       │   ├── agent/                # 该 Agent 经验、偏好、反思
│       │   └── workspace/            # 项目级、任务级沉淀
│       ├── artifacts/                # 生成物、导出、交付物副本
│       └── conversations/            # 归档 transcript（非 runtime）
│           ├── archive/              # 按会话分片 jsonl / 压缩包
│           └── index.json            # 会话索引（标题、时间、可搜索元数据）
├── shared/
│   ├── knowledge/                    # 个人知识宇宙用户文档、Feed 落盘
│   └── templates/                    # 可复用模板（可选）
├── memory/
│   └── personal/                     # 用户级长期偏好（跨 Agent）
│       └── index/
├── cache/                            # 可重建：embedding 缓存、缩略图、临时索引
└── .meta/
    ├── manifest.json                 # 数据空间版本、创建时间、agent 列表
    └── access-grants.jsonl           # 数据授权记录（见 §8）
```

### 3.1 默认 Agent 解析规则（冻结）

```typescript
// 逻辑规范（非最终实现代码）
function resolveAgentSpaceRoot(dataRoot: string, agentId: string): string {
  return join(dataRoot, "agents", agentId);
}

function resolveAgentWorkspaceDir(dataRoot: string, agentId: string): string {
  return join(resolveAgentSpaceRoot(dataRoot, agentId), "workspace");
}
```

**规则**：

- 每个 `agentId` **必有**独立 Agent Space；禁止两个 agent 默认共享同一 workspace 目录。
- `main`（默认 agent）与其他 agent **同构**，不再使用 `agents.defaults.workspace` 作为「全局扁平根」。
- 协作小组（groups）沉淀路径：`{agentSpace}/workspace/groups/<groupId>/` 或 `shared/knowledge/groups/<groupId>/`（按可见性：私有归 agent，共享归 shared — Phase 2 细化）。

### 3.2 与当前代码差距（迁移注记）

当前 `resolveAgentWorkspaceDir`（`src/agents/agent-scope.ts`）：

- 默认 agent → `agents.defaults.workspace` 或 `~/.openclaw/workspace`
- 非默认 agent → `~/.openbot/workspace-<id>`

**v1 兼容策略**：

1. 若 `data.root` 未设置 → 保持现有行为（doctor 提示升级）。
2. 若 `data.root` 已设置 → 新解析函数优先；`agents.list[].workspace` 仅当显式存在且位于 `data.root` 内时尊重（迁移期）。
3. Phase 1 **不强制**改写 `resolveAgentWorkspaceDir` 实现，但**冻结**新功能只认 Data Space 模型。

---

## 4. Memory 模型

### 4.1 分类

| 类            | 路径                                        | 内容                          | 归属             |
| ------------- | ------------------------------------------- | ----------------------------- | ---------------- |
| **personal**  | `{data.root}/memory/personal/`              | 用户跨 Agent 偏好、称呼、风格 | 用户             |
| **agent**     | `{data.root}/agents/<id>/memory/agent/`     | Agent 经验、反思、技能习得    | Agent            |
| **workspace** | `{data.root}/agents/<id>/memory/workspace/` | 项目/任务上下文、结构化笔记   | Agent+项目       |
| **index**     | 各 memory 子树下的 `index/`                 | embedding 索引、检索元数据    | 系统生成，可重建 |

现有 `MEMORY.md` / `memory.md` 映射到 `memory/agent/` 或 `memory/workspace/`（bootstrap 时迁移）。

### 4.2 生命周期（冻结）

| 事件                 | 行为                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| 用户「忘记这条记忆」 | 删除指定 memory 条目 + 更新 index；写 audit 事件                                     |
| 删除 Agent           | 弹窗三选一：**删除全部** / **保留 artifacts+conversations** / **仅解除绑定（软删）** |
| 导出我的数据         | 包含 personal + 各 agent memory；不含 credentials                                    |
| Agent 重置           | 清空 `memory/agent/` + runtime session；保留 `conversations/archive` 可选            |

### 4.3 开放问题（v1.1）

- embedding 索引是否始终放 `cache/` 而非 `memory/index/`？倾向：**热索引在 cache，冷索引在 memory/index**。

---

## 5. Conversation 模型

### 5.1 双层存储

```text
Runtime（State Dir，不可迁移）
~/.openbot/agents/<agentId>/sessions/
├── sessions.json           # 活跃会话索引
└── *.jsonl                 # 热 transcript

Archive（Data Space，可迁移、可导出）
~/OpenBot/agents/<agentId>/conversations/
├── archive/<sessionKey>.jsonl[.gz]
└── index.json
```

### 5.2 归档策略

| 触发                        | 动作                                          |
| --------------------------- | --------------------------------------------- |
| 会话关闭 / 超过 N 天无活动  | 将 jsonl 移至 archive；runtime 保留 stub 索引 |
| 用户「导出对话」            | 从 archive + runtime 合并导出                 |
| 数据迁移 / 导出我的 OpenBot | **必须包含** `conversations/archive`          |
| Gateway 备份                | runtime 可选；archive **必含**                |

**产品承诺**：用户执行「导出我的 OpenBot 数据」或「迁移数据位置」后，**历史对话不丢失**（与专家组意见一致）。

### 5.3 与 credentials 边界

- Archive **不得**含 OAuth token、API key、配对 secret。
- 导出管线须跑 **secret scanner**（路径黑名单 + 内容启发式），与 `SECURITY.md` 对齐。

---

## 6. SaaS 租户数据边界

### 6.1 目录规范（冻结）

```text
/data/
└── tenants/
    └── <tenantId>/
        ├── users/
        │   └── <userId>/
        │       └── OpenBot/          # 与用户本机 ~/OpenBot 同构
        │           ├── agents/
        │           ├── shared/         # 用户私有 shared；非企业全局
        │           ├── memory/
        │           └── cache/
        └── shared/                     # 企业级共享
            ├── knowledge/
            ├── agents/                 # 企业共享机器人 Agent Space（可选）
            └── policies/               # 企业数据策略指针（非用户文件）
```

### 6.2 隔离规则

| 边界                         | enforcement                                                 |
| ---------------------------- | ----------------------------------------------------------- |
| tenant A ↔ tenant B          | 路径前缀 + `isPathWithinRoot`；禁止跨 tenant API            |
| user A ↔ user B（同 tenant） | 默认隔离；共享仅通过 `tenant/shared` + 显式授权             |
| 员工 ↔ 企业共享 Agent        | 共享 Agent 的 Agent Space 在 `tenant/shared/agents/<id>/`   |
| 平台运维                     | 不得对员工 token 暴露 `/data` 浏览；仅 provision 配额与审计 |

### 6.3 配置表示（SaaS）

员工端不展示物理路径。Gateway 内部：

```json5
{
  data: {
    mode: "managed",
    root: "/data/tenants/acme/users/u001/OpenBot", // 仅服务端
    tenantId: "acme",
    userId: "u001",
  },
}
```

---

## 7. 配置模型（冻结）

### 7.1 一等公民键

| 键                   | 类型                     | 说明                          |
| -------------------- | ------------------------ | ----------------------------- |
| `data.root`          | string                   | Data Root 绝对路径            |
| `data.mode`          | `"local"` \| `"managed"` | 本机 vs SaaS 托管             |
| `data.cacheDir`      | string                   | 默认 `{data.root}/cache`      |
| `data.schemaVersion` | number                   | Data Space 布局版本，当前 `1` |

### 7.2 Agent 级键（仅进阶 / 企业策略）

| 键                        | 说明                                 |
| ------------------------- | ------------------------------------ |
| `agents.list[].dataSpace` | 可选；默认 `{data.root}/agents/<id>` |
| `agents.list[].workspace` | **deprecated**；迁移期只读           |

### 7.3 派生关系（不再让用户配置）

```text
agents.defaults.workspace  ──派生──►  {data.root}/agents/{defaultAgentId}/workspace
agents.list[i].workspace   ──派生──►  {data.root}/agents/{id}/workspace
```

实现层可提供 `resolveDataSpacePaths(cfg, agentId)` 单一入口，替代散落的路径拼接。

---

## 8. AI 数据安全扩展（专家组补充）

### 8.1 数据授权记录（Access Grants）

路径：`{data.root}/.meta/access-grants.jsonl`

每条记录：

```json
{
  "id": "grant-uuid",
  "agentId": "sales-agent",
  "resourceType": "knowledge",
  "resourcePath": "shared/knowledge/projectA",
  "grantedBy": "user",
  "grantedAt": "2026-07-10T10:00:00Z",
  "reason": "user_explicit_share",
  "revokedAt": null
}
```

**UI**：隐私中心 → 「此 Agent 可访问的数据」列表，支持撤销。

### 8.2 Memory 隐私控制（必须能力）

| 能力                        | Phase   |
| --------------------------- | ------- |
| Forget this memory          | Phase 2 |
| Delete agent memory         | Phase 2 |
| Export memory (subset)      | Phase 2 |
| Enterprise retention policy | Phase 3 |

### 8.3 数据导出包（Export Bundle）

**「导出我的 OpenBot 数据」** 标准包：

| 包含                             | 不包含                      |
| -------------------------------- | --------------------------- |
| `agents/*/workspace`（可选脱敏） | `~/.openbot/credentials`    |
| `agents/*/memory`                | `secrets.json`              |
| `agents/*/artifacts`             | `identity/`                 |
| `agents/*/conversations/archive` | runtime session（可选附带） |
| `shared/knowledge`               | auth-profiles               |
| `memory/personal`                |                             |
| `.meta/manifest.json`            |                             |

格式：zip + `manifest.json` + SHA256 校验；支持 GDPR 风格「可携带」。

---

## 9. 存储分层

```text
┌─────────────────────────────────────────┐
│  Primary — Local SSD (data.root)        │  日常读写、Agent cwd、热索引
└──────────────────┬──────────────────────┘
                   │ sync / backup job
┌──────────────────▼──────────────────────┐
│  Backup — NAS / 用户私有云 / 企业对象存储   │  周期性快照；非实时主存储
└──────────────────┬──────────────────────┘
                   │ policy-driven
┌──────────────────▼──────────────────────┐
│  Archive — Enterprise retention         │  合规归档、长期冷存储
└─────────────────────────────────────────┘
```

**NAS 约束（与产品规格一致）**：

- 禁止作为 Primary 推荐；embedding/sqlite/vector 热路径在 NAS 上会导致 latency 与 lock。
- UI 文案：**「备份到 NAS」** 而非 **「搬到 NAS 运行」**。

---

## 10. Enterprise Data Policy（Phase 3 占位）

企业管理员可配置（企业端，非员工设置）：

| 策略项   | 示例                            |
| -------- | ------------------------------- |
| 存储位置 | 指定 tenant 级 bucket / 区域    |
| 保留周期 | conversation 90 天；memory 永久 |
| 删除策略 | 离职用户数据 30 天内擦除        |
| 审计     | 导出/迁移/跨 Agent 授权日志     |
| 备份     | 每日增量至企业 OSS              |

---

## 11. 分阶段落地（修订）

### Phase 0 — 模型冻结（当前）

- [x] 本文档 v1.0 草案
- [ ] 产品 / 安全 / Gateway 评审签字
- [ ] 更新产品规格 v0.2 引用本文档

### Phase 1 — 止损（不等同于完整 Data Space 迁移）

- 移除员工端 workspace 路径配置 UI
- 自动创建 `data.root` + **最小目录树**（可先 flat 兼容，manifest 标记 `schemaVersion: 1`）
- SaaS 禁止 browse；`data.mode=managed`
- 取消「工作区未配置」阻断
- **不改动** `resolveAgentWorkspaceDir` 行为（避免大爆炸）；新安装写入 `data.root`

### Phase 2 — Data Space 对齐 + 用户数据能力

- 实现 `resolveDataSpacePaths`；逐步切换 workspace 解析
- Conversation 归档管线 runtime → archive
- 高级 → 数据目录：迁移 + **导出 + 恢复**
- Memory 生命周期 UI（forget / delete agent memory）
- Access grants 基础版

### Phase 3 — 企业

- Tenant `shared/` 与企业共享 Agent
- Enterprise Data Policy
- NAS/Cloud 备份调度

---

## 12. 验收标准（模型层）

- [ ] 任意 agentId 可解析出唯一 Agent Space 路径，无「双 workspace」歧义
- [ ] 删除 sales-agent 时，产品规则明确 memory/conversations 处置
- [ ] 导出包不含 credentials；含 conversations archive
- [ ] SaaS 租户路径与 `tenant/shared` 文档化且测试覆盖 `isPathWithinRoot`
- [ ] `data.schemaVersion` 升级有迁移脚本约定

---

## 13. 文档修订记录

| 版本 | 日期       | 说明                                     |
| ---- | ---------- | ---------------------------------------- |
| v1.0 | 2026-07-10 | 响应专家组评审；冻结 Data Space 三层模型 |
