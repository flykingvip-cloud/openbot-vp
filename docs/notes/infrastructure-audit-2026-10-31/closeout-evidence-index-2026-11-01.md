# 证据索引（基础设施审计收尾，2026-11-01）

原始输出目录：`docs/notes/infrastructure-audit-2026-10-31/closeout-evidence-2026-11-01/`。

原始命令输出（`*.out` / `*.err`）以压缩归档保留原始字节，避免 `git diff --check` 因尾随空白失败而被静默改写：`closeout-evidence-2026-11-01/raw-command-outputs.tar.gz`（成员摘要见同目录 `raw-command-outputs.MANIFEST.txt` / `raw-command-outputs.sha256`）。解压后应与归档前逐字节一致。目录内不再保留松散 `.out`/`.err`。

候选（验证当时）：

- head `c3b00f492411dc96d2befd67921fe4951cfede97`
- tree `4dbadcbb67f8ef0291773de323bfb7012e207f7a`
- `origin/main` 相同
- `git fetch origin main` 退出码 0，时间 2026-11-01T12:53:12Z；分支创建前复检 SHA 未变
- 环境：`env.txt`（Node v22.23.4，pnpm 10.23.0，shallow=false，Linux 6.12.94+）
- 安装：`pnpm install --frozen-lockfile` 退出码 0，2026-11-01T12:59:06Z。lockfile 未提交变更

| 记录                      | 命令                                                                                          |           退出码 | UTC               | 原始输出                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------- | ---------------: | ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 汇总                      | 见各行                                                                                        | 见 `summary.txt` | 12:59:16 起       | `summary.txt`                                                                                                                     |
| 本地门禁单测              | `pnpm exec vitest run scripts/ci-local-merge-gate.test.ts`                                    |                0 | 12:59:16–12:59:18 | `raw-command-outputs.tar.gz` → `vitest-ci-local-merge-gate.out` / `.err`                                                          |
| 防漂移单测                | `pnpm exec vitest run scripts/delivery/release-record.test.ts`                                |                0 | 12:59:18–12:59:19 | `raw-command-outputs.tar.gz` → `vitest-release-record.out` / `.err`                                                               |
| 账本与 forward-guard 单测 | `pnpm exec vitest run scripts/delivery/ledger.test.ts scripts/delivery/forward-guard.test.ts` |                0 | 12:59:19–12:59:21 | `raw-command-outputs.tar.gz` → `vitest-ledger-forward.out` / `.err`                                                               |
| 人类记录检查              | `pnpm delivery:release-record:check`                                                          |                0 | 12:59:21          | `raw-command-outputs.tar.gz` → `release-record-check.out` / `.err`                                                                |
| 账本审计                  | `pnpm delivery:ledger:audit`                                                                  |               30 | 12:59:28–12:59:29 | `raw-command-outputs.tar.gz` → `ledger-audit.out`（warn）/ `ledger-audit.err`（ERROR）；计数旁路：`ledger-audit-code-counts.json` |

本轮 audit 计数（从上述原始文件解析，不是历史 146 表）：ERROR missing-object 157；warn timeline-gap 8；warn overlay-debt 15；warn missing-tag 1。无 regression、incomplete-graph、open-interval 行。

未运行项没有输出文件：`pnpm build`、`pnpm tsgo`、`pnpm check`、平台矩阵、完整 `scripts/ci-local-merge-gate.sh`、托管 Actions、LIVE SSH、A3 / #175。

## 主干身份

合入关系用 `git merge-base --is-ancestor <squash> origin/main`，五项审计 PR 与 #131/#148/#149/#169/#170/#177 均为祖先。PR 明细来自 `gh pr view`（2026-11-01 本轮）。squash 与 head 的完整 SHA、tree、单父提交见 [closeout-2026-11-01.md](closeout-2026-11-01.md)。

## 历史证据（未删除、未改写）

- 权威历史分类：`p1-current-classification-2026-10-31.json`
- HISTORICAL donor_primary：`p1-reclassification-summary.json`、`reclassification-donor-primary.jsonl`
- 恢复清单：`recovered-shas.txt`（137 行）、`missing-object-inventory.jsonl`、`p1-donor-provenance-2026-10-31.json`
- seq145 当日证据：`seq145-evidence.json`
- 闭包与原始图：`p1-dag-break-evidence-closure-2026-10-31.md` 与同名 json、`p1-dag-break-graph-closure-raw-2026-10-31.json`
- 早期 audit 摘录：`ledger-audit-2026-10-31.md`、`ledger-audit-raw-snippet.txt`、`ledger-error-classification-2026-10-31.md`

## 验收评论位置

GitHub issue comments（不是 Review 对象）：

- https://github.com/flykingvip-cloud/openbot-vp/pull/171 （owner PASS comment，2026-11-01T00:46:07Z）
- https://github.com/flykingvip-cloud/openbot-vp/pull/172 （无 issue comment）
- https://github.com/flykingvip-cloud/openbot-vp/pull/173 （land comment，2026-10-31T15:27:57Z）
- https://github.com/flykingvip-cloud/openbot-vp/pull/174 （owner PASS comment，2026-11-01T00:47:41Z）
- https://github.com/flykingvip-cloud/openbot-vp/pull/176 （owner PASS comment，2026-11-01T00:50:48Z）
- https://github.com/flykingvip-cloud/openbot-vp/pull/175 （仍 OPEN；本轮未注册探针、未执行）
- https://github.com/flykingvip-cloud/openbot-vp/pull/177 （关联，不在本批）
