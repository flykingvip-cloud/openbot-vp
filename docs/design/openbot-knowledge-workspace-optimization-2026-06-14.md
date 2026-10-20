# OpenBot 知识工作台(Knowledge Workspace)优化方案

Date: 2026-06-14
Status: 草案待评审
作者: 架构评审(基于全量代码审查)
关联文档:

- `docs/design/openbot-knowledge-universe-final-task-plan-2026-06-05.md`(v5 认知层方案,本方案对其做产品重心修正)
- `docs/design/openbot-knowledge-universe-m2-review-report-2026-06-05.md` ~ `m5`(里程碑验收)
- `docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md`(企业供给边界)

---

## 0. 执行摘要(TL;DR)

当前「知识宇宙」作为**统一认知层(Cognitive Layer)** 完成度高(后端三源聚合、关系运行时、Agent 消费链、企业治理对接均已落地),但与业务目标——**对标 ima 的「知识库管理 + 成果文件沉淀」工作台**——存在**产品重心偏移**:

1. **缺核心实体 `KnowledgeBase`**:知识对象是扁平列表,只按来源/投影分组,用户无法建立"我的文件属于哪个知识库"的认知。
2. **缺「成果中心」聚合**:`Deliverable` 实体其实已存在于协作核心,但未聚合到知识工作台,员工无法统一查看 AI/协作/项目产出。
3. **检索是元数据子串匹配,无 RAG**:这是对标 ima 最大的隐性成本,却最容易被忽略。没有它,知识库只是"带权限的文件夹"。
4. **首页以关系图谱为唯一主角**:与"先找文件/找成果"的真实诉求不符,图谱应是增强能力而非入口。

**核心结论**:不推翻已有后端,而是**补两个实体(KnowledgeBase / 聚合 Deliverable)、补一层检索(RAG)、把图谱降级为洞察 Tab**,并最大化复用现有的 `skill-lifecycle-store`(个人资产 + 来源机器人 + 版本)、`@openbot/collaboration-core` 的 `Deliverable`、以及企业治理/授权链。

定位从 **Knowledge Universe(知识宇宙)** 调整为:

> **Knowledge Workspace(知识工作台)= 知识库 + 成果中心 + 企业知识 + 数据能力 + 关系洞察**

---

## 1. 背景:目标与现状的定位偏差

| 维度         | 业务目标(对标 ima)                                     | 当前实现                                 | 偏差     |
| ------------ | ------------------------------------------------------ | ---------------------------------------- | -------- |
| 用户首要诉求 | "我的报告在哪""销售库有竞品分析吗""把讨论沉淀进知识库" | 首页=以"我"为中心的关系网络              | 入口错位 |
| 核心对象     | 知识库(含文件/标签/机器人/权限)                        | 扁平 `KnowledgeObject`                   | 缺实体   |
| 成果沉淀     | 自动归档 AI/协作/项目产出                              | 仅 `knowledge.personal.collect` 手动收录 | 缺自动化 |
| 检索         | 基于文档内容的语义问答/召回                            | 标题/摘要/标签子串匹配                   | 缺 RAG   |
| 协作         | 谁产出了什么、机器人参与了什么                         | 关系图边可表达,但无成果视图              | 体感弱   |

成熟度评分:作为认知层 ≈ 8.5/10;作为知识库+成果工作台 ≈ 6.5/10。**问题不在技术,在产品重心。**

---

## 2. 现状代码全景(基于全量代码审查)

### 2.1 分层架构

```
前端 (ui/src/ui)
  views/knowledge-universe-*.ts        ← 10 个 Lit 视图组件
  ports/employee/.../home-page-contracts.ts (WorkbenchKnowledgeSurface 契约, 21 callbacks)
  controllers/knowledge-universe.ts    ← 状态机(39 字段, hasLoaded guard)
  capability/knowledge-universe/        ← facade / gateway-client / mock-backend / 图布局
        │ knowledge.* RPC
后端 (src/gateway/knowledge)
  server-methods/knowledge.ts          ← 20 个 RPC handler
  router.ts                            ← search/relationships/object/resolve/context/...
  source-bundle.ts                     ← 三源聚合(personal/enterprise/data)
  sources/** feed/** runtime/** resolve/** lineage/** governance/** adapter/**
        │
持久化:
  ~/.openbot/skill-assets/store.json          (个人知识 = 技能资产)
  ~/.openbot/openbot-enterprise-data.json     (企业投影/数据能力/治理审批)
```

