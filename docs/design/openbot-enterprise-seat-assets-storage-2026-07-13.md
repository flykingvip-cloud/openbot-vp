# Enterprise Seat Assets 存储后端（JSON 默认 · SQLite 可选）

> **状态**：文档补齐（代码已支持）  
> **日期**：2026-07-13  
> **关联**：[持久化引擎矩阵](./openbot-persistence-engine-matrix-2026-07-13.md)、[SaaS 租户数据架构 OQ-1](./openbot-saas-tenant-data-architecture.md)、`src/gateway/enterprise-seat-assets-backend.ts`

---

## 1. 结论

| 项              | 值                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| **数据类**      | **D**（控制面文档：整图读写、import/export、租户分片）                                                               |
| **默认引擎**    | **JSON 文件**                                                                                                        |
| **可选引擎**    | **SQLite**（同形状 payload，非关系拆表）                                                                             |
| **12 个月目标** | 默认仍 JSON；**单租户席位/绑定规模大**时 per-tenant 切 SQLite                                                        |
| **多租户**      | 共享 Gateway 下优先 `tenants/<tid>/control-plane/seat-assets.json`（tenant-context 寻址）；全局默认路径仅单实例/回退 |

**不是**中心化 Postgres；SQLite 也是**单文件后端**，payload 仍是序列化后的 store 文档。

---

## 2. 代码落点

| 能力                     | 路径                                                           |
| ------------------------ | -------------------------------------------------------------- |
| 后端抽象 / JSON / SQLite | `src/gateway/enterprise-seat-assets-backend.ts`                |
| 领域 store + load/save   | `src/gateway/enterprise-seat-assets-store.ts`                  |
| 配置类型                 | `src/config/types.gateway.ts` → `gateway.enterpriseSeatAssets` |
| Zod                      | `src/config/zod-schema.ts`（`enterpriseSeatAssets`）           |
| JSON → SQLite 迁移 CLI   | `scripts/migrate-enterprise-seat-assets-to-sqlite.ts`          |

默认路径（无 override 时）：

- JSON：`{CONFIG_DIR}/openbot-enterprise-seat-assets.json`（通常 `~/.openbot/...`）
- SQLite：`{CONFIG_DIR}/openbot-enterprise-seat-assets.sqlite`

SaaS managed + `OPENBOT_MULTITENANT=1` 时，请求期经 `resolveControlPlaneStorePathForClient` 解析到：

```text
tenants/<tenantId>/control-plane/seat-assets.json
```

（或同目录下若配置 sqlite 路径的租户分片文件。）

---

## 3. 配置

```json5
{
  gateway: {
    enterpriseSeatAssets: {
      // "json" (default) | "sqlite"
      backend: "json",
      // optional absolute/relative path override for the selected backend
      // store: "/data/tenants/acme/control-plane/seat-assets.json",
      // sqlite only:
      // sqliteBusyTimeoutMs: 5000,
    },
  },
}
```

| 字段                  | 默认           | 说明                                                   |
| --------------------- | -------------- | ------------------------------------------------------ |
| `backend`             | `json`         | 权威引擎选择                                           |
| `store`               | 见上默认文件名 | 路径覆盖；多租户下仍应优先走租户寻址注入的 `storePath` |
| `sqliteBusyTimeoutMs` | `5000`         | 仅 `backend=sqlite`                                    |

解析入口：`resolveEnterpriseSeatAssetsBackendFromConfig()`。

---

## 4. 何时用 JSON vs SQLite

| 场景                           | 建议                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------ |
| 自托管 / 小企业 / SaaS 默认    | **JSON**（OQ-1）                                                               |
| 单文件巨大、写冲突、启动解析慢 | 评估 **SQLite** 后端（同 store 形状）                                          |
| 需要 FTS/跨 seat 复杂 SQL 报表 | **不要**指望当前 SQLite 后端（payload blob）；应另做 Q 类投影库                |
| 多租户隔离                     | **路径分片**优先；每个租户一份 JSON 或一份 SQLite 文件，禁止混写全局文件当权威 |

---

## 5. 迁移

```bash
# 示例：把 JSON 迁到 SQLite（详见脚本 --help）
node --import tsx scripts/migrate-enterprise-seat-assets-to-sqlite.ts
node --import tsx scripts/migrate-enterprise-seat-assets-to-sqlite.ts \
  --source /path/a.json --target /path/b.sqlite
```

迁移后：

1. 校验 seat/binding 数量与抽检 ID
2. 配置 `gateway.enterpriseSeatAssets.backend: "sqlite"` 与 `store`
3. 保留 JSON 备份直至一个发布周期

---

## 6. 与 agent-growth / db-schema 的边界

| 模块                                   | 引擎                    | 关系                                  |
| -------------------------------------- | ----------------------- | ------------------------------------- |
| seat-assets                            | JSON 默认 · SQLite 可选 | L1 席位/资产绑定权威                  |
| agent-growth                           | JSON per agentDir       | 产品成长态；**不是** seat-assets      |
| `ai-workforce-governance/db-schema.ts` | DDL aspirational        | 分析投影目标，非 seat-assets 落盘格式 |

---

## 7. 验收

- [x] 代码双后端已存在
- [x] 配置类型 `backend: "json" | "sqlite"` 已文档化（本文）
- [x] 矩阵清单 seat-assets 行可勾选
- [ ] 生产大租户实测 SQLite 开关（按需）
