# OpenBot 员工端知识空间统一化实施设计方案

Date: 2026-06-29
Status: 待评审
适用范围: 员工端知识工作台中的知识空间、知识库、知识供给、数据能力相关能力
交付对象: 第三方实施团队
验收责任: OpenBot 架构与代码验收方

关联文档:

- `docs/design/openbot-knowledge-workspace-optimization-2026-06-14.md`
- `docs/design/openbot-knowledge-runtime-core-execution-plan-2026-06-25.md`
- `docs/design/openbot-knowledge-universe-homepage-redesign-acceptance-2026-06-24.md`
- `docs/design/openbot-knowledge-space-unification-work-breakdown-2026-06-29.md`
- `docs/design/openbot-knowledge-space-unification-migration-flags-2026-06-29.md`（§9.3 惰性回填、`knowledge.compat.status`、Phase 3 开关）
- `docs/design/openbot-knowledge-space-unification-acceptance-sop-2026-06-29.md`

---

## 0. 执行摘要

本方案的核心结论只有一句话:

> 员工端的“知识空间”与“知识库”必须统一收口到 `KnowledgeBase`，空间类型必须统一收口到 `KnowledgeBase.visibility`，导入行为必须强制绑定到某个空间，主动能力与被动知识只保留为“平面差异”，不再保留为另一套空间分类体系。

基于当前仓库代码核实，后端已经具备这次统一化改造所需的大部分基础能力:

1. `KnowledgeBase` 已经是知识空间容器实体，且具备 `visibility = private | team | enterprise`。
2. `knowledge.base.create` 已经按 `visibility` 推导 `backendKind`。
3. `knowledge.base.list` 已经能返回当前用户可见的全部空间。
4. 真正阻碍统一的不是模型缺失，而是现状存在多套并行口径:
   - 一套是 `KnowledgeBase` 容器体系。
   - 一套是 `source-bundle` 聚合出的散装对象体系。
   - 一套是 `SourceDescriptor` 自带的 `visibility` 和 `plane`。
   - 一套是部分导入 RPC 的“未选空间时自动落入个人收件箱”兼容行为。

本设计文档的目标不是重写知识域，而是在不推翻现有后端的前提下，形成一份可直接交给第三方团队执行的实施方案，并明确验收红线。

---

## 1. 已核实的现状

本节仅记录已经在当前仓库代码中核实过的事实，不引用外部截图和未落库的前端文件名。

### 1.1 核心实体与分类轴

`KnowledgeBase` 当前定义位于 `src/gateway/knowledge/knowledge-base-store.ts`，字段中已包含:

- `visibility: "private" | "team" | "enterprise"`
- `backendKind: "personal" | "enterprise"`
- `ownerId`
- `tenantId`
- `documentIds`

这说明:

1. “个人 / 团队 / 企业”这条空间主轴已经存在。
2. `backendKind` 不是空间主轴，而是当前实现中附着在空间上的第二分类轴。

### 1.2 创建空间的真实行为

`knowledge.base.create` 位于 `src/gateway/server-methods/knowledge.ts`，当前行为是:

1. 校验 `title` 必填。
2. 从请求上下文取 `userId` 与 `tenantId`。
3. 若 `visibility = team | enterprise`，要求存在企业上下文。
4. 以 `visibility === "private" ? "personal" : "enterprise"` 推导 `backendKind`。

这说明创建空间时，系统已经把 `visibility` 当成用户真正感知的空间类型。

### 1.3 另一套并行宇宙确实存在

`src/gateway/knowledge/source-bundle.ts` 当前并不是以 `KnowledgeBase` 为中心组织首页和供给页数据，而是拼接:

- `loadPersonalKnowledgeObjects()`
- 企业 feed bundle objects
- `dataCapabilities`

`src/gateway/knowledge/sources/types.ts` 中也保留了:

- `sourceBrowse.personal`
- `sourceBrowse.enterprise`
- `sourceBrowse.enterpriseRestricted`

这意味着“知识对象浏览宇宙”和“知识空间容器宇宙”当前是分开的。

### 1.4 个人散装知识不是从知识空间列表来的

