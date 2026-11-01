# Tasks：闭环隔离补验与合同冻结

## Agents

- cursor-closed-loop-490b · role: owner · scope: isolation tests, contract audit, and loom registration for the closed-loop freeze; no production behavior change · paths: docs/audits/2026-11-01-closed-loop-isolation-contract.md, .kiro/specs/closed-loop-isolation-contract/, src/task-outcome/closed-loop-isolation-contract.test.ts, src/task-outcome/closed-loop-isolation-restart-child.ts · since: 2026-11-01

## Tasks

- [x] 1. 对照 `c9050e4aa64482eab6fb61c8b42cf5270e811f20` 复核先前审计，并写下仍然成立的断点与需要修正的实施建议 — cursor-closed-loop-490b
- [x] 2. 用临时目录、合成身份和独立子进程补验六类合同，分开记录当前路径与 API 能力 — cursor-closed-loop-490b
- [x] 3. 冻结第一笔业务 PR 的文件、兼容、回滚和非范围；不在本期改那些文件的行为 — cursor-closed-loop-490b
- [ ] 4. 业务实施（显式否定写回 + 诊断版本化只读）。需要单独的用户授权。本文件不勾选 — cursor-closed-loop-490b
- [ ] 5. 业务实施（大白通知语义与收件人失败关闭）。依赖明确的 subjectRef 映射，且不得复用 pending-delivery / outbox / cron main 退回。需要单独授权 — cursor-closed-loop-490b
