# Batch E／T9 最终同版本验收包（候选）

日期：2026-11-09（Asia/Shanghai）  
Draft PR：https://github.com/flykingvip-cloud/openbot-vp/pull/263  
分支：`cursor/runtime-authority-batch-e-bf87`

## 固定 SHA

| 角色 | SHA |
| --- | --- |
| 受测运行时（M3 实现 tip） | `bc120f691c5199b063c7a5ea6e86586e035ffe37` |
| 本包提交前分支 tip／上一证据头 | `ffb70cefdbdfc1f1988cbd8e1b5ee35806de0192` |
| 本包证据头 | （push 本文件＋日志后更新） |

M1–M3 独立内容验收已通过（M3 受测同上；上一证据头 `ffb70cefdbdfc1f1988cbd8e1b5ee35806de0192`）。

## 工程门禁（本 tip 复跑）

| 门禁 | 结果 | 日志 |
| --- | --- | --- |
| `pnpm tsgo` | PASS／EXIT 0 | `acceptance-logs/t9-final-tsgo-bc120f691.log` |
| `NODE_OPTIONS=--max-old-space-size=8192 pnpm build` | PASS／EXIT 0 | `acceptance-logs/t9-final-build-bc120f691.log` |
| M3 五文件矩阵 | **5 文件／42 PASS**／EXIT 0 | `acceptance-logs/t9-final-m3-vitest-bc120f691.log` |
| T9 既有 31 文件矩阵 | **31 文件／266 PASS**／EXIT 0 | `acceptance-logs/t9-final-matrix-bc120f691.log` |
| 扩展 Gateway（`collaboration-learning`＋`collaboration-dispatch`） | **9 文件失败／196 通过；17 测试失败／1626 通过**／EXIT 1 | `acceptance-logs/t9-final-ext-gateway-bc120f691.log` |

**口径**：局部 42 PASS 与 31／266 PASS **不得**写成全库通过。扩展套件失败见下节。

## 扩展 Gateway 失败（相对 Batch E 为历史／既有）

独立验收曾指出「更大既有 Gateway 测试文件」上有两项与 M3 无关的历史断言失败。本轮对 `src/gateway/collaboration-learning` 与 `src/gateway/collaboration-dispatch` 做了更广复跑，共 **17** 项失败、跨 **9** 个测试文件。自 Batch D tip `479f9ba14` 至本 tip，**上述 9 个失败文件均无 Batch E 提交改动** → 相对本候选标为 **historical／pre-existing**，非 M3 引入。

代表性失败（完整列表见扩展日志）：

1. `discuss-to-task-gateway-ws.integration.test.ts` — 2 项：`expected false to be true`（WS 正式建立／双主体隔离）
2. `r7-claim-lifecycle-trusted.gateway.test.ts` — 2 项：trusted claim 生命周期断言
3. `todolist-acl-rpc.test.ts` — 5 项：ACL／confirm／transcript／historyReloadable
4. `r6-wake-handler-chain.gateway.test.ts` — 3 项：wake／confirm／chat.send
5. `r5-handler-trusted-chain.gateway.test.ts` — 1 项：`confirmation_consumed`
6. `controlled-collab-p2-event-dispatch.test.ts` — 1 项：subprocess child exit 1
7. `convergence-acceptance.test.ts` — 1 项：ENOENT continuity checkpoint
8. `episode-single-beat-runtime.g2.test.ts` — 1 项：productionExecutor 字符串断言
9. `group-task-heartbeat.test.ts` — 1 项：allowlist heartbeat 断言

合并前须按仓库整体门禁单独处置；本包不修复、不宣称全绿。

## 组终稿投递

**主链断点仍在（不关闭 T9 组终稿格）。**

- `acceptBoardItemSubmission`（`claim-contract.ts`）仍写入 `acceptedArtifactVersion`。
- `triggerPostSubmissionEventAdvance` 在 accepted 时仍返回 `accepted_no_further_exec_schedule`，不进入组终稿外发。
- M1–M3 成员已接受成果桥（`requestAcceptedArtifactDelivery`／grant／进程内 recover）会读取 `acceptedArtifactVersion`，但是 **显式请求的成员成果外发**，与组终稿自动集成→投递→回执 **不是同一条链**；完成成员桥 **不得** 关闭组终稿验收格。
- 生产路径中，除成员桥模块外，board 上 `acceptedArtifactVersion` 仍无组终稿 outbound 消费者。

若要关闭组终稿格，需另开设计／实施：组终稿对象、授权、投递消费者与失败重投（本包不做）。

## 真实运行 GAP（仍开放）

真实模型、生产重启、真实渠道外发、实物 PPT：仍 GAP。

## 委派补充

D0–D5（S0–S7）未开始。

## 合并／部署

本包 **不授权** 合并或部署。双规发布侧已盘点未合入栈并待命；须待本最终同版本包独立验收通过后，再发合入／DIGEST 信号。Owner 当面 `PRODUCTION_GO DIGEST` 仍为部署硬门槛。

## 结构结论（不变）

分层及场景入口已建立；未充分验证所有入口职责边界与生命周期一致性；不能作最终统一结论。成员成果可信投递补链（M1–M3）已通过；组终稿与真实 GAP 仍开放。
