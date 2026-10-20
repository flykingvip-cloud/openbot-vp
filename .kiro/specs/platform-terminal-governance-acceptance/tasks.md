# Platform Terminal Governance Acceptance

## Agents

- `codex-governance-acceptance` · role: owner · scope: 独立复验并修复平台、企业与员工大白管家的终端治理闭环 · paths: `.kiro/specs/platform-terminal-governance-acceptance/**`, `src/gateway/governance-policy*.ts`, `src/gateway/node-governance*.ts`, `src/gateway/agent-governance-scope*.ts`, `src/gateway/agent-invocation-governance*.ts`, `src/gateway/management-governance-audit*.ts`, `src/gateway/scope-attribution*.ts`, `src/gateway/server-methods/management-governance*.ts`, `ui/src/ui/ports/platform/advanced/management-governance-panel*.ts`, `docs/design/platform-terminal-governance-acceptance-*.md` · since: 2026-08-04

## Acceptance Closure

- [x] 复核既有治理实现和上轮未通过项，记录可复现证据。发现员工域身份缺失时 fail-open、平台操作审计归属缺失、未知机器人平台调用误报允许。— codex-governance-acceptance
- [x] 补齐平台管理员、企业管理员、员工大白管家的端到端授权与拒绝矩阵。五类主体、七类动作及跨域资源矩阵通过。— codex-governance-acceptance
- [x] 修复复验发现的权限绕过、归属或审计闭环缺口。新增失败关闭、平台目标归属审计和未知目标拒绝。— codex-governance-acceptance
- [x] 完成治理原语、管理 RPC、独立审计流、终端归属存储及高级治理页接线。治理定向测试 48 项通过，定向 lint/format/type 诊断通过；全仓 UI 构建仍被非治理模块的缺失导出阻断，云端只允许从生产基线做治理提交的增量回放。— codex-governance-acceptance
