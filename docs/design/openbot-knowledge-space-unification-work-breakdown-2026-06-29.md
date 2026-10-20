# OpenBot 员工端知识空间统一化研发任务拆解表（2026-06-29）

关联主方案:

- `docs/design/openbot-knowledge-space-unification-implementation-plan-2026-06-29.md`
- `docs/design/openbot-knowledge-space-unification-migration-flags-2026-06-29.md`（W8 迁移 / 开关 / 惰性回填 / `knowledge.compat.status`）
- `docs/design/openbot-knowledge-workspace-optimization-2026-06-14.md`
- `docs/design/openbot-knowledge-runtime-core-execution-plan-2026-06-25.md`

## 文档定位

本文用于把“知识空间统一化”方案落成可排期、可指派、可联调、可验收的研发任务。

本文默认以下前提已经成立:

1. 主设计方案已经评审通过。
2. 第三方团队会分别承担后端、前端、测试与联调工作。
3. 最终验收由 OpenBot 侧执行，而非第三方自判。

本文明确不做两件事:

1. 不重写知识域核心架构。
2. 不接受“只改 UI 文案 / 只改布局，不统一模型与接口”的交付。

## 冻结执行结论

本轮统一化的冻结结论如下:

1. 用户面“知识空间”统一等价于 `KnowledgeBase`。
2. 用户面“个人 / 团队 / 企业”统一等价于 `KnowledgeBase.visibility`。
3. 被动知识与主动能力只保留为 `plane = passive | active` 差异。
4. 所有正式导入入口必须显式指向某个知识空间。
5. 团队空间写权限不得继续 owner-only，必须支持成员角色。

## 必须冻结的架构原则

### 原则 1: `KnowledgeBase.visibility` 是唯一空间类型主轴

允许:

- `private -> 个人空间`
- `team -> 团队空间`
- `enterprise -> 企业空间`

不允许:

- 新增第三套空间类型枚举
- 继续使用 `backendKind` 作为 UI 一级分类
- 继续使用 `SourceDescriptor.visibility` 表示独立于空间的第二可见性体系

### 原则 2: 导入行为必须绑定空间

允许:

- 先创建空间，再导入
- 先选择已有空间，再导入

不允许:

- 用户点击导入时系统静默新建私有空间
- 用户在正式 UI 中不选空间即可导入

### 原则 3: 团队空间必须是真协作空间

允许:

- owner / admin / editor 写入
- viewer 只读

不允许:

- 空间可见但除 owner 外所有人无法写入

### 原则 4: active / passive 是内容平面，不是空间类型

允许:

- 空间详情内按 active / passive 过滤
- 数据能力保留为 active plane 管理视图

不允许:

- 把 active / passive 重新做成另一套顶级“空间分类”

### 原则 5: 兼容要有关闭路径

允许:

- Phase 1 保留兼容 warning
- Phase 3 关闭兼容兜底

不允许:

- 将“个人收件箱兜底”保留为长期默认行为

## 工作流总览

| 编号 | 工作流                           | 类型      | 风险 | 依赖       |
| ---- | -------------------------------- | --------- | ---- | ---------- |
| W0   | 设计冻结与 UI 落点核对           | 设计/联调 | 低   | 无         |
| W1   | 统一读写权限模型                 | 后端      | 高   | W0         |
| W2   | `knowledge.source.bind` 契约收口 | 后端      | 中   | W1         |
| W3   | 被动导入接口兼容收口             | 后端      | 中   | W1         |
| W4   | 前端创建入口与导入漏斗统一       | 前端      | 高   | W0、W2、W3 |
| W5   | 空间列表按 `visibility` 分组     | 前端      | 中   | W0         |
| W6   | 供给页与空间列表同源化           | 前端+后端 | 高   | W5         |
| W7   | 聚合来源接口与空间详情聚合视图   | 后端+前端 | 中   | W2、W3     |
| W8   | 迁移、功能开关与兼容关闭         | 后端      | 中   | W2、W3、W4 |
| W9   | 测试补齐与联调验收               | 测试/联调 | 高   | 全部       |

建议实施顺序:

`W0 -> W1 -> W2 -> W3 -> W4 -> W5 -> W6 -> W7 -> W8 -> W9`

不得跳过 `W1` 直接做 `W4/W5`。

---

## W0. 设计冻结与 UI 落点核对

### 目标

把“主设计稿中的行为要求”映射到实际实施仓与页面文件。

### 范围

