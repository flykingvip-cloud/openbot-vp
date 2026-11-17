# C3 — Proposed RELEASE_RECORD correction (proposal only)

This is a **human-readable proposal**. This PR does **not** run
`pnpm delivery:release-record:generate --write`, does **not** edit
`deploy/production/RELEASE_RECORD.md`, and does **not** backfill
`deploy/production/releases.jsonl`.

## Current drift

`pnpm delivery:release-record:check` on `origin/main`
`a78c5b66959dac3db4ecb2ecd2065aaec029b3c3` exits **20**. The generated
block (the only surface the check compares) still describes seq **154**
as the open tip; the machine ledger's unique open tip is seq **165**.

| Field | RELEASE_RECORD generated block (stale) | Ledger open tip (seq 165) |
| --- | --- | --- |
| seq | 154 | 165 |
| gatewaySha / uiSha | `a17b60872cb62122449a170a24b2f4e150cf9557` | `342de3076099e23004944916422f42d2d44ea186` |
| artifactDigest | `sha256:32b20f638067923bb21fdfede7130a34c6199042fc77dee07271436429f6a54e` | `sha256:c0234ea2c8908e4068fd26004ac24b8b4945cf032bd097537fbc1df0e707845b` |
| imageTag / artifactId | `rc-amd64-provenance-a17b60872cb6` | `rc-amd64-provenance-342de3076099` |
| tag | `provenance/sha-a17b60872cb6` | `provenance/sha-342de3076099` |
| liveFrom | `2026-11-02T05:24:45.706Z` | `2026-11-09T23:59:48.486Z` |
| liveTo | _(open)_ — **incorrect**: seq 154 is closed | _(open)_ — correct for seq 165 |
| liveVerified | `true` | `true` |

Seq 154 was closed in the ledger at seq 155 `liveFrom`
`2026-11-02T06:12:06.377Z`. Intermediate LIVE rows seq **155–164** are in
the ledger and are not reflected in the generated block. That is document
lag, not a missing ledger write in this review.

`delivery:release-record:generate --write` would update **only** the
marked generated block (`<!-- BEGIN GENERATED: current-identity -->` …
`<!-- END GENERATED: current-identity -->`). Prefix and suffix of
`RELEASE_RECORD.md` stay intact (verified by running generate in memory
on 2026-11-16; no file write). The exact block diff is
[c3-generated-block-proposed.diff](c3-generated-block-proposed.diff).

## What generate will not fix

The narrative heading immediately after the generated block is still:

`## Latest cutover (machine ledger) — seq 151 / d37bed5117d6 Path B`

That sentence is outside the markers, so a generate --write will leave it
stale. If the owner approves a documentation sync, that heading should be
moved to a historical section in a **separate** narrative edit, still
without treating any unrecorded LIVE as already approved.

## Do not retarget the record at today's unrecorded LIVE

For context only, already recorded elsewhere: today's running gateway
bundled SHA `8a686145c33f8c7e1d776a5aca2502d9091f11b0`, image digest
`sha256:e7babfa174f3a98762ed7b43ea7af932e8ddb0a5c6155522eb19856c5eadc61b`,
StartedAt 2026-11-16 07:16:25 CST (Asia/Shanghai), classified
**已发布未记账** relative to ledger tip seq 165.

That identity is **not** an approved cutover and **must not** be written
into `RELEASE_RECORD.md` or `releases.jsonl` as a retroactive go-live.
The correction proposed here is only: generated block ← **existing
ledger open tip seq 165**. Reconciling the running container to a new
ledger row is a later, separately approved Path B record.

## Recommended approval step (not done here)

After review, the owner may run `pnpm delivery:release-record:generate --write`
on a branch that is otherwise identical to a freshly fetched `origin/main`
plus this review, then re-run `pnpm delivery:release-record:check` and
expect exit 0 for ledger ↔ generated-block consistency. That check still
does **not** prove the running container identity.
