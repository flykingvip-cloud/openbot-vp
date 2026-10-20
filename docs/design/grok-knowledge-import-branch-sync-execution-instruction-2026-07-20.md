# Grok 执行指令：知识导入能力分支同步与完整性合并

## 任务目标

解决知识工作台导入能力在不同分支之间不同步的问题，恢复并审核完整的知识导入能力包，确保以下能力在同一集成基线中端到端一致可用：

- 本地文件导入
- 本地文件夹扫描与同步
- 笔记/摘要导入
- 网页导入
- 数据集导入
- Git 仓库导入
- 网盘/云端共享导入
- 邮件附件导入
- 主动数据源绑定

不得只恢复某个前端弹窗选项。必须同时核对 UI、Gateway RPC、权限、租户上下文、持久化、同步运行时、错误处理、测试和生产启动注册。

## 当前事实基线

- 当前工作分支：`fix-scoped-package-templates`
- 当前 HEAD：`b3ad8a9138`
- 功能增强源提交：`d85bc43620`
- 功能增强提交标题：`feat(ui): localFolder and passive connector import funnel`
- 功能范围跨越约 60 个文件，包含前端、后端、RPC、method scopes、启动注册和测试。
- 当前分支已经存在部分云盘后端实现，但缺少对应的前端导入入口，形成“后端能力存在、用户不可消费”的半合并状态。

## 执行约束

1. 先审查，再修改。不得直接对 `d85bc43620` 做盲目 cherry-pick。
2. 不得覆盖、回滚或删除其他代理的未提交工作。
3. 不得使用 `git reset --hard`、`git checkout --` 或 stash。
4. 当前工作树若有与本任务无关的修改，必须保留并忽略。
5. 所有新提交必须使用仓库规定的 `scripts/committer`，并包含：

   ```text
   Task: knowledge-import-branch-sync
   Agent: grok
   ```

6. 只提交本任务拥有的文件，不得 `git add .`。
7. 如果发现当前分支不是正确的集成基线，先报告差异和建议，不得自行切换分支。

## 阶段一：分支与功能差异审查

执行并保存结果：

```bash
git status --short
git log --oneline --decorate --graph --all --max-count=120
git branch -a --contains d85bc43620
git diff --stat HEAD...d85bc43620
git diff --name-status HEAD...d85bc43620
```

建立功能文件清单，至少覆盖：

- `ui/src/ui/views/knowledge-universe-space-import.ts`
- `ui/src/ui/views/knowledge-universe-space-import-local-folder.ts`
- `ui/src/ui/views/knowledge-universe-space-import-passive-connector.ts`
- `ui/src/ui/controllers/knowledge-universe-local-folder.ts`
- `ui/src/ui/controllers/knowledge-universe-passive-connector.ts`
- `ui/src/ui/controllers/knowledge-universe-workspace.ts`
- `ui/src/ui/controllers/knowledge-universe.ts`
- `ui/src/ui/capability/knowledge-universe/endpoints.ts`
- `ui/src/ui/capability/knowledge-universe/gateway-client.ts`
- `ui/src/ui/capability/knowledge-universe/workspace-endpoints.ts`
- `src/gateway/knowledge/sources/local-folder-*`
- `src/gateway/knowledge/sources/passive-connector-*`
- `src/gateway/knowledge/sources/cloud-drive/*`
- `src/gateway/server-methods/knowledge.ts`
- `src/gateway/server-methods-list.ts`
- `src/gateway/method-scopes.ts`
- `src/gateway/server-startup.ts`
- 相关单测和浏览器测试

输出《功能差异审查表》，每个功能标记：

| 功能 | UI 入口 | RPC | 权限/租户 | 存储 | 运行时 | 测试 | 当前分支状态 |
| ---- | ------- | --- | --------- | ---- | ------ | ---- | ------------ |

## 阶段二：完整性审核

逐项回答：

### 1. UI 入口

- 导入弹窗是否包含全部入口？
- `SpaceImportKind` 是否与实际渲染分支一致？
- 空间目标选择是否支持个人/团队/企业？
- 选择团队/企业空间后，文件、文件夹和云盘是否使用相同的 `knowledgeBaseId`？
- 管理知识空间页与知识工作台首页是否显示同一批空间？

### 2. Gateway 契约

- 新增方法是否注册到 `server-methods-list.ts`？
- 是否注册到 `method-scopes.ts`？
- 是否在 `server-methods/knowledge.ts` 或正确的拆分 handler 中接线？
- 所有 RPC 是否校验 trusted user、tenant、seat 和目标 KB 权限？

