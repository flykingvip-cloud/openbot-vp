# Tasks: Cron Personal Scope Authorization

## Agents

- kiro-cron-personal-scope · role: owner · scope: cron 个人入口强制 self scope、list/update/remove/run/runs 可信 owner 授权、员工会话隔离、UI 列表清理 · paths: `.kiro/specs/cron-personal-scope-authorization/**`, `src/gateway/server-methods/cron.ts`, `src/gateway/server-methods/cron.personal-scope.test.ts`, `src/gateway/protocol/schema/cron.ts`, `src/gateway/protocol/cron-validators.test.ts`, `src/cron/run-log.ts`, `src/cron/run-log.owner-scope.test.ts`, `ui/src/ui/controllers/cron.ts`, `ui/src/ui/controllers/cron.personal-scope.test.ts`, `ui/src/ui/capability/cron/facade.ts` · since: 2026-07-31

## 背景

生产事故：员工个人「定时任务」页展示了同租户同事创建的股市分析任务。根因是个人页面复用历史 enterprise/platform 会话，服务端 `cron.list` 按会话 domain 解析为 tenant/platform 范围，而不是收窄为当前用户。

## 修复任务

- [x] 新增只能收窄的 `ownerScope: "personal"` 入参，服务端由可信 userId 解析 owner，无法识别时 fail closed — kiro-cron-personal-scope
- [x] `cron.list` 在个人入口按 owner 收窄，高权限会话不再扩大范围 — kiro-cron-personal-scope
- [x] `cron.update`/`cron.remove` 在个人入口强制 owner 校验 — kiro-cron-personal-scope
- [x] `cron.run` 首次获得 owner 授权，拒绝他人任务 ID 且不入队 — kiro-cron-personal-scope
- [x] `cron.runs` 单任务路径 owner 校验；聚合路径按可见任务收窄并只读取这些任务的日志 — kiro-cron-personal-scope
- [x] personal scope 与会话 scope 取交集，避免多租户成员跨租户访问自有任务 — kiro-cron-personal-scope
- [x] 已删除任务的遗留运行日志不再对任意会话可读（`requireExistingJob`） — kiro-cron-personal-scope
- [x] 断连、加载失败时清空 `cronJobs`/运行日志/分页；保留待编辑任务以免更新退化为新建 — kiro-cron-personal-scope
- [x] 能力门面提供 `setPersonalScopeOnly()`，切换范围时清空缓存且显式 false 不误清管理端列表 — kiro-cron-personal-scope
- [x] 本地单操作者网关（无平台认证身份）不被 personal scope 锁死，真实会话仍 fail closed — kiro-cron-personal-scope
- [x] 运行日志刷新被拒时清空旧记录；任务列表出错不再取消运行详情选中 — kiro-cron-personal-scope
- [x] `cron.runs` 复用已解析 scope，避免单请求重复解析身份 — kiro-cron-personal-scope
- [x] 回归测试：越权拒绝、fail closed、跨租户、已删任务、jobId 变体、schema 拒绝放宽、日志白名单真实行为、平台管理员个人页收窄、本地操作者、门面归一化、UI 清理 — kiro-cron-personal-scope

## 待协调（未完成接线）

- [ ] 员工个人页调用 `cronCapability.setPersonalScopeOnly(state, true)`（须在首次加载前）。
      装配文件 `ui/src/ui/app.ts`、`ui/src/ui/app-settings.ts`、`ui/src/ui/ports/employee/**` 归其他任务所有且有未提交 WIP，
      按多代理规则 2 不可代为落地，需由其 owner 接线或经维护者授权。
      未接线前：`cron.run` 归属校验、`cron.runs` 跨用户历史收敛、UI 状态清理已生效；
      个人页“看到同事任务”的展示症状仍需该接线才会消失。

## 已知取舍

- 一次性任务（`at` 计划默认 `deleteAfterRun`）删除后，其遗留运行日志对受限 scope 不可读，
  包括属主本人。运行日志不带归属戳，无法在任务消失后判定属主，因此选择 fail closed 而非放行；
  平台 scope 仍可读取。若需属主可见，需要在运行日志中写入 ownership，属另一独立变更。
- 受限 scope 下，"外部存在的任务"回 `not authorized`、"不存在的 id"回 not found，
  错误形态可区分，理论上可用于探测 id 是否存在。update/remove 为既有行为，未在本次收紧。

## 验证

- `src/cron/run-log.owner-scope.test.ts` 5、`src/cron/run-log.test.ts` 11、
  `src/gateway/protocol/cron-validators.test.ts` 14、`src/gateway/server-methods/cron.personal-scope.test.ts` 21、
  `ui/src/ui/controllers/cron.personal-scope.test.ts` 12、`ui/src/ui/controllers/cron.test.ts` 28、
  `src/gateway/server.cron.test.ts` 7、`src/gateway/scope-attribution.test.ts` 11：共 109 项通过。
- `pnpm tsgo`：本任务 9 个文件零错误。
- Oxlint / Oxfmt：干净。
- 既有失败（与本任务无关，未修改相关文件）：`src/gateway/server-methods/rpc-tenant-scope.test.ts`（本地 `nodes.ts` 缺 scope 过滤）、
  `src/cron/cron-protocol-conformance.test.ts`（缺 `apps/macos/Sources/OpenBot/*`，目录已改名 `OpenBot`）、
  `src/cron/isolated-agent/delivery-dispatch.named-agent.test.ts`。
