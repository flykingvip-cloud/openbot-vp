# DeliveryLane MergePort (Tip C)

## What this is

`lane.requestMerge` re-checks **implementSeal ∧ acceptSeal ∧ matchHead(tipSha)** and only then calls an injectable **MergePort**. The default adapter shells existing `gh pr merge` (squash/merge/rebase) — it does **not** invent a second GitHub client stack.

## What this is not

- **Merge ≠ production cutover.** Landing on `main` via MergePort does not flip `OPENBOT_DELIVERY_LANE_ENABLED` / `gateway.deliveryLane.enabled`, nor any product cutover flag.
- Feature flag remains **default OFF**. When unset, `lane.*` RPCs stay `UNAVAILABLE` (zero behavior change).
- Tip D (cross-bot acceptSeal productization) and Tip E (helper quota / ban personal_subagent acceptSeal) are out of scope here.

## Guard flow

1. Load lane; optional `observedHeadSha` must equal `tipSha` or refuse (drift).
2. `computeMissingKeys` must be empty (dual seals + match-head).
3. Both seals: `PASS` / `REVIEW_PASS`, not invalidated, tipSha bound.
4. `lane.prNumber` required.
5. Invoke `MergePort.merge` **once**.
6. On success → `stage=merged`, record `lastMerge`.

## Merge mode tool policy

When `LaneMode=merge` (after `requestMergeReady`):

| Allow                                      | Deny                                                  |
| ------------------------------------------ | ----------------------------------------------------- |
| `lane.requestMerge` / channel `merge-port` | Raw `git push` / `git merge` / `gh pr merge` via exec |
| Other non-merge tools (unchanged)          | Direct `gh_pr_merge` / `git_merge` tool names         |

`setLaneMode` still refuses `merge` (Tip B); merge mode is entered only via `requestMergeReady`.

## Modules

- `merge-port.ts` — `MergePort` interface, `createGhPrMergePort`, `createRecordingMergePort`
- `merge-request.ts` — `requestMerge`
- `mode-policy.ts` — merge-mode raw-merge deny
