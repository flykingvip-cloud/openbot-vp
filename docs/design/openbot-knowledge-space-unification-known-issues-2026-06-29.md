# 知识空间统一化 — 已知问题清单

> 日期：2026-06-29（U4–U8 跟进：2026-06-29；专家评审回写：2026-06-29；**二次独立复核**：2026-06-29；交付二源码完成：2026-06-29）  
> 范围：W0–W9 实施完成后的残留项与非阻断限制；U4 跟进拆为**交付一 / 交付二 / 交付三（U8）**分批验收

## 专家评审结论（2026-06-29）

| 交付批次   | 范围                            | 结论        | 说明                                                                              |
| ---------- | ------------------------------- | ----------- | --------------------------------------------------------------------------------- |
| **交付一** | U4 空间内统一导入               | **✅ 通过** | 源码符合规格；门禁 146 tests 绿；`knowledge-universe-space-import.ts` 等已落地    |
| **交付二** | U5+U7 顶部入口收敛 + U6 首页 IA | **✅ 通过** | **二次独立复核 ✅**（源码 + 专门测试 + 门禁 146 绿）；待 land 冻结 SHA + W13 录屏 |
| **交付三** | U8 主动数据源 ↔ 企业连接器对齐  | **✅ 通过** | **§U8 已落地**（方案 B）；U4 §5.3 过渡表单已取代；门禁 159 tests 绿               |

**二次验收纪要（2026-06-29 · 专家独立复核）**

| 项                    | 结论                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| 交付二 U5+U6+U7       | **✅ 通过** — 与本文「专家评审 ✅」一致；源码、专门测试、`scripts/test-knowledge-space-unification.mjs` 146 绿 |
| U8 规格是否入档       | **✅ 已入档** — 见本文 **§U8**（取代 U4 §5.3）；首次验收时规格未写全，**现已补全**                             |
| U8 作用域决策         | **✅ 已裁定** — **个人空间允许主动数据源**，分路径约束见 **§U8 §8**（非一律禁止）                              |
| Git 冻结 SHA          | **❌ 仍未 land** — 基线 `HEAD c001d2c2c7` 之后为未提交工作树；执行团队须连同 U4–U6+U8 批次一并 commit          |
| U4 §5.3 endpoint 表单 | **过渡态** — U8 落地前保留；不得对外宣称为终态                                                                 |

**U4 §5.3 与 U8 关系（重要）**

- **U4 交付一 ✅** 验收的是：统一导入入口 + 被动 ingest + **过渡版**主动源 UI（`ku-space-import-form-active` → 直接 `knowledge.source.bind`）。
- **U8 交付三** 将**取代** §U4 **§5.3** 的简化绑定表单规格；现行 endpoint 三字段表单仅作**临时实现**，不得视为终态。
- 终态二选一（U8 实施时在 PR 说明中择一并写死）：
  - **A（推荐）**：空间内「主动数据源」**完全**走企业连接器流程（目录 → 装包 → 凭证 → 探测 → 绑定到当前 KB），删除通用 `kind` + `endpoint` 表单。
  - **B（过渡）**：连接器流程为主；保留折叠区 **「HTTP REST 快速绑定」**（仅 `kind=api` + `title` + `endpoint` URL，仍调 `knowledge.source.bind`），**不再**暴露 `external` / `capability` 的自由 endpoint 输入。

**交付二完成快照（代码现状，可复核）**

| 项    | 预期                                                                       | 现状                                                                                                                                |
| ----- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| U5+U7 | 删除 4 卡；搜索旁 `ku-home-import-open`；已选空间走 `openSpaceImportEntry` | **已改**：`renderQuickActions` 已移除；`openUploadFlow` / `openSupplyManagePage` 已删；`openPersonalIngestFlow` 已选空间分支改接 U4 |
| U6    | `knowledge-universe-intelligence-band.ts` + 三带布局                       | **已改**：action band → assets band → intelligence band；关系 preview + 发现/行动/治理同带                                          |

**U7 与 U7 披露口径**

- 本清单自加 **U7**（残留 `openPersonalIngestFlow` → 旧个人沉淀全页）为**如实披露**，非隐瞒缺陷。
- 专家评审：**U7 实质属于 U5 范围**（首页快捷卡「导入来源」仍走旧路径）。建议 **U5 + U7 合并为一批**实现，**完成后**再做 U6。
- 推荐次序：**U5+U7 → U6**（非 U4 → U7 → U5 → U6 四段拆 PR）。

**提交与联调状态（交付一 + 交付二）**

- **Git**：截至二次验收仍为**未提交工作树**（基线 `HEAD c001d2c2c7` 之后）；执行团队须 **land 冻结 SHA**（U4–U6 与后续 U8 **分 commit 或单 PR 由团队定**，但须可追溯）。
- U4/U5–U7 为**源码通过**；浏览器联调须 `pnpm ui:build` + Gateway 重启（见 U4 §9）。
- **W13 录屏**：建议在 **W14（U8）** 完成后录制 active 源终态，避免录两次。

## 非阻断（可随 Phase 3 开关关闭）

| ID  | 问题                                                          | 影响                          | 缓解                                                                                         |
| --- | ------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| K1  | Legacy API 仍可在缺省 `knowledgeBaseId` 时落入个人收件箱      | 旧客户端可能继续隐式导入      | `OPENBOT_KNOWLEDGE_REQUIRE_KNOWLEDGE_BASE_ID=1`；监控 `warningStats.implicit_personal_inbox` |
| K2  | Legacy `source.bind.visibility` 默认 warning+忽略，非直接拒绝 | 旧客户端可能仍传无效字段      | `OPENBOT_KNOWLEDGE_REJECT_SOURCE_BIND_VISIBILITY=1`                                          |
| K3  | 个人收件箱历史空间保留                                        | 用户可能看到旧兜底空间        | 新 UI 不再默认写入；文档已说明退役路径                                                       |
| K4  | `knowledge.compat.status` 每次调用会扫描 binding store        | 高频轮询有少量 I/O            | 生产环境建议低频率巡检（如 cron / 运维手动）                                                 |
| K5  | 多 agent 共享工作树并发编辑                                   | 验收期间测试可能瞬时红/绿翻转 | SOP 强制冻结 SHA + 干净树；优先 CI 或独立 worktree                                           |

## 产品 / UX 限制

| ID  | 问题                                                                                         | 影响                                                                       | 计划                                                                             |
| --- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| U1  | 空间详情仍保留 snippets / web / datasets / agent 等细粒度 Tab                                | 与聚合「来源」Tab 并存，略冗余                                             | 后续可收敛为聚合 Tab + drill-down                                                |
| U2  | 联调录屏需人工录制                                                                           | W9 交付缺最后一项证据                                                      | 按 demo script 录制后归档                                                        |
| U3  | 团队空间创建仍依赖 enterprise seat context                                                   | 无 tenant 时无法创建 team/enterprise KB                                    | 与设计一致，非本轮缺陷                                                           |
| U4  | ~~空间内「新建 / 导入来源」入口未统一~~                                                      | **交付一 ✅** — 源码 + 测试通过；待 land + ui:build 联调                   | 见 `knowledge-universe-space-import.ts`；§U4；**联调需 ui:build + Gateway 重启** |
| U5  | ~~首页顶部 4 张快捷卡冗余（含旧 ingest 路径）~~                                              | **交付二 ✅** — 4 卡已删；搜索旁单按钮 `ku-home-import-open`               | 见 §U5；与 U7 同批落地                                                           |
| U6  | ~~首页 IA：关系洞察 / 发现 / 治理分散；无「知识智能」带~~                                    | **交付二 ✅** — `ku-intelligence-band` 三带布局                            | 见 §U6                                                                           |
| U7  | ~~残留 `openPersonalIngestFlow`（首页快捷卡 → 旧「导入来源」全页）~~                         | **交付二 ✅** — 已选空间 ingest 改接 `openSpaceImportEntry`                | 见 §U7；与 U5 同批                                                               |
| U8  | 主动数据源导入未对齐企业连接器规范（U4 §5.3 过渡 endpoint 表单）                             | **✅ 已完成** — 方案 B：连接器向导 + HTTP REST 折叠；§8 分路径             | 见 §U8；`knowledge-universe-space-connector-bind.ts`                             |
| U9  | ~~首页「新建知识/导入」抽屉目的地为固定标签，抽屉内无法改选目标空间~~                        | **✅ 已完成** — 首页 `lockSpace=false` + `ku-space-import-target-selector` | 见 §U9；空间内入口保持 `ku-space-import-target-locked`                           |
| U10 | ~~连接器向导缺少 in-wizard OAuth 授权~~：`oauth2` 连接器无法在知识空间导入抽屉内直接发起授权 | **✅ 已完成** — 向导内 OAuth 授权 + 演示模拟完成                           | 见 §U10；`startKnowledgeUniverseConnectorOAuth` / 轮询 / `simulateComplete`      |

