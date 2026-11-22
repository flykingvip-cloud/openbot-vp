# C1 — Original intent of the seq 151 tip pin

Baseline: `origin/main` `a78c5b66959dac3db4ecb2ecd2065aaec029b3c3` (2026-11-16).
No ledger write was made for this review.

## What the pin actually was

`scripts/delivery/ledger.test.ts` contained:

```ts
it("production releases.jsonl Path B SoT reaches seq151 tip d37bed5117d6", () => {
  expect(Math.max(...rows.map((r) => r.seq))).toBe(151);
  // #172 closed seq 127 liveTo with successor-StartedAt attestation; sole open tip is seq 151.
  expect(rows.filter((r) => r.liveTo === undefined).map((r) => r.seq)).toEqual([151]);
  // ...
  expect(rows.find((r) => r.seq === 151)?.liveTo).toBeUndefined();
});
```

Git history shows this was **a moving snapshot of the then-current tip**, not a
permanent ceiling on the Path B SoT:

| When                                      | Commit                                                                               | What the test pinned                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| #76 `dd129a28`                            | Restore Path B `releases.jsonl` as openbot-vp machine SoT                            | max seq **144**, dual-open `[127, 144]`, `open-interval` expected             |
| `c3a40259` (#89 era)                      | Tip advanced                                                                         | max seq **145**, dual-open `[127, 145]`                                       |
| `6fc389f8` / `38686dc1` / #176 `282c2635` | After [#172](https://github.com/flykingvip-cloud/openbot-vp/pull/172) closed seq 127 | max seq **151**, **sole** open tip `[151]`, `open-interval` must be **false** |

#172's own intent (commit `f79e3e2a`, 2026-11-01 08:07 CST Asia/Shanghai) was
narrower than "freeze the tip at 151":

- Close the dual-open interval by setting seq 127 `liveTo` to seq 128 `liveFrom`
  (`2026-10-14T16:31:38Z`) with an explicit **successor-StartedAt** attestation
  (host FinishedAt unrecoverable).
- Regenerate the human L3 / generated identity from the **then-current**
  ledger tip (seq 151 / `d37bed5117d6`).
- Document ERROR classification; do **not** bulk-acknowledge regressions.

#176 then aligned the audit tests to that single open tip. The unique-open-tip
and successor-close rules are the durable invariants. The number 151 was only
the tip at the moment those PRs landed.

## Why the pin went stale

Later approved ledger writes advanced the tip without updating the snapshot:

| seq     | Commit / PR                                | Tip SHA prefix                                                                                   |
| ------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 152     | `fde7444f` #194                            | `d42fbc3ca2b4` — this close set seq 151 `liveTo` = seq 152 `liveFrom` `2026-11-01T23:04:06.294Z` |
| 153     | `56c7a5ca` #203                            | `e037fed74758`                                                                                   |
| 154     | `10b9f044` #208                            | `a17b60872cb6`                                                                                   |
| 155–164 | #221, #227, #229, and later ledger commits | see `releases.jsonl`                                                                             |
| 165     | `322db390` #267                            | `342de3076099` (current ledger open tip)                                                         |

`RELEASE_RECORD.md` was last generated at seq 154 (see C3). The unit test was
left at 151. Rewriting the pin to `toBe(165)` would only reproduce the same
staleness on the next legitimate cutover.

## What this PR changes

The production-ledger test is split:

1. **Structural invariants** (read the current ledger, no frozen tip number):
   unique seqs, only the documented 110/111 gap, exactly one open interval,
   that open row is the maximum seq, no `open-interval` finding, and
   successor-close (`pred.liveTo === next.liveFrom`) from seq 103 onward
   (after the documented 2026-09-28 holes at seq 99–102).
2. **Historical fixtures** for the #172 / seq 151 era, which still matter:
   seq 127 `liveTo` = seq 128 `liveFrom` = `2026-10-14T16:31:38Z`; seq 151
   identity `d37bed5117d6969e5ad0ee47b32e4efa8b6d715a` / digest
   `sha256:09c9b4c0…`; seq 151 `liveTo` = seq 152 `liveFrom` =
   `2026-11-01T23:04:06.294Z`; plus the previously recorded liveTo /
   liveVerified pins for earlier rows.

The test still does **not** require `audit.ok`. Missing historical objects
remain `delivery:ledger:audit` errors. That guard is not weakened.