### 2.2 后端关键事实(均有代码佐证)

| 事实                               | 证据                                                                                                                                | 影响                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **检索=元数据子串匹配,无向量/RAG** | `src/gateway/knowledge/router.ts` `matchesQuery`(只拼 title+summary+tags+source+kind 后 `.includes()`);`resolve-engine.ts` 同一函数 | ima 式问答无法实现                |
| **文档正文不入索引**               | `sources/personal-source.ts` 仅映射 `profile.summary`;Office/PDF 仅登记元数据(M2 报告)                                              | 召回质量低                        |
| **无 `KnowledgeBase` 实体**        | `source-bundle.ts` 产出扁平 `KnowledgeObject[]`;企业"库"= `libraryCount`=投影数                                                     | 无法建库                          |
| **个人知识 = 技能资产**            | `sources/personal-source.ts` → `listPersonalSkillAssets()`(`skill-lifecycle-store.ts`)                                              | 复用地基(见 2.4)                  |
| **最近访问在内存**                 | `recent-visits.ts` 进程内 Map                                                                                                       | 重启丢失                          |
| **企业知识申请=内存桩**            | `access-request.ts` `requestKnowledgeEnterpriseAccess`(Map,无治理)                                                                  | 与数据能力申请不一致              |
| **数据能力申请=真治理**            | `seat-capability-access.ts` → governance approval(本轮已打通)                                                                       | 可作为模板                        |
| **Agent 消费=system prompt 注入**  | `auto-reply/reply/knowledge-universe-context.ts` → `buildKnowledgeUniverseSystemPrompt`;`cron/isolated-agent/run.ts`                | 仅元数据行,无 turn 内按需检索工具 |
| **死代码**                         | `access-request.ts` `requestKnowledgeDataCapabilityAccess` 未被 RPC 调用                                                            | 清理项                            |

### 2.3 前端关键事实

- 页面区块顺序(本轮已调整):搜索 → 来源卡 → 快捷操作 → 关系网络(主) → 最近/推荐 → 供给与管理(个人/企业/数据)。
- `loadKnowledgeUniverseHome` 有 `hasLoaded` guard,二次进入不刷新(`controllers/knowledge-universe.ts`)。
- 无 client 时整体走 `mock-backend.ts`。
- **KU 模块内无「知识库容器」、无「成果」视图**。
- `onOpenMyAccumulation` 跳到 **Settings → my-accumulation**(独立 surface,展示技能/能力清单,即"我的沉淀")。

### 2.4 既有可复用资产(本方案的关键杠杆)

> 这一节决定了工作量。结论:**KnowledgeBase 与成果中心的数据底座大多已存在,以"视图+容器+钩子"为主,而非从零建模。**

**(a) `skill-lifecycle-store.ts` —— 个人知识/资产的成熟底座**

`EmployeeSkillProfile` / `EmployeeSkillSummary` 已含:

- `assetType`: `prompt | template | workflow | knowledge | agent | capability`
- `tags` / `category` / `visibility(private|group|enterprise)`
- `sourceRobot: {id, name}` ← **哪个机器人产出**(成果溯源现成字段)
- `version` / `versionCount` / `versions[]`(完整版本历史 + diff)
- `lifecycle`(draft→private→reviewing→approved→published→deprecated→retired)
- `sharedGroups[]` / `enterpriseConsumers[]` / robot 安装关系
- `health`(成功率/延迟/失败原因)

已具备:建资产(`saveSkillAsset`,记录 sourceAgentId)、编辑、版本、回滚、迁移、分享到群、提交企业评审、依赖拓扑。

**(b) `@openbot/collaboration-core` 的 `Deliverable` —— 成果中心的现成模型**

`packages/collaboration-core/src/types/deliverable.ts`:

```ts
type Deliverable = {
  deliverableId;
  groupId;
  taskId?;
  title;
  description?;
  content?;
  contentType?;
  status;
  version;
  previousVersionId?;
  submittedBy?;
  approvedBy?;
  publishedBy?;
  submittedAtMs?;
  approvedAtMs?;
  publishedAtMs?;
  createdBy?;
  updatedBy?;
  createdAtMs;
};
```