## 不在本轮范围

| ID  | 说明                                         |
| --- | -------------------------------------------- |
| O1  | 未删除历史 KB / binding / 收件箱数据         |
| O2  | 未强制 Phase 3 开关默认开启（仍为 opt-in）   |
| O3  | `backendKind` 未做存量重写，仅作派生兼容字段 |

## 一票否决项自检

| 否决项                               | 状态                                             |
| ------------------------------------ | ------------------------------------------------ |
| 新 UI 仍存在正式无空间导入路径       | **否** — ingest 无选中空间时跳转 `libraryCreate` |
| 团队 editor 无法写入                 | **否** — RPC + 权限测试覆盖                      |
| `source.bind` 独立 visibility 仍生效 | **否** — 继承 KB；legacy 字段被忽略              |
| 供给页与空间页两套宇宙               | **否** — 同源 `knowledgeBases`                   |
| 无自动化测试                         | **否** — 见 acceptance report                    |

---

## U4 修复规格：空间内「导入内容」入口未统一

> 复检发现（2026-06-29）。归类：W4「导入漏斗统一」的**空间内一半**未完成。
> 数据归属正确，问题在导入入口的 UX 与主动数据源能力缺失。
>
> **实施状态（2026-06-29）**：**交付一 ✅ 通过**（源码 + 门禁用例）；SOP §D3 / W4 可恢复为通过。**交付二 ✅ 通过**（U5+U7 + U6 源码 + 146 tests 绿 + `ui:build`）。待执行团队 **land 冻结 SHA** + W13 联调录屏。

### 1. 现象

进入某个**已归类空间**（个人 / 团队 / 企业，例如企业空间「人力资源管理」）后，点右上「新建」或空态红色「导入来源」，弹出的是**只能选单个本地文件**的旧表单（`uploadDrawerTitle/uploadDrawerHint/uploadFileLabel/uploadHint/uploadAction`，`ui/src/i18n/locales/zh-CN.ts:1733,1737,1744,1759-1761`），不是面向"本空间"的统一内容导入入口。

### 2. 根因

`resolveLibraryPrimaryAction()`（`ui/src/ui/views/knowledge-universe-library-workspace-page.ts:114`）在**已选空间**分支按当前内容 Tab 分叉到旧的个人沉淀抽屉：

- 来源(documents) Tab → `surface.onPersonalCollectDrawerOpenChange(true, "upload")` → 单文件上传表单（`renderPersonalUploadForm`，`ui/src/ui/views/knowledge-universe-personal-panel.ts`）
- 网页(web) Tab → `"collect"` 模式
- 数据集(datasets) Tab → `"upload"` 模式
- Agent Tab → 跳成果页；证据片段 / 已移除 → 不可用提示

即「能导入什么」由"用户停在哪个 Tab"隐式决定，而非在一处选择内容类型。

### 3. 数据正确性（非缺陷，先澄清避免误修）

空间内导入的**归属是对的**：`collectKnowledgeUniversePersonal` / `uploadKnowledgeUniversePersonal`（`ui/src/ui/controllers/knowledge-universe.ts:1289 / 1443`）经 `requireSelectedKnowledgeBaseId()`（`:129`，仅返回 `runtime.selectedKnowledgeBaseId`、无收件箱回退）把 `knowledgeBaseId = 当前空间` 传给后端 `knowledge.personal.collect/upload`。**修复时不得改动这条归属链路**，只改入口 UX 与新增主动源入口。

### 4. 缺口（3 项）

1. 入口非统一：导入类型由 Tab 隐式决定，缺一个"选择内容类型"的统一入口。
2. 措辞错位：沿用个人沉淀文案（`personal.*`），未明确"正在导入到【当前空间名】"。
3. 主动数据源**入口已接、规范未对齐**：U4 已落地 `bindSource` 过渡 UI（`knowledge-universe-space-import.ts` → `ku-space-import-form-active`），但仍是 **kind + title + endpoint** 简化表单，**未**走企业数据能力中心的连接器目录 / 凭证 / 探测流程。**终态规格见 U8（取代 §5.3）**。

### 5. 修复规格

#### 5.1 统一入口契约

- 触发点：空间详情页右上「新建」（hero `actionNew`）与空态「导入来源」按钮，统一指向同一个"向本空间导入内容"入口。
- 空间固定：目标空间 = `surface.selectedKnowledgeBaseId`（当前空间），**不再让用户重选空间 / 空间类型**；UI 显式展示"导入到【{当前空间标题}】"。
- 交互：进入入口 → 选择内容类型 → 对应表单 → 提交 → 写入当前空间 → 刷新「来源」视图。
- 实施：替换 `resolveLibraryPrimaryAction()` 已选空间分支的"按 Tab 开旧抽屉"逻辑；内容 Tab（来源/证据片段/数据集/网页/Agent知识/已移除）回归为**只读查看**该空间已有内容（「来源」Tab 已通过 `knowledge.base.sources.list` + plane 过滤聚合，见 U1）。

#### 5.2 被动内容（复用现有，均已带 `knowledgeBaseId=当前空间`）

| 类型          | 复用 RPC / 控制器                                                       |
| ------------- | ----------------------------------------------------------------------- |
| 文件 / 文件夹 | `knowledge.personal.upload` / `uploadKnowledgeUniversePersonal`         |
| 网址          | `knowledge.personal.collectWeb` / `collectWebKnowledgeUniversePersonal` |
| 数据集        | `knowledge.personal.importDataset`                                      |
| 笔记 / 摘录   | `knowledge.personal.collect` / `collectKnowledgeUniversePersonal`       |

#### 5.3 主动数据源绑定表单（**过渡 UI · 由 U8 取代**）

> ⚠️ **规格状态**：本节为 U4 交付一的**最小可行**主动源入口，**不是终态**。
> **U8（交付三）将取代本节**；现行 `renderActiveSourceForm`（`knowledge-universe-space-import.ts`）在 U8 落地后须：
>
> - **方案 A**：整段删除，改接企业连接器向导；或
> - **方案 B**：降级为折叠区 **「HTTP REST 快速绑定」**（仅 `kind=api`），不再提供 `external` / `capability` 的自由 endpoint 字段。
>
> U4 交付一验收**不等待 U8**；U8 完成后须回写本节为「已取代」并更新门禁用例。

