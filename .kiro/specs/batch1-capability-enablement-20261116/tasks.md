# Tasks：Batch 1 隔离能力启用交付

## Agents

- auditbot-batch1 · role: owner · scope: comment-only Account Worker / readonly-invoke alignment, isolated wiring for task-progress, knowledge reuse and basic diagnosis loops, tests, PR and canary draft; t20 tenant gate, shutdown coverage, official-entry records, diagnosis observation conversion, clean RPC run, and task-progress canary prep; no production deploy or ledger write · paths: .kiro/specs/batch1-capability-enablement-20261116/**, .env.example, src/batch1-capability-enablement/**, src/progress-ledger/\*\*, src/conversation-task/ledger-binding.ts, src/config/types.gateway.ts, src/config/zod-schema.ts, src/gateway/workbench/pending-tasks-read-model.ts, src/diagnosis/official-live-send.ts, src/diagnosis/official-live-send.test.ts, src/diagnosis/bootstrap.ts, src/diagnosis/production-cutover.ts, src/diagnosis/diagnose-observation-summary.ts, src/diagnosis/diagnose-observation-summary.test.ts, src/diagnosis/diagnose-report-text.ts, src/diagnosis/diagnose-live-request.ts, src/diagnosis/live-run.ts, src/diagnosis/report.ts, src/diagnosis/report-validate.ts, src/diagnosis/report-query-projection-snapshot.ts · since: 2026-11-16

## Tasks

- [x] 1. 行为不变的文案/注释修正：`.env.example` Account Worker 与 `considerReadonlyInvoke` 注释对齐代码默认值；四个编排主开关注释与运行时默认仍为关闭。 — auditbot-batch1
- [x] 2. 在独立隔离环境接通任务进度与交付物追踪闭环（真实任务入口、执行事件、进度、刷新后状态仍正确）。需要时仅在隔离环境开启 Progress Ledger。 — auditbot-batch1
- [x] 3. 接通会话延续与确定性知识复用：后续任务可检索并正确引用先前交付物；跨租户访问必须拒绝。 — auditbot-batch1
- [x] 4. 接通基础诊断：报告查询、问题解释、人工处置与状态追踪。不启用自动修复、外部投递或不可逆删除，不绕过生产执行模式拒绝逻辑。 — auditbot-batch1
- [x] 5. 实际运行闭环与边界测试（正常、权限拒绝、依赖失败、重复请求、刷新恢复；诊断写入回退、跨租户、出网限制、费用边界、会话重置），记录请求与证据。 — auditbot-batch1
- [x] 6. 通过 PR #300 将变更纳入 main（独立验收后合入 `67fc9b6461d30d97ea587c218b6914240b88344f`）。未执行生产部署，未写 `deploy/production/releases.jsonl`。 — auditbot-batch1
- [x] 7. t20：核实进度开关为进程全局；补齐租户门控与覆盖全部开启来源的关闭路径；提交正式入口任务/进度/交付物/重载记录。 — auditbot-batch1
- [x] 8. t20：用候选 OpenBot 产物和独立持久化目录重做真实回滚演练；撤销“Python 监听器演练等同应用回滚通过”的结论。 — auditbot-batch1
- [x] 9. t20：修复诊断结果转换中 CONFIRMED 观察丢失，正确表达工具超时、根因未确认、路由证据缺失；保留修复前失败、修复后通过的回归。诊断投递仍在本批范围之外。 — auditbot-batch1
- [x] 10. t20：提交一次干净的 RPC 测试运行（独立目录，绑定 SHA 与 runId，区分准备/被测/验证，含角色与内容指纹）。 — auditbot-batch1
- [ ] 11. 填写可审批的任务进度灰度单确定项；镜像 digest、生产试点账号、负责人和费用上限仍待授权人指定。不把缺项表单当作部署申请。本 PR 不自行合入。 — auditbot-batch1

## Notes

- origin/main baseline for t20: `67fc9b6461d30d97ea587c218b6914240b88344f` (merge of PR #300).
- OPENBOT_PROGRESS_LEDGER_ENABLED is a process-global OR of env and `gateway.progressLedger.enabled`. Env=0 does not override config.enabled=true. Shutdown (`OPENBOT_PROGRESS_LEDGER_SHUTDOWN` or `gateway.progressLedger.shutdown`) wins. Conversation-task projections can stay on because close-requires-evidence defaults ON. A shared instance may be called a single-tenant canary only when a non-empty tenant allowlist is set. Clearing the allowlist is not a safe rollback.
- Official-entry / rollback / RPC / knowledge evidence: `/workspace/openbot-vp-audit/batch1-evidence/t20-*/`.
- The earlier Python-listener drill is not application-rollback evidence; historical index only: `/workspace/openbot-vp-audit/batch1-evidence/release-prep/rollback-drill.json`.
- No production deploy and no `deploy/production/releases.jsonl` write. — auditbot-batch1
