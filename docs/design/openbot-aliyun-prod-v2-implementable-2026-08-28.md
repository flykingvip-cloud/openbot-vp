# Aliyun prod V2.3 — implementable status (reconstructed 2026-08-28)

**状态：** 从已合入 PR 还原的 **status 文档**，不是一份未发表的原始实施计划。  
**主干基线：** `origin/main` @ `b64d90a8b`（#796）。  
**禁止：** 本文不授权 live cutover、容器对调、`PRODUCTION_GO`、或改写已合入的 M0a/M0b 门禁。

\#774 引用了本路径，但该文件从未进树。下面只收录 **merged PR 正文与账本已经写明** 的里程碑。未在那些来源出现的 V2.3 id（例如 M1 / M2a）**不予补造**。

操作员主机步骤（命令、无密钥）：`deploy/production/M0B_M2B_OPERATOR_RUNBOOK.md`。  
交付标准（含 §6.1.1 R9 live identity）：`docs/design/openbot-dev-delivery-pipeline-standard-2026-07-20.md`。

---

## Operator tracking（OP-3 closed; seq 51 LIVE — 无对应 GitHub issue）

2026-08-29 只读审计：#796 已合入（OP-1/OP-2 入账）。OP-1 `--verify-live` PASS（未对开放的 seq 45 再 `--record`）；OP-2 已用 `pnpm delivery:cutover:record` 补记 seq 46（~11min forward，`--unverified-backfill`）+ seq 47（rollback / 当前 LIVE，`--live-verified --intentional-revert`）。`RELEASE_RECORD` Latest = seq 47 / `21e1e8392f0f` / digest `sha256:715122a1…`。OP-3 closed；当前 LIVE = seq 51。命令见 `deploy/production/M0B_M2B_OPERATOR_RUNBOOK.md`。本文不授权 cutover。

- [x] **OP-1 / M0b verify-live** — PASS on `8.217.93.71` / `openbot-gateway-rc`：`build-info.commit=21e1e8392f0ff5808563727eaa8f66e6ad9ed148`；healthz 200 `{ok:true,status:live}`；readyz 200 `{ready:true,failing:[]}`。禁止对已开放的 seq 45 再 `--record`（未再 record）。
- [x] **OP-2 / seq 46 rollback** — 主机 leftover：image `localhost/openbot:rc-amd64-provenance-471b3a2c3099`，id `3274060a31d4bf4187026687ac8369ae98da9545075dea4690750cba756bfe01`，digest `sha256:1aaa7406c0965d9ffd33b9237030e43d5af833119cc2663e9821c930e545765b`，OCI revision `471b3a2c30990c2cc555c01bfa496870e147c229`，container `817c9dfe13db` / `openbot-gateway-rc-prev-471b3a2c3099-safety`，StartedAt `2026-08-28T05:40:36Z`，FinishedAt `2026-08-28T05:51:33Z`。账本：seq 46 `--unverified-backfill`；seq 47 `--live-verified --intentional-revert` 回到运行镜像 `rc-amd64-provenance-21e1e8392f0f` digest `sha256:715122a14a8805c40f071c078a99132addbbb00633be21eabb55da7b85f65a5b`（不是 seq 45 入账的 `ee132a30…`）。
- [x] **OP-3 / M2b** — 下一次 GHCR cutover 必须 `--verify-live --record`（writer 带 `--live-verified`），禁止再走 seq 45 那种 backfill。

### 相关、但不是操作员主机项

- [x] **#777** — CLOSED（未 merge，`2026-08-28T17:30:29Z`）。替换 PR **#794** 已合入（`2026-08-28T23:23:13Z`）：CTR seq-45 B CONDITIONAL PASS 文档进树（`.kiro/specs/conversation-task-runtime/p4-5-seq45-b-predeploy.md`）。<https://github.com/gmood2008/openbot/pull/794>

---

## 已落地（in-repo）

| Id                 | 内容                                                                                                                                                 | 证据                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **M0a**            | ledger 门禁修复：v2 行、单一开放 `liveTo`、原子写入 `pnpm delivery:cutover:record`、alignment 无 SHA 则 fail-closed                                  | #774 merged `2026-08-28T01:38:08Z`                         |
| **M0a follow-up**  | 批准回滚可写账本（`--intentional-revert` → `regressionAcknowledged`）；短 SHA 对齐；Docker TS2783 解锁 GHCR 构建                                     | #778 merged `2026-08-28T02:35:24Z`（#776）                 |
| **seq 45 账本**    | 关闭 seq 44；追加 seq 45 / `21e1e8392f0f` / GHCR digest `sha256:ee132a30…ecb2`（当时开放 LIVE；现已关闭）                                            | #782 merged `2026-08-28T05:09:23Z`                         |
| **M0b in-repo**    | 写入必须声明 LIVE 如何确立：`--live-verified` 或 `--unverified-backfill`；`cutover-from-ghcr.sh --verify-live --record` 传 `--live-verified`；§6.1.1 | #786 merged `2026-08-28T16:16:03Z` as `8a6066afa`          |
| **runbook/status** | 操作员 runbook + V2.3 status 跟踪器进树                                                                                                              | #792 merged                                                |
| **CTR seq-45 B**   | seq-45 B CONDITIONAL PASS 文档进树（替换被误关的 #777）                                                                                              | #794 merged `2026-08-28T23:23:13Z`（#777 CLOSED 未 merge） |
| **OP-1 / OP-2**    | 独立 verify-live PASS；补记 seq 46 + seq 47；`RELEASE_RECORD` Latest = seq 47 / digest `sha256:715122a1…` / `liveVerified=true`                      | #796 merged `2026-08-29T00:03:34Z` as `b64d90a8b`          |

