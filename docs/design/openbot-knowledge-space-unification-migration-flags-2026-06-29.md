# 知识空间统一化 — 迁移与功能开关说明

> 日期：2026-06-29  
> 关联：`openbot-knowledge-space-unification-implementation-plan-2026-06-29.md` §9.3  
> 任务拆解：W8 · `openbot-knowledge-space-unification-work-breakdown-2026-06-29.md`  
> 验收：SOP §E1 / §E3 / §B4 · `openbot-knowledge-space-unification-acceptance-sop-2026-06-29.md`

## 1. 迁移原则

1. **幂等**：同一迁移逻辑重复执行不会破坏数据。
2. **可回滚**：关闭功能开关即可恢复 Phase 1 兼容行为。
3. **无停机**：全部为惰性迁移或读路径触发，不要求手工停服修库。
4. **不删历史**：个人收件箱、历史 KB、历史 binding 均保留。

## 2. source binding visibility 回填

### 行为

凡绑定到 `knowledgeBaseId` 的 source binding，其 `visibility` 必须与目标 KB 的 `visibility` 一致。

### 触发方式

| 方式             | 说明                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| 惰性回填（默认） | 每次 `knowledge.source.list` / `listKnowledgeSourceBindings` 读取前自动扫描并修正                |
| 显式巡检         | 调用 `knowledge.compat.status`，响应中的 `sourceBindingVisibilityBackfill` 返回本次扫描/修正计数 |

### 实现位置

- `src/gateway/knowledge/knowledge-source-binding-visibility-backfill.ts`
- `src/gateway/knowledge/sources/source-binding-store.ts`

### 验收

1. 历史 binding 的 `visibility` 与所属空间一致。
2. 重复 list / compat.status 时 `updated` 为 0。

## 3. 兼容 warning 统计

### 统计项

| code                             | 含义                                                          |
| -------------------------------- | ------------------------------------------------------------- |
| `implicit_personal_inbox`        | 导入/绑定未传 `knowledgeBaseId`，落入「我的收录」             |
| `source_bind_visibility_ignored` | `knowledge.source.bind` 收到 legacy `visibility` 字段并被忽略 |

### 存储

`~/.openbot/knowledge/compat-warning-stats.json`（随 `CONFIG_DIR` 变化）

### 读取

RPC：`knowledge.compat.status` → `warningStats`

写入：在产生 compat warning 时自动递增（无需调用方额外上报）。

## 4. 功能开关（Phase 3）

环境变量均支持 legacy 前缀 `OPENCLAW_*`。

| 开关                        | 环境变量                                            | 默认 | Phase 3 行为                                                                                            |
| --------------------------- | --------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------- |
| 无空间导入即拒绝            | `OPENBOT_KNOWLEDGE_REQUIRE_KNOWLEDGE_BASE_ID=1`     | off  | `collect` / `upload` / `collectWeb` / `importDataset` / `source.bind` 缺省 `knowledgeBaseId` 时返回 400 |
| 拒绝 source.bind.visibility | `OPENBOT_KNOWLEDGE_REJECT_SOURCE_BIND_VISIBILITY=1` | off  | 请求体含 `visibility` 时直接拒绝（不再 warning+忽略）                                                   |

### Phase 1（当前默认）

- 缺省 `knowledgeBaseId` → 落入个人收件箱 + `compatWarnings`
- `source.bind.visibility` → 忽略 + `compatWarnings`
- 新 UI 已强制显式选空间，不应再触发 inbox 兜底

### 验证步骤

```bash
# 查看开关与统计（无需重启）
openbot gateway call knowledge.compat.status '{}'

# 开启强拒绝（必须重启 gateway 后生效）
export OPENBOT_KNOWLEDGE_REQUIRE_KNOWLEDGE_BASE_ID=1
export OPENBOT_KNOWLEDGE_REJECT_SOURCE_BIND_VISIBILITY=1
# macOS: 通过 OpenBot 应用重启 gateway，或 launchctl kickstart -k gui/$UID/ai.openbot.gateway
```

## 5. 个人收件箱

- tag：`openbot:personal-inbox`
- **不删除、不迁移内容**
- 新 UI 不再作为默认导入目标；仅服务 legacy 调用方
- Phase 3 打开 `REQUIRE_KNOWLEDGE_BASE_ID` 后，隐式写入停止，收件箱变为普通历史私有空间

## 6. 监控建议

1. 定期调用 `knowledge.compat.status`，观察 `warningStats` 是否下降。
2. 当 `implicit_personal_inbox` 长期为 0 且所有客户端已升级，可开启 `REQUIRE_KNOWLEDGE_BASE_ID`。
3. 当 `source_bind_visibility_ignored` 长期为 0，可开启 `REJECT_SOURCE_BIND_VISIBILITY`。

## 7. 相关 RPC

| RPC                           | 用途                                                |
| ----------------------------- | --------------------------------------------------- |
| `knowledge.compat.status`     | 功能开关、warning 统计、binding visibility 回填摘要 |
| `knowledge.source.list`       | 触发惰性 visibility 回填                            |
| `knowledge.base.sources.list` | 空间详情聚合来源（W7）                              |
