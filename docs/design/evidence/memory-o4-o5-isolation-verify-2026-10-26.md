# Memory O4/O5 隔离验证记录（2026-10-26）

| 字段   | 值                                                |
| ------ | ------------------------------------------------- |
| 日期   | 2026-10-26（Asia/Shanghai）                       |
| 工作树 | `/private/tmp/openbot-memory-batch1-rework`       |
| 范围   | 合成数据；真实网关处理函数 + 双来源对照；无真实库 |

## 1. 网关处理函数（`dataHandlers["data.memory.forget"]`）

测试文件：`src/gateway/server-methods/memory-forget-gateway-isolation.test.ts`

| 路径                                           | 结果                                 |
| ---------------------------------------------- | ------------------------------------ |
| managed 拒绝                                   | 期望 fail + managed 文案             |
| enterprise `sessionDomain` 拒绝                | 期望 fail + enterprise admin 文案    |
| employee 外键 agent 所有权拒绝                 | 期望 fail + permission 文案          |
| null client 合法允许：合成 Data Space 文件删除 | 期望 ok + `deletedPath`；文件 ENOENT |
| employee 自有 agent + 缺失条目                 | 进 ACL 后 not found（fail-closed）   |

说明：认证/所有权走真实 `assertMemoryCenterAgentAccess`；managed 走真实 `rejectWhenManaged`；删除走真实 `forgetMemoryEntry`。配置/actor 列表在测试中 mock，文件系统为 tmp 合成根。

## 2. 双来源召回对照（helper + manager.search）

测试文件：`src/memory/memory-batch1-o4-o5-diagnose.test.ts`（O5 describe）

| 检查                                                | 结果                                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 来源 A = Data Space `agents/main/memory/agent/*.md` | forget 目标                                                                                                      |
| 来源 B = workspace `MEMORY.md` 同短语对照           | 独立来源                                                                                                         |
| 删前 A 是否进入检索映射                             | **否** — `manager.search` 索引 workspace `MEMORY.md` / `workspace/memory`，**不含** Data Space agent memory 路径 |
| 立即 / 现有同步后 / 跨进程重启后同来源 A            | 因 A 从未索引 → **无法**证明同来源残留；分类 `not-confirmed-defect:source-A-never-indexed-...`                   |
| 来源 B 对照                                         | 可命中；**不得**当作 A 残留                                                                                      |
| 伪造来源映射                                        | **未做**                                                                                                         |

## 3. 限制（明文）

若产品要「删 A 后同来源召回=0」的可证伪验收，需另批：**让 Data Space 记忆文件进入与 forget 同一来源 identity 的检索映射**，或提供稳定 sourceId/locator 断言 API。当前路径下记录限制，停在后端修复设计之前（无新同来源残留可提交）。

## 4. 未触碰

真实记忆、主目录、T34、push/PR/部署、RPC/lifecycle/来源范围、候选视图实现、外部 tracker 写操作。
