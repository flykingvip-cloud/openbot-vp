# Batch E／T9 最终同版本验收包（候选）

日期：2026-11-09（Asia/Shanghai）  
Draft PR：https://github.com/flykingvip-cloud/openbot-vp/pull/263  
分支：`cursor/runtime-authority-batch-e-bf87`

## 固定 SHA

| 角色                           | SHA                                        |
| ------------------------------ | ------------------------------------------ |
| 受测运行时（M3 实现 tip）      | `bc120f691c5199b063c7a5ea6e86586e035ffe37` |
| 本包提交前分支 tip／上一证据头 | `ffb70cefdbdfc1f1988cbd8e1b5ee35806de0192` |
| 本包证据头（正文＋日志）       | `59cad9e726be006718e9eb1b21e0f54f134836d9` |
| 分支 tip（含本钉 SHA 提交）    | （push 后以 origin 为准；本机提交时见 PR） |

M1–M3 独立内容验收已通过（M3 受测同上；上一证据头 `ffb70cefdbdfc1f1988cbd8e1b5ee35806de0192`）。

## 工程门禁（本 tip 复跑）

| 门禁                                                               | 结果                                                     | 日志                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------- |
| `pnpm tsgo`                                                        | PASS／EXIT 0                                             | `acceptance-logs/t9-final-tsgo-bc120f691.log`        |
| `NODE_OPTIONS=--max-old-space-size=8192 pnpm build`                | PASS／EXIT 0                                             | `acceptance-logs/t9-final-build-bc120f691.log`       |
| M3 五文件矩阵                                                      | **5 文件／42 PASS**／EXIT 0                              | `acceptance-logs/t9-final-m3-vitest-bc120f691.log`   |
| T9 既有 31 文件矩阵                                                | **31 文件／266 PASS**／EXIT 0                            | `acceptance-logs/t9-final-matrix-bc120f691.log`      |
| 扩展 Gateway（`collaboration-learning`＋`collaboration-dispatch`） | **9 文件失败／196 通过；17 测试失败／1626 通过**／EXIT 1 | `acceptance-logs/t9-final-ext-gateway-bc120f691.log` |

**口径**：局部 42 PASS 与 31／266 PASS **不得**写成全库通过。扩展套件失败见下节。

## 扩展 Gateway 失败（归因已对照；撤回「历史／既有」笼统标签）

> **撤回**：本包曾写「9 个失败文件无 Batch E 改动 → historical／pre-existing」。测试文件未改 ≠ 实现／依赖未改；该归因在缺少基线对照时无效。独立验收亦撤回「两项历史断言失败」的无基线表述。

对照报告：`t9-ext-gateway-17-fail-attribution.md`（同目录）。同命令下对失败 9 文件复跑：

| 端        | SHA          | 结果                             |
| --------- | ------------ | -------------------------------- |
| 候选 tip  | `8deb8ce4f…` | 17 FAIL／71 PASS                 |
| Batch D   | `479f9ba14…` | 17 FAIL／71 PASS（与候选同集合） |
| T0 迁移前 | `efdb1b98d…` | 14 FAIL／74 PASS                 |

分类：**Batch E 引入 0**；**既有（T0 同败）14**；**迁移引入（T0→D）3**（discuss-to-task×2、p2 subprocess×1）。无「归因未定」。本包仍不修复这 17 项、不宣称全绿；**最终验收仍 FAIL**。

代表性失败文件（完整见归因表与扩展日志）：

1. `discuss-to-task-gateway-ws.integration.test.ts` — 2（迁移引入）
2. `r7-claim-lifecycle-trusted.gateway.test.ts` — 2（既有）
3. `todolist-acl-rpc.test.ts` — 5（既有）
4. `r6-wake-handler-chain.gateway.test.ts` — 3（既有）
5. `r5-handler-trusted-chain.gateway.test.ts` — 1（既有）
6. `controlled-collab-p2-event-dispatch.test.ts` — 1（迁移引入）
7. `convergence-acceptance.test.ts` — 1（既有）
8. `episode-single-beat-runtime.g2.test.ts` — 1（既有）
9. `group-task-heartbeat.test.ts` — 1（既有）

## 组终稿投递

**主链断点仍在（不关闭 T9 组终稿格）。**

- `acceptBoardItemSubmission`（`claim-contract.ts`）仍写入 `acceptedArtifactVersion`。
- `triggerPostSubmissionEventAdvance` 在 accepted 时仍返回 `accepted_no_further_exec_schedule`，不进入组终稿外发。
- M1–M3 成员已接受成果桥（`requestAcceptedArtifactDelivery`／grant／进程内 recover）会读取 `acceptedArtifactVersion`，但是 **显式请求的成员成果外发**，与组终稿自动集成→投递→回执 **不是同一条链**；完成成员桥 **不得** 关闭组终稿验收格。
- 生产路径中，除成员桥模块外，board 上 `acceptedArtifactVersion` 仍无组终稿 outbound 消费者。

若要关闭组终稿格，需另开设计／实施：组终稿对象、授权、投递消费者与失败重投（本包不做）。最小补链设计（仅设计）：`t9-group-final-delivery-bridge-design.md`。

## 真实运行 GAP（仍开放）

真实模型、生产重启、真实渠道外发、实物 PPT：仍 GAP。

## 委派补充

D0–D5（S0–S7）未开始。

## 合并／部署

本包 **不授权** 合并或部署。**Owner 已判定 T9 最终验收不通过**（证据可接受、最终门禁 FAIL）；禁止统一合入／DIGEST／切 LIVE。须待 17 项归因处置与组终稿链关闭后，再发合入信号。Owner 当面 `PRODUCTION_GO DIGEST` 仍为部署硬门槛。

## 结构结论（不变）

分层及场景入口已建立；未充分验证所有入口职责边界与生命周期一致性；不能作最终统一结论。成员成果可信投递补链（M1–M3）已通过；组终稿与真实 GAP 仍开放。