- 网关：复用 `gateway.bindSource(req)` → `knowledge.source.bind`（后端 `src/gateway/server-methods/knowledge.ts:2023`，已就绪）。
- 请求字段：
  - `kind`: `"api" | "external" | "capability"`（必选；passive kind 会被后端拒绝）
  - `title`: 必填（缺省可回退 `endpoint`）
  - `endpoint`: api / external 提供连接/定位串
  - `knowledgeBaseId`: **固定为当前空间**（不可由用户改）
  - `visibility`: **不要传**（后端忽略并回 `source_bind_visibility_ignored` warning；binding 可见性继承空间）
- 权限：写操作经后端 `canWriteKnowledgeBase`（owner/admin/editor）校验；viewer 应在 UI 禁用该入口。
- 成功后：刷新「来源」聚合视图（`knowledge.base.sources.list`），新条目应为 `plane=active`、`visibility=空间可见性`。
- 前端接线：在 `WorkbenchKnowledgeSurface`（`ui/src/ui/ports/employee/views/home-page-contracts.ts`）新增 `onBindSource(req)` 回调 + render-model handler + 控制器 action（调用 `gateway.bindSource`），与现有 `previewCapability/invokeCapability` 接线方式一致。

#### 5.4 文案

新增面向空间的导入 i18n（`importToSpace.*` 之类），替换该入口处的 `personal.*` 个人沉淀措辞；en + zh-CN 同步，其余语言回退英文。

### 6. 验收 / 测试（F2 硬门禁补充）

新增前端用例（建议文件 `ui/src/ui/views/knowledge-universe-space-import.node.test.ts` 或并入既有空间详情测试）：

1. 已选空间点「新建」→ 出现统一内容类型选择入口（含被动 + 主动选项），**而非**直接进单文件上传表单。
2. 选「主动数据源」→ **过渡**：调用 `bindSource`（`knowledgeBaseId=当前空间`、不含 `visibility`）。**U8 后**：走连接器规范或仅 HTTP REST 快速绑定（见 §U8）。
3. 绑定成功后「来源」聚合列表出现 `plane=active` 条目，可见性 = 空间可见性。
4. viewer 角色下该入口不可用。

回归不得破坏：现有 `collect/upload/collectWeb/importDataset` 归属链路（`knowledgeBaseId=selectedKnowledgeBaseId`）。

### 7. 涉及文件（实施落点）

- `ui/src/ui/views/knowledge-universe-library-workspace-page.ts`（`resolveLibraryPrimaryAction` + hero/空态按钮）
- 新增统一导入入口视图（如 `ui/src/ui/views/knowledge-universe-space-import.ts`）
- `ui/src/ui/views/knowledge-universe-personal-panel.ts`（被动表单复用 / 拆分）
- `ui/src/ui/ports/employee/views/home-page-contracts.ts`（`onBindSource` 等 surface 契约）
- `ui/src/ui/ports/employee/render-model.ts`（handler 接线）
- `ui/src/ui/controllers/knowledge-universe.ts`（新增 `bindKnowledgeUniverseSource` action）
- `ui/src/i18n/locales/en.ts`、`ui/src/i18n/locales/zh-CN.ts`（空间导入文案）
- 测试：上述 F2 用例

### 8. 注意

- 不改后端：`knowledge.source.bind` / `knowledge.personal.*` 行为已满足，本项纯前端 + 文案 + 测试。
- 归属链路（`requireSelectedKnowledgeBaseId` → `knowledgeBaseId`）保持不变。
- 完成后回写 SOP §D3 与 W4 状态：由「部分完成」恢复为「通过」。

### 9. 联调前置（易误判为「U4 未生效」）

若 Mac 应用 / Gateway 静态 UI 仍展示旧「导入来源」全页（标题 +「返回我的知识」+ 单文件表单），**优先检查 bundle 是否过期**，而非重复改 `resolveLibraryPrimaryAction`：

1. 源码已改但 `dist/control-ui` 未重建 → 运行中的仍是旧 `resolveLibraryPrimaryAction` → `onPersonalCollectDrawerOpenChange("upload")` → 控制器强制 `pageTab=personal`。
2. 联调最小步骤：

   ```bash
   pnpm ui:build   # 或 pnpm build
   # 重启 Gateway（Mac 应用或 launchctl kickstart -k gui/$UID/ai.openbot.gateway）
   # 浏览器硬刷新
   ```

3. `pnpm ui:dev` 场景：前端 HMR 即可；后端 RPC 变更仍需 Gateway 重启。
4. 验证点：空间详情 hero「新建」应出现 `data-testid="ku-space-import-open"` 抽屉（含 `ku-space-import-picker`），**不应**整页跳转到 `pageTab=personal`。

残留非空间详情入口（首页快捷卡等）见 **U7**，须与 U5 一并收敛。

---

## U5 修复规格：首页顶部快捷卡冗余收敛（4 → 1）

> 复检发现（2026-06-29）。**交付二 · ✅ 已完成**（2026-06-29 源码 + 门禁）。
> **依赖 U4 交付一 ✅**；与 **U7 同批 PR** 落地（见 §U7）。
> 本项纯前端 + 文案 + 测试，不改后端。

### 0. 完成快照（可复核）

- `renderQuickActions` 已删除；搜索条旁 `data-testid="ku-home-import-open"` 接 `openSpaceImportEntry`
- `openUploadFlow` / `openSupplyManagePage` / `openLibraryDocumentCreate` 已从首页移除
- 「我的资产」迁至空间面板头部（`ku-my-assets-workspace-link`）

### 1. 现象

知识工作台首页搜索条下方有 4 张快捷卡（`renderQuickActions`，`ui/src/ui/views/knowledge-universe-page.ts:292`）：沉淀知识 / 导入来源 / 知识供给管理 / 我的资产。其中 3 张与「创建空间 + 空间面板 + 空间内统一导入(U4)」重复。

### 2. 逐卡判定（含承接 + 处置）

| 卡片           | 当前承接                                                                                                    | 重复性                                                                                           | 处置                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| ① 沉淀知识     | `openCollectFlow`/`openCreateAndCollectFlow`（`:111/115`）→ 无空间跳 `libraryCreate`，有空间开 collect 抽屉 | 与②同类"把内容加入空间"；"沉淀当前上下文"真正归属是聊天/Agent 会话与「成果中心」每行的"沉淀"动作 | **并入**统一「新建知识 / 导入」                                |
| ② 导入来源     | `openUploadFlow`（`:123`）→ `openPersonalIngestFlow("upload")` → 与 U4 同一单文件表单                       | **直接重复** U4 空间内导入；违反主稿 §8.2/§8.3「单一导入入口」                                   | **删除**                                                       |
| ③ 知识供给管理 | `openSupplyManagePage`（`:153`）→ 供给页                                                                    | W6 后"我的/企业知识"= 与下方「我的知识空间」面板同源 `knowledgeBases`；面板已含「管理全部空间」  | **删除**；数据能力(active) 收进空间详情「来源(active)」（W7）  |
| ④ 我的资产     | `openMyAssetsPage`（`:149`）→ `onOpenMyAccumulation` → assets 页                                            | 独立域（技能/能力/沉淀资产），与导入无重复                                                       | **保留**，但移出"导入快捷行"，作为独立入口（它是管理而非导入） |

### 3. 修复规格

1. **沉淀知识 + 导入来源 → 合并为 1 张「新建知识 / 导入」主卡**：
   - 点击进入 U4 的统一导入入口（`ui/src/ui/views/knowledge-universe-space-import.ts`）。
   - 已选空间 → 直接进该空间统一导入（被动：文件/网址/数据集/笔记 + 主动：API/能力 `bindSource`）。
   - 未选空间 → 引导先选/建空间，再进同一入口。
   - 成为**唯一**"加知识"入口（与 §8.3 一致）。
