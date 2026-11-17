# Requirements: inherited delivery-guard debt (C1–C3)

> 状态：审查包。Owner：auditbot-batch1。不得写入 `deploy/production/releases.jsonl`，不得部署生产，不得把今日未记账 LIVE 写成已追认发布。与 Batch 1 能力启用 PR 分离。

## Context

`origin/main` 上的 `delivery-guard` 在本审查开始时有三类继承失败：单元测试仍钉住 seq 151；`pnpm delivery:ledger:audit` 因历史对象缺失 exit 30；`RELEASE_RECORD.md` 生成块停在 seq 154，而账本开放 tip 已是 seq 165。本规格只允许修复过期测试、增加只读分类报告与文档提案。

## Requirements

### Requirement 1: C1 测试守卫意图而不是冻结 tip 序号

1. THE 系统 SHALL 从 git 历史核实 seq 151 断言的原始意图（#172 关闭双开区间、唯一开放 tip、后继 liveTo 关闭），而不是把数字 151 当成永久上限。
2. WHEN 修复过期测试 THEN 测试 SHALL 检查当前账本的结构不变量（唯一开放 tip、最大 seq 即该开放行、允许的 110/111 缺口、从 seq 103 起的后继关闭），并保留 seq 127 / seq 151 时代的历史 fixture。
3. THE 系统 SHALL NOT 把断言改写成 `max seq === 165` 并再次锁死。
4. THE 系统 SHALL NOT 要求 `audit.ok`，也不得削弱 `pnpm delivery:ledger:audit`。

### Requirement 2: C2 先分类缺失对象再谈恢复

1. THE 审查 SHALL 在完整（非浅）克隆上区分：浅克隆、缺 refs、与本 GitHub 对象图中真正不存在的 SHA。
2. THE 系统 MAY 增加只读分类脚本与归档/恢复计划；该脚本 MUST NOT 写账本、删除账本行或降低守卫。
3. 恢复对象或接受归档证明 SHALL 等待 owner 批准。

### Requirement 3: C3 只提案、不回写记录

1. THE 审查 SHALL 提出 `RELEASE_RECORD` 生成块与账本开放 tip（seq 165 / `342de3076099`）之间的人读修正差异。
2. THE 系统 SHALL NOT 在本规格范围内执行 `delivery:release-record:generate --write`，也 SHALL NOT 把今日运行中的未记账 LIVE（bundled SHA `8a686145…`）写入记录或账本。

### Requirement 4: 本地替代检查必须标明覆盖范围

1. 本地替代 CI 文档 SHALL 按 job 标明已跑 / 部分 / 未跑。
2. Windows、macOS、iOS、Android、CogniWeave、install-smoke 等未跑项 SHALL NOT 被写成完整 CI 等价通过。
