# T9 扩展 Gateway 17 项失败对照归因

日期：2026-11-10（Asia/Shanghai）  
Draft PR：https://github.com/flykingvip-cloud/openbot-vp/pull/263  
分支：`cursor/runtime-authority-batch-e-bf87`

## 固定 SHA

| 角色 | SHA |
| --- | --- |
| 受测运行时（M3 tip） | `bc120f691c5199b063c7a5ea6e86586e035ffe37` |
| 证据包（最终包正文＋日志） | `59cad9e726be006718e9eb1b21e0f54f134836d9` |
| 归因对照候选 tip（仅报告／日志钉之后） | `8deb8ce4fd139e2690b8c918e0c7cfb01ae2e496` |
| Batch D tip（对照） | `479f9ba14c10e27446e6444e82a9a92c9b546013` |
| 迁移前基线 T0（开工 tip） | `efdb1b98d83e096a31e251095080de954f5883ec` |

说明：候选 tip `8deb8ce4f` 相对受测 `bc120f691` 仅验收正文／日志；本轮 9 文件复跑在 tip 上执行，与受测实现同源。

## 命令与环境（三端相同）

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

- 机器：UPBEYOND Mac（本机工作区／detached worktree）
- Node / pnpm：与最终包同机；`package.json`／`pnpm-lock.yaml` 在 T0↔Batch D↔候选之间无差异，worktree 共用 `node_modules` 符号链接
- 未设额外 `NODE_OPTIONS`（与最终包扩展 Gateway 跑法一致；`NODE_OPTIONS=8192` 仅用于构建门禁）

## 汇总结果

| 端 | HEAD | 文件 | 测试 | EXIT | 日志 |
| --- | --- | --- | --- | --- | --- |
| 候选 tip | `8deb8ce4f…` | 9 failed (9) | **17 failed** / 71 passed (88) | 1 | `acceptance-logs/t9-attr-9files-candidate-8deb8ce4f.log` |
| Batch D | `479f9ba14…` | 9 failed (9) | **17 failed** / 71 passed (88) | 1 | `acceptance-logs/t9-attr-9files-batchd-479f9ba14.log` |
| T0 迁移前 | `efdb1b98d…` | 7 failed / 2 passed (9) | **14 failed** / 74 passed (88) | 1 | `acceptance-logs/t9-attr-9files-t0-efdb1b98d.log` |

最终包全目录扩展套件曾记 17／1626；本轮只复跑失败 9 文件，失败集合与最终包一致。

## 分类计数

| 分类 | 数量 | 含义 |
| --- | --- | --- |
| Batch E 引入（候选 FAIL／Batch D PASS） | **0** | 无本批新增回归；本回合不做 Batch E 最小修复 |
| 非 Batch E 单独引入且相对 T0 亦 FAIL → **既有**（有 T0 基线证据） | **14** | 可标既有 |
| 非 Batch E 单独引入、T0 PASS／D+候选 FAIL → **迁移引入**（T0→Batch D） | **3** | 不得标既有；亦非 Batch E |
| 归因未定 | **0** | 三端均可复现 |

候选 vs Batch D：17 项失败名称完全一致；16 项首条错误文案字节一致；1 项（p2 subprocess）仅 stderr 路径前缀不同（候选工作区 vs Batch D worktree），根因同为 `BILLING_ERROR_USER_MESSAGE` 读 undefined。

**撤回**：最终包曾写「失败文件无 Batch E 改动 → historical／pre-existing」。测试文件未改 ≠ 实现／依赖未改；在缺少基线对照时该归因无效。现以本表为准。

## 逐项表