2. **删除「知识供给管理」卡**：浏览交给「我的知识空间」面板 + 「管理全部空间」链接；不再保留独立供给页顶级入口。
3. **「我的资产」移出快捷行**：放到空间面板头部或二级导航，保留 `onOpenMyAccumulation`。

### 4. 涉及文件

- `ui/src/ui/views/knowledge-universe-page.ts`（`renderQuickActions` 收敛为单卡；删除 `openUploadFlow`/`openSupplyManagePage` 卡入口；`openMyAssetsPage` 改挂载点）
- `ui/src/ui/views/knowledge-universe-space-import.ts`（U4 统一入口，作为合并卡的承接对象）
- `ui/src/i18n/locales/en.ts`、`zh-CN.ts`（删除/改写 `quickActions.upload/supplyManage*` 文案，新增单卡文案）

### 5. 验收

1. 首页快捷区只剩 1 张"加知识"卡（+「我的资产」独立入口）；无「导入来源」「知识供给管理」独立卡。
2. 点合并卡 → 进 U4 统一导入（已选空间直接进；未选空间先引导选/建）。
3. 浏览空间仍可经「我的知识空间」面板 +「管理全部空间」到达。
4. 回归：`renderQuickActions` 相关既有测试更新；删除的卡不再有 `data-testid`（`ku-supply-manage-action-card`、上传卡）残留断言。
5. **不得**再调用 `openPersonalIngestFlow` / `openUploadFlow` / `openLibraryDocumentCreate` 作为已选空间的「加知识」入口（见 U7）。

### 6. 测试（建议纳入门禁脚本）

| 行为               | 建议文件                                              | 用例要点                                                                 |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| 首页仅一张加知识卡 | `knowledge-universe-page` 相关 node/browser test      | 无 `ku-supply-manage-action-card`；无独立 upload 卡                      |
| 合并卡接 U4        | 同上或 `knowledge-universe-space-import.node.test.ts` | 已选空间 → `onLibraryWorkspaceImportOpenChange(true)` 或等价 drawer 打开 |
| 未选空间           | `space-ingest.node.test.ts` 扩展                      | 合并卡 → `libraryCreate` 引导                                            |

### 7. 依赖与批次

- **前置**：U4 交付一 ✅（已源码通过；land + ui:build 联调另计 W10）。
- **与 U7 同批**：实现 U5 卡片收敛时**必须**同时删除/改接 §U7 所列 `openPersonalIngestFlow` 入口，**禁止**只改 UI 文案保留旧路径。
- **后置**：U6 须在 U5+U7 合并 PR 合并后再开。

---

## U6 布局规格：首页 IA 三层重排 + 「知识智能」带

> 复检发现（2026-06-29）。**交付二 · ✅ 已完成**（2026-06-29 源码 + 门禁）。
> **依赖 U5+U7 ✅**。纯前端布局/组合，不改数据与后端。

### 0. 完成快照（可复核）

- 新增 `ui/src/ui/views/knowledge-universe-intelligence-band.ts`（`ku-intelligence-band`）
- `renderKnowledgeUniverseHomePage` 三带：action band → assets band → intelligence band
- `RelationsSection` 新增 `preview` 变体；发现/行动/治理并入智能带

### 1. 现状

`renderKnowledgeUniverseHomePage`（`ui/src/ui/views/knowledge-universe-page.ts:613`）纵向顺序：

1. 搜索 `renderUnifiedSearch`
2. 4 张快捷卡 `renderQuickActions`（见 U5）
3. 我的知识空间 + 成果中心 `renderKnowledgeUniverseWorkspacePanels`
4. **关系洞察** `renderKnowledgeUniverseRelationsSection`（折叠 `<details>`，夹在中部）
5. 底部网格 `renderKnowledgeUniverseInsightsGrid`（`ui/src/ui/views/knowledge-universe-insights-grid.ts`）：发现 `renderDiscoverWidget`(discoveryEvents) + 下一步行动/智能推荐 `renderNextActionsWidget`(actionSuggestions + recommendations) + 治理卡

### 2. 问题

1. 最显眼位置（紧贴搜索）放的是最重复的 4 卡（U5）。
2. **智能信号被劈成两段**：关系洞察在中部折叠块、发现/推荐/治理在页面最底部网格；同属"系统替你发现/建议什么"的内容被资产区隔开。
3. 关系图（最具"视角"价值的网络视图）默认折叠、视觉优先级最低，与架构 #4「关系作为 Runtime Core 信号」定位倒挂。

### 3. 目标布局：三层叙事（找/加 → 我有什么 → 系统发现/建议什么）

**第 1 带 · 行动 / 检索（顶部，纤细）**

- 全宽统一搜索 `renderUnifiedSearch`。
- 旁置**单个**「+ 新建知识 / 导入」按钮（U5 合并卡，接 U4 入口）。

**第 2 带 · 我的知识资产（主体，双栏，视觉锚点最大）**

- `renderKnowledgeUniverseWorkspacePanels`：左 我的知识空间（按 个人/团队/企业 分组）+ 右 成果中心。基本不动。

**第 3 带 · 知识智能 / Runtime 信号（统一一条，替代"中部折叠 + 底部网格"）**

- 新增 `renderKnowledgeIntelligenceBand`，把以下合并为一条、卡片节奏统一：
  - 关系网络：由 `renderKnowledgeUniverseRelationsSection` 改为**可见的图预览卡**（缩略 + 点击展开），不再默认折叠；为本带视觉中心。
  - 发现：`renderDiscoverWidget`（discoveryEvents）。
  - 智能推荐 + 下一步行动：`renderNextActionsWidget`（recommendations + actionSuggestions）。
  - 治理：governance 卡（`renderGovernanceInsightCard`）。
- 宽屏建议 3 列：`关系网络（大，可跨列）` / `发现` / `推荐 + 下一步`，治理做横向 health strip。

### 4. 实施落点

- `ui/src/ui/views/knowledge-universe-page.ts`（`renderKnowledgeUniverseHomePage` 重排为三带；把 `renderKnowledgeUniverseRelationsSection` 从第 4 位下移并入新带）
- 新增 `ui/src/ui/views/knowledge-universe-intelligence-band.ts`（包裹关系预览 + 发现 + 推荐 + 治理；复用既有 `renderDiscoverWidget`/`renderNextActionsWidget`/`renderGovernanceInsightCard`）
- `ui/src/ui/views/knowledge-universe-relations-section.ts`（新增"预览卡"变体：默认可见缩略图 + 展开）
- `ui/src/ui/styles/workbench.css`（三带 + 智能带栅格）

### 5. 视觉理由

- 自上而下单一叙事：找/加 → 我有什么 → 系统替我发现/建议什么；每带职责单一。
- 去重后第一屏聚焦"搜索 + 我的空间/成果"，噪声下降。
- 智能信号收口为一条、卡片大小一致、可扫读；关系图从"折叠在中间"升级为"可见的网络视角"，呼应架构 #4。
- 价值与层级匹配，纠正"重复卡最重、关系图最轻"的倒挂。

### 6. 验收

1. 首页自上而下为：行动/检索带 → 资产双栏 → 知识智能带；无中部孤立的关系折叠块。
2. 关系网络在智能带内默认可见（预览），可展开为完整图。
3. 发现 / 智能推荐 / 治理 与关系同处一带，卡片样式统一。
4. 回归：既有 home / insights / relations 测试更新；关系展开/折叠交互与 `relationsInsightExpanded` 行为保持（或迁移为预览展开态）。

### 7. 依赖与次序

**专家推荐次序**：`U4（交付一 ✅）→ U5+U7（交付二 · 合并一批）→ U6（交付二 · 第二批）`。

---

## U7 修复规格：残留个人沉淀导入路径未收敛

