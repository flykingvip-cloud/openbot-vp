# Step 7 实施报告 —— Agent KnowledgeEvidence 注入

Date: 2026-06-14
Status: **Step 7 已落地（commit `76bd2884e4`），待验收**
关联计划: `docs/design/openbot-knowledge-rag-integration-plan-2026-06-14.md` (v3) §8 Step 7 / §9
前置: Step 6 `df7471ee28`（含 S6-D2 修补）

---

## 1. 阶段目标

- `resolve/context-builder.ts` 注入 `KnowledgeEvidence`（正文 + 出处 + 版本 + sourceUri）
- Agent system prompt 引用格式升级：`《title Vversion(date)》section` + `sourceUri`
- `auto-reply/.../knowledge-universe-context.ts`：有 indexed evidence 时也生成 prompt

**本期不含**：前端库内检索 UI（Step 8）、成果归档到库（S2-D4）、历史版本显式检索 RPC。

---

## 2. 交付物

| 文件                                                 | 职责                                    |
| ---------------------------------------------------- | --------------------------------------- |
| `src/gateway/knowledge/resolve/evidence-format.ts`   | Citation / prompt 行格式化              |
| `src/gateway/knowledge/resolve/context-builder.ts`   | promptBlock 追加 evidence 区块          |
| `src/gateway/knowledge/resolve/resolve-engine.ts`    | 按 query 调用 `searchKnowledgeEvidence` |
| `src/gateway/knowledge/types.ts`                     | `KnowledgeAgentContext.evidence`        |
| `src/auto-reply/reply/knowledge-universe-context.ts` | evidence 触发 prompt 生成               |
| `resolve/evidence-format.test.ts`                    | 引用格式 3 条                           |
| `resolve/resolve-engine.evidence.test.ts`            | 索引 → prompt 集成 1 条                 |

---

## 3. 验收对照（§9 Step 7）

| 验收项                            | 结果 | 证据                                    |
| --------------------------------- | ---- | --------------------------------------- |
| Agent prompt 含 KnowledgeEvidence | ✅   | `resolve-engine.evidence.test.ts`       |
| 引用含版本 + 日期 + 章节          | ✅   | `《Escalation Guide V1(…)》` + section  |
| 引用含 sourceUri                  | ✅   | prompt 含 `ku://kb/...`                 |
| auto-reply 路径感知 evidence      | ✅   | `hasPromptSignal` 含 `context.evidence` |

---

## 4. Prompt 格式摘要

```
Retrieved knowledge evidence (cite using the Citation line + sourceUri):
When answering, quote evidence as 《title Vversion(date)》section and include sourceUri when available.
- Citation: 《Sales Policy V3(2026-05-01)》第 3.2 节 (ku://kb/...)
  Excerpt: ...
```

元数据对象（`KnowledgeObject` 子串）与 indexed evidence 并存；有索引命中时 evidence 优先供 Agent 引用。

---

## 5. 质量门禁

| 门禁                                                 | 结果        |
| ---------------------------------------------------- | ----------- |
| Step 7 新增测试                                      | **4/4**     |
| knowledge + retrieval + RPC + auto-reply（标准口径） | **127/127** |
| oxlint（Step 7 改动文件）                            | ✅          |

**标准复跑命令**：

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/knowledge/ src/retrieval/ \
  src/auto-reply/reply/knowledge-universe-context.test.ts \
  src/gateway/server-methods/knowledge-base-rpc.test.ts \
  src/gateway/server-methods/knowledge-deliverables-rpc.test.ts \
  src/gateway/server-methods/knowledge-base-search-rpc.test.ts \
  src/gateway/server-methods/knowledge-personal-ingest-rpc.test.ts
# → 127 passed
```

---

## 6. 残余技术债

| 编号  | 问题                                    | 归属     |
| ----- | --------------------------------------- | -------- |
| S7-D1 | 未单独暴露「指定 versionId 检索」RPC    | 后续增强 |
| S6-D1 | binary/PDF 无 bytes → evidence 质量受限 | 附件通道 |
| S2-D4 | 成果 relatedKnowledgeBaseId 归档        | Step 8   |
| S5-D1 | base.search substring 不返回 bundle     | Step 8   |

---

## 7. 下一步（Step 8）

- 前端库内检索 UI + 成果中心归档到 KB
- 用户可感知 P1 闭环
