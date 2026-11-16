# C2 — Missing-object classification and restore / archival-proof plan

Recorded 2026-11-16 19:33 CST (Asia/Shanghai) on a **full** auditor clone
(worktree `/workspace/openbot-vp-gate-debt`, shared object store with
`/workspace/openbot-vp-enablement-audit`).

`git fetch origin` (all advertised refs, no prune, no rewrite of the review
branch) was completed before `git cat-file`. Individual SHA probes used
`git fetch --no-tags origin <sha>:refs/ledger-object-probe/<sha>` and did
**not** create surviving refs (all probes failed; 0 probe refs remain). The
ledger file was not written.

## This is not a shallow-clone artifact

| Fact | Value |
| --- | --- |
| `git rev-parse --is-shallow-repository` | `false` |
| `.git/shallow` | absent |
| `git rev-list --count HEAD` (`origin/main` `a78c5b66959dac3db4ecb2ecd2065aaec029b3c3`) | 422 |
| `git rev-list --all --count` after `git fetch origin` | 2124 |
| Remote-tracking branches | 205 |
| Tags on `origin` (`git ls-remote --tags origin`) | **0**, including **0** `provenance/sha-*` tags |

Checkout depth is therefore not the reason objects are missing. The remaining
explanations are: the SHA is not on any advertised ref of this GitHub remote,
or it was never in this GitHub object graph (history rewrite / force-push /
objects that lived only in a local donor).

## Classification (this GitHub remote, full clone)

Unique ledger SHAs: **159**. Machine-readable snapshot:
[c2-classification-summary.json](c2-classification-summary.json),
[c2-missing-object-classification.jsonl](c2-missing-object-classification.jsonl).

| Class | Unique SHAs | Meaning |
| --- | ---: | --- |
| `present-in-this-github-object-graph` | 21 | `git cat-file` succeeds after fetching all origin refs. Rows **seq 145–165**. Confirmed by GitHub commits API HTTP 200 for samples `065840dfba12`, `d37bed5117d6`, `342de3076099`. |
| `absent-from-this-github-remote` | 138 | Missing locally, and `git fetch origin <sha>` returns `fatal: remote error: upload-pack: not our ref`. GitHub commits API HTTP **422** for samples `9a8e91d19e893fc5d963103538cdbd35f315ac30` (seq 144) and `1e1143012db2276329ee0357ee78b51b7a89f41f`. |
| fetchable-by-SHA but unadvertised | 0 | No dangling SHA on this remote was fetchable by id. |
| probe-inconclusive | 0 | — |

Rows with both gateway and UI SHAs present: 21 (seq 145–165).
Rows with at least one SHA absent from this remote: 142 (seq 1–144, excluding
the documented 110/111 gap).

`pnpm delivery:ledger:audit` on this same full clone still exits **30** with
`ledger: 163 releases, 157 errors, 24 warnings`. All 157 errors are
`missing-object`. Warnings: 15 `overlay-debt`, 8 `timeline-gap`, 1
`missing-tag` (seq 1). The last error is seq 145 vs missing prior seq 144
`9a8e91d19e89`; seq 146–165 do not emit `missing-object` because both sides
are in this GitHub graph. The 157 count is one finding per ancestry check
that cannot be adjudicated (including overlay rows that ship two SHAs),
not 157 unique missing commits. That command remains the fail-closed guard.
This classification explains the errors; it does not clear them.

### Relation to the 2026-10-31 P1 recovery work

The October 31 package (`docs/notes/infrastructure-audit-2026-10-31/`,
especially `p1-object-recovery-reclassification-2026-10-31.md`) recovered
historical tip objects from a **local donor** (`/Users/daniel/AI项目/openbot`)
into `refs/audit-recovery/*` on an auditor machine. Those recovery refs were
**never pushed** to this GitHub remote. The donor itself was also reported
shallow. Today's full GitHub clone therefore still lacks seq 1–144 objects,
including seq 144 `9a8e91d19e89`, which some earlier local clones still had
(it was the shallow boundary in that work). Under **this** GitHub object
graph, seq 145 vs seq 144 is `missing-object` (prior absent), not a proven
DAG break.

Treat the 2026-10-31 "145 forward-only / 1 incomplete_graph_unknown"
adjudication as **donor-local** evidence, not as objects present on GitHub.

## Restore or archival-proof plan (proposal only)

**Do not** delete ledger rows. **Do not** lower `delivery:ledger:audit`.
**Do not** bulk-write `regressionAcknowledged`.

### Path A — restore objects into this GitHub graph (preferred if the donor still exists)

1. Locate the original donor clone and/or any machine that still has
   `refs/audit-recovery/*` or the 137 recovered tips listed in
   `docs/notes/infrastructure-audit-2026-10-31/recovered-shas.txt`.
2. On an isolated clone, `git fetch <donor> <sha>:refs/backup/ledger-objects/<sha>`
   for each SHA classified `absent-from-this-github-remote`. Do not rewrite
   `main`. Do not GC. Do not change commit contents.
3. After owner approval, **push only** the `refs/backup/ledger-objects/*`
   (or a single `backup/ledger-historical-objects-<date>` ref that reaches
   them) to `origin`, so the objects become part of this GitHub object
   graph without being cutover sources.
4. Re-run `node --import tsx scripts/delivery/classify-ledger-objects.ts --probe-origin` and
   `pnpm delivery:ledger:audit` on a fresh full clone. Expect many
   `missing-object` errors to disappear. Any remaining
   `incomplete-graph` or `regression` findings need **per-row**
   adjudication. Still no bulk acknowledge.

### Path B — archival proof if the donor is gone

If no donor still holds the objects, the following together are proof that
the SHAs are **absent from this GitHub remote**, not proof the historical
cutovers never happened:

- the append-only ledger rows (seq, SHAs, digests, liveFrom/liveTo, evidence text);
- the 2026-10-31 inventory and donor notes, including `missing-object-inventory.jsonl`
  and `recovered-shas.txt`;
- this 2026-11-16 full-clone `cat-file` miss after fetching every advertised origin ref;
- origin fetch `upload-pack: not our ref` for all 138 missing SHAs;
- GitHub commits API HTTP 422 for sampled missing SHAs;
- zero tags, including zero `provenance/sha-*` tags, on `origin`.

Owner may later approve a separate archival-attestation class or a backup
remote. Until then the guard stays fail-closed (exit 30).

### What this PR adds in-tree

`node --import tsx scripts/delivery/classify-ledger-objects.ts`
is a report tool:

- default: classify against the current object store and report
  `is-shallow` so a truncated clone is not called proven remote absence;
- `--probe-origin`: optionally fetch-by-SHA and distinguish
  `absent-from-probed-remote` vs `fetchable-by-sha-from-probed-remote`;
- `--output` writes JSONL;
- exit 0 on a successful report even when objects are missing;
- never writes `releases.jsonl`.

It is **not** wired as a replacement for `delivery:ledger:audit`.