已含完整生命周期(提交/批准/发布)+ 版本 + 产出人。前端协作侧已有 `deliverables` / `deliverable-detail` 视图(`ui/src/ui/ports/employee/views/group-profile-governance.ts`)。**缺的是跨群聚合到"我的成果" + 与知识库关联。**

**(c) 企业治理/授权链**

企业投影(projection spec/feed)、可见性策略、数据能力目录、席位授权 + 本轮新增的 `seat-capability-access`(真审批)。企业知识库与数据能力授权**已具雏形**。

**(d) 关系运行时 + M5 Agent 注入**

`runtime/**` + `resolve/**` + `adapter/**`,是机器人消费知识的后端依据。**保留,降级为洞察 Tab + 后端检索信号。**

---

## 3. 核心差距清单

| #   | 差距                                                       | 性质             | 优先级             |
| --- | ---------------------------------------------------------- | ---------------- | ------------------ |
| G1  | 无 `KnowledgeBase` 容器与归属                              | 缺实体           | P0                 |
| G2  | 无「成果中心」聚合视图(跨群 Deliverable + chat/agent 来源) | 缺视图(数据已在) | P0                 |
| G3  | 无自动收录(chat/agent/workspace → 建议入库)                | 缺捕获层         | P1                 |
| G4  | 检索无 RAG(正文不入索引、无向量召回)                       | 缺能力(硬骨头)   | P1(需选型)         |
| G5  | 企业知识申请是内存桩                                       | 一致性           | P1                 |
| G6  | 协作型 KB 无 Owner/Editor/Contributor/Viewer               | 缺权限           | P2                 |
| G7  | 首页以图谱为唯一主角                                       | IA               | P0(本轮已部分缓解) |
| G8  | 最近访问内存态 / 死代码                                    | 健壮性           | P2                 |

---

## 4. 目标架构:Knowledge Workspace = 5 域

```text
知识工作台 Knowledge Workspace
├── 1. 知识库 Knowledge Base     ← 新增实体(建库/上传/标签/权限/挂机器人)
├── 2. 成果中心 Deliverables     ← 聚合 collaboration Deliverable + chat/agent 产出
├── 3. 企业知识 Enterprise       ← 已有,接审批闭环
├── 4. 数据能力 Data Capability  ← 已有(本轮已打通申请→授权)
└── 5. 关系洞察 Knowledge Graph  ← 现有关系运行时降级为此域
```

导航从"单一知识宇宙首页"演进为 5 域(可用 Tab/分区)。用户面命名用「知识库/知识工作台」,图谱称「关系洞察」;`Knowledge Universe` 保留为内部代号与后端模块名(避免大改包名)。

---

## 5. 实体模型设计

### 5.1 KnowledgeBase(新增容器)

不复制文档,只声明"成员归属规则",复用既有对象池:

```ts
type KnowledgeBase = {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  visibility: "private" | "team" | "enterprise";
  // 成员来源:个人库挂技能资产,企业库挂治理投影,避免重复存储
  backend:
    | { kind: "personal"; assetTagFilter?: string[]; assetCategory?: string }
    | { kind: "enterprise"; projectionSpecId: string };
  robotIds: string[]; // 挂载到此库的机器人(喂给 Agent 检索)
  tags: string[];
  retrieval: { mode: "keyword" | "semantic"; indexed: boolean }; // 为 RAG 预留
  documentCount: number;
  createdAtMs: number;
  updatedAtMs: number;
};
```

`KnowledgeObject` 增加可选 `knowledgeBaseId`(个人对象归属);企业库直接映射到投影,不另存。

### 5.2 Deliverable(复用 + 工作台扩展)

不新建实体,扩展 `@openbot/collaboration-core` 的 `Deliverable`,新增"工作台视角"字段或在聚合层附加:

```ts
// 聚合视图(读模型),不改写协作核心存储
type WorkspaceDeliverable = {
  deliverableId: string;
  title: string;
  kind: "report" | "ppt" | "proposal" | "analysis" | "meeting" | "other";
  source: "chat" | "agent" | "group" | "task"; // 由 createdBy/groupId/taskId 推导
  creators: string[]; // submittedBy/createdBy + sourceRobot
  relatedKnowledgeBaseId?: string; // 归档到哪个库
  relatedProjectId?: string;
  status: string; // 复用 DeliverableStatus
  updatedAtMs: number;
};
```