`src/gateway/knowledge/sources/personal-source.ts` 中，个人知识对象来自 `listPersonalSkillAssets()`，再映射为 `KnowledgeObject[]`。

这说明当前“我的知识”并不是读取某个 `KnowledgeBase` 容器，而是读取个人资产池后拼成对象列表。

### 1.5 导入 RPC 目前不统一

当前已核实的导入相关入口包括:

- `knowledge.personal.collect`
- `knowledge.personal.upload`
- `knowledge.personal.collectWeb`
- `knowledge.personal.importDataset`
- `knowledge.deliverables.attach`
- `knowledge.source.bind`

其中:

1. `knowledge.personal.importDataset` 已经要求 `knowledgeBaseId` 必填。
2. `knowledge.personal.collect`、`knowledge.personal.upload`、`knowledge.personal.collectWeb` 允许不传 `knowledgeBaseId`。
3. `knowledge.source.bind` 也允许不传 `knowledgeBaseId`，且还允许单独传 `visibility`。

### 1.6 未指定空间时会自动落入个人收件箱

`resolveKnowledgeBaseIdForPersonalMutation()` 位于 `src/gateway/server-methods/knowledge.ts`，当前逻辑是:

1. 如果显式传了 `knowledgeBaseId`，直接使用。
2. 如果未传但有 `userId`，则调用 `ensurePersonalInboxKnowledgeBase()`。
3. `ensurePersonalInboxKnowledgeBase()` 会创建标题为“我的收录”的私有 KB，tag 为 `openbot:personal-inbox`。

这说明现状确实存在“隐式默认建库并自动落入 private 空间”的行为。

### 1.7 主动源和空间可见性目前会漂移

`knowledge.source.bind` 当前会把请求里的 `visibility` 原样传入 `bindKnowledgeSource()`。

`src/gateway/knowledge/sources/source-binding-store.ts` 中的 `SourceDescriptor` 也会把这个 `visibility` 独立写入 binding 记录。

这意味着:

1. 主动源已经和某个 `KnowledgeBase` 绑定。
2. 但其可见性还可以和空间自身的 `visibility` 分离。
3. 这是本次统一必须清理的一条分叉。

### 1.8 列表可见性已经有了，但写权限并未统一

`knowledge.base.list` 会根据可见性返回当前用户可见的全部知识空间。

但几乎所有写操作仍走 `ownedKnowledgeBaseForMutation()`，当前只认:

- `existing.ownerId === context.userId`

虽然系统已经有 `viewer | editor | admin` 的成员模型，但尚未接入写权限判断。

这意味着团队空间即使“看得见”，也不一定“写得进”。

### 1.9 员工端知识宇宙 UI 实施面已在仓库中落地

本轮 UI 改造的主要实施面位于 `ui/src/ui/views/`，下列文件**已在当前仓库中存在**，且为统一化改造的直接承载（非“待第三方新建”）:

- `ui/src/ui/views/knowledge-universe-page.ts` — 知识工作台页面根与 Tab 路由
- `ui/src/ui/views/knowledge-universe-library-workspace-page.ts` — 空间详情 / 来源 Tab / passive-active 过滤
- `ui/src/ui/views/knowledge-universe-library-create-page.ts` — 唯一「创建知识空间」入口
- `ui/src/ui/views/knowledge-universe-personal-panel.ts` — 被动导入抽屉（collect / upload 等）

关联辅助模块（分组、供给同源、导入漏斗）:

- `ui/src/ui/views/knowledge-universe-library-grouping.ts`
- `ui/src/ui/views/knowledge-universe-supply-spaces.ts`
- `ui/src/ui/views/knowledge-universe-space-ingest.ts`

验收时以**行为 + RPC 契约**为准，同时以上述文件为代码定位边界；若外部建议中的文件名与上表不一致，以上表为准。

---

## 2. 问题定义

### 2.1 当前问题不是“没有知识空间”

当前问题不是系统缺少知识空间模型，而是存在以下四类不一致:

1. 模型口径不一致:
   - `KnowledgeBase.visibility`
   - `KnowledgeBase.backendKind`
   - `sourceBrowse.personal / enterprise / data`
   - `SourceDescriptor.visibility`

