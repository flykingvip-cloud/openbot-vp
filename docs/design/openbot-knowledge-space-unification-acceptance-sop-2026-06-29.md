# OpenBot 员工端知识空间统一化最终验收 SOP（2026-06-29）

关联文档:

- `docs/design/openbot-knowledge-space-unification-implementation-plan-2026-06-29.md`
- `docs/design/openbot-knowledge-space-unification-work-breakdown-2026-06-29.md`
- `docs/design/openbot-knowledge-space-unification-migration-flags-2026-06-29.md`（迁移、惰性回填、`knowledge.compat.status`、Phase 3 开关）
- `docs/design/openbot-knowledge-space-unification-acceptance-report-2026-06-29.md`（自动化测试映射与一键脚本）

## 文档定位

本文用于把“知识空间统一化”项目的最终验收动作整理成一份可直接执行的 SOP。

适用对象:

- OpenBot 侧架构验收负责人
- OpenBot 侧代码验收负责人
- 联调负责人
- 第三方团队交付负责人

本文只覆盖本轮范围:

1. 空间模型统一
2. 导入入口统一
3. 写权限统一
4. 列表与供给页同源化
5. 兼容与迁移收口

本文不覆盖下一阶段范围:

1. 知识检索/RAG 能力重构
2. 数据能力运行时重写
3. 完整知识工作台 IA 二次升级

## 前置条件

执行验收前必须确认以下条件已满足:

### 冻结基准（强制）

1. **验收必须锚定单一 git commit SHA**（交付分支上的 merge commit 或 tag），并在验收记录中写明该 SHA。
2. 在该 SHA 上执行一次完整自动化门禁且**全部通过**（见 §F 与 `openbot-knowledge-space-unification-acceptance-report-2026-06-29.md`）:

   ```bash
   OPENBOT_TEST_PROFILE=low node scripts/test-knowledge-space-unification.mjs
   ```

3. **不得在并发编辑中的 dirty 工作树上签字验收**。若同一 SHA 上重跑出现与首次不一致的失败/通过差异，视为**验收基准不稳定**，需暂停签字、冻结树状态后重验。
4. 多 agent 共享工作树场景：验收前执行 `git status` 确认无他人 WIP；必要时要求交付方提供独立 worktree 或 CI 绿 build 作为对照。

### 交付材料

5. 第三方团队已提交完整代码分支（含上述冻结 SHA）。
6. 第三方团队已提交接口变更说明。
7. 迁移与功能开关说明 → `openbot-knowledge-space-unification-migration-flags-2026-06-29.md`。
8. 第三方团队已提交自动化测试结果（含 §F 硬门禁输出）。
9. 第三方团队已提交联调录屏或逐步截图（脚本见 `openbot-knowledge-space-unification-demo-script-2026-06-29.md`）。
10. 当前分支已可本地运行对应前后端环境。

建议先保留以下材料:

1. 代码 diff 导出
2. 测试结果截图
3. 联调录屏
4. 网络请求与 RPC 返回快照
5. 迁移前后数据样本

## 验收环境准备

建议准备三类测试身份:

1. `owner@example.com`
2. `editor@example.com`
3. `viewer@example.com`

建议准备一个带 tenant 上下文的企业环境，便于覆盖:

1. 个人空间
2. 团队空间
3. 企业空间

建议准备如下测试空间:

1. 私有空间 `个人资料库`
2. 团队空间 `华东销售知识空间`
3. 企业空间 `企业政策知识空间`

建议准备如下测试内容:

1. 文本文件 `pricing.md`
2. 网页 URL `https://example.com/policy`
3. 数据集记录 2 条
4. 一条 deliverable
5. 一条 capability 绑定输入

## A. 代码结构验收

### A1. 空间类型主轴是否已统一

检查项:

1. 代码中是否仍新增或引入了第三套空间类型枚举。
2. 前端是否仍以 `backendKind` 作为一级分组依据。
3. `knowledge.base.list` 的分组逻辑是否基于 `visibility`。

通过标准:

1. 用户面个人/团队/企业统一由 `KnowledgeBase.visibility` 驱动。
2. `backendKind` 仅作为兼容派生字段存在。

失败判定:

1. 第三方新增了另一套空间类型字段或枚举。
2. 列表分组仍依赖 `backendKind` 或其它平行字段。

### A2. 写权限能力是否已统一

检查项:

1. 是否存在统一的读/写/管理权限函数。
2. 写接口是否仍直接依赖 owner-only 判断。
3. 成员角色是否真的参与了权限计算。

通过标准:

1. owner/admin/editor/viewer 的能力边界清晰。
2. 关键写接口不再复制 owner-only 分支。

失败判定:

1. 团队空间写权限仍本质上是 owner-only。
2. editor 角色只停留在 UI 上，后端不承认。

### A3. `source.bind` 是否已真正收口

检查项:

1. `knowledge.source.bind` 是否要求目标空间。
2. binding visibility 是否继承空间。
3. 外部 `visibility` 是否被忽略或仅做兼容提示。

通过标准:

1. 绑定记录的 visibility 与目标空间一致。
2. 无法再制造“空间 A，binding 可见性 B”的状态。

失败判定:

1. 仍然可以通过请求参数让 binding 保留另一套 visibility。

## B. RPC 行为验收

### B1. 创建空间

步骤:

1. 创建个人空间。
2. 创建团队空间。
3. 创建企业空间。

通过标准:

1. 个人空间 `visibility = private`
2. 团队空间 `visibility = team`
3. 企业空间 `visibility = enterprise`
4. 无 tenant 时不能成功创建团队/企业空间

### B2. 显式空间导入

步骤:

1. 对个人空间执行 `collect`
2. 对团队空间执行 `upload`
3. 对团队空间执行 `collectWeb`
4. 对企业空间执行 `importDataset`

通过标准:

1. 每个接口都明确写入指定空间。
2. 返回体中可识别目标 `knowledgeBaseId`。
3. 后续列表或搜索可看见结果。

### B3. 兼容 warning

步骤:

1. 用旧调用方式省略 `knowledgeBaseId`
2. 观察返回体、日志或兼容标记

通过标准:

1. Phase 1/2 兼容期内可成功，但明确返回 warning。
2. warning 可用于后续排查旧调用方。

失败判定:

1. 兼容路径完全静默，无法追踪旧调用。

### B4. 强拒绝开关

步骤:

1. 设置环境变量（完整列表见 `openbot-knowledge-space-unification-migration-flags-2026-06-29.md` §4）:
   - `OPENBOT_KNOWLEDGE_REQUIRE_KNOWLEDGE_BASE_ID=1`
   - （可选）`OPENBOT_KNOWLEDGE_REJECT_SOURCE_BIND_VISIBILITY=1`
2. **重启 gateway 进程**使 env 生效（macOS 可通过 OpenBot 应用重启 gateway，或 `launchctl kickstart -k gui/$UID/ai.openbot.gateway`）。**不重启即判无效验收。**
3. 再次以旧方式省略 `knowledgeBaseId` 调用导入 RPC。
4. （可选）对 `knowledge.source.bind` 传入 legacy `visibility` 字段，验证 `REJECT_SOURCE_BIND_VISIBILITY` 行为。

通过标准:

1. 请求被拒绝。
2. 错误语义明确。
3. 关闭开关并重启 gateway 后，Phase 1 兼容行为可恢复（warning 模式）。

### B5. active source 绑定

步骤:

1. 向团队空间绑定 capability。
2. 读取 source bindings。
3. 检查 plane、visibility、knowledgeBaseId。

通过标准:

1. `plane = active`
2. `knowledgeBaseId` 正确
3. `visibility` 与目标空间一致

### B6. passive source 拒绝走 bind

步骤:

1. 尝试以 `upload` 或等效 passive kind 走 `knowledge.source.bind`

通过标准:

1. 请求被拒绝。
2. 错误语义清晰。

## C. 权限验收

### C1. owner 验收

步骤:

1. owner 创建团队空间
2. owner 导入文件
3. owner 绑定 capability
4. owner 修改空间元信息
5. owner 邀请成员

通过标准:

1. 全部成功。

### C2. editor 验收

步骤:

1. owner 邀请 editor
2. editor 进入团队空间
3. editor 导入网页
4. editor 绑定 capability
5. editor 尝试修改成员或空间管理信息

通过标准:

1. editor 可写内容。
2. editor 不可执行管理员动作。

失败判定:

1. editor 无法导入内容。

### C3. viewer 验收

步骤:

1. owner 邀请 viewer
2. viewer 进入团队空间
3. viewer 尝试导入内容
4. viewer 尝试绑定 capability

通过标准:

1. viewer 可读。
2. viewer 不可写。

### C4. admin 验收

步骤:

1. owner 邀请 admin
2. admin 进入团队空间
3. admin 导入内容
4. admin 邀请新成员
5. admin 修改空间元信息

通过标准:

1. admin 具备管理级能力。

## D. 前端行为验收

### D1. 空间列表分组

步骤:

1. 打开知识工作台
2. 检查空间列表分组

通过标准:

1. 存在个人 / 团队 / 企业三段分组。
2. pinned/favorites/recent 即使存在，也不替代这三段主分组。

### D2. 创建入口唯一化

步骤:

1. 检查所有“创建空间”入口
2. 实际创建一个团队空间

通过标准:

1. 只保留一个正式创建入口。
2. 创建时必须明确选择空间类型。

失败判定:

1. 存在某个快捷入口绕过空间类型选择。

### D3. 导入漏斗统一

步骤:

1. 分别测试文件、网页、数据集、笔记、capability 入口

通过标准:

1. 所有入口都先选空间，再选来源类型。
2. 正式 UI 不存在“不选空间直接导入”的路径。
3. **空间内（U4，2026-06-29）**：已选空间后，「新建 / 导入来源」进入统一内容类型选择抽屉（含被动 ingest + 主动 `bindSource`），不再按 Tab 隐式分叉到旧个人沉淀单文件表单。

### D4. 供给页同源化

步骤:

1. 打开供给页
2. 对比空间列表与供给页中的空间类入口

通过标准:

1. “我的知识 / 团队知识 / 企业知识”与空间列表同源。
2. “数据能力”是 active plane 视图，而不是并列空间类型。

失败判定:

1. 供给页仍直接挂另一套散装对象顶级宇宙。

### D5. 空间详情页

步骤:

1. 进入一个空间详情
2. 查看过滤视图

通过标准:

1. 至少支持全部 / passive / active / 已移除视图。
2. 能看出 active 与 passive 只是内容平面差异。

## E. 迁移与兼容验收

### E1. source binding visibility 回填

权威说明：`openbot-knowledge-space-unification-migration-flags-2026-06-29.md` §2。

步骤:

1. 准备历史 binding 数据（`visibility` 与所属 KB 不一致）。
2. 触发惰性迁移（任选其一）:
   - 调用 `knowledge.source.list` 或 `knowledge.base.sources.list`（内部经 `listKnowledgeSourceBindings`）
   - 调用 **`knowledge.compat.status`**，读取 `sourceBindingVisibilityBackfill`（内部经 **`backfillSourceBindingVisibilityStore()`**）
3. 再次读取 binding，确认 `visibility` 已与 KB 一致。

通过标准:

1. 已绑定到空间的 source `visibility` 与空间一致。
2. 重复执行步骤 2，`updated` 为 0（幂等）。

失败判定:

1. 仅在仓库中搜索独立 SQL/一次性迁移脚本而忽略上述 RPC 与惰性回填 —— 视为漏判。

### E2. 个人收件箱退役路径

步骤:

1. 检查“我的收录”空间是否仍存在
2. 检查新 UI 是否继续依赖它做默认导入

通过标准:

1. 历史空间可保留。
2. 新 UI 不再以它为默认目标。

### E3. 功能开关

权威说明：`openbot-knowledge-space-unification-migration-flags-2026-06-29.md` §4–§6。

步骤:

1. 调用 `knowledge.compat.status`，记录 `featureFlags` 与 `warningStats`。
2. 按 §B4 切换 env 开关并**重启 gateway**，验证开启与关闭行为。
3. 对比文档中的开关名与实际 env 是否一致。

通过标准:

1. 开关行为可预测。
2. 说明文档和实际行为一致。
3. `warningStats` 在触发 compat warning 后递增（可与 B3 联动观察）。

## F. 自动化测试验收

### F1. 后端测试

至少应存在以下类型测试:

1. owner/admin/editor/viewer 权限测试
2. collect/upload/collectWeb/importDataset 显式空间导入测试
3. 兼容 warning 测试
4. 强拒绝开关测试
5. active source visibility 继承测试
6. passive kind bind 拒绝测试

### F2. 前端测试

#### F2.1 硬门禁（缺失或未通过 → F2 不通过）

在冻结 SHA 上，以下用例必须存在于 `scripts/test-knowledge-space-unification.mjs` 覆盖范围内且全部 green:

| 必测行为                     | 测试文件                                                                       | 用例名（`it(...)`）                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 空间列表三段分组             | `ui/src/ui/views/knowledge-universe-library-grouping.node.test.ts`             | `partitions sidebar spaces into pinned, favorites, and visibility groups`                    |
| 导入必须先选空间             | `ui/src/ui/views/knowledge-universe-space-ingest.node.test.ts`                 | `redirects to library create when ingest is opened without a selected space`                 |
| 供给页同源化                 | `ui/src/ui/views/knowledge-universe-supply-spaces.node.test.ts`                | `renders personal supply spaces from knowledgeBases instead of a parallel pool`              |
| 空间详情 passive/active 过滤 | `ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts` | `renders aggregated source plane and kind columns in the 来源 table`                         |
| 创建入口唯一化               | `ui/src/ui/views/knowledge-universe-create-entry.node.test.ts`                 | `routes formal create through the libraryCreate page tab`                                    |
| 创建入口唯一化（空库 CTA）   | `ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts` | `routes the formal create action through the libraryCreate page tab when no libraries exist` |
| 空间内统一导入               | `ui/src/ui/views/knowledge-universe-space-import.node.test.ts`                 | `opens the unified import drawer instead of the legacy upload form`                          |
| 主动源 bind 契约             | `ui/src/ui/views/knowledge-universe-space-import.node.test.ts`                 | `builds bindSource requests with knowledgeBaseId and without visibility`                     |
| viewer 只读禁用              | `ui/src/ui/views/knowledge-universe-space-import.node.test.ts`                 | `disables write access for viewer members in shared spaces`                                  |

一键执行:

```bash
OPENBOT_TEST_PROFILE=low node scripts/test-knowledge-space-unification.mjs
```

#### F2.2 建议项（不阻断签字，但应在联调录屏中覆盖）

| 行为                      | 建议证据                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 空状态 CTA 导向创建       | `knowledge-universe-governance.browser.test.ts` → `links empty discover and actions cards to ingest and deliverables` |
| 创建页 Runtime Scope 选择 | 录屏场景 1（demo script）：创建页展示 personal/team/enterprise 三段                                                   |

### F3. 回归测试

不得破坏以下能力:

1. `knowledge.base.search`
2. `knowledge.base.documents.list`
3. `knowledge.base.web.list`
4. `knowledge.base.datasets.list`
5. `knowledge.base.agent-knowledge.list`
6. `knowledge.deliverables.attach`

## G. 交付材料归档

最终归档建议至少包括:

1. 设计稿最终版
2. 任务拆解表
3. 接口变更说明
4. 迁移与功能开关说明 → `openbot-knowledge-space-unification-migration-flags-2026-06-29.md`
5. 验收报告 → `openbot-knowledge-space-unification-acceptance-report-2026-06-29.md`
6. 自动化测试结果（含冻结 SHA + 门禁命令输出）
7. 联调录屏 → `openbot-knowledge-space-unification-demo-script-2026-06-29.md`
8. 已知问题清单 → `openbot-knowledge-space-unification-known-issues-2026-06-29.md`
9. 最终验收结论

## H. 最终结论模板

建议使用以下口径:

```text
知识空间统一化项目验收结论:

1. 空间类型主轴统一: 通过 / 不通过
2. 写权限统一: 通过 / 不通过
3. 导入漏斗统一: 通过 / 不通过
4. source.bind 契约收口: 通过 / 不通过
5. 空间列表三段分组: 通过 / 不通过
6. 供给页同源化: 通过 / 不通过
7. 迁移与兼容关闭路径: 通过 / 不通过
8. 自动化测试与联调证据: 通过 / 不通过

总体结论:
- 是否允许宣布本轮统一化完成: 是 / 否
- 是否允许第三方团队结项: 是 / 否
- 是否存在阻断上线问题: 是 / 否
```

## I. 一票否决项

以下任一项出现，直接判定不通过:

1. 新 UI 仍存在正式的“无空间导入”路径。
2. 团队空间 editor 仍然无法写入。
3. `source.bind` 仍可独立生效另一套 visibility。
4. 供给页与空间页仍是两套顶级宇宙。
5. 第三方团队无法提供自动化测试和真实演示证据。

## J. 建议验收顺序

建议严格按以下顺序验收:

1. 代码结构
2. RPC 行为
3. 权限
4. 前端行为
5. 迁移与兼容
6. 自动化测试
7. 联调录屏

不要先看 UI 再看权限，否则很容易被“看起来完成了”误导。
