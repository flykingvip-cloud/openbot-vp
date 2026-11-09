# T9 扩展 Gateway 17 项 — 修复进度与发布挂账

日期：2026-11-10（Asia/Shanghai）  
Draft PR：https://github.com/flykingvip-cloud/openbot-vp/pull/263  
分支：`cursor/runtime-authority-batch-e-bf87`

## Owner 决策（覆盖）

本轮**以修通测试为目标**（最小修复）；挂账文档保留为进度记录。仍 **不** 合入／部署／DIGEST／切 LIVE／真实外发。

归因基线见 `t9-ext-gateway-17-fail-attribution.md`。

## 本轮已修通（相对归因时的 17 FAIL）

同命令 9 文件复跑：`acceptance-logs/t9-attr-9files-after-fixes.log` → **13 failed／75 passed**（原 17／71）。

| # | 测试 | 修复要点 |
| --- | --- | --- |
| 1–2 | discuss-to-task WS ×2（迁移引入） | 随 state barrel→leaf 导入收紧／图变绿（与 p2 同根） |
| 3 | p2 subprocess（迁移引入） | collaboration-dispatch 对 `agent-runtime/state` 改为 leaf 导入，避免 barrel 拉入 outbound→`@buape/carbon` CJS exports 炸子进程；`embedded-payloads` 惰性 getter 破循环初始化 |
| 4 | episode-single-beat productionExecutor 串 | `chat.ts` 将 `productionExecutor` 前移到 `executeCollaborationRound` 参数对象前部 |

## 仍失败（13）— 影响与挂账

| 簇 | 项数 | 影响 | 发布挂账 |
| --- | --- | --- | --- |
| todolist ACL／owner-decision／confirm／revoke | 5 | ACL 拒绝面、确认单次消费、撤销后 historyReloadable、transcript 失败路径 | **阻塞**宣称扩展 Gateway 绿；合入前须处置；不得作文案遗留 |
| r5／r6 confirm／wake／chat.planConfirm | 4 | 双租户隔离、confirmation_consumed、wake 双根鉴权、计划确认可见性 | 同上；涉及双主体隔离与确认语义 |
| r7 claim lifecycle | 2 | 租户 claim 释放／镜像失败重试 | 同上；恢复／锁语义 |
| convergence AC-3 ledger | 1 | 连续性检查点路径 | 路径漂移；阻塞该 AC |
| group-task-heartbeat escalate | 1 | allowlist 升级／whoWokeWhom | 心跳升级可观测性 |

**在 `PRODUCTION_GO DIGEST`／统一合入／切 LIVE 之前，上述 13 项必须有显式豁免或后续修复关闭。** 局部 M3／组终稿补链绿 **不得** 写成全库通过。

## 组终稿

最小补链首切片已实现（见 `t9-group-final-delivery-bridge-design.md` 实施记录）：policy／command／state／delivery；doubles 测试绿。**不**关闭真实模型／重启／渠道／PPT GAP；accept 路径仍无静默外发。