2. 导入口径不一致:
   - 有的入口要求显式空间。
   - 有的入口默默落入个人收件箱。
   - 有的入口还能自带另一套 `visibility`。

3. 权限口径不一致:
   - 空间已经支持成员角色。
   - 写入行为却仍是 owner-only。

4. 展示口径不一致:
   - 一套 UI 面向容器空间。
   - 一套 UI 面向散装对象。
   - 用户很难判断“这份知识属于哪个空间”。

### 2.2 必须解决的用户级问题

本次改造后，用户必须能完成以下闭环:

1. 创建一个个人 / 团队 / 企业知识空间。
2. 明确知道当前要导入到哪个空间。
3. 用统一导入入口导入文件、网页、数据集、笔记，或接入主动能力。
4. 在统一的空间列表中，按个人 / 团队 / 企业看到它。
5. 打开该空间后，看到该空间内的被动知识与主动能力。
6. 团队空间中的非 owner 成员，在具备编辑权限时也能导入和维护内容。

---

## 3. 设计目标

### 3.1 目标

1. 一个实体: 用户面“知识空间”统一等价于 `KnowledgeBase`。
2. 一条主轴: 用户面空间类型统一等价于 `KnowledgeBase.visibility`。
3. 一个导入漏斗: 所有导入都必须显式指向某个空间。
4. 一个列表宇宙: 首页和工作台不再并行维护“散装对象宇宙”和“空间宇宙”。
5. 一个权限模型: 可见性控制读范围，成员角色控制写范围。
6. 一个平面概念: 被动知识与主动能力只保留为 `plane = passive | active`，不再视作另一套空间分类。

### 3.2 非目标

本方案不在本轮实现以下内容:

1. 不重写知识检索、RAG、lineage、governance 核心实现。
2. 不删除既有 `backendKind` 存储字段，只将其降级为兼容字段。
3. 不在本轮重命名内部 `knowledge-universe` 模块名。
4. 不要求一次性推翻全部现有 UI，只要求对外行为统一。

### 3.3 设计原则

1. 先统一语义，再清理兼容代码。
2. 先补权限，再统一入口，否则团队空间只是“看得见但写不进”。
3. 先前端强制显式选空间，再后端收紧 RPC。
4. 所有新增接口字段尽量 optional，保护现有调用方。
5. 对历史数据采用惰性迁移和幂等迁移，不做破坏性重写。

---

## 4. 目标模型

### 4.1 统一后的用户心智

统一后用户看到的模型如下:

```text
知识工作台
  -> 知识空间列表
     -> 个人空间
     -> 团队空间
     -> 企业空间

知识空间
  -> 被动知识 passive
     -> 文档
     -> 网页
     -> 数据集
     -> 摘录 / 笔记
     -> Agent 生成知识
  -> 主动能力 active
     -> API
     -> External source
     -> Capability
```

### 4.2 统一后的分类映射

| 用户概念 | 后端实体                          | 后端字段                    |
| -------- | --------------------------------- | --------------------------- |
| 个人空间 | `KnowledgeBase`                   | `visibility = "private"`    |
| 团队空间 | `KnowledgeBase`                   | `visibility = "team"`       |
| 企业空间 | `KnowledgeBase`                   | `visibility = "enterprise"` |
| 被动知识 | `SourceDescriptor` / 文档索引对象 | `plane = "passive"`         |
| 主动能力 | `SourceDescriptor`                | `plane = "active"`          |

### 4.3 `backendKind` 的未来定位

统一后，`backendKind` 的定位改为:

1. 存量兼容字段。
2. 由空间类型派生:
   - `private -> personal`
   - `team | enterprise -> enterprise`
3. 不再作为任何 UI 一级分类依据。

### 4.4 `SourceDescriptor.visibility` 的未来定位

统一后:

1. 绑定到空间的 source 不允许拥有独立于空间的可见性。
2. `SourceDescriptor.visibility` 必须从所属 `KnowledgeBase.visibility` 派生。
3. 若未来存在“不绑定空间的临时能力”，应显式定义为另一类对象，不能继续复用当前 binding 模型。

---

## 5. 权限模型设计

### 5.1 读权限

