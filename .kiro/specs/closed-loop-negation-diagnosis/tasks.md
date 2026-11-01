# Tasks：显式任务否定写回与诊断读取

## Agents

- cursor-closed-loop-490b · role: owner · scope: structured TaskOutcome rejection and diagnosis read of one outcome version · paths: src/task-outcome/subject-ref.ts, src/task-outcome/feedback-disposition.ts, src/task-outcome/reject-result.ts, src/task-outcome/closed-loop-negation-diagnosis.test.ts, src/auto-reply/reply/inbound-task-feedback.ts, src/diagnosis/task-outcome-evidence.ts, src/gateway/server-methods/task-outcome-reject.ts, src/gateway/server-methods/task-outcome-reject.pack.ts, .kiro/specs/closed-loop-negation-diagnosis/, docs/audits/2026-11-01-closed-loop-ui-wiring-scope.md · since: 2026-11-01

## Tasks

- [x] 1. 自由文本先分类。引用、转述、泛泛否定、新增要求和未绑定的结果否定不写任务。合法目标改写仍只写 workspace。 — cursor-closed-loop-490b
- [x] 2. `task.outcome.rejectResult` 只对已关闭且归属匹配的任务追加 correction。 — cursor-closed-loop-490b
- [x] 3. `diagnosis.diagnose` 读取指定版本，并把失败与工具观察分开返回。 — cursor-closed-loop-490b
- [x] 4. 经验贡献撤销在注入的临时 collaboration store 上验证；生产默认仍走 loadConfig()。 — cursor-closed-loop-490b
- [ ] 5. 通知、身份映射、自动复验。不在本期。 — cursor-closed-loop-490b
- [x] 6. 下一笔前后端接入只写实施清单，不改 UI，也不把终端用户加成 operator.write。清单在 docs/audits/2026-11-01-closed-loop-ui-wiring-scope.md。 — cursor-closed-loop-490b