> 联调反馈（2026-06-29）。**交付二 · ✅ 已完成**；与 §U5 **同一 PR** 落地。
> U4 已改空间详情 hero「新建」；首页「导入来源」等仍走 `openPersonalIngestFlow` → 旧全页。属**如实披露**，非 U4 规格失败。

### 1. 现象

在已选团队/企业空间（如「人力资源」）下，从**非空间详情**入口点「导入来源 / 沉淀知识」，或旧 bundle 下点空间「新建」，仍进入：

- 二级页标题「导入来源」
- 面包屑「返回我的知识」（非当前空间名）
- 单文件上传表单（`personal.uploadDrawer*`）

而非 U4 的 `ku-space-import-picker` 统一类型选择抽屉。

### 2. 根因

| 层级               | 机制                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 视图入口           | `openUploadFlow` / `openLibraryDocumentCreate` / `openCollectFlow`（`knowledge-universe-page.ts`）均调用 `openPersonalIngestFlow`                                     |
| 空间 ingest helper | `openPersonalIngestFlow`（`knowledge-universe-space-ingest.ts`）在 `hasSelectedKnowledgeSpace` 时 `onPageTabChange("personal")` + `onPersonalCollectDrawerOpenChange` |
| 控制器             | `setKnowledgeUniversePersonalCollectDrawerOpen`（`knowledge-universe.ts:978`）在 `open=true` 时**无条件** `setKnowledgeUniversePageTab("personal")`                   |
| 旧 bundle          | `dist/control-ui` 未含 `openSpaceImportEntry` 时，空间 hero「新建」仍走旧 `resolveLibraryPrimaryAction`                                                               |

即：**「向当前空间加内容」与「个人沉淀二级页」在路由层仍耦合**。

### 3. 修复规格

#### 3.1 已选空间 + 「加知识 / 导入」类动作

统一改为 `openSpaceImportEntry(surface)`（`knowledge-universe-space-import.ts`）：

- **留在** `libraryWorkspace`（或首页 overlay 抽屉，若产品选择首页也弹 drawer 而非跳页）
- **禁止** `onPageTabChange("personal")` + upload/collect 旧全页

需改动的入口（至少）：

| 入口                                    | 文件                                    | 当前                                | 目标                                    |
| --------------------------------------- | --------------------------------------- | ----------------------------------- | --------------------------------------- |
| `openUploadFlow`                        | `knowledge-universe-page.ts`            | `openPersonalIngestFlow("upload")`  | `openSpaceImportEntry`                  |
| `openLibraryDocumentCreate`             | 同上                                    | 同上                                | 同上或删除回调，仅保留 U4               |
| `openCollectFlow` / 合并卡（U5）        | 同上                                    | collect 抽屉                        | `openSpaceImportEntry`                  |
| `libraryWorkspace.onOpenDocumentCreate` | `knowledge-universe-page.ts:696`        | `openLibraryDocumentCreate`         | 删除或改接 U4                           |
| 治理页 collect 引导                     | `knowledge-universe-governance-page.ts` | `openPersonalIngestFlow("collect")` | 已选空间 → U4；无空间 → `libraryCreate` |
| workspace-nav collect                   | `knowledge-universe-workspace-nav.ts`   | 同上                                | 同上                                    |

#### 3.2 个人沉淀页保留边界

`pageTab=personal` **仅**用于真正的个人知识对象管理（版本、标签、我的摘录列表等），**不再**作为「向任意已选空间导入内容」的跳板。

可选（二选一，执行团队择一并在 PR 说明）：

- **A（推荐）**：保留 `setKnowledgeUniversePersonalCollectDrawerOpen` 行为，但所有「向空间导入」入口不再调用它。
- **B**：为 `setKnowledgeUniversePersonalCollectDrawerOpen` 增加 `{ target: "personal-list" | "space-import" }`；`space-import` 时不切 `pageTab`。

#### 3.3 废弃与清理

- 删除或 `@deprecated`：`openUploadFlow`、`openLibraryDocumentCreate`（若 U5 合并后无引用）。
- `resolveLibraryPrimaryAction` 的 `onOpenDocumentCreate` 选项参数可从类型签名中移除（已无调用方）。
- 更新 `knowledge-universe-space-ingest.node.test.ts`：已选空间 ingest 应期望 **U4 抽屉** 而非 `onPersonalCollectDrawerOpenChange`。

### 4. 验收

1. 已选任意空间，从首页「导入来源」等价入口（U5 合并卡）→ **不出现** `pageTab=personal` 旧全页。
2. 空间详情「新建」+ 空态「导入来源」→ U4 抽屉（`ku-space-import-picker`）。
3. `rg 'openPersonalIngestFlow.*upload'` 在 `knowledge-universe-page.ts` 无**已选空间**加知识路径（personal 列表管理路径可保留）。
4. 门禁扩展：`space-ingest.node.test.ts` 或新用例 — 已选空间打开 ingest → `onLibraryWorkspaceImportOpenChange(true)`，且 **不**调用 `onPageTabChange("personal")`。

### 5. 涉及文件

- `ui/src/ui/views/knowledge-universe-page.ts`
- `ui/src/ui/views/knowledge-universe-space-ingest.ts`
- `ui/src/ui/views/knowledge-universe-governance-page.ts`
- `ui/src/ui/views/knowledge-universe-workspace-nav.ts`
- `ui/src/ui/controllers/knowledge-universe.ts`（若采用 3.2-B）
- 测试：`knowledge-universe-space-ingest.node.test.ts`、`scripts/test-knowledge-space-unification.mjs` 文件列表

### 6. 依赖

- **前置**：U4 源码已存在。
- **阻塞**：U5 合并卡、U4 联调录屏（demo script 场景 2/3）。
- **不改后端**（U8 可能需桥接 RPC，见 §U8）。

---

## U8 修复规格：主动数据源导入对齐企业连接器规范

> 跟进项（2026-06-29）。**交付三 · ❌ 未做**。
> **取代 U4 §5.3** 的简化绑定表单（`kind` + `title` + `endpoint` → 直接 `knowledge.source.bind`）。
> **依赖**：交付一 ✅（统一导入抽屉）、交付二 ✅（入口收敛）；**建议 W13 录屏前完成**，避免 active 源场景录两次。

### 0. 现状快照（U4 过渡实现，可复核）

`ui/src/ui/views/knowledge-universe-space-import.ts` 中 `renderActiveSourceForm`：

- 用户自选 `kind`: `api | external | capability`
- 填写 `title` + 自由文本 `endpoint`
- 提交 → `bindKnowledgeUniverseSource` → `knowledge.source.bind`

**问题**：与企业端「数据能力中心」已落地的连接器规范**两套 UX、两套心智模型**；员工在空间里绑「能力」时绕开连接器目录、凭证库、连通性探测与 `DataSource` 治理字段。

### 1. 应对齐的规范来源（企业连接器 · 已验收）

以 `docs/design/enterprise-data-capability-center-acceptance-report-2026-06-14.md` 为准，员工端空间内主动源导入须**复用同一套步骤与 RPC 语义**（UI 可嵌入抽屉 / 子向导，不必跳转企业设置全页）：

