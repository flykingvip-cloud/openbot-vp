# OpenBot 全仓库分支收敛与功能完整性计划

## 1. 目标

对本地整个工作树、全部远程分支、当前生产 revision 和 release candidate 做全量排查，建立唯一可信集成基线，将仍有价值且符合当前架构的功能完整合并，并阻止以下问题再次发生：

- 功能只存在于某个历史分支；
- 后端已合并但前端入口丢失；
- UI 存在但 RPC、权限、存储或启动接线缺失；
- 当前开发分支、远端 main、release candidate 与生产 SHA 长期分叉；
- 未归因工作树修改被误提交或覆盖；
- 发布镜像来自无法复现的脏工作树或局部 layer；
- 功能回退直到线上人工发现。

本计划只定义审计、决策、集成和验收流程。执行前不得在当前共享工作树直接批量 merge、rebase、cherry-pick、stash 或清理文件。

## 2. 已确认的仓库现状

### 2.1 Git 拓扑

- 当前分支：`fix-scoped-package-templates`
- 当前 HEAD：`b3ad8a9138dcf199a802f5c369801e66eb0b8249`
- 远端同名分支：当前 HEAD 比 `origin/fix-scoped-package-templates` 超前 326 个提交。
- `HEAD...origin/main`：当前独有 749，远端 main 独有 4。
- `HEAD...origin/release/candidate-20260712`：当前独有 421，RC 独有 282。
- `origin/main...origin/release/candidate-20260712`：main 独有 4，RC 独有 610。
- 当前 HEAD 比生产 revision `85eee3e7b987b14b3f83301e3f200b3e1d797cc6` 超前 97 个提交。
- 远端分支约 43 个。

结论：当前不存在可直接指定为“最新代码”的单一分支，必须先进行提交和功能分类。

### 2.2 工作树风险

- 当前约 49 个脏文件。
- 约 26 个文件未归因。
- `package.json`、`ui/src/i18n/locales/en.ts`、`ui/src/i18n/locales/zh-CN.ts` 存在多 owner 冲突。
- 工作树同时包含 Android、iOS、macOS、Gateway、Control UI、生产 Nginx、A2UI bundle 和迁移脚本 WIP。
- 不得在该工作树直接执行全局合并。

### 2.3 生产状态

- 当前生产记录：`fix-scoped-package-templates` @ `85eee3e7...`
- 镜像：`openbot:rc-amd64-v69`
- 当前 HEAD 已领先生产 97 个提交。
- readiness 为 503，已知失败项为 `wecom`。
- 生产 UI 沿用 v67/v68 tree，而非当前 HEAD 的完整可复现全量构建。

结论：代码收敛和生产发布必须分开；未完成收敛前不得用“当前 HEAD 更晚”推断“应直接部署”。

## 3. 核心原则

1. **以功能闭环为合并单位，不以文件或单个提交为单位。**
2. **先建立集成基线，再迁移功能。**
3. **所有候选功能必须完成 UI → RPC → 权限 → 存储 → runtime → 消费 → 测试闭环。**
4. **历史分支只作为候选来源，不自动拥有正确性。**
5. **生产 SHA 是运行基线，不是代码完整性基线。**
6. **当前共享工作树是证据现场，不是集成场地。**
7. **每个功能只有一个 owner 和一个 landing stream。**
8. **任何发布必须来自干净、可复现、可追溯的提交。**

## 4. 计划总览

| Wave | 名称             | 目标                             | 输出                                     |
| ---- | ---------------- | -------------------------------- | ---------------------------------------- |
| 0    | 冻结与取证       | 固化当前状态，避免继续扩大分叉   | refs、工作树清单、生产基线报告           |
| 1    | 提交与功能分类   | 对全部分支独有提交分类           | branch inventory、feature ledger         |
| 2    | 架构与合理性审核 | 判断保留、重做、淘汰或延后       | ADR/decision matrix                      |
| 3    | 集成基线建立     | 建立唯一 convergence branch      | 干净集成分支和锁定 SHA                   |
| 4    | 分域合并         | 按依赖顺序迁移功能包             | 分波次绿色提交                           |
| 5    | 全栈回归         | 验证跨域、跨端、租户、升级和回滚 | gate report                              |
| 6    | RC 与生产        | 生成可复现镜像并灰度发布         | release record、rollback proof           |
| 7    | 长期治理         | 防止再次分叉和功能回退           | CI 门禁、branch policy、feature manifest |