来源映射:协作产出读 `Deliverable`(group/task);AI 对话/Agent 产出读 `skill-lifecycle` 资产的 `sourceRobot`。

### 5.3 与现有 store 的映射(零重复造轮子原则)

| 目标能力       | 复用                                          | 新增                              |
| -------------- | --------------------------------------------- | --------------------------------- |
| 个人知识库成员 | `skill-lifecycle-store` 资产 + tags/category  | KB 容器 store + `knowledgeBaseId` |
| 企业知识库     | 治理投影 + 可见性策略                         | KB→projection 映射只读            |
| 成果(协作)     | `collaboration-core` `Deliverable` + 既有视图 | 跨群聚合读模型                    |
| 成果(AI/Agent) | `skill-lifecycle` `sourceRobot`/`versions`    | 成果语义标注                      |
| 数据能力授权   | `seat-capability-access`(本轮)                | 无                                |
| 关系/推荐      | `runtime/**` `resolve/**`                     | 降级为 Tab                        |

---

## 6. 信息架构与首页重构

```text
┌────────────────────────────────────────────┐
│ 🔍 搜索:知识 / 文件 / 成果 / 机器人          │  ← 检索入口
├──────────────────────┬─────────────────────┤
│ 我的知识库(可建库)   │ 企业知识库            │  ← 实体入口
├──────────────────────┴─────────────────────┤
│ 最近成果:项目报告 / 销售分析 / 会议纪要      │  ← 成果中心(首屏高价值)
├────────────────────────────────────────────┤
│ 推荐知识                                     │  ← 关系运行时轻输出
├────────────────────────────────────────────┤
│ 关系洞察(图谱)  ← 折叠/下半部              │  ← 增强能力,非主角
└────────────────────────────────────────────┘
```

本轮已完成的首页层级调整(搜索→来源卡→快捷操作→网络→供给)是过渡;**目标态需把"知识库实体卡"和"最近成果"提到首屏,把图谱降为折叠区**。

---

## 7. 分阶段实施路线

> 排序原则:用户价值优先 + 复用度优先 + 风险后置。

### P1 —— 实体落地(知识库 + 成果中心)【风险低,多为视图层】

目标:用户能"建知识库、把文件归库、看到跨来源成果"。

- 新增后端:
  - `src/gateway/knowledge/knowledge-base-store.ts`(个人 KB 容器,持久化到 `~/.openbot/`)
  - `src/gateway/knowledge/deliverables/` 聚合读模型(读 collaboration `Deliverable` + skill 资产)
  - RPC:`knowledge.base.create/list/update/delete`、`knowledge.base.attachObject`、`knowledge.deliverables.list`
- 复用:`skill-lifecycle-store`、`collaboration-core` Deliverable、企业投影
- 前端:
  - 新增 `knowledge-base` 域视图(库列表 + 库详情:文件/标签/挂载机器人/权限)
  - 新增「成果中心」视图(AI/协作/项目/已发布/收藏 过滤)
  - 复用本轮首页快捷操作锚点
- 验收:可创建个人库、上传/归档文件入库、库内检索(关键词)、成果中心展示跨群产出并可归档到库。
- 工作量:中;风险:低(数据底座已存在)。

### P2 —— 自动收录(Knowledge Capture Runtime)【中风险】

目标:对话/Agent/协作完成 → 主动建议"收录到哪个库"。

- 新增 `src/gateway/knowledge/capture/`:在 chat 总结、agent 任务完成、协作 deliverable 发布的 hook 点产出建议卡
- 复用:`saveSkillAsset`(已记录 sourceAgentId)、`Deliverable` 发布事件
- 前端:收录建议卡(选择目标库 + 一键归档)
- 验收:聊天生成报告后出现"收录到[销售库/项目A/个人库]"建议;Agent 产出自动建立库关联。
- 工作量:中。

### P3 —— 检索升级(RAG)【高风险,需先选型,见第 8 节】

目标:从"元数据子串"升级为"正文语义召回",让知识库可被问答、可被机器人真正使用。

- 文档正文抽取(扩展 `personal-document-upload.ts` 的 Office/PDF 解析)
- chunk + embedding + 向量索引(新增检索服务)
- `router.ts` / `resolve-engine.ts` 的 `matchesQuery` 升级为混合检索(关键词 + 向量)
- 验收:对知识库内容提问可返回带出处的答案;Agent system prompt 注入相关 chunk 而非仅元数据。
- 工作量:高;风险:高(基础设施依赖)。

