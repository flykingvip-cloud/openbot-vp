# Tasks：Batch 1 隔离能力启用交付

## Agents

- auditbot-batch1 · role: owner · scope: comment-only Account Worker / readonly-invoke alignment, isolated wiring for task-progress, knowledge reuse and basic diagnosis loops, tests, PR and canary draft; no production deploy or ledger write · paths: .kiro/specs/batch1-capability-enablement-20261116/** · since: 2026-11-16

## Tasks

- [ ] 1. 行为不变的文案/注释修正：`.env.example` Account Worker 与 `considerReadonlyInvoke` 注释对齐代码默认值；四个编排主开关注释与运行时默认仍为关闭。 — auditbot-batch1
- [ ] 2. 在独立隔离环境接通任务进度与交付物追踪闭环（真实任务入口、执行事件、进度、刷新后状态仍正确）。需要时仅在隔离环境开启 Progress Ledger。 — auditbot-batch1
- [ ] 3. 接通会话延续与确定性知识复用：后续任务可检索并正确引用先前交付物；跨租户访问必须拒绝。 — auditbot-batch1
- [ ] 4. 接通基础诊断：报告查询、问题解释、人工处置与状态追踪。不启用自动修复、外部投递或不可逆删除，不绕过生产执行模式拒绝逻辑。 — auditbot-batch1
- [ ] 5. 实际运行闭环与边界测试（正常、权限拒绝、依赖失败、重复请求、刷新恢复；诊断写入回退、跨租户、出网限制、费用边界、会话重置），记录请求与证据。 — auditbot-batch1
- [ ] 6. 通过 PR 将变更纳入 main；准备可追溯候选与灰度单草稿。不执行生产部署，不写 `deploy/production/releases.jsonl`。 — auditbot-batch1
