# Priority1 对象恢复与历史重新分类 — 2026-10-31 Asia/Shanghai

> **历史合入状态（不要按今天阅读表内 OPEN）：** 基线表里的「#171 OPEN」「#172 未合入」以及文末「未合入 #171/#172」记录的是 2026-10-31 写本文时的状态。2026-11-01 现行合入与验收边界见 [closeout-2026-11-01.md](closeout-2026-11-01.md)。表内单元格保持原句。

> **SUPERSEDED ADJUDICATION (2026-10-31 later same day):** the 「5 proven DAG break」claim below is **withdrawn** as final adjudication. **权威当前分类**见 `p1-current-classification-2026-10-31.json`（145 forward-only + 1 incomplete_graph_unknown；完整 146 本轮未重遍历）。详见 `p1-dag-break-evidence-closure-2026-10-31.md`。seqs **52/100/121/140 → forward-only**；seq **145 → incomplete_graph_unknown**（「当前联合对象图下非祖先」, **not** 「历史无共同祖先」）。Donor 亦 shallow；**禁止**称「联合完整图」。Counts 141+5 仅为 *HISTORICAL donor_primary* 已发表拆分，非现行定案。恢复计数三分项：inventory/清单 **137**，捕获时 `refs/audit-recovery/*` **5**。


> **性质**：证据包（evidence-only）。**不**修改 `deploy/production/releases.jsonl` / `RELEASE_RECORD.md`；**不**写 `regressionAcknowledged`；**不**合入、DIGEST、部署或触发 A3。
> **与 #172 关系**：独立于 [#172](https://github.com/flykingvip-cloud/openbot-vp/pull/172)（限定账本修复）。本 PR 仅交付对象恢复与重新分类证据。Codex 独立验收；实施方不自宣布 PASS。

## 基线

| 项 | 值 |
|---|---|
| origin/main | `0e4d269615e26909bbac606f1dfb755b3511400c` |
| #171 head | `e049e76bf41aed231828dc2c276a97cb31171580` OPEN |
| #172 head / 账本审计 tip | `d189e74f85ff2838b0df0b469ca5eeae39bf9724` OPEN（限定修复已验收，**未合入**） |
| audit worktree | `/Users/daniel/AI VP/openbot-infrastructure-audit` @ `audit/ledger-integrity-seq127-release-record` |
| audit clone shallow | **true**；boundary = `9a8e91d19e893fc5d963103538cdbd35f315ac30`（seq144 tip） |
| 权威对象库 donor | `/Users/daniel/AI项目/openbot`（本地；非 GitHub 可达 tip 的完整对象源） |
| Loom stream | `infrastructure-audit-p1-object-recovery-20261031` |
| 账本路径（只读审计） | `deploy/production/releases.jsonl` @ #172 tip（seq127 已关；仅 seq151 开放） |

## 方法

1. 在 #172 tip 上跑 `pnpm delivery:ledger:audit` → exit **30**；146 条 regression ERROR；open-interval 已因 seq127 关闭消失。
2. 对每条 ERROR 做 `git cat-file -t` + `git merge-base --is-ancestor`；**缺对象不得称为已证明 regression**。
3. `git fetch origin <sha>` → `not our tip` / `not our ref`；`gh api repos/.../commits/<sha>` 抽样 **24/24 HTTP 422**；remote `provenance/*` tags = **0**。
4. 从 donor 只读 `git fetch <donor> <sha>:refs/audit-recovery/<sha>` 收回 **137** tip（不改写提交内容、不强推、不 GC、不删 refs）。
5. **分类权威（已修正）**：先前 donor_primary **不可**作为最终定案权威——**donor 亦为 shallow**。祖先正证（`is-ancestor` exit 0）可采纳；空 merge-base / 非祖先在未排除 shallow 截断前只能标 incomplete_graph_unknown。
6. **未**写 `regressionAcknowledged`；未删账本行；本 PR **不**改账本/人类记录。

### 分类判定（forward-only）

| 分类 | 判定 |
|---|---|
| forward-only | 对象存在，祖先检查成立 |
| proven DAG break | 对象存在，祖先检查返回非祖先 |
| missing object | 缺少必要对象 |
| incomplete graph / command failure | 无法可靠判断，保持 unknown |

## 前后差异（原 146 条 ERROR regression）