| 步骤             | 企业端现状                                                     | 员工端 U8 要求                                                                |
| ---------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. 选连接器      | `enterprise-data.connectors.catalog`                           | 空间导入抽屉内展示 catalog（按 tenant 过滤；无 tenant 时降级提示）            |
| 2. 安装动作包    | `connectors.ensure-demo-package` / `ensure-package`            | 未 `ready` 的连接器须先装包，再允许绑定                                       |
| 3. 选/建凭证     | `connector-credentials.list/upsert` + OAuth 流程               | 与 `enterprise-data-governance-center-surface.ts` 同源交互（API Key / OAuth） |
| 4. 探测连通性    | `sources.test-connection`                                      | 绑定前必须探测成功（或明确允许 `mock_smoke_ok` 演示路径）                     |
| 5. 登记数据源    | `DataSource`（`connectorId` + `credentialId` + `displayName`） | 创建或选取已有 DataSource，**禁止**仅写裸 endpoint 字符串冒充连接器源         |
| 6. 绑定到当前 KB | `knowledge.source.bind` 或经 DataCapability / projection 桥接  | `knowledgeBaseId` **固定为当前空间**；visibility 继承 KB（与 W2 一致）        |

参考实现（只读复用，禁止再抄一套平行表单）：

- `ui/src/ui/ports/enterprise/views/enterprise-data-governance-center-surface.ts`
- `ui/src/ui/controllers/enterprise-data-capability/gateway-client.ts`
- `src/gateway/enterprise-data/connector-catalog.ts`、`source-connection-probe.ts`

### 2. 与 U4 §5.3 的取代关系

| U4 §5.3（过渡）                         | U8（终态）                                         |
| --------------------------------------- | -------------------------------------------------- |
| 三字段 endpoint 表单                    | **删除**或降级（见下）                             |
| `external` / `capability` 自由 endpoint | **必须**经连接器 + DataSource                      |
| 无 catalog / 凭证 / 探测                | **必须**对齐 §1 表格                               |
| 验收仅断言 `bindSource` 请求形状        | 验收断言连接器步骤 + KB 归属 + `plane=active` 回显 |

**endpoint 表单处置（实施团队二选一，PR 描述写死）**：

- **A · 连接器流程替换（推荐）**：移除 `renderActiveSourceForm` 整段；「主动数据源」= 嵌入式连接器向导（6 步）。
- **B · HTTP REST 快速绑定保留**：主路径仍为连接器向导；底部折叠 **「HTTP REST 快速绑定」** 仅允许 `kind=api` + HTTPS URL（仍调 `knowledge.source.bind`），**移除** `external` / `capability` 选项与通用 endpoint 占位符。

无论 A/B，**不得**再让用户在主力 UI 里手写 connector 级 endpoint 冒充 Salesforce / Notion / ERP 等连接器源。

### 3. 修复规格

1. **空间上下文**：向导全程展示「绑定到【{当前空间标题}】」；`knowledgeBaseId` 不可改。
2. **权限**：写权限与 U4 一致（`canWriteKnowledgeBase` / `selectedKnowledgeBaseCanWrite`）；viewer 禁用。
3. **租户与 visibility 分路径**：须遵守 **§8 作用域决策表**（个人空间允许 active，但连接器 vs HTTP REST 分路径）。
4. **成功后**：关闭抽屉 → 刷新 `knowledge.base.sources.list` → 「来源」Tab 出现 `plane=active` 行（含 connector / DataSource 可识别字段，而非仅裸 URL）。
5. **与供给页关系**：不得再开第二套「数据能力」绑定入口；空间内导入为**唯一**员工端主动源绑定入口（与主方案 §8.3 一致）。
6. **后端**：优先复用 enterprise-data + 既有 `knowledge.source.bind`；若需新 RPC 桥接（例如 `knowledge.source.bindFromDataSource`），单独立项并在 U8 PR 列明；**不得**破坏 W2 visibility 继承与 W3 `knowledgeBaseId` 归属。

### 4. 涉及文件（预期）

- `ui/src/ui/views/knowledge-universe-space-import.ts`（删除/替换 `renderActiveSourceForm`）
- 新增（建议）`ui/src/ui/views/knowledge-universe-space-connector-bind.ts`（嵌入向导）
- `ui/src/ui/controllers/knowledge-universe.ts`（绑定 action 改接 DataSource + bind 桥接）
- `ui/src/ui/ports/employee/render-model.ts`、`home-page-contracts.ts`
- 测试：`knowledge-universe-space-import.node.test.ts` + 新 connector-bind 测试；扩展 `scripts/test-knowledge-space-unification.mjs`
- 文档：U4 §5.3 状态、acceptance-report **交付三**、demo script「绑定 active source」场景

### 5. 验收

1. 已选空间 → 导入抽屉 →「主动数据源」→ **不出现** U4 过渡版三字段通用表单（方案 A）；或仅见折叠「HTTP REST 快速绑定」（方案 B）。
2. 连接器路径：选 catalog 条目 →（如需）装包 → 选凭证 → 探测成功 → 绑定 → `knowledge.base.sources.list` 含 `plane=active` 且可追溯到 `connectorId` / DataSource。
3. `knowledgeBaseId` 始终为当前空间；请求不含独立 `visibility`。
4. viewer / 无写权限：入口不可用。
5. 演示连接器（Salesforce demo / Notion 等）可走通验收报告 §2.1–2.2 同级 smoke 路径（**team/enterprise 或 private+tenant** 路径）。
6. **个人空间（private、无 tenant）**：须能走 **HTTP REST 快速绑定** 并成功出现 `plane=active`（见 §8）。
7. 回归：被动 ingest 与 U5/U7 入口**不受影响**。

### 6. 测试（建议纳入门禁）

| 行为                           | 建议文件                                       | 要点                                   |
| ------------------------------ | ---------------------------------------------- | -------------------------------------- |
| 过渡表单已移除/降级            | `knowledge-universe-space-import.node.test.ts` | 无裸 `external`/`capability` 主力 UI   |
| 连接器向导步骤                 | 新 `*-connector-bind.node.test.ts`             | mock catalog → 探测 → bind；断言 KB id |
| HTTP REST 快速绑定（若方案 B） | 同上                                           | 仅 `kind=api`；仍不含 `visibility`     |

### 7. 依赖与批次

- **前置**：U4 交付一 ✅、U5+U7 / U6 交付二 ✅（含专家二次独立复核 ✅）。
- **推荐次序**：**W14（U8）→ W13 录屏**（active 源场景按终态录制）。
- **编号说明**：本文 **U8** = 产品跟进「主动源 ↔ 连接器」；`work-breakdown` 文档中的 **W8** = 迁移/功能开关，**不同含义**。

### 8. 作用域决策（产品裁定 · 2026-06-29 · **已决**）

> 二次验收阻塞项：**「个人空间是否允许主动数据源？」** — 下文为执行团队须遵循的**正式裁定**，U8 实现不得再 pending。

#### 8.1 裁定结论

**允许。** 个人空间（`visibility=private`）的 **owner** 与其它 visibility 一样，可在统一导入抽屉中绑定 **主动数据源**（`plane=active`）。

**依据**（与主方案一致，非新增产品轴）：

1. `openbot-knowledge-space-unification-implementation-plan-2026-06-29.md` §5 权限矩阵：owner 对 private KB **可绑定主动能力**。
2. 同主方案 §8.3：导入类型含 API / External / Capability，**未**按 visibility 排除 personal。
3. W2 已落地：`knowledge.source.bind` + `knowledgeBaseId` + visibility 继承 KB — **后端不区分** private 禁绑 active。

#### 8.2 分路径约束（U8 必遵 · 非「禁止个人 active」）

企业连接器栈（`DataSource` / catalog / 凭证）**租户 scoped**；个人空间常无 `tenantId`。因此 U8 **按路径分流**，而非一刀切关闭「主动数据源」选项：