- 做: 核对真正承载员工端知识工作台的前端文件、页面、surface 契约、状态机与路由入口。
- 不做: 任何功能开发。

### 产出

1. 一份“实施映射表”，列出:
   - 页面文件
   - 状态文件
   - RPC client 文件
   - 测试文件
2. 一份“与主设计稿的差异清单”。

### 验收标准

1. 第三方团队能明确说出哪些真实文件会被改。
2. 不再引用仓库中不存在的页面文件名作为实施边界。

---

## W1. 统一读写权限模型

### 目标

用统一权限能力替代当前 owner-only 写入模型。

### 当前约束

当前写权限基本依赖 `ownedKnowledgeBaseForMutation()`。

### 范围

- 做:
  - 抽象 `canReadKnowledgeBase()`
  - 抽象 `canWriteKnowledgeBase()`
  - 抽象 `canAdminKnowledgeBase()`
  - 把成员角色接入真实权限判断
- 不做:
  - 重写可见性体系

### 任务

1. 设计统一权限输入结构:
   - userId
   - tenantId
   - knowledgeBase
   - member records
2. 定义角色矩阵:
   - owner
   - admin
   - editor
   - viewer
3. 替换以下写入入口的 owner-only 判断:
   - `knowledge.personal.collect`
   - `knowledge.personal.upload`
   - `knowledge.personal.collectWeb`
   - `knowledge.personal.importDataset`
   - `knowledge.source.bind`
   - `knowledge.deliverables.attach`
   - `knowledge.base.update`
   - `knowledge.base.documents.detach`
   - `knowledge.base.documents.restore`
   - `knowledge.base.members.invite`
4. 明确 admin 与 editor 的边界:
   - editor 可写内容
   - admin 可管理成员与空间元信息

### 输出

1. 权限能力实现代码
2. 角色矩阵说明
3. 权限回归测试

### 验收标准

1. 团队空间 editor 可导入内容。
2. viewer 无法写入。
3. 代码中不再散落 owner-only 复制判断。

---

## W2. `knowledge.source.bind` 契约收口

### 目标

让 active source 绑定完全从属于空间模型。

### 范围

- 做:
  - `knowledgeBaseId` 强约束
  - `visibility` 继承空间
  - 兼容 warning
- 不做:
  - 能力运行时重写

### 任务

1. 调整请求契约:
   - `knowledgeBaseId` 成为正式必填目标
   - `visibility` 退化为兼容字段
2. 实现 binding visibility 继承:
   - 读取 KB
   - 从 KB 派生 visibility
   - 忽略外部 `visibility`
3. 接入统一写权限
4. 补充兼容日志/warning
5. 更新接口说明和测试

### 输出

1. `knowledge.source.bind` 实现变更
2. source binding visibility 继承逻辑
3. 兼容 warning 机制

### 验收标准

1. 无法再让 source binding 生效另一套独立 visibility。
2. 团队空间 editor 可绑定 active source。
3. passive source 仍不能走 bind。

---

## W3. 被动导入接口兼容收口

### 目标

把 `collect/upload/collectWeb` 从“可隐式落入收件箱”收紧为“显式空间导入”，同时分阶段保护兼容。

### 范围

- 做:
  - UI 新调用强制传 `knowledgeBaseId`
  - 旧调用保留兼容 warning
  - 准备最终关停开关
- 不做:
  - 立即删除个人收件箱

### 任务

1. 为以下接口增加一致的兼容处理:
   - `knowledge.personal.collect`
   - `knowledge.personal.upload`
   - `knowledge.personal.collectWeb`
2. 实现 warning 返回策略:
   - 不影响成功返回
   - 明确告诉调用方使用了兼容兜底
3. 准备 feature flag:
   - 允许在 Phase 3 打开“无空间即拒绝”
4. 明确收件箱空间的未来定位:
   - 普通历史空间
   - 非默认导入目标

### 输出

1. 三个接口的一致兼容策略
2. 功能开关
3. 测试用例

### 验收标准

1. 新 UI 全部显式传空间。
2. 老调用路径可以被识别与统计。
3. 打开开关后，无空间导入被正确拒绝。

---

## W4. 前端创建入口与导入漏斗统一

### 目标

让第三方团队把“创建空间”和“导入来源”统一成一条显式闭环。

### 范围

- 做:
  - 唯一创建入口
  - 显式空间选择
  - 导入类型选择
- 不做:
  - 新建另一套产品概念

### 任务

1. 只保留一个正式“创建知识空间”入口。
2. 创建时必须显式选择:
   - 个人
   - 团队
   - 企业
