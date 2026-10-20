# Execution Architecture Principles（.kiro 入口）

> **状态:** 原则层 v2.1 **已冻结；P0–P11 已执行**。Execution / Focus 表未落库。生产 Activation / Orchestration live 仍 fail-closed。
> **权威正文:** [`docs/design/openbot-execution-architecture-principles-2026-09-17.md`](../../../docs/design/openbot-execution-architecture-principles-2026-09-17.md)
> **性质:** 补充并约束本目录 `execution-plan.md`、Progress Ledger、任务聚焦合同；**不替代** CTR `CT*`、Ledger `I1–I8`、任务聚焦 `I1–I25`。

## 五句话

- ConversationTask = Identity
- Execution = Run
- Session = Context
- Ledger = Fact
- Projection = View

冻结句：ConversationTask 是任务身份，Session 是执行上下文。

## 编号（仅 EA-\*）

- 边界：`EA-B1` … `EA-B7`（身份真源、槽位≠基数、焦点不是新表、Cron/Heartbeat 只是 Wake、Focus≠Session Strategy、Execution 一等公民）
- 不变量：`EA-I1` … `EA-I8`

## 本入口禁止

- 在此文件复制一份第二套对象定义（以免分叉）
- 把本文当作 chat.send / Cron / UI 的施工批准
- 用本文 I1–I8 覆盖 Ledger 或 CTR 原号

字段、禁止清单、与 CTR/Ledger 的引用表只以权威正文为准。