读权限继续基于两层控制:

1. 空间可见性:
   - `private`: owner 可见
   - `team`: 同 tenant 且满足团队可见性规则的成员可见
   - `enterprise`: 同 tenant 的企业可见主体可见

2. 现有治理与检索侧可见性逻辑保持不变。

### 5.2 写权限

本次必须新增统一写权限判断能力，替代当前 owner-only 的 `ownedKnowledgeBaseForMutation()` 语义。

建议新增三个能力函数:

1. `canReadKnowledgeBase()`
2. `canWriteKnowledgeBase()`
3. `canAdminKnowledgeBase()`

其中:

| 角色   | 读取 | 导入被动知识 | 绑定主动能力 | 修改空间元信息 | 邀请成员 |
| ------ | ---- | ------------ | ------------ | -------------- | -------- |
| owner  | 是   | 是           | 是           | 是             | 是       |
| admin  | 是   | 是           | 是           | 是             | 是       |
| editor | 是   | 是           | 是           | 否             | 否       |
| viewer | 是   | 否           | 否           | 否             | 否       |

### 5.3 实施要求

第三方团队必须:

1. 不得继续将团队空间写入限制为 owner-only。
2. 必须把 `knowledge.base.members.*` 中的成员角色接入真正的写权限判断。
3. 必须为所有写操作统一使用新权限能力，而不是每个 RPC 单独写一套分支。

---

## 6. 后端接口设计

### 6.1 保留不变的接口

以下接口保留方法名与主体语义:

- `knowledge.base.create`
- `knowledge.base.get`
- `knowledge.base.list`
- `knowledge.base.update`
- `knowledge.base.delete`
- `knowledge.base.documents.list`
- `knowledge.base.web.list`
- `knowledge.base.datasets.list`
- `knowledge.base.agent-knowledge.list`
- `knowledge.base.recycle.list`

### 6.2 必须改造的接口

#### 6.2.1 `knowledge.personal.collect`

目标行为:

1. 最终态要求 `knowledgeBaseId` 必填。
2. 导入时不再隐式创建个人收件箱。
3. 写权限按 `canWriteKnowledgeBase()` 校验。

兼容落地策略:

1. Phase 1:
   - 前端必须显式传 `knowledgeBaseId`
   - 后端仍兼容缺省值，但返回 warning
2. Phase 2:
   - 后端拒绝不带 `knowledgeBaseId`

#### 6.2.2 `knowledge.personal.upload`

要求同 `collect`。

#### 6.2.3 `knowledge.personal.collectWeb`

要求同 `collect`。

#### 6.2.4 `knowledge.personal.importDataset`

该接口已要求 `knowledgeBaseId`，本轮仅需:

1. 接入统一写权限判断。
2. 确保返回体中保留明确的 `knowledgeBaseId`。

#### 6.2.5 `knowledge.source.bind`

这是本轮必须重点改造的接口。

目标行为:

1. `knowledgeBaseId` 必填。
2. 请求体不再接收独立 `visibility` 作为可信输入。
3. source binding 的 `visibility` 必须继承目标空间的 `visibility`。
4. 写权限按 `canWriteKnowledgeBase()` 校验。

兼容要求:

1. Phase 1 可以接受旧字段 `visibility`，但必须忽略并记录兼容 warning。
2. Phase 2 从请求契约中移除该字段。

#### 6.2.6 `knowledge.deliverables.attach`

当前接口已要求 `knowledgeBaseId`，本轮仅需:

1. 统一写权限校验。
2. 对团队空间允许 editor/admin attach。

### 6.3 建议新增的聚合接口

为了减少前端对多个内容列表接口的拼装成本，建议新增:

`knowledge.base.sources.list`

推荐返回结构:

```ts
type KnowledgeBaseSourceListItem = {
  id: string;
  knowledgeBaseId: string;
  plane: "passive" | "active";
  kind:
    | "document"
    | "upload"
    | "web"
    | "dataset"
    | "note"
    | "agent-knowledge"
    | "api"
    | "external"
    | "capability";
  title: string;
  status?: string;
  sourceDescriptorId?: string;
  documentId?: string;
  updatedAtMs: number;
  visibility: "private" | "team" | "enterprise";
};
```