3. 所有导入入口统一为:
   - 先选空间
   - 再选来源类型
4. 导入来源分组:
   - passive: 文件 / 网页 / 数据集 / 笔记 / Agent 知识
   - active: API / external / capability
5. 禁止任何正式入口绕过空间选择。

### 输出

1. 创建入口统一实现
2. 导入向导或导入弹层统一实现
3. 前端调用全部显式传 `knowledgeBaseId`

### 验收标准

1. 新 UI 中找不到无空间导入路径。
2. 用户能清楚区分导入到哪个空间。
3. 创建团队/企业空间时的类型选择可见、可验证。

---

## W5. 空间列表按 `visibility` 分组

### 目标

把知识空间列表统一为用户真正能理解的三段式结构。

### 范围

- 做:
  - 个人 / 团队 / 企业分组
  - 保留 pinned / favorites / recent 作为辅助手段
- 不做:
  - 把 pinned / favorites 当成空间类型本身

### 任务

1. 读取 `knowledge.base.list`
2. 基于 `visibility` 分组:
   - private
   - team
   - enterprise
3. 为各组设计空态
4. 支持后续扩展排序:
   - 最近更新
   - 收藏优先
5. 统一点击空间后的详情入口

### 输出

1. 分组列表 UI
2. 对应状态管理
3. 分组测试

### 验收标准

1. 用户可以在一处看到所有空间。
2. 分组直接受 `visibility` 驱动。
3. 不再依赖另一套对象分类来代替空间列表。

---

## W6. 供给页与空间列表同源化

### 目标

消灭“空间宇宙”和“供给宇宙”并行存在的顶级心智冲突。

### 范围

- 做:
  - 供给页改为从空间列表同源读取
  - 数据能力降为 active plane 视图
- 不做:
  - 彻底删除对象浏览与 feed

### 任务

1. 识别当前供给页真实数据来源。
2. 将“我的知识 / 团队知识 / 企业知识”改为从 `knowledge.base.list` 派生。
3. 将“数据能力”保留为 active plane 管理视图。
4. 若仍需对象 feed，只能作为空间内视图或推荐视图，不能继续充当顶级入口。

### 输出

1. 同源化后的供给页设计与实现
2. 数据来源说明
3. 联调截图与录屏

### 验收标准

1. 供给页与空间列表不再维护两套顶级实体宇宙。
2. 验收方能够看出供给页数据来自空间而非平行对象池。

---

## W7. 聚合来源接口与空间详情聚合视图

### 目标

降低前端对多接口拼装的复杂度，统一空间详情内的内容展示。

### 范围

- 做:
  - 设计并实现聚合接口
  - 空间详情按 active/passive 过滤
- 不做:
  - 替换现有所有细粒度 list RPC

### 任务

1. 设计 `knowledge.base.sources.list`
2. 聚合以下来源:
   - documents
   - web
   - datasets
   - agent knowledge
   - source bindings
3. 统一映射:
   - `plane`
   - `kind`
   - `visibility`
   - `updatedAtMs`
4. 前端空间详情页接入聚合视图

### 输出

1. 聚合接口
2. 详情页聚合视图
3. 过滤与排序逻辑

### 验收标准

1. 同一空间内容可以在一处统一查看。
2. active/passive 过滤有效。
3. 不要求用户切换多个 tab 才知道空间里有什么。

---

## W8. 迁移、功能开关与兼容关闭

### 目标

把兼容逻辑变成可控的临时措施，而不是永久技术债。

### 范围

- 做:
  - source binding visibility 回填
  - 功能开关
  - 兼容统计
- 不做:
  - 删除历史空间

### 任务

1. 实现 source binding visibility 幂等回填。
2. 实现兼容 warning 统计。
3. 实现“无空间导入即拒绝”开关。
4. 实现“忽略 source.bind.visibility”开关或固定行为。
5. 编写迁移说明。

### 输出

1. 惰性迁移逻辑（见 `openbot-knowledge-space-unification-migration-flags-2026-06-29.md` §2–§3）
2. feature flags（同上 §4）
3. 兼容期监控方式（`knowledge.compat.status` + `compat-warning-stats.json`，同上 §3、§6）

### 验收标准

1. 迁移可重复执行。
2. 开关行为可验证。
3. 不需要停机或手工修库。

---

## W9. 测试补齐与联调验收

### 目标

用自动化测试和实际演示证明统一方案真的落地，而不是只在设计稿里成立。

### 范围

- 做:
  - 单测
  - 集成测试
  - 联调录屏
  - 交付文档
