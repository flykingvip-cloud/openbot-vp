# Collaboration self-run blockers — platform Mode B (2026-10-15)

## Universality

| Blocker                                                                                                      | Scope                      | Platform fix                                                 |
| ------------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------ |
| Stale/smoke `applied` items steal self-advance lead; `blockBoardItem` cannot clear published/claimed/applied | **Any group**              | `cancelBoardItem` + active-set ranking                       |
| `ROUND_COMPLETE` + `humanStartsNewRound` → silence                                                           | **Any group with that L2** | `continueAfterRoundComplete` (default OFF, scoped allowlist) |
| RPC S3 schema lag                                                                                            | **Any stale dist**         | Rebuild tip on #748+ (no code in this PR)                    |

## Guarantees

- Group-agnostic (no hard-coded gray group ids in logic)
- Flags default OFF; gray via scoped `tenantId/groupId` allowlist
- No LIVE / Floor live / global claim|wake|challenge true
- Inventory-first continue: no auto-publish of board drafts

## Follow-up 2026-10-16 — published inventory + claim-first

| Blocker                                                                             | Scope                    | Platform fix                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| `continueAfterRoundComplete` → `no_active_board_inventory` while `published` exists | **Any group**            | Mode B inventory includes `published\|claimed\|applied\|in_progress\|returned` |
| Mode B lead ignores unclaimed `published` intended claimants                        | **Any group**            | `ACTIVE_OWNER_STATUSES` includes `published`                                   |
| Wake ledger alone never claims                                                      | **Any Mode B gray path** | `tryClaimPublishedInventoryLead` on continue + trySelfAdvance execute          |
| Exact-string intendedClaimantIds reject case variants                               | **Any group**            | `isIntendedClaimantId` normalized match                                        |

Delivery self-advance active set stays `applied\|in_progress`. Terminals `accepted\|cancelled\|blocked` and `submitted_for_review` stay out of continue inventory. No LIVE/Floor / hard-coded team agent ids / default-on flags.