相关但 **不是** V2.3 交付门禁、且已在主干的 CTR 休眠代码（flags OFF，C 未开）：#775 / #783 / #785。生产启用 `OPENBOT_CONVERSATION_TASK_ORCH_*` = **NOT APPROVED**（#777 / #794 正文）。

---

## 部分完成

| Id                   | 现状                                                                                                                  | 证据                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **seq 45 LIVE 声明** | 历史：#786 写过 Latest = seq 45。现 Latest = seq 47 / `21e1e8392f0f` / digest `sha256:715122a1…`，`liveVerified=true` | OP-2 ledger reconstruction；#796；`RELEASE_RECORD` Latest |
| **seq 45 容器身份**  | OP-1 已独立 verify-live PASS。当前运行镜像是 seq 47 digest `sha256:715122a1…`，不是 seq 45 入账的 `sha256:ee132a30…`  | 主机 `podman inspect`；seq 47 `--live-verified`；#796     |

---

## 仍属操作员 / 主机（勾选见上方 Operator tracking）

来源只引用已写明的事实，不发明中间 SHA：

| Id       | 对应                                              | 来源                                                                            |
| -------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| **OP-1** | M0b 独立 `--verify-live`（已 PASS，勾选见上）     | 主机 `openbot-gateway-rc` build-info / healthz / readyz                         |
| **OP-2** | `--intentional-revert` 补记 seq 46 回滚（已入账） | #796；seq 46+47 via `delivery:cutover:record`；`RELEASE_RECORD` Latest = seq 47 |
| **OP-3** | M2b：观察容器后再 `delivery:cutover:record`       | #774 Remaining；#786 checklist                                                  |

对已开放的 seq 51 再 `--record` 会关掉该行并复制一条 LIVE，禁止。

---

## 账本尾（tree，OP-2 后）

- seq **44** `76fea1fb0669`：`liveTo=2026-08-28T03:59:00Z`
- seq **45** `21e1e8392f0f` / digest `sha256:ee132a30…`：`liveTo=2026-08-28T05:40:36Z`；无 `liveVerified`（backfill）
- seq **46** `471b3a2c3099` / digest `sha256:1aaa7406…`：`liveFrom=2026-08-28T05:40:36Z`；`liveTo=2026-08-28T05:51:33Z`；`liveVerified=false`
- seq **47** `21e1e8392f0f` / digest `sha256:715122a1…`：`liveTo=2026-08-29T04:04:22Z`；`liveVerified=true`；`--intentional-revert`
- seq **48** `6d27021431bd` / digest `sha256:767a5d3a…`：`liveTo=2026-08-29T06:49:12Z`；`liveVerified=true`；GHCR main-amd64
- seq **49** `33fc87c58229` / digest `sha256:a4f41fe7…`：`liveTo=2026-08-29T08:05:34Z`；`liveVerified=true`；GHCR main-amd64 @ sha256:a4f41fe77f86319877d7af83a04ea0527f09b7de4951ed4df36f0af7d4a5ef43
- seq **50** `1a6de1be5c44` / digest `sha256:b3318467…`：`liveTo=2026-08-29T13:15:53Z`；`liveVerified=true`；GHCR main-amd64 @ sha256:b3318467d1651222dd9381c18f6616e64ac92b17e61e5da273abccc2affa373a
- seq **51** `59be50660d8e` / digest `sha256:a64adc1f…`：开放 LIVE；`liveVerified=true`；GHCR main-amd64 @ sha256:a64adc1f04f116d7dd0e7e434f1d1a00a99601ed8de8ae8523becd2b1a470595

`pnpm delivery:ledger:audit` 0 errors（历史 warning 保留）。开放 LIVE 不再触发 `unverified-live`。

---

## 本文件不包含

- 未在 #774 / #778 / #782 / #786 / #792 / #794 / #796 / #777 出现的里程碑编号或截止日期
- 密钥、host env、swap/recreate 步骤
- 把 #777 / #794 的 CTR B 签字记录搬进本仓库其它路径