- 不做:
  - 仅提交“开发自测通过”口头结论

### 必测项

1. 权限:
   - owner
   - admin
   - editor
   - viewer
2. 导入:
   - collect
   - upload
   - collectWeb
   - importDataset
   - deliverables.attach
3. active binding:
   - 继承空间 visibility
   - passive kind 拒绝
4. 列表:
   - `knowledge.base.list`
   - 前端按三段分组
5. 聚合:
   - 空间详情内 active/passive 过滤
6. 开关:
   - warning 模式
   - 强拒绝模式

### 必交材料

1. 自动化测试结果
2. 联调录屏
3. 迁移说明
4. 功能开关说明
5. 已知问题清单

### 验收标准

1. 所有核心场景均有证据。
2. 不能只提交截图而无测试。
3. 不能只提交测试而无真实演示。

---

## 里程碑建议

| 里程碑 | 包含工作流 | 交付标准                              |
| ------ | ---------- | ------------------------------------- |
| M1     | W0 + W1    | 权限模型冻结，owner-only 被替换       |
| M2     | W2 + W3    | active binding 与被动导入兼容收口完成 |
| M3     | W4 + W5    | 创建入口、导入漏斗、三段分组列表完成  |
| M4     | W6 + W7    | 供给页同源化、空间详情聚合视图完成    |
| M5     | W8 + W9    | 迁移、开关、测试、联调与最终验收完成  |

---

## 明确禁止的拆工方式

第三方团队不得采用以下拆工方式:

1. 先做 UI 大改，再补权限。
2. 把 `source.bind` 留到最后再改。
3. 只做“列表分组”但不做导入收口。
4. 只做“新页面”，不改现有 RPC 行为。
5. 把兼容逻辑做成永久逻辑且无关闭路径。

---

## 最终排期建议

建议最少拆为以下四类负责人:

1. 后端负责人:
   - W1、W2、W3、W8
2. 前端负责人:
   - W4、W5、W6、W7
3. 测试负责人:
   - W9 自动化与联调用例
4. 联调负责人:
   - 交付环境、录屏、材料归档

如果只能投入少量人力，优先级顺序必须是:

`权限 -> bind 契约 -> 导入收口 -> 列表分组 -> 同源化 -> 聚合接口`

---

## W10–W13. U4 跟进：导入入口统一 + 首页收口（2026-06-29 追加）

> 规格来源：`openbot-knowledge-space-unification-known-issues-2026-06-29.md`（含专家评审结论 §交付一/二）。
> **交付一 U4 ✅ 通过（源码）**；**交付二 U5+U7 / U6 ❌ 未完成**。

| 工作流 | 对应             | 状态        | 目标                                                          | 依赖    |
| ------ | ---------------- | ----------- | ------------------------------------------------------------- | ------- |
| W10    | U4 land + 联调   | 待做        | commit 冻结 SHA + `pnpm ui:build` + Gateway 重启              | U4 源码 |
| W11    | **U5 + U7 合并** | **❌ 未做** | 4 卡→1 卡 + 删除/改接全部 `openPersonalIngestFlow` 加知识路径 | W10     |
| W12    | U6 首页 IA       | **❌ 未做** | `knowledge-universe-intelligence-band.ts` + 三带布局          | W11     |
| W13    | 文档 + 录屏      | 待做        | acceptance-report §6.2 更新 + demo script                     | W11+    |

**专家推荐次序**：W10 → **W11（U5+U7 单 PR）** → W12 → W13。禁止 W11 与 U7 拆成两个只改一半的 PR。

### W10 验收

1. U4 改动已 commit 并记录 `ACCEPTANCE_SHA`。
2. `dist/control-ui` 含 `openSpaceImportEntry` / `ku-space-import-picker`。
3. demo script 场景 2：空间「新建」→ U4 抽屉，非旧 upload 全页。

### W11 验收（U5 + U7 合并）

1. `renderQuickActions` 仅 1 张加知识卡（+「我的资产」迁出快捷行）。
2. `openUploadFlow` / `openSupplyManagePage` 卡删除；`openCollectFlow` 等改接 `openSpaceImportEntry`。
3. 已选空间从首页加知识 → 不触发 `onPageTabChange("personal")`。
4. 门禁 green。

### W12 验收

1. `renderKnowledgeUniverseHomePage` 三带布局。
2. 关系网络在智能带内默认可见预览。

建议排期：**W10 → W11 → W12 → W13** 同一开发者顺序完成。
