# Batch E／T9 同版本门禁包（tip 复跑）

日期：2026-11-10（Asia/Shanghai）  
Draft PR：https://github.com/flykingvip-cloud/openbot-vp/pull/263  
分支：`cursor/runtime-authority-batch-e-bf87`

## 固定 SHA

| 角色 | SHA |
| --- | --- |
| 受测运行时（代码 tip） | `62f62063eb3f481186d53df746a627f86e98a4ab` |
| 本包证据头（正文＋日志） | `e44f4f24d8f3c7889f49f9d1eb381e9f2e28b117` |

本包为 tip `62f62063e` 的同版本门禁复跑证据；**不**宣称最终统一验收通过，**不**通知双轨 GO，**不**授权合入／部署／DIGEST／切 LIVE／真实外发。

## 工程门禁（本 tip 复跑）

| 门禁 | 结果 | 日志 |
| --- | --- | --- |
| `pnpm tsgo` | PASS／EXIT 0 | `acceptance-logs/t9-final-tsgo-62f62063e.log` |
| `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` | PASS／EXIT 0 | `acceptance-logs/t9-final-build-62f62063e.log` |
| M3 五文件矩阵 | **5 文件／42 PASS**／EXIT 0 | `acceptance-logs/t9-final-m3-vitest-62f62063e.log` |
| T9 既有 31 文件矩阵 | **31 文件／266 PASS**／EXIT 0 | `acceptance-logs/t9-final-matrix-62f62063e.log` |
| 扩展 Gateway 9 文件（归因同命令） | **9 文件／88 PASS**／EXIT 0 | `acceptance-logs/t9-final-ext-gateway-62f62063e.log` |

**口径**：局部 42／266／88 PASS **不得**写成全库通过。本包仅记录上述门禁复跑结果。

## 扩展 Gateway 9 文件命令

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

相对归因基线的原 17 FAIL：在 tip `62f62063e` 上同命令已 **0 FAIL**（见 `t9-ext-gateway-17-fail-release-disposition.md` 与本包 ext-gateway 日志）。

## 组终稿／真实 GAP（状态提示，非本包关闭项）

- 组终稿最小补链首切片已在 Draft #263 落地（policy／command／state／wiring）；本包不另验组终稿全链。
- 真实模型／生产重启／真实渠道外发／实物 PPT：仍 GAP。
- **不**关闭「最终统一验收」格；Owner 当面 `PRODUCTION_GO DIGEST` 仍为部署硬门槛。

## 合并／部署

本包 **不授权** 合并或部署；仍推 Draft #263。