### P4 —— 协作权限 + 图谱降级【中风险】

- team 级 KB 引入 Owner/Editor/Contributor/Viewer 四角色(企业 KB 沿用治理可见性,不叠加双 ACL)
- 企业知识申请 `knowledge.enterprise.access.request` 接入 governance(对齐数据能力)
- 关系图谱从首页主角降为「关系洞察」Tab,保留后端 Agent 检索作用
- 最近访问落盘;清理 `access-request.ts` 死代码
- 验收:团队库可分角色协作;企业知识申请走真实审批;图谱作为洞察能力可用但不抢首屏。

---

## 8. RAG 检索决策专章(P3 前置)

**这是对标 ima 能否达成的决定性选型,必须先拍板。**

现状:`matchesQuery` 仅对元数据 `.includes()`,文档正文不入索引。ima/Dify/Coze 的核心是 chunk→embed→向量召回。

候选路径:

| 方案                           | 说明                                             | 成本        | 适用            |
| ------------------------------ | ------------------------------------------------ | ----------- | --------------- |
| A. 外部 embedding + 轻量向量库 | 接 embedding API + sqlite-vss/pgvector/本地 HNSW | 高,质量最好 | 真对标 ima      |
| B. 关键词增强过渡              | 正文抽取 + 全文倒排(BM25/SQLite FTS)+ 标签加权   | 中,无需向量 | 快速改善,非语义 |
| C. 混合                        | 先 B 落地体感,再渐进加 A 的语义层                | 中→高       | 推荐            |

需团队确认:是否有可用 embedding/向量基础设施?数据驻留/合规约束?**在选定前 P3 不启动**,P1/P2 不依赖它即可交付价值。

---

## 9. 与现有里程碑 / spec 的关系

- **不推翻 M1–M5 后端**:三源聚合、关系运行时、resolve/context、企业治理、Agent 注入全部保留。
- **修正 v5 的两条"铁律"**:① 允许"知识库/成果列表"作为一等入口(v5 原文"不允许目录树/知识库首页/文档列表"过严);② 图谱由"首页唯一主角"降为"关系洞察域"。
- **本方案是 v5 的产品重心修正,不是替代**:把投入从"图谱平台化"重新平衡到"知识库 + 成果"两个高感知域。

---

## 10. 风险与取舍

| 风险                        | 应对                                                            |
| --------------------------- | --------------------------------------------------------------- |
| 重复造 Deliverable/资产模型 | 严格复用 collaboration-core + skill-lifecycle,聚合层只做读模型  |
| RAG 基础设施缺失拖累工期    | P1/P2 不依赖 RAG;P3 独立选型,可先上关键词过渡(方案 B)           |
| 多 agent 共享工作树         | 实体 store 为新增文件,降低与他人 WIP 冲突;提交按 task 范围      |
| 企业侧双 ACL                | 企业 KB 沿用治理可见性,四角色仅用于 team KB                     |
| 包名/模块大改               | 后端模块名 `knowledge` 保留,仅用户面文案改为"知识库/知识工作台" |

---

## 11. 范围边界(本期不做)

- 不做企业知识管理后台(归企业端治理中心)。
- 不做连接器/数据网关直连(知识层只消费 Feed,红线不变)。
- 不做图谱平台化的冲突检测深化(维持现状,优先级最低)。
- 不在 P1 引入向量检索(置于 P3,需选型)。

---

## 12. 验收标准汇总

| 阶段 | 关键验收                                                          |
| ---- | ----------------------------------------------------------------- |
| P1   | 建个人库 / 文件归库 / 库内关键词检索 / 成果中心跨来源展示并可归档 |
| P2   | chat/agent/协作完成后出现收录建议并可一键入库                     |
| P3   | 知识库内容可问答(带出处);Agent 注入相关 chunk                     |
| P4   | team 库四角色协作;企业知识申请走治理;图谱降为洞察 Tab             |

---

## 13. 下一步

1. 评审本方案,确认"知识工作台"定位与 5 域划分。
2. 拍板 RAG 选型(方案 A/B/C),决定 P3 是否本期排入。
3. 批准后从 **P1** 启动(纯复用,风险最低):`KnowledgeBase` 容器 + 成果中心读模型 + 两个域视图。