| 当前空间              | tenant / seat         | 导入抽屉「主动数据源」UI                                                                       | 允许的后端路径                                       |
| --------------------- | --------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **private**           | **无**                | **隐藏**连接器 6 步向导；展示 **HTTP REST 快速绑定**（方案 B 主路径，或方案 A 下的唯一子路径） | `knowledge.source.bind`，`kind=api`，HTTPS URL       |
| **private**           | **有**                | 连接器向导 **+** HTTP REST 快速绑定（折叠）                                                    | connector → DataSource → bind 桥接；和/或 `bind` api |
| **team / enterprise** | **有**（必需，见 U3） | **连接器向导为主**；external/capability **禁止**裸 endpoint                                    | enterprise-data 全流程 → 绑定当前 KB                 |
| **team / enterprise** | 无                    | 不应创建（U3）；若异常态则 **禁用** active 并提示创建/加入团队空间                             | —                                                    |

**要点**：

- ❌ **错误理解**：「个人空间不允许主动数据源」— 与主方案权限矩阵冲突。
- ✅ **正确实现**：个人无 tenant 时 **不允许走 enterprise 连接器向导**（无 catalog 上下文），但 **仍允许** owner 通过 **HTTP REST 快速绑定** 向 private KB 挂 `kind=api` 主动源。
- 有 tenant 的个人空间（seat 上下文存在）：与 team 类似，**可**走完整连接器流程。

#### 8.3 与 §2 方案 A/B 的组合（写死默认）

| 方案              | private + 无 tenant                                      | private + 有 tenant         | team / enterprise                       |
| ----------------- | -------------------------------------------------------- | --------------------------- | --------------------------------------- |
| **A**（全连接器） | **不适用** — 须降级为「仅 HTTP REST 子面板」或改选 **B** | 连接器向导                  | 连接器向导                              |
| **B**（推荐默认） | HTTP REST **为主**（无连接器块）                         | 连接器 **+** HTTP REST 折叠 | 连接器 **+** HTTP REST 折叠（api only） |

**执行团队默认采用方案 B**，并在 U8 PR 描述中引用本节 §8。

#### 8.4 文案与测试

- i18n：个人无 tenant 时若用户点「主动数据源」，**不得** silent 空页 — 须说明「个人空间可绑定 REST API；企业连接器请在团队/企业空间或使用已绑定租户凭证的个人空间」。
- 门禁补充：
  - private KB + 无 tenant → 仅渲染 HTTP REST 路径；`bindSource` 成功。
  - team KB + tenant → 连接器 mock 路径；不得出现 U4 三字段 generic form。

---

## 执行团队任务清单（交付一收尾 + 交付二 + 交付三）

> 与 `openbot-knowledge-space-unification-work-breakdown-2026-06-29.md` §W10–W14 对齐。
> **专家次序**：W10（U4 land/联调）→ **W11（U5+U7）** → W12（U6）→ **W15（U9 ✅）** → **W14（U8）** → W13（文档/录屏，含 active 源终态）。

| 任务 ID | 对应                      | 状态            | 依赖         | 交付物                                                | 验收                                                    |
| ------- | ------------------------- | --------------- | ------------ | ----------------------------------------------------- | ------------------------------------------------------- |
| **W10** | U4 land + 联调            | 待做            | 交付一源码   | commit 冻结 SHA + `pnpm ui:build` + Gateway 重启      | dist 含 `ku-space-import-picker`；空间「新建」→ U4 抽屉 |
| **W11** | **U5 + U7 合并**          | **✅ 源码完成** | W10          | 单 PR：4 卡→1 按钮 + 改接 ingest + 测试               | §U5 验收 1–5 + §U7 验收 1–4                             |
| **W12** | U6 首页 IA                | **✅ 源码完成** | W11          | `knowledge-universe-intelligence-band.ts` + 三带 CSS  | §U6 验收 1–4                                            |
| **W14** | **U8 主动源 ↔ 连接器**    | **✅ 源码完成** | W11/W12      | 取代 U4 §5.3；**§U8 §8 个人空间允许 active** + 分路径 | §U8 验收 1–7 + §8.4                                     |
| **W15** | **U9 首页目标空间选择器** | **✅ 源码完成** | W11          | `lockSpace` + `ku-space-import-target-selector`       | §U9 验收 1–5                                            |
| **W13** | 文档 + 录屏               | 待做            | **W14 推荐** | acceptance-report 交付三；demo script 全场景          | U2 归档；active 源按 U8 录                              |

### 建议排期（专家推荐）

1. **W10**：land U4 + 本地/联调环境 `ui:build` + `launchctl kickstart -k gui/$UID/ai.openbot.gateway`（或 Mac 应用重启）。
2. **W11**：**一个 PR** 完成 U5 卡片 + U7 路径收敛（禁止拆成两个 PR 只改一半）。
3. **W12**：W11 合并后再改首页 IA，避免三改首页。
4. **W14**：**U8** — 用企业连接器流程**取代** U4 §5.3 endpoint 表单（方案 A 或 B 写进 PR）。
5. **W15**：**U9** — 首页导入 `lockSpace=false` + 目标空间选择器（**✅ 源码完成**）。
6. **W13**：交付二/三结论 + 联调录屏（**active 源场景须在 W14 之后**）。

### 禁止事项

1. 不得只做 U5 文案/删卡而保留 `openUploadFlow` / `openPersonalIngestFlow`（U7 必须同 PR）。
2. 不得在未 `ui:build` 时判定「U4 未通过」或回滚 `openSpaceImportEntry`。
3. 不得改动 `requireSelectedKnowledgeBaseId` → `knowledgeBaseId` 归属链路（U4 §3）。
4. 不得在未 land U4 冻结 SHA 的情况下对外宣布交付一结项。
5. 不得将 U4 §5.3 过渡 endpoint 表单当作终态对外宣传；U8 未完成前须在文档中标明「临时实现」。
6. 不得在 U8 中复制第三套连接器表单；须复用 enterprise-data RPC 与治理中心交互模式。

---

## U9 修复规格：首页导入入口增加目标空间选择器（区分空间内 / 首页两种上下文）

> 复检发现（2026-06-29）。**✅ 已完成**（2026-06-29 源码 + 门禁 151 tests 绿）。
> 纯前端 + 文案 + 测试，不改后端、不改归属链路。与 U8 同批跟进（U8 仍 ❌ 未做）。

### 0. 完成快照（可复核）

- `openSpaceImportEntry(surface, { lockSpace })` — 首页 `{ lockSpace: false }`，空间内默认 `true`
- 首页抽屉：`data-testid="ku-space-import-target-selector"` + 按 visibility 分组的 `<select>` + `ku-space-import-create-space`
- 空间内抽屉：`data-testid="ku-space-import-target-locked"` 固定标签
- runtime 字段：`libraryWorkspaceImportLockSpace`（`home-page-contracts` / controller / render-model）

### 1. 现象

从首页顶部「新建知识/导入」(`ku-home-import-open`) 进入统一导入抽屉时，红框那行是固定标签「导入到【我的收录】」，用户无法在抽屉内改选目标空间。

### 2. 根因

1. 目的地取自 `surface.selectedKnowledgeBaseId`，而首页进来时该值由 `ensureSelectedKnowledgeBase()`（`ui/src/ui/controllers/knowledge-universe-workspace.ts:128`）**自动选定**：`readPreferredKnowledgeBaseId()`（上次偏好）→ 否则 `knowledgeBases[0]`（列表首个）。截图落到「我的收录」。
2. 抽屉目标行是**固定标签** `targetLabel`（`ui/src/ui/views/knowledge-universe-space-import.ts` `renderImportPicker`），无选择器，无法改。
3. `openSpaceImportEntry` 不区分"从空间详情进"还是"从首页进"——两种上下文走同一固定标签。

### 3. 设计判定（两种入口，目的地处理不同）

