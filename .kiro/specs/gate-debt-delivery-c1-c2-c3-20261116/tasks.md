# Tasks: inherited delivery-guard debt (C1–C3)

## Agents

- auditbot-batch1 · role: owner · ide: cursor · scope: C1 test fix, C2 classification/report, C3 record-vs-ledger proposal, local CI coverage notes · since: 2026-11-16

## 任务

- [x] 1. 从全新 `origin/main` 建立独立 worktree / 分支（不改 Batch 1 克隆，不写入账本）
- [x] 2. C1：核实 seq 151 断言原意并修复过期测试（结构不变量 + 历史 fixture，不锁死 165）
- [x] 3. C2：在完整克隆上分类缺失对象，提交只读报告脚本与恢复/归档证明计划
- [x] 4. C3：提出 RELEASE_RECORD 生成块相对账本 tip 165 的修正差异（不写回，不追认今日 LIVE）
- [x] 5. 按 job 标明本地替代 CI 覆盖范围；未跑的 Windows / macOS / iOS / Android / CogniWeave / install-smoke 不得写成通过
- [ ] 6. Owner 批准后：从 donor 恢复对象到 backup refs，或接受归档证明（本 PR 不做）
- [ ] 7. Owner 批准后：`pnpm delivery:release-record:generate --write` 仅同步生成块到账本 tip 165（本 PR 不做）
- [ ] 8. 恢复 GitHub Actions 后重跑完整 CI（本 PR 不做）
