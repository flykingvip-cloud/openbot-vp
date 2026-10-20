# Step 1 实施报告 —— 检索平台骨架 + 知识库容器

Date: 2026-06-14
Status: **正式通过（技术轨，2026-06-14 第二轮验收）** / 产品 P1 不通过
关联计划: `docs/design/openbot-knowledge-rag-integration-plan-2026-06-14.md` (v3) §8 Step 1 / §9 验收
产品方案: `docs/design/openbot-knowledge-workspace-optimization-2026-06-14.md` (P1+P3)

---

## 0. 阶段命名澄清（回应验收 §二 / §5.3）

| 对内名称   | 对外名称              | 可宣称完成度                         |
| ---------- | --------------------- | ------------------------------------ |
| RAG Step 1 | 知识库后端地基        | 后端 API 就绪，待 UI 接入            |
| 产品 P1    | 知识库 + 成果中心 MVP | **不可宣称完成**（需 Step 5–8 闭环） |

**本报告交付的是 RAG 集成计划 Step 1（技术地基），不是产品方案完整 P1。**

---

## 1. 阶段目标与范围

落地 v3 架构的**地基层**，且不依赖后续 RAG 索引：

- `src/retrieval/` **检索平台骨架**：`RetrievalSource` 抽象 + `KnowledgeRetrievalService` 编排 + `Visibility Resolver`。
- `src/gateway/knowledge/knowledge-base-store.ts` **知识库容器**（create/list/get/update/delete/attach）。
- `knowledge.base.*` **RPC** 接入 + 注册 + 权限 scope。
- **RPC 集成测试**（验收 D1）：权限链、tenant 上下文、非 owner 拒绝、attach 幂等。

**本期不含**（属 Step 2/3/4/5/8）：文档抽取、分块、嵌入、sqlite-vec 索引、`KnowledgeSource` 真实检索、`knowledge.base.search`、成果中心、前端。

---

## 2. 交付物

### 新增文件

| 文件                                                    | 职责                       |
| ------------------------------------------------------- | -------------------------- |
| `src/retrieval/types.ts`                                | 平台契约                   |
| `src/retrieval/visibility-resolver.ts`                  | 权限门                     |
| `src/retrieval/retrieval-service.ts`                    | 多源编排                   |
| `src/gateway/knowledge/knowledge-base-store.ts`         | KB 容器 JSON 持久化        |
| `src/retrieval/visibility-resolver.test.ts`             | 4 用例                     |
| `src/retrieval/retrieval-service.test.ts`               | 5 用例                     |
| `src/gateway/knowledge/knowledge-base-store.test.ts`    | 8 用例（含损坏 JSON 恢复） |
| `src/gateway/server-methods/knowledge-base-rpc.test.ts` | 5 用例（RPC 权限链集成）   |

### 改动文件（均为追加，不改既有逻辑）

| 文件                                      | 改动                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `src/gateway/server-methods/knowledge.ts` | 新增 6 个 `knowledge.base.*` handler；`update` 补 tenant 二次校验（D5） |
| `src/gateway/method-scopes.ts`            | READ/WRITE scope 注册                                                   |
| `src/gateway/server-methods-list.ts`      | 注册 6 个方法名                                                         |

---

## 3. 验收对照（计划 §9 Step 1 + 专家附加条件）

| 验收项                              | 结果                   | 证据                                                 |
| ----------------------------------- | ---------------------- | ---------------------------------------------------- |
| 平台可注册 source                   | ✅                     | `retrieval-service.test.ts`                          |
| 建库 / 归属 / 列文件                | ✅                     | `knowledge-base-store.test.ts`                       |
| 权限字段就位                        | ✅                     | `visibility-resolver.test.ts` + RPC 层过滤           |
| RPC 集成测试（D1）                  | ✅                     | `knowledge-base-rpc.test.ts` 5 用例                  |
| update visibility tenant 校验（D5） | ✅                     | RPC handler + 集成测试                               |
| 损坏 store 恢复                     | ✅                     | `knowledge-base-store.test.ts` invalid JSON → 空列表 |
| 测试计数说明（D8）                  | ✅                     | 见 §5                                                |
| 代码落地                            | ✅ 已提交 `791fb2178d` | Task: knowledge-rag-step1 / Agent: cursor-composer   |

### 已知缺口（Step 1 可接受，后续 Step 补齐）

| 编号 | 问题                                     | 计划 Step               |
| ---- | ---------------------------------------- | ----------------------- |
| D2   | attach 未对接 skill-lifecycle-store      | Step 4                  |
| D3   | RPC 命名 `attach` vs 方案 `attachObject` | Step 8 文档对齐或 alias |
| D4   | 缺 `retrieval: { mode, indexed }` 等字段 | Step 3–4                |
| D6   | 无 detach / 批量 list 文档详情           | Step 4–5                |

---

## 4. 产品轨对照（P1 — 不通过，预期内）

| 产品预期        | 状态             |
| --------------- | ---------------- |
| 前端建库 / 管理 | ❌ Step 8        |
| 文件归库闭环    | ❌ Step 4        |
| 库内关键词检索  | ❌ Step 5        |
| 成果中心        | ❌ Step 4–8 并行 |
| 首页 IA 调整    | ❌ Step 8        |

---

## 5. 质量门禁证据

| 门禁                     | 结果                                                           |
| ------------------------ | -------------------------------------------------------------- |
| **新增单元测试**         | **17/17 通过**（visibility 4 + retrieval-service 5 + store 8） |
| **RPC 集成测试**         | **5/5 通过**                                                   |
| **Step 1 合计**          | **22/22 通过**                                                 |
| 回归（knowledge 域全量） | **58/58 通过**（含 boundary、seat-capability-access 等）       |
| oxlint                   | 0 warnings / 0 errors                                          |
| oxfmt                    | 全部规范                                                       |
| 既有 knowledge RPC       | 追加式，未改动原有 handler 逻辑                                |

> **D8 更正说明**：此前报告「21/21」混用了回归套件计数。正确口径为：Step 1 新增 **17** 个 store/平台单测 + **5** 个 RPC 集成测 = **22**；若含 `knowledge-consumption-boundary` 等边界测试，总套件为 24+。

---

## 6. 可复跑验证命令

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/retrieval/ \
  src/gateway/knowledge/knowledge-base-store.test.ts \
  src/gateway/server-methods/knowledge-base-rpc.test.ts

pnpm exec oxlint src/retrieval src/gateway/knowledge/knowledge-base-store.ts \
  src/gateway/server-methods/knowledge.ts src/gateway/server-methods/knowledge-base-rpc.test.ts
```

---

## 7. 验收决议（第二轮，2026-06-14）

| 轨道                   | 结论                                |
| ---------------------- | ----------------------------------- |
| RAG Step 1（技术地基） | ✅ **正式通过**，准予进入 Step 2    |
| 产品 P1（用户可感知）  | ❌ 不通过（待 Step 5–8 + 成果中心） |

**闭环待办（R1）**：✅ 已于 2026-06-14 提交 `791fb2178d`。

---

## 8. 下一步

- **Step 2**：文档正文抽取 + 两层 hash。
- **并行（产品 P1 核心）**：成果中心聚合读模型 + `knowledge.deliverables.list`（不必等 RAG 全通）。
- **Step 5–8**：库内检索 + 前端闭环 → 产品 P1 可验收。
