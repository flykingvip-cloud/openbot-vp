# ConversationTask Runtime — P4.5 seq-45 B 生产部署前验收

> Owner(签署): 长程任务审核 · 实施 ≠ 本签署（#775 Cursor Agent）· 合入人 ≠ 本签署（flykingvip-cloud）
> 关联: `./p4-5-orchestration-plane.md` · `./p4-5-admission-package.md` · `./p2-5-production-readiness.md`（B→A→D→C）
> 状态: **B = CONDITIONAL PASS（已完成）** · **seq 45 D 已完成** · ledger **#782 已在 main** · **seq 46 已回滚** · P4.5b **#783** / P4.5c **#785** 已在 main · LIVE 正在另行 recut · `production enable of OPENBOT_CONVERSATION_TASK_ORCH_* = NOT APPROVED` · `CTR activation/projection/authorization = NOT APPROVED` · **C 未打开**
> 候选（B 当时）: `origin/main` `258bed8206674c886d9a8a544e81bc6500d2c23f`（PR #775）
> LIVE（seq 45 D 完成后；回滚后曾为）: `21e1e8392f0ff5808563727eaa8f66e6ad9ed148`（ledger #782）。当前 LIVE 正在另行 recut，本文件不记录尚未合入的 recut SHA。
> 日期: 2026-08-28（Asia/Shanghai）

## 0. 范围（历史记录，不是新的 cutover 申请）

本文件记录 **已完成** 的 seq-45 B CONDITIONAL PASS：当时申请把已合入的 P4.5 Orchestration Plane 休眠内核随 `origin/main` 前向带到 LIVE（seq 45），形态与 seq 44 相同：present, dormant, fail-closed。

事后（相对 B 当时）：

- **D 已完成**：生产 cutover 到 `21e1e839`（seq 45）
- **ledger #782 已合入 main**（记录 seq 45 行）
- **seq 46 已回滚**
- **P4.5b #783**（dormant choke-point）与 **P4.5c #785**（dormant identity）已在 `origin/main` `13cbfa6873466810831d57290e7617c82a833ccc`
- **LIVE 正在另行 recut**（不在本 PR 范围；本文件不发明当前 LIVE commit）。回滚后 LIVE 曾为 `21e1e839`
- **flags 保持 OFF**；**C 观测启用未打开**

本 PR 是文档回填，**不是**新的 cutover 申请，也 **不是** 编排 / activation 启用批准。

明确仍不申请：编排 shadow/dispatch/node/browser 启用、CTR activation、live invoke、HMAC/vault 变更、打开 C。

## 1. 逐项复核（B 当时，对照 `258bed82` / #775）

下表是 B 签署时对 **#775 合入点** 的复核，不是对当前 `origin/main`（已含 #783 / #785 choke-point）的复核。

| #   | 项                 | 证据                                                                                                  | 结果                                                            |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | 无 gateway 接线    | `server.impl.ts`、`dispatch-from-config.ts` @ `258bed82` 无 `task-orchestration` / `considerDispatch` | PASS（B 当时；#783 之后已有 dormant choke-point，仍 flags OFF） |
| 2   | 无 env 默认打开    | `.env.example` 无 `ORCH_*`；四开关默认 OFF                                                            | PASS                                                            |
| 3   | 不 invoke          | `considerDispatch` 字面量 `invokedTool: false`、`job: null`                                           | PASS                                                            |
| 4   | 不能跑在 CTR 前面  | `dispatchEnabled=1` 且 CTR activation OFF ⇒ no-op                                                     | PASS                                                            |
| 5   | 本机 fail-closed   | 零 node / 未绑定 / `nodeEnabled` OFF ⇒ human_gate 或 skip                                             | PASS                                                            |
| 6   | sandbox ≠ 用户电脑 | workspace 路径不得路由为 `node_fs_read` / `node_exec`                                                 | PASS                                                            |
| 7   | CT2 / A1 未破      | 无 `nodeId` / `steps` / `progress` 写入 `conversation_tasks`                                          | PASS                                                            |
| 8   | 非 Mission         | `sessions_spawn` 仅类型/深度上限                                                                      | PASS                                                            |
| 9   | 前向 only          | `76fea1fb..258bed82` ahead 61, behind 0。D 现场须重跑 `verify-forward-only.sh`                        | PASS（B 当时）                                                  |
| 10  | CTR 红线           | activation/projection/authorization 仍 forbidden；D 后须核对进程 env 未新增 `ORCH_*`                  | PASS                                                            |

合入门槛（ruleset）在 #775 合入时为绿：`check (types, lint, format)`、`delivery guard`、`freeze + phase0`。主干 `check-docs` / `secrets` audit / `skills-python` 不在 required 列表。

## 2. 爆炸半径（B 当时写入 A/D）

LIVE 到候选 **ahead_by=61**（B 当时：seq 44 `76fea1fb` → `258bed82`）。seq 45 是 origin/main 整包前进，不是只部署 P4.5 文件。

CONDITIONAL 条件：D 从干净 `origin/main` 构建；**不**向 `env.list` / `.env.docker` 写入任何 `OPENBOT_CONVERSATION_TASK_ORCH_*`；seq 44 shadow 维持休眠（HMAC 已在、flags OFF、allowlist 空）。

## 3. 回滚（B 当时计划）

容器级（B 当时）：seq 44 镜像 `76fea1fb0669`。代码级：ORCH 未接线，env 未设置即保持关闭。

D 完成后实际 LIVE 曾为 `21e1e839`（ledger #782）。seq 46 已回滚。当前 LIVE 正在另行 recut。

## 4. 签署

- B: **CONDITIONAL PASS** — 长程任务审核, 2026-08-28
- 实施 owner（Cursor Agent / #775）不得视为本签署
- flykingvip-cloud 的 PR Approve 是代码审，不替代 B，也不替代 A
- 本文件合入不构成新的 A/D，也不打开 C 或任何 `OPENBOT_CONVERSATION_TASK_ORCH_*`

## 5. 事后状态（相对 B 当时）

| 项       | 状态                                                             |
| -------- | ---------------------------------------------------------------- |
| seq 45 D | 已完成（cutover 到 `21e1e839`）                                  |
| ledger   | **#782 已在 main**                                               |
| seq 46   | **已回滚**                                                       |
| P4.5b    | **#783 已在 main**（dormant choke-point）                        |
| P4.5c    | **#785 已在 main**（dormant identity）；`origin/main` `13cbfa68` |
| LIVE     | 正在另行 recut。不发明当前 LIVE SHA。回滚后曾为 `21e1e839`       |
| flags    | **OFF**                                                          |
| C        | **未打开**                                                       |
