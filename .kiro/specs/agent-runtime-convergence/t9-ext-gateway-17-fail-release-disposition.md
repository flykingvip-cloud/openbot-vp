# T9 扩展 Gateway 17 项 — 修复进度与发布挂账

日期：2026-11-10（Asia/Shanghai）  
Draft PR：https://github.com/flykingvip-cloud/openbot-vp/pull/263  
分支：`cursor/runtime-authority-batch-e-bf87`

## Owner 决策（覆盖）

本轮**以修通测试为目标**（最小修复）；挂账文档保留为进度记录。仍 **不** 合入／部署／DIGEST／切 LIVE／真实外发。

归因基线见 `t9-ext-gateway-17-fail-attribution.md`。

## 复验命令（同归因）

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/collaboration-learning/discuss-to-task-gateway-ws.integration.test.ts \
  src/gateway/collaboration-learning/r7-claim-lifecycle-trusted.gateway.test.ts \
  src/gateway/collaboration-learning/todolist-acl-rpc.test.ts \
  src/gateway/collaboration-learning/r6-wake-handler-chain.gateway.test.ts \
  src/gateway/collaboration-learning/r5-handler-trusted-chain.gateway.test.ts \
  src/gateway/collaboration-learning/controlled-collab-p2-event-dispatch.test.ts \
  src/gateway/collaboration-learning/convergence-acceptance.test.ts \
  src/gateway/collaboration-dispatch/episode-single-beat-runtime.g2.test.ts \
  src/gateway/collaboration-dispatch/group-task-heartbeat.test.ts
```

证据：`acceptance-logs/t9-attr-9files-after-fixes-round2.log` → **9 files / 88 passed / 0 failed**。

## 本轮已修通（相对归因时的 17 FAIL）

| 簇                                | 项数 | 修复要点                                                                                                         |
| --------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| discuss×2 + p2 subprocess（迁移） | 3    | leaf 导入避开 state barrel→carbon；`embedded-payloads` 惰性 getter                                               |
| episode productionExecutor        | 1    | `chat.ts` 参数对象字段顺序                                                                                       |
| todolist ACL／owner-decision×5    | 5    | confirm 拒绝文案含「主答」；测试 OS 写 `writeKind:"auth"`+epoch；`members.json` 写权；避免 agent-peer 误自动确认 |
| r5／r6 confirm／wake／chat×4      | 4    | `isBotLikeMemberId` 不再把 `emp-owner` 当 bot；gateway `agents.list` 与 `/`↔`-` normalize 对齐                   |
| r7 claim lifecycle×2              | 2    | 同上 readiness／agents.list + id match                                                                           |
| convergence AC-3                  | 1    | 断言对齐 Sprint-2（checkpoint／artifact_ledger，不 mint task_ledger）                                            |
| heartbeat escalate                | 1    | 测试 tick 间隔越过 nudge fail backoff 30s                                                                        |

## 仍失败

**无**（同命令 9 文件 88/88 绿）。

## 组终稿

最小补链首切片已实现（见 `t9-group-final-delivery-bridge-design.md`）：policy／command／state／wiring；doubles 测试绿。**不**关闭真实模型／重启／渠道／PPT GAP；accept 路径仍无静默外发。

## 发布约束

仍 **不** 合入／部署／`PRODUCTION_GO DIGEST`／切 LIVE／真实外发。本轮修复仅推 Draft #263。
