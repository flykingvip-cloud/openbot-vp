# Task Progress Ledger 验收签字 · 2026-08-22 21:08 CST

决策摘要：**合并验收通过；生产启用 / 生产 flag 不批准。**

| 维度                                     | 决策                                   | 签字                                   |
| ---------------------------------------- | -------------------------------------- | -------------------------------------- |
| P0–P6 实施 + #597 合并                   | **批准**                               | 用户（「帮我批准」）+ cursor-grok 记录 |
| 隔离灰度七项                             | **批准**（第 4 项 pass-with-residual） | 见 `canary-signoff-20260822.md`        |
| 生产 cutover（LIVE 与 trunk 对齐）       | **暂不批准**                           | 见下方阻断                             |
| 生产 `OPENBOT_PROGRESS_LEDGER_ENABLED=1` | **明确不批准**                         | 保持 OFF                               |

机器回执：`docs/design/evidence/task-progress-ledger-acceptance-signoff-20260822.json`

## 已确认通过

- #597 `25df222f26971854b00f52a611e810c26e2e8b91` 在 `origin/main` 祖先链上；P0–P6 在 `tasks.md` 全部勾选完成。
- 隔离灰度（`canary-signed-off`）：append-only、TOOL_SUCCEEDED 不停在 completed、payload evidence、quiet 不推送、cron/admin 同投影、I1–I8=0。
- LIVE（2026-08-22 21:08 复验）：gateway `c393dca8feedd8b9db1a1f7fafc4796ac60b5d06`；UI pin `index-Dpg8P1UR.js` / `ledger-ui-pin-r1`；`项验收已满足` 在 live UI；healthz live；**flag 未设置**。
- 针对 **LIVE SHA** 的门禁（fresh `git fetch origin` 后重跑）：`verify-forward-only.sh` allow；`verify-delivery-alignment.sh` PASS（9/0 fail，仅 dirty-tree WARN）。

## 阻断 / 未批准项

1. **`origin/main` 已前进**：fresh fetch 后 tip = `5c221b9ec38c6316b98797342a01fb39ffd80562`（#606），LIVE 仍为 `c393dca8fe`。不能以「已等于当时 main tip」宣告 trunk/L3 完全对齐；下一次 cutover 必须再 fetch 并重测 **当时** tip。
2. **`RELEASE_RECORD` / UI pin 行仅在本地脏工作树**（66 个脏文件），尚未进 `origin/main`；不能从该工作树直接 land cutover 记录。
3. **生产 flag 未启用、未授权**：未设置 `OPENBOT_PROGRESS_LEDGER_ENABLED=1`，未为启用重启 gateway — 符合当前不批准状态。
4. **Turn Contract 独立模块**：非本波阻断，不纳入本次否决理由。

## 生效约束

- 生产 **保持** `OPENBOT_PROGRESS_LEDGER_ENABLED` OFF，直至用户 **另发明确授权** 且完成：干净工作树 → fresh fetch → forward-only + delivery alignment → LIVE 与候选 tip 一致 → 再启用 flag 并验收。
- 独立 Turn Contract 重构 PR 不阻塞上述授权前置。