| # | 测试 | 候选 | Batch D | T0 | 归因 | 影响／发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `discuss-to-task-gateway-ws…` · legal establish | FAIL `expected false to be true`（WS 正式建立） | FAIL 同 | **PASS** | **迁移引入** | 双主体／正式入场隔离主链；合入前须单独修复轨；**阻塞**宣称扩展 Gateway 绿／最终验收 |
| 2 | `discuss-to-task-gateway-ws…` · dual principals isolate | FAIL 同型 | FAIL 同 | **PASS** | **迁移引入** | 同上；双主体同 local groupId 隔离 |
| 3 | `r7-claim-lifecycle-trusted…` · op-A clears → op-B | FAIL | FAIL 同 | FAIL | **既有** | claim 生命周期／租户根释放；已知失败；不得作文案遗留；合并不得当全绿 |
| 4 | `r7-claim-lifecycle-trusted…` · mirror fail → release／retry | FAIL `expected +0 to be 1` | FAIL 同 | FAIL | **既有** | 同上 |
| 5 | `todolist-acl-rpc…` · ignore attacker ACL fail-closed | FAIL 缺「主答」文案 | FAIL 同 | FAIL | **既有** | ACL 拒绝面；影响授权文案／失败关闭语义 |
| 6 | `todolist-acl-rpc…` · transcript write failure retryable | FAIL `no_active_confirmer`≠`transcript_append` | FAIL 同 | FAIL | **既有** | 提案投递与 transcript 失败路径 |
| 7 | `todolist-acl-rpc…` · same-version retry single-consume | FAIL | FAIL 同 | FAIL | **既有** | 确认单次消费 |
| 8 | `todolist-acl-rpc…` · refuse stale plan confirms | FAIL `actor_not_confirmer`／主答 | FAIL 同 | FAIL | **既有** | 确认人 ACL 收窄 |
| 9 | `todolist-acl-rpc…` · D6b revoked coordinator historyReloadable | FAIL | FAIL 同 | FAIL | **既有** | 撤销后历史可读边界 |
| 10 | `r6-wake-handler-chain…` · tenant auth vs legacy revoke | FAIL | FAIL 同 | FAIL | **既有** | wake 鉴权双根冲突 |
| 11 | `r6-wake-handler-chain…` · two-tenant … confirm … stop→wake | FAIL `confirmation_consumed` | FAIL 同 | FAIL | **既有** | 双租户确认／隔离 |
| 12 | `r6-wake-handler-chain…` · chat.send plan confirm | FAIL | FAIL 同 | FAIL | **既有** | 计划确认可见结果、无执行 |
| 13 | `r5-handler-trusted-chain…` · two-tenant trusted locator | FAIL `confirmation_consumed` | FAIL 同 | FAIL | **既有** | 信任 locator 确认链 |
| 14 | `controlled-collab-p2…` · subprocess permit→exit→recover | FAIL child exit 1／`BILLING_ERROR_USER_MESSAGE` undefined（`embedded-payloads` 导入链） | FAIL 同根因 | **PASS** | **迁移引入** | 许可提交后崩溃恢复／防重复；迁移期 wiring 导入破坏子进程；**阻塞**最终验收；另开修复（非 Batch E） |
| 15 | `convergence-acceptance…` · AC-3 task_ledger continuity | FAIL ENOENT `task_ledger.json` | FAIL 同 | FAIL | **既有** | 连续性检查点路径 |
| 16 | `episode-single-beat-runtime.g2…` · productionExecutor 字符串 | FAIL 源码切片不含期望串 | FAIL 同 | FAIL | **既有** | 执行器选择断言与实现漂移 |
| 17 | `group-task-heartbeat…` · allowlist escalate | FAIL escalate 未出现 | FAIL 同 | FAIL | **既有** | 心跳升级／whoWokeWhom |

## Batch E 改动面（佐证「非测试文件未改即可开脱」）

`479f9ba14..bc120f691`：

- 上述 9 个**测试文件**：无 diff
- `src/gateway/collaboration-dispatch/plan-gate-exec.ts`：+1 行 `BoardTodolistDeliveryMapping` 类型导入
- `src/agent-runtime/**`：成员已接受成果桥（command／policy／state／delivery／wiring）大量新增

对照跑证明：即便测试文件未改，Batch E 也**未**单独把这 17 项从绿打红（Batch D 已同败）；其中 3 项相对 T0 为迁移窗口引入。

## 发布处置（统一）

1. **不得**发出 T9 最终验收通过／统一合入／DIGEST／切 LIVE。
2. 局部 M3 42 与 31／266 **不得**写成全库或扩展 Gateway 通过。
3. 14 既有：记入已知失败清单；涉及双主体隔离、ACL、撤销、确认、恢复——合并前须有显式豁免或修复，不可静默忽略。
4. 3 迁移引入：单列修复轨（WS 正式建立／双主体；p2 subprocess 导入／billing helper）；修复后须在同命令下对 9 文件＋M3 五文件复验。
5. 本回合：**无代码修复提交**（Batch E 引入计数为 0）。

## Non-goals

不修 17 项、不合入、不部署、不 DIGEST、不真实外发、不关闭组终稿格（见并行设计稿）。
