# OpenBot Context Scope Controller v1.1 补充执行方案

Date: 2026-08-21

Status: **协作运行协议 v1.0 的上下文治理补充 · 脏工作区 WIP，2026-08-22 生产验收不通过，不得宣称已接入 Runtime**。决定：[生产验收决定](/design/collaboration-csc-production-acceptance-2026-08-22)。

Parent: [协作运行协议 v1.0](/design/collaboration-runtime-protocol-v1-execution-2026-08-21) · [Production Runtime Contract](/design/collaboration-production-runtime-contract-v1-2026-08-21)

Related: [Context Compiler](/design/context-compiler-contract-2026-08-20) · inbound-depth chat/retrieve/act

---

## 0. 一句话

CSC 管的是 **本轮上下文获取权**，不是记忆，也不是「谁可以说话」。

```text
Collaboration Policy     → 怎么协作
Round State Machine      → 能不能说、何时说
Context Scope Controller → 本轮允许从哪里看
Retrieval Planner        → 从授权源里具体取什么
Context Compiler         → History 如何编译进模型
Ledger                   → 事实
```

不新增协作话术规则。不把 Group Memory 写进个人记忆。不 overlay LIVE。

---

## 1. 与现有层的边界（禁止再造平行体系）

| 层            | 已有落点                                      | CSC 不替代                            |
| ------------- | --------------------------------------------- | ------------------------------------- |
| 能力天花板    | `inbound-depth.ts` chat/retrieve/act          | 仍决定工具/副作用上限                 |
| History→Model | `src/agents/context-compiler/`                | 仍是唯一 outbound 编译器              |
| 群 Mandatory  | `runtime-context-assembly.ts`                 | 身份/使命/角色/Policy/阶段 **不可关** |
| 知识检索      | `knowledge-universe-context` / resolve-engine | CSC 只授权边界；检索器仍做 query      |

P0 要消灭的是：**用户一开口就无条件 `loadKnowledgeSourceBundle` / 把目录原文塞进 Context。**

Full Scope ≠ Full Context。Deep 也是 Index → Candidate → Rank → Compress → Assembly。

---

## 2. 四级 Mode（≠ InboundDepth）

| Mode      | 何时                                         | 知识预取                        | recursiveFolderScan            |
| --------- | -------------------------------------------- | ------------------------------- | ------------------------------ |
| `minimal` | 简单问答 / inbound `chat` / 用户只要当前对话 | 禁止                            | 禁止                           |
| `auto`    | **默认**                                     | 允许对**已授权**源做 query 检索 | 禁止                           |
| `focused` | 用户点名文件/库/文件夹                       | 只在所选源内检索                | 禁止                           |
| `deep`    | 用户明确 Deep Research                       | 多轮索引检索                    | 允许索引扫描，**禁止全文倾倒** |

Mode 是检索策略；Source 是检索边界。二者不得合成一个字段。

---

## 3. Mandatory vs Optional

**Runtime Mandatory（用户关不掉）：** Bot 身份、群身份、成员关系、当前角色、Collaboration Policy、当前 operating phase、当前会话窗口。

**Retrieval Optional：** SHARED_MEMORY 长尾、任务账本、历史决策、群文件、知识库、外部 API。

用户选「仅当前对话」= 关掉可选检索，**不是**让 Bot 忘记自己在哪个群。

Context 使用 ≠ Memory 学习。群记忆进入个人能力仍走 capsule → projection → asset → promotion。

---

## 4. P0 / P1 / P2 / P3

| 阶段   | 做                                                                                                                                          | 不做                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **P0** | Controller + ScopePlan + Budget；默认 auto；minimal 不扫知识库；focused 只走所选源；群 Mandatory 不可关；`contextPolicy` 进 Policy snapshot | 输入框 UI、扩展确认、企业审计看板 |
| **P1** | `Context ▾` 来源选择 + 「本轮用了哪些资料」                                                                                                 | 把 RAG/Token 术语暴露给用户       |
| **P2** | Context Insufficient → 建议扩源 → 用户确认                                                                                                  | 自动扩到未授权库                  |
| **P3** | 权限/密级/成本归因                                                                                                                          | 绕过 Member Visibility            |

Turn > Session > Group > User Default > System Default。P0 只实现 Turn + System Default。

---

## 5. 代码落点

- `src/gateway/context-scope/` — Controller / Plan / Budget
- `CollaborationPolicyV1.contextPolicy` — 与协作规则并列，禁止混进 mention/supplement
- `get-reply-run.ts` — Scope 之后才决定是否 `buildKnowledgeUniversePromptContext`
- `PersistedRound.contextScopePlan` — 可观测；**不**给 Round SM 增加新的发言状态

验收（自动化）：

1. 普通改写/闲聊 → `minimal`，不预取知识库
2. 未指定源的分析 → `auto`，`recursiveFolderScan=false`
3. 指定 file/kb → `focused`，sources 不含未选库
4. 群会话即使用户只要当前对话 → `mandatorySources` 仍含 group
5. Deep 仍 `fullContextDumpAllowed=false`
