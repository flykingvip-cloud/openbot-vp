# Default AI takeover for Account Computer (2026-10-18)

## Product rule
When the user asks the digital human to open 云电脑 / use the account browser, **default control is the agent**. Prompt human takeover only for password, OTP, Secure Form, authorization, or other steps the agent cannot complete alone.

## Bug
`computerPreviewOpenPlan` treated “电脑 tab open + userYielded≠true” as wanting input, so merely selecting 电脑 (or a prior incomplete handoff) called `takeControl` and left the desk in `HUMAN_TAKEOVER`, blocking agent navigate with `human takeover holds the account browser`.

## Fix
1. **UI:** `wantsInput` is only explicit `holding` (接管 / auth handoff). Opening 电脑 alone sends `releaseControl`.
2. **Server:** On account-browser serial claim, if `HUMAN_TAKEOVER` and no `await_return` waiters, `releaseStaleHumanTakeoverForAgent` clears the preview grant + product coordinator, then retries the claim. Active auth handoff waiters still block.

## Claim level (honest draft)
Unit + SAR fixture coverage. Not a live 18789 click drive in this PR. Ops clearance of a stuck desk is separate from this PR.
