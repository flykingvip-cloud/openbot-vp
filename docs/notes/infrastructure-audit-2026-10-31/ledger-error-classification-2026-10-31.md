# Ledger audit ERROR/warn classification — 2026-10-31 Asia/Shanghai

Context: `pnpm delivery:ledger:audit` exit **30** on tip including seq 151.
Independent LIVE re-check this turn (SSH `root@8.217.93.71`): `build-info.commit` =
`d37bed5117d6969e5ad0ee47b32e4efa8b6d715a`, OCI revision same, digest
`sha256:09c9b4c0db843c8b977f21cc0e5fb78c43ab408dbd633cda9e41573756442c48`, healthz 200.
**Current identity alignment ≠ ledger audit pass.**

Audit rule: `scripts/delivery/ledger.ts` marks `regression` when prior row’s shipped SHA
is not `git merge-base --is-ancestor` of the next row’s shipped SHA (`isForwardOnly`).
Missing objects → code ≠ 0 → **ERROR**, same as a real non-ancestor.

## Counts (this worktree after deepen; still shallow-ish / incomplete object graph)

| severity | code          |   n | Class                                                          |
| -------- | ------------- | --: | -------------------------------------------------------------- |
| ERROR    | open-interval |   1 | **Interval integrity** — seq 127 and 151 both omit `liveTo`    |
| ERROR    | regression    | 146 | split below                                                    |
| warn     | regression    |  11 | **Acknowledged historical** (`regressionAcknowledged` set)     |
| warn     | overlay-debt  |  15 | **Overlay** — scoped-UI rows owing full-dist rebase            |
| warn     | timeline-gap  |   9 | **Timeline** — holes / unclosed predecessor (includes seq 127) |
| warn     | missing-tag   |   1 | **Missing tag** — seq 1                                        |

## ERROR regression split (evidence)

Local classifier (`git cat-file` + `merge-base --is-ancestor`) on each ERROR regression:

| Subclass                        |   n | Meaning                                                                                                              | Treat as                                                                                                                                  |
| ------------------------------- | --: | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| object-missing (clone-relative) | 145 | Prior and/or current SHA **not in the audit clone** used for bulk classify (may exist in a deeper clone / elsewhere) | **Inconclusive in that clone** — cannot prove content rollback; **must not** auto-`regressionAcknowledged`; restore objects then re-audit |
| true-non-ancestor               |   1 | Both objects present locally; prior ∉ ancestors(current)                                                             | **Proven ancestry break** at seq **145** (`9a8e91d19e89` ↛ `065840dfba12`)                                                                |

### Seq 145 (only proven non-ancestor with local objects)

- Prior LIVE seq 144 tip `9a8e91d19e893fc5d963103538cdbd35f315ac30` (reintroduced by #76 ledger restore message).
- Seq 145 tip `065840dfba129475c9c9030c80af07970dcdd084` (`fix(build): clear docker tsc… (#78)`).
- Local: both `commit`; `merge-base --is-ancestor 144→145` **fails**; reverse also fails.
- Independent acceptor re-check (same day): **both seq 144 and seq 145 objects present** in a full-enough local clone; `merge-base --is-ancestor` still returns non-zero → **true ancestry break**. Earlier notes that treated 144 as GitHub-missing were **environment/API-view limited**, not a permanent object absence.
- Ancestry break ≠ proven **functional content** rollback; it is a commit-DAG / SoT discontinuity class.
- **No** `regressionAcknowledged` on seq 145.
- Class: **history / SoT discontinuity** after ledger restore — needs owner narrative + optional acknowledge; **not** auto-fixable by inventing ancestry.

### Object-missing / inconclusive majority (≈145 in the audit clone used for bulk classify)

Many earlier Path B tips (including seq 127/128 tips `5ea7e2b7…`, `0024d162…` in that clone) were absent from the object store used for bulk classification → audit marks ERROR the same as true non-ancestor. **Do not auto-acknowledge** these rows. Restoring objects may reclassify some as forward-only or as additional proven breaks; until then historical audit stays fail (exit 30).

**Do not** bulk-write `regressionAcknowledged` without per-row evidence.

## Interval error — seq 127 (priority fix)

| Fact                                                                                    | Evidence                                                                 |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| seq 127 omits `liveTo`                                                                  | `releases.jsonl` row                                                     |
| seq 128 follows with `liveFrom` `2026-10-14T16:31:38Z`                                  | same file; evidence text quotes HK StartedAt `2026-10-15 00:31:38 +0800` |
| seq 128 notes name rollback `openbot-gateway-rc-prev-5ea7e2b7bd33-safety`               | ledger notes                                                             |
| That safety container / image **absent** on HK today                                    | `podman ps -a` / `podman images` 2026-10-31                              |
| Host `/root/openbot-cutover-history.log` stops ~seq 86–92; **no** 5ea7e2/0024d162 lines | grep on host                                                             |
| `journalctl` retention begins `2026-10-31`                                              | no Oct 14 events                                                         |

**Conclusion:** host **FinishedAt for seq 127 is not independently recoverable** now. Closing must not pretend a container inspect was read. Path B writer convention (`closeLiveInterval` / README) closes prior `liveTo` at **successor cutover `liveFrom`**. Proposed close value = seq 128 `liveFrom`, with an explicit attestation that the clock source is **successor StartedAt in ledger evidence**, not host FinishedAt.

## RELEASE_RECORD drift

Pre-fix: `deploy/production/RELEASE_RECORD.md` L3 still claimed seq **107** / `bb72d034…` while machine tip is seq **151** / `d37bed5117d6`.

This PR applies a **one-shot static sync** of L3 / latest cutover pointer from the JSONL tip (seq 151 / `d37bed5117d6`). That is **not** continuous generation and **not** an anti-drift gate. Follow-up: generator and/or consistency check so human view cannot silently lag the next LIVE row again.

## Operational posture

Pause advancing **new** cutovers under a “delivery gate green” claim until open-interval is fixed and regression classes are either object-restored or explicitly acknowledged. **Do not** stop healthy LIVE service.
