# Step 6 实施报告 —— 收录/上传自动入库

Date: 2026-06-14
Status: **Step 6 正式通过（技术轨，2026-06-14 第五轮验收）**
关联计划: `docs/design/openbot-knowledge-rag-integration-plan-2026-06-14.md` (v3) §8 Step 6 / §9
落地提交: `fc968e46d9`（Task: knowledge-rag-step6 / Agent: cursor-composer）

---

## 1. 阶段目标

- `personal-mutations` 写路径（collect / upload）在指定 `knowledgeBaseId` 时自动 **attach + ingest**
- `knowledge.base.attach` 对已归属个人文档触发 **re-ingest**
- 闭合 **S3-D1**：`ingestKnowledgeDocument` 接入 upload/attach 闭环

**本期不含**：Agent Evidence 注入（Step 7）、前端库内检索 UI（Step 8）、binary/PDF 无 buffer 上传的全文解析（仍依赖后续附件字节通道）。

---

## 2. 交付物

| 文件                                                               | 职责                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------- |
| `src/gateway/knowledge/personal-knowledge-ingest.ts`               | 附件/收录/技能资产 → buffer → `ingestKnowledgeDocument` |
| `src/gateway/server-methods/knowledge.ts`                          | collect/upload/attach RPC 接线 + 返回 `ingest` 结果     |
| `src/gateway/knowledge/personal-knowledge-ingest.test.ts`          | 单元 + hook 测试 5 条                                   |
| `src/gateway/server-methods/knowledge-personal-ingest-rpc.test.ts` | upload/collect/attach → search 集成 3 条                |

---

## 3. 验收对照（§9 Step 6）

| 验收项                | 结果 | 证据                                                            |
| --------------------- | ---- | --------------------------------------------------------------- |
| 上传归属库即可检索    | ✅   | RPC：upload + knowledgeBaseId → indexed 命中「Restart gateway」 |
| 收录归属库即可检索    | ✅   | RPC：collect + knowledgeBaseId → indexed 命中「export」         |
| attach 触发 re-ingest | ✅   | upload 无库 → base.attach → indexed 命中「Password reset」      |
| S3-D1 闭合            | ✅   | upload / collect / attach 均走 `ingestKnowledgeDocument`        |

**质量门禁**：Step 6 专项 **8/8**；标准全量回归 **119/119**（复跑确认）。

---

## 4. 第五轮验收结论（2026-06-14）

| 项目                               | 结论                |
| ---------------------------------- | ------------------- |
| Step 6 技术轨                      | **通过**            |
| S3-D1                              | **已关闭**          |
| 准予进入 Step 7                    | **是**              |
| 产品 P1「文件归库 + 库内检索」子项 | 后端文本路径闭环 ✅ |

**端到端闭环**：

```
knowledge.base.create
  → knowledge.personal.upload/collect（带 knowledgeBaseId）
      → attachDocumentToKnowledgeBase
      → ingestKnowledgeDocument
  → knowledge.base.search → searchMode: indexed + KnowledgeEvidence[]
```

**产品 P1 后端**：约 **85%**（建库 / 归库 / 库内检索后端满足；用户体感仍依赖 Step 8 UI）。

---

## 5. API 变更（向后兼容）

### `knowledge.personal.collect` / `knowledge.personal.upload`

新增可选参数：`knowledgeBaseId`（别名 `kbId`）。

当传入且用户为 KB owner 时：

1. 校验 KB owner（与 `knowledge.base.attach` 一致，闭合 **S6-D2**）
2. 自动 `attachDocumentToKnowledgeBase(kbId, skillId)`
3. 调用 ingest，响应追加 `ingest: { attempted, skipped, chunkCount, ... }`

未传 `knowledgeBaseId` 时行为与 Step 5 一致（仅写 skill-assets，不 ingest）。

### `knowledge.base.attach`

响应新增 `ingest` 字段（从已存 skill 资产读取正文 re-ingest）。

---

## 6. 残余技术债

| 编号     | 严重度 | 问题                                                 | 状态                     |
| -------- | ------ | ---------------------------------------------------- | ------------------------ |
| S6-D1    | 中     | binary/PDF 上传无原始 bytes                          | 开放 → 后续附件通道      |
| S6-D2    | 中     | collect/upload attach 前缺 owner 门                  | **已关闭**（验收后补丁） |
| S5-D1    | 低     | `knowledge.base.search` substring 不返回 bundle 子串 | Step 8 或增强            |
| S2-D4    | 低     | 成果 `relatedKnowledgeBaseId` 归档                   | Step 7/8                 |
| S4-D2/D3 | 低     | 企业 visibility / 向量 RPC 测                        | 后续                     |

---

## 7. 下一步（Step 7）

- `resolve/context-builder.ts` 注入 `KnowledgeEvidence`（版本 + 出处 + sourceUri）
- `auto-reply/.../knowledge-universe-context.ts` 升级 Agent 引用格式
