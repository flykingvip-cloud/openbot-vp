# P1 DAG-break evidence closure — 2026-10-31 Asia/Shanghai

> **历史标识：** 文末「未继续 #174/#175」指写本文的那一轮。#174 已于之后合入；#175 仍未执行。现行入口 [closeout-2026-11-01.md](closeout-2026-11-01.md)。分类口径正文保持原样。

> Supersedes the adjudication language in `p1-object-recovery-reclassification-2026-10-31.md`
> that called seqs **52 / 100 / 121 / 140 / 145** 「proven DAG break」.
> **No** `regressionAcknowledged` changes. **No** self-PASS.

## Why re-open

Both object stores used for classification are **shallow**:

| repo                        | path                                               | shallow | boundaries                         |
| --------------------------- | -------------------------------------------------- | ------- | ---------------------------------- |
| audit (openbot-vp worktree) | `/Users/daniel/AI VP/openbot-infrastructure-audit` | true    | `9a8e91d19e89…` (seq144 tip)       |
| donor                       | `/Users/daniel/AI项目/openbot`                     | true    | 6 boundaries (see provenance JSON) |

`#173` tip `3b16dc781` used **donor_primary**. That is unsafe as adjudication authority:
donor shallow boundaries can yield empty `merge-base` / false non-ancestor.

Also: **tip objects present ≠ parent chain complete**.

## Per-seq closure table

| seq | prior          | current        | solo audit                                                                     | solo donor                                 | joint alternate                                                                            | **after closure**                                                                               |
| --: | -------------- | -------------- | ------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
|  52 | `59be50660d8e` | `756a577ec77e` | cmd fail (missing mid `cdd67eab` in audit-only)                                | non-ancestor + shallow hit on current walk | audit+donor objects → **anc=0**, mb=`59be5066…`                                            | **forward-only**                                                                                |
| 100 | `28ef650e0f97` | `6628f4bf364b` | **anc=0**, mb=`28ef650e…`                                                      | non-ancestor + shallow hits                | (positive already)                                                                         | **forward-only**                                                                                |
| 121 | `0411972cd38c` | `13ff093d281b` | **anc=0**, mb=`0411972c…`                                                      | non-ancestor + shallow hits                | (positive already)                                                                         | **forward-only**                                                                                |
| 140 | `d95f332d39c8` | `c33c140167bf` | **anc=0**, mb=`d95f332d…`                                                      | non-ancestor + shallow hits                | (positive already)                                                                         | **forward-only**                                                                                |
| 145 | `9a8e91d19e89` | `065840dfba12` | anc=1/rev=1; prior **is** shallow boundary; parent `b9be3ec5` missing in audit | current tip missing in donor               | tips both visible; still anc=1/rev=1; prior `rev-list --count=1` on audit (shallow marker) | **incomplete_graph_unknown** — label **「当前联合对象图下非祖先」**; **not** 「历史无共同祖先」 |

Machine-readable: `p1-dag-break-evidence-closure-2026-10-31.json`, `p1-dag-break-graph-closure-raw-2026-10-31.json`.

### Seq145 detail (required language)

- Both SHAs exist under joint alternate view (audit objects + donor objects).
- `merge-base --is-ancestor` both ways exit **1**; `merge-base` empty.
- Audit shallow boundary **is** the prior tip; declared parent `b9be3ec588e9…` absent in audit-only, present in donor; with alternate, parent object readable but **shallow marker still truncates** `rev-list` of prior to count=1.
- Therefore truncation is **not** ruled out. Do **not** claim historical absence of a merge-base.

## Authoritative current classification

**唯一当前有效分类表**：`p1-current-classification-2026-10-31.json`
（`p1-reclassification-summary.json` 仅保留 HISTORICAL donor_primary 快照；勿把其顶层旧字段当现行口径。）

## Count口径 (141＋5＝146 → 调整视图 145＋1)

- **146** = `delivery:ledger:audit` **ERROR regression** adjacency findings on the audited ledger tip (`#172` `d189e74f`), **not** all adjacent ledger pairs.
- Ledger data rows ≈ **149**; adjacent pairs ≈ **148**; ERROR regressions = **146**.
- `regressionAcknowledged` seqs on ledger: **3, 4, 11, 17, 18, 47, 95** (7). **Zero overlap** with the 146 ERROR set — acknowledged rows were already excluded from ERROR output.
- Published `#173` split **141 forward-only + 5 proven_dag_break** was the **HISTORICAL** donor_primary pass over those same 146 ERROR rows (not current adjudication).
- After this closure of the five: **52/100/121/140 → forward-only**; **145 → incomplete_graph_unknown**; **proven_dag_break among those five = 0**.
- **当前口径（原 146）**：**145** 条正向祖先证据 + **1** 条图不完整未知（seq145）。推导：原 141 FO（本轮未重遍历）+ 本轮闭合 4 条 FO = 145 FO；seq145 = incomplete_graph_unknown。**完整 146 条本轮未重新遍历。**
- 用语：用「**当前联合对象图下…**」；**禁止**「联合完整图」/ joint complete graph。audit 与 donor 均为 shallow；截断未排除。
- Historical audit remains **fail-closed**. No acknowledge written to greenwash.

## Recovery counts（三项必须区分，禁止混写）

| 项                                                 |    数量 | 来源                                                                                                     |
| -------------------------------------------------- | ------: | -------------------------------------------------------------------------------------------------------- |
| 恢复 tip **对象/清单**（inventory）                | **137** | `p1-donor-provenance-2026-10-31.json` · `recovered_tips_into_audit_refs_count`；对象现均 `cat-file` 可读 |
| `recovered-shas.txt` **行数**                      | **137** | 同目录清单文件                                                                                           |
| 捕获时仍存在的 `refs/audit-recovery/*` **refs 数** |   **5** | `p1-dag-break-graph-closure-raw-2026-10-31.json` → `provenance.audit.audit_recovery_ref_count`           |

**不得**把 refs=5（或误写 0）写成「恢复 tip = 0」，也不得把 inventory=137 说成「当前仍有 137 条 recovery refs」。

## Donor provenance (preserved)

See `p1-donor-provenance-2026-10-31.json`（已补 `recovery_counts` 三分项）。

- Donor remotes include `origin=https://github.com/upbeyond/openbot.git`, `fork=https://github.com/gmood2008/openbot.git` (plus local wt remote).
- Donor HEAD at capture: `0c22e4837dc4179b02dd0b30f424c535d8cd9284`.
- Donor **is_shallow=true** with 6 shallow boundaries.
- GitHub `422` / `not our ref` on tip fetch = **current fetch path unavailable**, **not** proof of forgery or permanent loss.

## Boundaries

- Did not modify `releases.jsonl` / `regressionAcknowledged`.
- Did not merge, DIGEST, deploy, run A3, or continue #174/#175 work this turn.
- Codex accepts; no self-PASS.
