# 回滚（Phase B web_read 影子）

## 一句话

关闭 shadow 观察旗标或卸掉接线；保持 `ORCHESTRATION_LIVE_INVOKE = false`；不写生产 ledger、不调用 web 工具。

## 步骤（编码落地后适用；当前无运行时变更）

1. 将 shadow 观察相关 feature / 接线设为 off（配置级）。
2. 确认 `ORCHESTRATION_LIVE_INVOKE` 仍为 `false`（`src/task-orchestration/types.ts`）——**禁止**靠翻转该常量「回滚」。
3. 确认无 `web_search` / `web_fetch` 调用路径被启用。
4. 确认无生产 ledger 写入（`wroteLedger` 保持 false）。
5. 对照基线：用户可见输出、工具次数、ledger 与 shadow 关闭时零差异。

## 不做

- 不 force-push、不改生产账本历史
- 不打开 Fabric 默认值
- 不以「回滚」为名启用 live invoke