| 分类 | 恢复前（audit shallow 叙事） | 恢复后（donor-primary） |
|---|---:|---:|
| forward-only | 0 | **141** |
| proven DAG break | 1（仅 seq145） | **5**（52, 100, 121, 140, 145） |
| missing object | 145 | **0**（双库联合视角） |
| incomplete graph / unknown | （被误并进 missing） | **0**（权威分类后） |

历史仍 **fail-closed**（exit 30）；不得称交付门禁通过。现行口径见 `p1-current-classification-2026-10-31.json`（145 FO + 1 incomplete_graph_unknown；proven_dag_break=0）。HISTORICAL donor_primary 曾报少数 proven DAG break，已撤回为定案。**不再**把缺对象统称为已证明 regression。

机器可读：**权威当前** `p1-current-classification-2026-10-31.json`；HISTORICAL `p1-reclassification-summary.json`、`reclassification-donor-primary.jsonl`。

## Proven DAG break（HISTORICAL donor_primary 表；≠ 功能内容回退；现行已撤回）

| seq | prior | current | 分类源 |
|---:|---|---|---|
| 52 | `59be50660d8e…` | `756a577ec77e…` | donor_primary |
| 100 | `28ef650e0f97…` | `6628f4bf364b…` | donor_primary（audit shallow 曾假 forward-only，已弃） |
| 121 | `0411972cd38c…` | `13ff093d281b…` | donor_primary |
| 140 | `d95f332d39c8…` | `c33c140167bf…` | donor_primary |
| 145 | `9a8e91d19e89…` | `065840dfba12…` | audit_fallback（donor 缺 145 tip） |

以上均为双向非祖先、`merge-base` 空的 **DAG/SoT 不连续**。**不可**据此断言功能内容回退；**未** acknowledge。

## Seq145 专项

详见同目录 `seq145-evidence.json`。摘要：

- seq144 `9a8e91d19e893fc5d963103538cdbd35f315ac30`：audit+donor 均有；`fix(build): formal-deliverable-root… (#882)`；parents `b9be3ec5…`
- seq145 `065840dfba129475c9c9030c80af07970dcdd084`：仅 audit 有；donor 无；`fix(build): clear docker tsc… (#78)`；parents `b8864b26…`
- audit：`is-ancestor 144→145` code **1**；`145→144` code **1**；`merge-base` 无共同祖先
- 结论（**已由 closure 修正**）：不得再定为 proven DAG break；应记 **incomplete_graph_unknown /「当前联合对象图下非祖先」**（prior 即 audit shallow boundary，截断未排除）。≠ 功能回退；不自动 acknowledge。详见 `p1-dag-break-evidence-closure-2026-10-31.md`。

## 附件清单（本目录）

| 文件 | 说明 |
|---|---|
| `p1-current-classification-2026-10-31.json` | **权威当前分类**（145 FO + 1 incomplete；勿合并旧补丁字段） |
| `p1-reclassification-summary.json` | HISTORICAL donor_primary 快照（非现行） |
| `missing-object-inventory.jsonl` | 恢复前缺失 tip 清单（137） |
| `recovered-shas.txt` | 从 donor 收回的 tip 列表 |
| `reclassification-donor-primary.jsonl` | 146 条权威重分类全表 |
| `seq145-evidence.json` | seq145 双方对象 / 祖先 / 共同祖先证据 |
| `github-commit-api-sample.json` | GitHub commits API 抽样（均为 422） |
| `ledger-audit-raw-snippet.txt` | 审计输出脱敏摘录（exit 30） |

## 已证明 / 待验证 / 环境限制

- **已证明（现行）**：donor 可补齐 tip 对象 inventory **137**（清单 137 行；捕获时 recovery refs **5**）；当前分类见 `p1-current-classification-2026-10-31.json`（145 FO + 1 incomplete_graph_unknown）；GitHub/origin 抽样不可达这些 tip。HISTORICAL donor_primary 曾报 141+5，已由 closure 撤回为定案。
- **待验证**：H1「Actions 分钟耗尽」；A3 未授权未执行。
- **环境限制**：audit worktree 仍 shallow；完整祖先行走依赖本地 donor；`refs/audit-recovery/*` 仅本机取回锚点，未推远程。

## 未做 / 边界

- 未合入 #171/#172；未 DIGEST/部署；未触发 A3；未改账单/runner/ruleset
- Priority 2（RELEASE_RECORD 防漂移）与 Priority 3（A3 包）**未**在本 PR 开工
- 历史账本审计保持失败；不掩盖 unknown / 不刷绿
