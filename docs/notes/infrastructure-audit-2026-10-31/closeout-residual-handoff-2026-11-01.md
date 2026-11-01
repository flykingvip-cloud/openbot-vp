# 残留移交表（2026-11-01）

复核时间：2026-11-01T13:01:00Z。本地 Loom 可登记；本轮没有向 GitHub 建 issue、没有发消息、没有指派他人。负责人未确认的一律写待指派。只建任务不等于该项完成。

| ID | 事实与证据 | 影响 | 负责人 | 下一步 / 依赖 / 授权 | 可验证完成条件 | 状态 |
|---|---|---|---|---|---|---|
| IA-CI-BILLING-H1 | 2026-10-31 笔记：托管 job `steps=[]`、`runner_id=0`、日志 404 已作为无 runner 现象记录。Billing API 为 HTTP 404，分钟耗尽仍是假设。见 `billing-h1-blocked-2026-10-31.md`、`batch-b` 与计划阶段 1。本轮未重拉 Actions runs，未打开 Billing UI | 不能用本地单测代替托管 CI 健康；`ci-gate.yml` 里的 ledger audit 在对象缺失时会退出码 30 | 待指派 | 只读核对 org Billing / 用量页面或带明确 annotation 的 run。不改 Billing、runner、ruleset。需要账号权限 | 同一类 job 有 runner、非空 steps、可读日志，且账单或 annotation 能证实或排除分钟/花费封锁。缺页面则保持待验证 | 受阻，待授权读账单 |
| IA-A3-175 | #175 仍 OPEN。包在分支 `audit/a3-implementation-pack-PENDING-AUTH-20261031`，head `2c236eec71787ce1f444100bd230469f71cffca2`。默认分支上没有 `audit-a3-runner-probe.yml`。计划：`a3-control-experiment-plan-PENDING-AUTH.md`。本轮未合并、未 `workflow_dispatch` | 没有控制实验，就不能把空 steps 收成「有/无 runner」的现行结论。A3 单独也不能关闭 H1 | 待指派 | 先得到把 workflow_dispatch 探针合入默认分支的授权，再按计划的次数与超时触发。`--ref` 不能代替默认分支注册 | Exp-1 的 run json 显示 runner 与 steps，或在时限内复现空 steps；证据落在计划写的 `a3-evidence/<run_id>/`。未授权则保持未执行 | 暂缓，未执行 |
| IA-SEQ145 | 历史权威类仍是 `incomplete_graph_unknown`。本轮 clone 缺 seq144 tip，audit 把 seq145 记为 missing-object。无 `regressionAcknowledged`。任务说明：[seq145-incomplete-graph-2026-11-01.md](seq145-incomplete-graph-2026-11-01.md) | 历史账本审计不能变绿；不能写成内容回退或「历史无共同祖先」 | 待指派 | 补齐 seq144/seq145 与父链后再分类。禁止为了通过而 acknowledge 或删行。donor 与恢复清单保留 | 两侧 tip 与父对象可读，截断被排除或仍标 unknown，并由独立验收写下分类。在此之前不得 acknowledge | 未决 |
| IA-HIST-AUDIT | 历史文件：原 146 = 145 forward-only + 1 incomplete，且 146 未整表重走。本轮 audit：退出码 30，157 missing-object，0 regression。两套数字不是同一次运行。早期摘录仍在 `ledger-audit-2026-10-31.md` | `ci-gate.yml` 的 ledger audit 步骤会对这种对象库失败。失败保持可见 | 待指派 | 在含历史 tip 的对象库上重跑 `pnpm delivery:ledger:audit`，与 `p1-current-classification-2026-10-31.json` 对照。不改账本来换退出码 0 | 新跑的 finding 与对象库说明写入新证据；seq145 仍按 IA-SEQ145 关闭；历史文件仍可找到 | 历史债，未重审全表 |
| IA-BACKUP-RESTORE | 计划阶段 4 要求隔离恢复演练才算备份有效。本批笔记没有恢复演练记录。`disk-inventory-2026-10-31.md` 只是 2026-10-31 Mac 磁盘线索，本轮未复测 | 有文件或有账本不等于可恢复。不能给出 RPO/RTO 已达标的结论 | 待指派 | 另批授权的隔离环境。不删生产数据，不把演练做成 forward-only 回退 | 从备份恢复后，数量、checksum、tenant 边界与一次业务读成功有记录 | 未开始 |
| IA-STAGING-DRILL | `batch-c-provenance-staging-2026-10-31.md`：只读拓扑。C4 写明未做 fresh staging install，也未跑 `staging-local-sim`。附录主机是当时的 HK LIVE，不是可随意演练的 staging | 故障演练与切流没有本轮证据 | 待指派 | 使用专用 staging，显式授权。禁止对 `8.217.93.71` 的 LIVE 做演练写入 | 一次失败注入或最小业务闭环的命令、SHA、退出码与回退记录 | 未开始 |
| IA-SLO-OBS | 计划批次 E：按批准的 SLO 做观察窗。仓库里没有本批已批准的 SLO 数值，也没有绑定时间区间的观察记录。2026-10-31 LIVE 只读（seq151 / `d37bed5117d6`，healthz 200）不是观察窗 | 一次身份对齐不能当成稳定性证明 | 待指派 | 先由用户定 SLO 与窗口，再只读采集。本轮不部署 | 窗口起止、指标、失败样本和「unknown 不算 green」的记录齐全 | 未开始 |
| IA-RESOURCE-ENV | 2026-10-31 Mac Data 卷约 99%（`disk-inventory-2026-10-31.md`）。本执行环境 `df` 显示根卷约 3% 使用，不能代表那台 Mac。Bun 在本环境缺失；CI setup 目标与当日 Mac Bun 的差异写在计划初查里，本轮未复测 Mac | 磁盘与工具链偏差仍可能让构建或测试失真 | 待指派 | 在目标主机上复测 `df` 与 Node/pnpm/Bun。清理须单独授权，本轮未删 | 目标主机容量与工具链版本有新的只读记录，或授权清理后有 before/after | 线索仍在，未复测 |

Loom：`infrastructure-audit:infra-audit` 保持 `active`（没有待验收枚举；意图写明执行完成、待独立验收）。`infrastructure-audit:seq145-incomplete-graph` 为 `blocked`，owner `unassigned`（待指派）。
