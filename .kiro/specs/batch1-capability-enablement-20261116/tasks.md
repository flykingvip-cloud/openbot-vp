# Tasks：Batch 1 隔离能力启用交付

## Agents

- auditbot-batch1 · role: owner · scope: comment-only Account Worker / readonly-invoke alignment, isolated wiring for task-progress, knowledge reuse and basic diagnosis loops, tests, PR and canary draft; no production deploy or ledger write · paths: .kiro/specs/batch1-capability-enablement-20261116/** · since: 2026-11-16

## Tasks

- [x] 1. 行为不变的文案/注释修正：`.env.example` Account Worker 与 `considerReadonlyInvoke` 注释对齐代码默认值；四个编排主开关注释与运行时默认仍为关闭。 — auditbot-batch1
- [x] 2. 在独立隔离环境接通任务进度与交付物追踪闭环（真实任务入口、执行事件、进度、刷新后状态仍正确）。需要时仅在隔离环境开启 Progress Ledger。 — auditbot-batch1
- [x] 3. 接通会话延续与确定性知识复用：后续任务可检索并正确引用先前交付物；跨租户访问必须拒绝。 — auditbot-batch1
- [x] 4. 接通基础诊断：报告查询、问题解释、人工处置与状态追踪。不启用自动修复、外部投递或不可逆删除，不绕过生产执行模式拒绝逻辑。 — auditbot-batch1
- [x] 5. 实际运行闭环与边界测试（正常、权限拒绝、依赖失败、重复请求、刷新恢复；诊断写入回退、跨租户、出网限制、费用边界、会话重置），记录请求与证据。 — auditbot-batch1
- [ ] 6. 通过 PR 将变更纳入 main；准备可追溯候选与灰度单草稿。不执行生产部署，不写 `deploy/production/releases.jsonl`。 — auditbot-batch1

## Notes

- origin/main baseline at start: `a78c5b66959dac3db4ecb2ecd2065aaec029b3c3`.
- Isolated flag change only: `OPENBOT_PROGRESS_LEDGER_ENABLED=1` inside the isolated test, restored after each case. CTR activation, knowledge auto-generate, auto-remediation, and external delivery were not enabled.
- Isolated loop evidence: `/workspace/openbot-vp-audit/batch1-evidence/isolated-loops.json` (7 passing vitest cases).
- DGN-T3–T6 live `chat.send` / `chat.inject` / `sessions.reset` against a local gateway was not started in this unit; official tenant fence and `deliver:false` fallback path were recorded, with a follow-up for a confirmed loopback-only harness.
- No production deploy and no `deploy/production/releases.jsonl` write. — auditbot-batch1