## 5. Wave 0：冻结与取证

### 5.1 禁止动作

- 不得切换当前工作树分支。
- 不得 merge、rebase、cherry-pick 或 stash。
- 不得删除本地/远程分支。
- 不得运行 `git gc --prune` 或手工删除 `.git/gc.log`，直到确认没有需要恢复的悬空对象。
- 不得提交未归因文件。

### 5.2 取证输出

生成：

- `git-status-snapshot.txt`
- `branch-ref-inventory.tsv`
- `worktree-inventory.txt`
- `remote-ahead-behind.tsv`
- `production-release-baseline.md`
- `unattributed-and-conflict-files.md`

必须记录当前所有 refs 的 SHA、日期、subject、upstream 和 ahead/behind。

### 5.3 工作树归属处理

逐个未归因文件确认：

- owner；
- task/spec；
- 是否已完成；
- 是否可提交；
- 是否应舍弃；
- 是否为生成物；
- 是否与其他任务共享。

在 owner 未确认前，不得移动这些文件进入任何集成提交。

## 6. Wave 1：全分支提交与功能分类

### 6.1 分支集合

至少审计：

- `HEAD`
- `origin/main`
- `origin/fix-scoped-package-templates`
- `origin/release/candidate-20260712`
- 当前生产 SHA
- 所有 `origin/pr/*`
- 所有 `origin/kiro-*`、`origin/cursor-*`、`origin/codex/*`
- `origin/wip/main-uncommitted-2026-07-13`
- 所有 supervisor 分支
- dependabot 分支单独分类，不与功能分支混合

### 6.2 提交分类

每个独有提交标记：

- `already-equivalent`：补丁已以其他 SHA 存在；
- `feature-candidate`：有价值且未进入目标基线；
- `bugfix-candidate`：修复仍适用的问题；
- `superseded`：已被更完整实现替代；
- `conflicting-design`：与现架构冲突；
- `generated-only`：构建产物/格式/锁文件噪声；
- `wip-incomplete`：不可独立合并；
- `deployment-only`：只影响发布基础设施；
- `security-sensitive`：需先读 `SECURITY.md` 并单独审核；
- `drop-approved`：经 owner 和维护者确认不再需要。

### 6.3 功能账本

建立 `feature-ledger.csv`，字段至少包括：

```text
feature_id, domain, source_branch, source_shas, owner, status,
ui, rpc, auth, storage, runtime, tests, docs, deploy,
dependencies, conflicts, decision, target_wave
```

同一功能散落在多个分支时合并为一个 feature record，不得重复落地。

## 7. Wave 2：架构与合理性审核

### 7.1 审核维度

每个功能必须回答：

- 是否符合当前产品定位？
- 是否符合多租户与 trust model？
- 是否引入第二套 source of truth？
- 是否重复已有功能或命名不同但语义相同？
- 是否破坏现有 API、数据文件或迁移路径？
- 是否覆盖所有客户端和渠道？
- 是否具有生产级错误处理和可观测性？
- 是否可测试、可回滚、可迁移？

### 7.2 决策类型

- `ACCEPT_AS_IS`
- `ACCEPT_WITH_REWORK`
- `REIMPLEMENT_ON_CURRENT_ARCH`
- `DEFER`
- `REJECT`
- `NEEDS_PRODUCT_DECISION`

每项必须有证据和 owner，禁止以“分支更新”作为接受理由。

## 8. Wave 3：建立唯一集成基线

### 8.1 需要维护者确认的关键决策

在执行合并前，由维护者明确：

1. 未来唯一 integration base 是 `origin/main`、当前 `fix-scoped-package-templates`，还是新建 convergence branch。
2. `release/candidate-20260712` 是历史 RC 还是仍为功能来源。
3. 当前生产 SHA 是否只作为 rollback anchor。
4. 是否允许把当前 749 个独有提交整体视为候选主线。