- **空间内入口**（空间详情页「新建」/「导入来源」）：空间是**有意上下文** → 目的地 = 当前空间，**保持锁定标签**（可加"切换空间"小链接）。
- **首页入口**（顶部「新建知识/导入」，context-less）：无有意上下文 → 红框改为**目标空间选择器**，让用户定位导入到哪个目录分类。

### 4. 修复规格

1. **入口上下文标记**：给 `openSpaceImportEntry` / 抽屉增加 `lockSpace`（或 `fromHome`）标记。
   - 空间内入口：`lockSpace=true` → 渲染锁定标签「导入到【当前空间】」。
   - 首页入口：`lockSpace=false` → 渲染**目标空间选择器**。
2. **目标空间选择器**（首页入口）：
   - **默认预选 = 上次使用空间**（`readPreferredKnowledgeBaseId()`；无则列表首个真实空间）——与现状默认一致，但**可见且可改**（下拉/列表，带箭头，非死标签）。
   - 选项按 **个人 / 团队 / 企业**（visibility）分组列出（复用 `knowledgeBases` 分组 + `onSelectKnowledgeBase`）。
   - 末尾提供「＋ 新建空间」→ `openKnowledgeSpaceCreatePage`（呼应"新建知识"语义）。
   - 改选后目的地实时反映在标题/类型卡；导入类型卡可直接使用（已有合理默认）。
3. **归属链路不变**：被动 ingest 与主动 bind 仍经 `requireSelectedKnowledgeBaseId → knowledgeBaseId=所选空间`；选择器只是改 `selectedKnowledgeBaseId`，不新增后端字段。
4. **零空间兜底**：用户无任何空间时，首页入口仍走 `openKnowledgeSpaceCreatePage`（与现状一致）。

### 5. 涉及文件

- `ui/src/ui/views/knowledge-universe-space-import.ts`（`renderImportPicker` 目标行：按 `lockSpace` 渲染标签 or 选择器；`openSpaceImportEntry` 增上下文标记）
- `ui/src/ui/views/knowledge-universe-page.ts`（首页 `ku-home-import-open` 调用时传 `fromHome=true`）
- `ui/src/ui/views/knowledge-universe-library-workspace-page.ts`（空间内 `resolveLibraryPrimaryAction` 传 `lockSpace=true`）
- `ui/src/ui/ports/employee/views/home-page-contracts.ts`（如需新增 surface 字段：当前导入上下文 / 选择器开关）
- `ui/src/i18n/locales/en.ts`、`zh-CN.ts`（选择器文案：选择目标空间 / 新建空间）

### 6. 验收 / 测试

1. 首页「新建知识/导入」→ 抽屉目标行是**可改选择器**，默认预选上次空间，含「＋ 新建空间」。
2. 改选另一空间后导入 → 内容进入**所选**空间（`knowledgeBaseId=所选`）。
3. 空间详情「新建」→ 抽屉目标行为**锁定标签**=当前空间（不出现选择器）。
4. 零空间时首页入口 → 跳建空间页。
5. 回归：U4/U5/U6 既有用例与门禁 `scripts/test-knowledge-space-unification.mjs` 全绿。

### 7. 依赖

独立 UX 项，**依赖交付一（U4 统一导入抽屉）已落地**；可与 U8 同批实施。完成后首页导入入口的"目录定位"问题闭合。

---

## U10 规格：连接器向导内 OAuth 授权（oauth2 连接器）

> **状态：✅ 已完成（2026-06-29）** — `knowledge-universe-connector-bind.ts` + 向导 UI + 测试。
>
> U8 验收发现（2026-06-29）。小后续项，**依赖 U8 已落地**。纯前端 + 文案 + 测试，复用企业端既有 OAuth RPC，不改后端。

### 1. 现象 / 根因

U8 连接器向导（`ui/src/ui/views/knowledge-universe-space-connector-bind.ts` `renderConnectorWizard`）的凭证区只支持：①选已有凭证（`listConnectorCredentials`）②新建 `api_key` 凭证（label/instanceUrl/apiKey）。对 `credentialKind === "oauth2"` 的连接器（catalog 中的 `crm-salesforce`、`notion`），**没有 in-wizard 授权按钮**——用户必须先在企业数据中心完成 OAuth 授权、再回知识空间选择该凭证。若没有预授权凭证，oauth2 连接器在空间内绑不了。

### 2. 修复规格

为 `credentialKind === "oauth2"` 的连接器，在凭证区增加「授权 (OAuth)」路径，**复用企业端 OAuth RPC**（已在 `ui/src/ui/controllers/enterprise-data-capability/gateway-client.ts`）：

1. 点「授权」→ `startConnectorOAuth(tenantId, { connectorId, label, callbackOrigin, returnPath })` → 返回 `{ sessionId, authorizeUrl, simulateAllowed, expiresAt }`。
2. 若 `authorizeUrl` 非空 → 新窗口/重定向打开授权页；`returnPath`/`callbackOrigin` 指向 control-ui 回跳。
3. 轮询 `getConnectorOAuthStatus(tenantId, sessionId)` 直至 `status` 完成，取 `credentialId`。
4. 演示包（`simulateAllowed === true`）下提供「模拟完成」→ `simulateCompleteConnectorOAuth(tenantId, sessionId, workspaceName?)` → `{ credentialId }`。
5. 完成后：把返回的 `credentialId` 写入 `libraryWorkspaceConnectorBindDraft.credentialId`、刷新 `listConnectorCredentials`，随后照 U8 既有流程「测试连通 → 绑定」。

约束：

- 仅 `oauth2` 连接器显示授权按钮；`api_key`（如 SAP/HTTP-REST）维持现有 save-new 凭证表单；`none` 不显示凭证区。
- 作用域沿用 U8 `resolveActiveSourceBindPath`（需 tenant）；个人无 tenant 仍只走 HTTP REST 快速绑定，不涉 OAuth。
- 绑定环节不变：`bindKnowledgeUniverseConnectorSource` → `upsertSource` → `bindSource`（结构化 `enterprise-data://` URI，无 visibility）。

### 3. 涉及文件

- `ui/src/ui/controllers/knowledge-universe-connector-bind.ts`（新增 `startKnowledgeUniverseConnectorOAuth` / `pollKnowledgeUniverseConnectorOAuthStatus` / `simulateCompleteKnowledgeUniverseConnectorOAuth` action + OAuth session 状态）
- `ui/src/ui/views/knowledge-universe-space-connector-bind.ts`（oauth2 连接器渲染「授权」按钮 + 会话状态/授权中提示）
- `ui/src/ui/controllers/knowledge-universe.ts`（runtime 增 OAuth session 字段）
- `ui/src/ui/ports/employee/views/home-page-contracts.ts`（surface 增 `onStartConnectorOAuth` 等回调 + 会话状态字段）
- `ui/src/ui/ports/employee/render-model.ts`（handler 接线）
- `ui/src/i18n/locales/en.ts`、`zh-CN.ts`（授权/授权中/模拟完成文案）

### 4. 验收 / 测试

1. 选 `oauth2` 连接器（如 Salesforce）→ 凭证区出现「授权」按钮；选 `api_key` 连接器不出现。
2. 授权 → `startConnectorOAuth`；演示包下「模拟完成」→ 取得 `credentialId` 并自动选中。
3. 取得凭证后「测试连通 → 绑定」走通，来源以 `plane=active` 入「来源」聚合。
4. 个人空间（无 tenant）不出现连接器/OAuth，只 HTTP REST 快速绑定。
5. 回归：U8 连接器/HTTP-REST 既有用例 + 门禁 `scripts/test-knowledge-space-unification.mjs` 全绿。

### 5. 依赖

依赖 **U8 已落地**；复用企业端 `enterprise-data.connector-credentials.oauth.start/status/simulate-complete`（后端已就绪），无新增后端。
