# Step 2 实施报告 —— 文档抽取 + 两层 hash + 成果中心读模型

Date: 2026-06-14
Status: **正式通过（技术轨，2026-06-14 第三轮验收）** / 成果中心后端有条件通过 / 产品 P1 ~40%
关联计划: `docs/design/openbot-knowledge-rag-integration-plan-2026-06-14.md` (v3) §8 Step 2
产品方案: `docs/design/openbot-knowledge-workspace-optimization-2026-06-14.md` §7 P1（成果中心并行）

---

## 1. 阶段目标

### 技术轨 Step 2

- PDF / Markdown / Text 正文抽取（复用 `src/media/pdf-extract.ts`）
- `content-clean` 去除页码、时间戳、重复页眉页脚
- 两层 hash：`rawHash`（原文件）+ `semanticHash`（清洗后正文）
- 版本增量判定：`unchanged` / `raw_only` / `new_semantic_version`

### 产品轨并行（成果中心地基）

- `WorkspaceDeliverable` 聚合读模型（协作 Deliverable + Agent skill 资产）
- `knowledge.deliverables.list` RPC

**本期不含**：sqlite 拆表索引（Step 3）、库内检索 RPC（Step 5）、前端成果中心视图（Step 8）。

---

## 2. 交付物

| 文件                                                            | 职责                              |
| --------------------------------------------------------------- | --------------------------------- |
| `src/gateway/knowledge/content-clean.ts`                        | 正文清洗（时间戳/页码/重复行）    |
| `src/gateway/knowledge/document-fingerprint.ts`                 | raw/semantic hash + 版本增量分类  |
| `src/gateway/knowledge/document-extract.ts`                     | 统一抽取入口 + PDF/文本路由       |
| `src/gateway/knowledge/document-extract.test.ts`                | 9 用例                            |
| `src/gateway/knowledge/deliverables/types.ts`                   | `WorkspaceDeliverable` 读模型类型 |
| `src/gateway/knowledge/deliverables/read-model.ts`              | 跨群 Deliverable + Agent 资产聚合 |
| `src/gateway/knowledge/deliverables/read-model.test.ts`         | 3 用例                            |
| `src/gateway/server-methods/knowledge-deliverables-rpc.test.ts` | 4 用例（RPC 权限链）              |
| `src/gateway/server-methods/knowledge.ts`                       | `knowledge.deliverables.list`     |
| `.loom/registry.yaml`                                           | EDGSC 路径 + EDGSC↔ME 共 land     |

---

## 3. 验收对照

| 验收项               | 结果 | 证据                                                       |
| -------------------- | ---- | ---------------------------------------------------------- |
| PDF 抽取             | ✅   | `document-extract.test.ts`                                 |
| semantic hash 稳定   | ✅   | 时间戳变更用例                                             |
| 两层 hash + 增量判定 | ✅   | `raw_only` / `unchanged` / `new_semantic_version` 均有测试 |
| 成果读模型           | ✅   | `read-model.test.ts`                                       |
| deliverables RPC     | ✅   | handler + `knowledge-deliverables-rpc.test.ts`             |

### 第三轮整改（S2-D1 / S2-D2）

| 编号  | 问题                         | 状态                                    |
| ----- | ---------------------------- | --------------------------------------- |
| S2-D1 | `raw_only` 死代码            | ✅ 已修正：semantic 相同时先判 raw 差异 |
| S2-D2 | 无 deliverables RPC 集成测试 | ✅ 已补 4 条                            |

### 已知缺口（后续 Step）

| 编号  | 问题                            | 计划 Step         |
| ----- | ------------------------------- | ----------------- |
| S2-D3 | `source: chat` 无产出路径       | Step 6 或标注预留 |
| S2-D4 | `relatedKnowledgeBaseId` 未填充 | Step 6 归档钩子   |
| S2-D5 | 抽取未接入 upload               | Step 3 kb-ingest  |
| —     | Agent 资产 userId 过滤          | Step 4 多用户安全 |

---

## 4. 质量门禁

| 门禁                        | 结果                                                         |
| --------------------------- | ------------------------------------------------------------ |
| Step 2 新增测试             | **14/14**（extract 9 + deliverables 3 + deliverables RPC 4） |
| Step 1+2 RPC 集成           | **9/9**（KB 5 + deliverables 4）                             |
| knowledge 域 + Step 1/2 RPC | **88/88**                                                    |
| 提交                        | ✅ `d708addece`（Step 2 主体）；整改待下一 commit            |

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/gateway/knowledge/ src/gateway/server-methods/knowledge-base-rpc.test.ts src/gateway/server-methods/knowledge-deliverables-rpc.test.ts
```

---

## 5. 验收决议（第三轮，2026-06-14）

| 轨道         | 结论                                                 |
| ------------ | ---------------------------------------------------- |
| RAG Step 2   | ✅ **正式通过**，准予 Step 3                         |
| 成果中心后端 | ⚠️ **有条件通过**（S2-D2 已补，归档/UI 待 Step 6/8） |
| 产品 P1 整体 | ❌ 不通过（~40%）                                    |

---

## 6. 下一步

- **Step 3（P0）**：sqlite 拆表 + hierarchical chunk + `kb-ingest`（接入 `extractKnowledgeDocument`）
- **Step 5**：`knowledge.base.search`
- **Step 8**：前端知识库 + 成果中心 + 归档到库

---

## 附：提交记录

- Step 1：`791fb2178d`（Task: knowledge-rag-step1 / Agent: cursor-composer）
- Step 2：`d708addece`（Task: knowledge-rag-step2 / Agent: cursor-composer）