### 8.2 推荐方案

新建专用 convergence worktree/branch，由人类操作员创建；agent 不自行切换当前工作树：

```text
base: 经维护者确认的 canonical ref
branch: <owner>/repository-convergence-20260720
worktree: 独立干净目录
```

所有合并在独立 worktree 完成，当前共享工作树只用于比对和 owner handoff。

### 8.3 基线入口门禁

- 工作树干净；
- `pnpm install` 状态一致；
- `pnpm build`、`pnpm tsgo`、`pnpm check` 基线结果已记录；
- 当前生产 smoke 和已知失败项已记录；
- 数据迁移/配置格式版本已冻结。

## 9. Wave 4：按依赖顺序合并

推荐顺序：

### 4A. 仓库与构建基础

- package manifests、lockfile、patches；
- build、CI、Docker、release scripts；
- plugin SDK exports；
- generated bundle 规则。

### 4B. 身份、租户与权限

- platform auth；
- tenant context；
- seat/employee/agent identity；
- secrets/vault；
- method scopes。

这些是后续所有企业功能的硬前置。

### 4C. 核心 Gateway 与会话

- gateway method packs；
- session/transcript/conversation lifecycle；
- routing；
- maintenance timers；
- checkpoint/restart recovery。

### 4D. 数据、知识与记忆

- data space；
- enterprise-data；
- semantic object catalog；
- knowledge base/index/retrieval；
- local folder/cloud drive/passive connectors；
- CogniWeave/memory；
- lineage/governance。

### 4E. Agent、能力与协作

- agent catalog/runtime bindings；
- capability lifecycle；
- supervisor/fabric；
- collaboration/group memory；
- cron/workflow/deliverables。

### 4F. 商业、预算与平台治理

- entitlement；
- pricing/billing/credits；
- governance/policy；
- admin/enterprise portals。

### 4G. 客户端与 UI

- Control UI/employee workbench；
- enterprise/platform ports；
- Android；
- iOS；
- macOS；
- shared protocol models。

### 4H. 部署与运维

- Nginx/domain routing；
- Docker image；
- staging scripts；
- observability/readiness；
- rollback automation。

每个子波次必须达到绿色 checkpoint 后立即提交，不得累计整个仓库再一次性提交。

## 10. 共享热文件策略

以下文件不得由多个 feature owner 各自整文件提交：

- `package.json`
- lockfiles
- `src/gateway/server-methods-list.ts`
- `src/gateway/method-scopes.ts`
- `src/gateway/server-methods.ts`
- `src/gateway/server.impl.ts`
- `src/gateway/server-maintenance.ts`
- `ui/src/i18n/locales/en.ts`
- `ui/src/i18n/locales/zh-CN.ts`
- `ui/src/ui/app.ts`
- `ui/src/ui/ports/employee/render-model.ts`
- deploy production records/config

为这些文件指定专门 integration owner。功能 owner只提交领域文件和明确 patch；热文件由 integration owner 在每波末统一接线。

## 11. 验证门禁

### 11.1 每个功能包

- scoped tests；
- changed-file typecheck；
- oxfmt/oxlint；
- 权限负向测试；
- tenant isolation；
- restart persistence；
- UI entry-to-RPC contract。

### 11.2 每个 Wave

```bash
pnpm format
pnpm check
pnpm tsgo
pnpm build
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test
```

若全量测试受共享环境影响，必须记录 scoped pass、已知基线失败和差异，不得笼统写“测试通过”。

### 11.3 跨域黄金路径

至少覆盖：

- 登录 → tenant/seat → agent roster → chat/session；
- 数据源 → 数据能力 → 知识物化 → 检索 → Agent 消费；
- 本地文件夹/网盘 → KB → 索引 → 回复证据；
- capability install → entitlement → invocation → billing；
- collaboration → task → deliverable → knowledge archive；
- restart → state recovery；
- tenant A/B 隔离；
- Android/iOS/macOS 与 Gateway 协议兼容。

## 12. Wave 5：全栈回归与发布候选

### 12.1 RC 生成条件