### 3. 本地文件夹

- 路径策略是否拒绝越界路径、符号链接逃逸和非法目录？
- 扫描是否有大小、文件数量、类型和超时限制？
- 增量同步是否幂等？
- watcher、同步计划和文档索引是否持久化？

### 4. 网盘/被动连接器

- 百度、阿里、夸克等 provider 是否具备真实 credential/OAuth 状态流？
- OAuth callback 是否在生产 HTTP 路由中注册？
- 绑定是否保存到正确的租户和知识空间？
- token 失败、过期、断开、重复同步是否有可恢复状态？
- 网盘文件是否最终进入知识库文档、索引和检索链路，而不只是显示连接成功？

### 5. 消费闭环

必须验证：

```text
创建/选择空间
  -> 导入本地文件或网盘内容
  -> 保存 source binding
  -> 扫描/同步
  -> 文档入库
  -> 索引完成
  -> knowledge.search / knowledge.base.search 可检索
  -> Knowledge Universe 页面可见
  -> Agent/回复可消费
```

## 阶段三：合并策略

根据阶段一和二的结果选择策略：

### 推荐策略：功能包级合并

如果 `d85bc43620` 及其依赖是一组完整、可测试的功能提交，应按功能包合并，而不是只 cherry-pick UI 提交。需要列出依赖提交顺序，并确保 UI、RPC、runtime、tests 一起进入集成基线。

### 允许策略：分层移植

只有在源提交与当前分支严重冲突时，才分层移植：

1. 类型和 endpoint 契约
2. Gateway RPC 和 scopes
3. 本地文件夹 runtime
4. passive connector/cloud-drive runtime
5. UI controller 和 views
6. 集成测试

每层完成后必须编译和运行 scoped tests。不得先合 UI、后补后端。

### 禁止策略

- 只恢复 `SpaceImportKind` 枚举
- 只复制导入弹窗文件
- 只恢复网盘 provider 而不恢复 OAuth 路由
- 只恢复后端 RPC 而不恢复 UI 入口
- 用 mock 成功代替真实持久化和检索验证

## 阶段四：必须通过的验证

### 静态验证

```bash
pnpm exec oxfmt --check <changed-files>
pnpm tsgo
```

### UI 验证

至少运行：

```bash
OPENBOT_TEST_PROFILE=low pnpm test \
  ui/src/ui/views/knowledge-universe-space-import.node.test.ts \
  ui/src/ui/views/knowledge-universe-governance.browser.test.ts \
  ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts
```

补充回归断言：

- 导入入口包含 `localFolder`、`gitRepo`、`cloudDrive`、`mailAttachment`。
- 选择团队/企业空间后目标 `knowledgeBaseId` 不丢失。
- 管理空间页和首页都显示个人、团队、企业三类分组。

### 后端验证

运行本地文件夹、被动连接器、云盘 OAuth、知识入库和检索相关 scoped tests。至少覆盖：

- 路径越界拒绝
- 租户隔离
- connector credential 加载
- OAuth callback
- source binding 持久化
- 重复同步幂等
- 同步失败重试
- 文档索引
- 检索可见性

### 黄金路径 E2E

新增或复用一个测试，完整验证：

```text
创建 team KB
  -> 绑定本地文件夹或 cloud drive
  -> 执行扫描/同步
  -> 断言文档进入 KB
  -> 断言 knowledge.base.search 返回证据
  -> 断言 Knowledge Universe feed/source 可见
  -> 断言 agent/reply 可以消费
  -> 重启/重新加载后断言 binding 和文档仍存在
```

没有这条黄金路径，不得将功能标记为“已合并可发布”。

## 阶段五：交付报告

最终必须输出：

1. 源分支、目标集成分支、合并提交列表。
2. 功能差异审查表。
3. 冲突文件及解决方式。
4. 通过的测试命令和结果。
5. 未完成项、风险和后续 owner。
6. 明确声明“未部署”或提供实际部署 commit、镜像/tag、环境和线上验证结果。

## 完成判定

只有同时满足以下条件，任务才算完成：

- 导入功能包完整进入统一集成基线；
- 前端入口、后端 RPC、权限、存储、同步、索引和消费链路一致；
- UI 和后端 scoped tests 全绿；
- 黄金路径 E2E 通过；
- 无未解释的功能差异；
- 交付报告明确记录合并提交和部署状态。

如果任一条件不满足，状态必须标记为 `blocked` 或 `partially complete`，不得宣称已完成。