设计目的:

1. 让“空间详情页”可以统一展示来源列表。
2. 前端无需并行请求多个 list 接口后再做二次拼装。
3. 为后续“按来源类型过滤”“按 plane 过滤”打基础。

### 6.4 `knowledge.base.list` 的实施要求

本次不强制新增 RPC，但必须保证:

1. 返回结果稳定携带 `visibility`。
2. 前端能够基于该字段分组。
3. 若新增 `visibility` 过滤参数，必须是 optional，不得破坏现有无参调用。

---

## 7. 默认个人收件箱的兼容与退役

### 7.1 当前行为

当前系统存在系统生成的“我的收录”私有 KB，tag 为 `openbot:personal-inbox`。

### 7.2 未来定位

该空间在统一后不应再承担“未选空间时的静默兜底”职责。

建议将其定位调整为:

1. 历史兼容空间。
2. 可被用户显式看到，但不再由系统偷偷创建和偷偷写入。
3. 仅在历史数据迁移和老调用方兼容期间保留。

### 7.3 退役策略

1. Phase 1:
   - UI 不再依赖隐式收件箱。
   - 老接口缺省时仍可落入收件箱，但返回 warning。
2. Phase 2:
   - 服务端禁止缺少 `knowledgeBaseId`。
3. Phase 3:
   - 将收件箱从“默认空间”完全降级为普通私有空间。

---

## 8. 前端行为设计

由于当前仓库未包含外部建议里所引用的具体员工端页面文件名，本节以行为要求和 API 契约为准。

### 8.1 一级导航

知识工作台中的知识空间列表必须按三段分组展示:

1. 个人空间
2. 团队空间
3. 企业空间

允许保留:

- pinned
- favorites
- recent

但它们不能再替代空间类型分组本身。

### 8.2 创建入口

必须只保留一个正式创建入口:

- 创建知识空间

创建弹窗或页面中必须显式选择:

- 个人
- 团队
- 企业

禁止:

1. 点击“导入”时顺手自动建一个私有空间。
2. 由某个快捷入口跳过空间类型选择。

### 8.3 导入入口

所有导入入口必须统一为两步:

1. 先选目标空间
2. 再选导入类型

导入类型分为两类:

1. 被动知识:
   - 上传文件
   - 网页收藏
   - 数据集导入
   - 笔记 / 摘录
   - Agent 生成知识

2. 主动能力:
   - API
   - External source
   - Capability

### 8.4 供给与管理页

供给与管理页不得继续与空间列表并行维护另一套“我的知识 / 企业知识 / 数据能力”的一级实体宇宙。

统一后推荐语义:

1. “我的知识 / 团队知识 / 企业知识”读取同一份 `knowledge.base.list` 数据后按 `visibility` 过滤。
2. “数据能力”保留为 active plane 的管理视图，而不是另一类空间。

### 8.5 空间详情页

空间详情页至少需要支持以下过滤视图:

1. 全部
2. 被动知识
3. 主动能力
4. 已移除或回收内容

若第三方团队不实现新的聚合接口，则必须在前端显式标注这些视图是聚合结果，而不是混淆成单一数据源。

---

## 9. 迁移方案

### 9.1 迁移目标

迁移的重点不是重写历史数据，而是消除未来行为的不一致。

### 9.2 需要处理的存量数据

1. 已存在的私有 / 团队 / 企业 KB。
2. 历史自动创建的“我的收录”收件箱 KB。
3. 已存在的 source bindings。
4. 历史 attach 到空间中的文档与 deliverable。

### 9.3 迁移策略

#### 9.3.1 `backendKind`

不做存量重写，仅作为派生兼容字段保留。

#### 9.3.2 source binding visibility 回填

所有绑定到 KB 的 source binding 必须执行幂等回填:

1. 找到其 `knowledgeBaseId`
2. 读取目标 KB 的 `visibility`
3. 用该值覆盖 binding 的 `visibility`

**实施与验收落点**（惰性迁移，非独立停机脚本）见  
`docs/design/openbot-knowledge-space-unification-migration-flags-2026-06-29.md` §2:

- 读路径：`listKnowledgeSourceBindings()` 内自动调用 `backfillSourceBindingVisibilities()`
- 显式巡检 RPC：`knowledge.compat.status`（返回 `sourceBindingVisibilityBackfill` 摘要）
- 导出函数：`backfillSourceBindingVisibilityStore()`（同上文档）

#### 9.3.3 个人收件箱

不删除，不迁移，不隐藏历史内容。

#### 9.3.4 隐式导入兼容

在服务端引入兼容 warning，记录哪些调用方仍未传 `knowledgeBaseId`，用于后续关停。

### 9.4 迁移原则

1. 幂等
2. 可回滚
3. 不要求停机
4. 不做破坏性数据删除

---

## 10. 分阶段实施计划

### 10.1 Phase 0 设计冻结

交付物:

1. 本设计文档评审通过。
2. 确认 UI 实际承载仓与页面文件落点。
3. 确认第三方团队采用的联调环境。

通过标准:

1. 统一模型与接口策略不再变动。
2. 权限矩阵冻结。

### 10.2 Phase 1 入口与权限统一

目标:

1. 前端导入入口全部显式选空间。
2. 后端写权限从 owner-only 升级到 owner/admin/editor。
3. `knowledge.source.bind` 改为继承空间可见性。

通过标准:

1. 用户无法再通过新 UI 做“无空间导入”。
2. 团队空间 editor 可以成功导入被动知识和绑定主动能力。
3. 老调用方兼容仍可工作，但有 warning。

### 10.3 Phase 2 列表与视图统一

目标:

1. 知识空间列表按 `visibility` 分组。
2. 供给与管理视图与空间列表同源。
3. 可选实现 `knowledge.base.sources.list` 聚合接口。

通过标准:

1. UI 中不再存在平级的“空间宇宙”和“对象宇宙”顶级入口。
2. 同一空间内容不再需要用户在两个世界中寻找。

### 10.4 Phase 3 契约收紧与兼容清理

目标:

1. 服务端强制 `knowledgeBaseId` 必填。
2. 停止隐式个人收件箱兜底。
3. 停止接受 `knowledge.source.bind.visibility` 作为输入。

通过标准:

1. 新版所有调用方全部显式传空间。
2. 服务端兼容分支可关闭。

---

## 11. 第三方团队必须提交的交付物

### 11.1 代码交付

1. 后端接口改造代码
2. 前端空间列表与导入统一代码
3. 数据迁移脚本或惰性迁移逻辑
4. 自动化测试

### 11.2 文档交付

1. 接口变更说明
2. 迁移与功能开关说明 → `docs/design/openbot-knowledge-space-unification-migration-flags-2026-06-29.md`
3. 验收报告与已知问题 → `openbot-knowledge-space-unification-acceptance-report-2026-06-29.md`、`openbot-knowledge-space-unification-known-issues-2026-06-29.md`
4. 已知风险与未解决问题清单

### 11.3 演示证据

必须提交录屏或逐步截图，覆盖以下场景:

1. 创建个人空间并导入文件
2. 创建团队空间并由 editor 导入网页
3. 创建企业空间并绑定 capability
4. 在列表中按个人 / 团队 / 企业看到对应空间
5. 打开某空间后同时看到 passive 与 active 内容
6. 老调用方不传 `knowledgeBaseId` 时收到兼容 warning
7. Phase 3 开关打开后，不传 `knowledgeBaseId` 会被拒绝

---

## 12. 验收标准

### 12.1 功能验收

必须全部满足:

1. “知识空间”与“知识库”在 UI 和接口层语义一致。
2. 个人 / 团队 / 企业统一由 `KnowledgeBase.visibility` 驱动。
3. 所有新 UI 导入入口必须先选空间。
4. 团队空间 editor/admin 具备写入能力。
5. `knowledge.source.bind` 不再允许独立于空间定义另一套 visibility。
6. 供给页与空间列表不再维护两套顶级宇宙。

### 12.2 接口验收

必须全部满足:

1. 所有改造后的写接口都走统一权限能力。
2. `knowledge.base.list` 返回体稳定包含 `visibility`。
3. `knowledge.personal.collect/upload/collectWeb` 最终态可强制要求 `knowledgeBaseId`。
4. `knowledge.source.bind` 最终态要求 `knowledgeBaseId` 且忽略外部 `visibility`。

### 12.3 测试验收

必须至少新增或更新以下测试类型:

1. 权限测试:
   - owner
   - admin
   - editor
   - viewer

2. 导入测试:
   - 显式空间导入成功
   - 缺省空间兼容 warning
   - 收紧后拒绝无空间导入

3. binding 测试:
   - active source 绑定继承空间 visibility
   - passive source 不能走 bind

4. 列表测试:
   - `knowledge.base.list` 分组所需字段完整

### 12.4 回归验收

不得破坏以下既有能力:

1. `knowledge.base.search`
2. `knowledge.base.documents.list`
3. `knowledge.base.web.list`
4. `knowledge.base.datasets.list`
5. `knowledge.base.agent-knowledge.list`
6. `knowledge.deliverables.attach`
7. 现有治理与检索相关测试

---

## 13. 风险与应对

### 13.1 风险 1

团队空间 UI 已统一，但写权限仍未从 owner-only 升级。

后果:

1. 外观看起来已支持协作空间。
2. 实际上非 owner 仍然无法导入。

应对:

1. 把权限改造列为 Phase 1 必做，不允许下沉到后续阶段。

### 13.2 风险 2

前端完成显式选空间，但后端继续默默兜底到收件箱，导致旧调用路径继续扩散。

应对:

1. Phase 1 打 warning
2. Phase 3 强制关停

### 13.3 风险 3

第三方团队继续沿用旧供给页对象宇宙，只是在 UI 上加了个空间分组。

应对:

1. 验收时必须检查其数据来源。
2. 若“我的知识 / 企业知识”仍直接读取散装对象而非空间列表同源数据，则判定未完成。

### 13.4 风险 4

通过前端拼装绕过统一模型，后端仍保持多套契约长期并存。

应对:

1. Phase 2 必须明确接口收口计划。
2. 不接受“只做前端皮肤层统一”的交付。

---

## 14. 明确的实施禁令

第三方团队不得采取以下做法:

1. 不得新增第三套“空间类型”枚举。
2. 不得保留 `source.bind.visibility` 作为长期有效输入。
3. 不得继续把团队空间写权限锁死为 owner-only。
4. 不得只改 UI 文案而不统一接口行为。
5. 不得通过隐藏现有入口来掩盖后端未统一的问题。

---

## 15. 验收结论判定规则

以下任一项不满足，视为不通过验收:

1. 新 UI 仍存在不选空间即可导入的正式入口。
2. 团队空间 editor 无法写入。
3. `source.bind` 仍允许空间外独立 visibility 生效。
4. 供给页与空间页仍然是两套顶级宇宙，且数据源未统一。
5. 第三方团队无法提交对应测试与演示证据。

以下项满足，则可判定通过:

1. 统一模型、统一入口、统一权限全部落地。
2. 历史兼容行为有明确关闭路径。
3. 自动化测试覆盖核心回归。
4. 实际演示能跑通个人 / 团队 / 企业三类空间闭环。

---

## 16. 建议的实现顺序

为了控制返工，建议第三方团队严格按以下顺序实施:

1. 抽象统一读写权限函数
2. 改造 `knowledge.source.bind`
3. 改造 `collect/upload/collectWeb` 的兼容 warning
4. 前端统一导入入口
5. 前端空间分组列表
6. 供给页与空间列表同源化
7. 增加聚合来源接口
8. 关闭无空间导入兼容

不得跳过第 1 步直接做 UI。

---

## 17. 最终结论

这次统一化改造不是“新增知识空间能力”，而是“让已经存在的知识空间能力成为唯一可信主模型”。

就当前代码现实而言，最重要的三件事是:

1. 让 `KnowledgeBase.visibility` 成为空间分类的唯一真源。
2. 让所有导入显式绑定空间。
3. 让团队空间真正具备协作写入能力。

只要这三件事做到位，其它诸如列表编排、供给页收口、主动能力管理视图，都可以在统一模型上逐步演进。