- 所有 accepted features 在 feature ledger 中为 landed；
- 所有 rejected/deferred features 有书面决策；
- 工作树干净；
- commit attribution 无 `UNATTRIBUTED`/`CONFLICT`；
- release image 从锁定 commit 全量构建；
- UI 与 backend 来自同一 commit；
- release record 记录完整 SHA、image digest 和测试结果。

### 12.2 Staging 验证

- 多租户 smoke；
- knowledge import golden path；
- auth/login across clients；
- domain routing；
- healthz/readyz；
- scheduled jobs soak；
- 数据升级和回滚演练。

### 12.3 生产灰度

1. 生成 immutable image tag；
2. 备份控制面和知识/记忆数据；
3. 灰度单租户或内部租户；
4. 观察错误率、readyz、队列和 scheduled jobs；
5. 扩大流量；
6. 更新 release record；
7. 保留前一镜像和数据回滚点。

## 13. 长期防回退机制

### 13.1 Feature manifest

建立机器可读清单，例如：

```yaml
knowledge_import:
  ui_kinds: [file, localFolder, note, url, dataset, gitRepo, cloudDrive, mailAttachment, active]
  rpc_methods: [...]
  runtime_modules: [...]
  tests: [...]
```

CI 校验 UI、RPC、runtime 和 tests 不缺项。

### 13.2 Branch policy

- 功能分支必须定期同步 canonical base；
- 超过约定 TTL 未合并的分支自动列入 stale review；
- release branch 禁止新增独占功能；
- RC 修复必须回灌 canonical branch；
- 生产 hotfix 必须在 24 小时内形成回灌 PR；
- 分支关闭前检查独有提交是否已 landed/superseded/rejected。

### 13.3 发布 provenance

每个生产镜像必须能够回答：

- 来自哪个 commit？
- 该 commit 是否在 canonical branch？
- UI/backend 是否同源？
- 包含哪些 feature ids？
- 哪些功能被明确排除？
- 回滚到哪个镜像和数据快照？

## 14. 角色划分

- **Repository convergence owner**：唯一总 lander。
- **Domain reviewers**：Gateway、Auth/Tenant、Knowledge/Data、Agent/Collaboration、Commercial、UI/Mobile、Deploy。
- **Feature owners**：负责功能闭环证据，不负责全仓库 landing。
- **Release owner**：负责干净构建、staging、cutover 和 rollback。
- **Human maintainer**：决定 canonical base、功能取舍和生产窗口。

## 15. 首批执行任务

1. 人类维护者确认 canonical integration base。
2. 创建独立 convergence worktree/branch。
3. 固化当前 49 个脏文件的 owner 和处置方式。
4. 对 43 个远程分支生成 ahead/behind 和独有提交清单。
5. 优先审计以下高价值/高风险分支：
   - `release/candidate-20260712`
   - `fix-scoped-package-templates`
   - `wip/main-uncommitted-2026-07-13`
   - `kiro-hybrid-isolation/hybrid-gateway-isolation`
   - `kiro-daibai/chat-checkpoint-rollback`
   - `pr/edgsc-knowledge-universe`
   - `pr/workbench-enterprise-ui`
   - `pr/platform-auth-control-ui`
   - `pr/data-directory-lifecycle`
6. 建立 feature ledger 和 decision matrix。
7. 先合并身份/租户/权限，再合并知识/数据/UI。
8. 完成全栈黄金路径后生成新的 RC，不在当前生产容器上叠加零散 layer。

## 16. 完成判定

仓库收敛任务只有同时满足以下条件才完成：

- canonical branch 唯一且书面确认；
- 所有活跃/历史分支的独有提交已分类；
- 所有有价值功能已 landed 或有明确 deferred/rejected 决策；
- 工作树无未归因和 ownership conflict；
- 全仓库构建、类型、检查和测试达到记录的绿色基线；
- 跨域黄金路径通过；
- RC 从干净 commit 全量构建；
- staging 和生产验证完成；
- hotfix/RC 变更已回灌 canonical branch；
- release record 可完整追溯 commit、image、feature 和 rollback。

在此之前，状态只能是 `in progress` 或 `partially converged`，不得宣称“全仓库已同步”。
