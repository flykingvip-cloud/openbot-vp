# M3 Acceptance: Second-Batch Enterprise Operational Identity Providers

Date: 2026-06-29
Session: `019f12e0-ddf4-7751-9ab4-ab663e8c36ed`
Agent: `codex-oig`

## Scope

This acceptance pass checks M3 from
`docs/design/openbot-enterprise-operational-identity-v1-work-breakdown-2026-06-06.md`:

- Add the second-batch provider adapter contract.
- Add explicit operational action allowlists for GitHub Org, Jira, and Notion.
- Define the boundary between WeChat official/channel publishing actions and data-sync actions.
- Keep the M1/M2 identity governance invariants intact.

## Verdict

Status: accepted.

- The provider adapter contract exists under `src/gateway/enterprise-operational-identity-providers/` and exposes rollout tier, registration readiness, operational actions, data-sync actions, reauthorization hints, and degraded hints.
- The second-batch provider catalog includes `wechat-official`, `wechat-channels`, `github-org`, `jira`, and `notion`.
- GitHub Org, Jira, and Notion expose explicit operational action allowlists only.
- WeChat official/channel providers separate publish operations from data-sync operations; data-sync actions are rejected by `IdentityUsagePolicy` validation and must be represented through DataSource binding semantics.
- Unsupported or misleading connectors degrade explicitly: personal `wechat` is rejected with a user-facing message instead of being treated as an official account.
- New providers reuse the same identity model (`credentialBindingId`) and the same Seat-first policy/audit chain; no provider adds a third credential field set or bypasses Seat authority.

## Verification Commands

- `pnpm exec vitest run src/gateway/enterprise-operational-identity-providers.test.ts src/gateway/enterprise-operational-identity.test.ts src/gateway/enterprise-operational-identity-access.test.ts`
  - Result: 3 files passed, 18 tests passed.
- `pnpm exec vitest run ui/src/ui/ports/enterprise/views/enterprise-surfaces.browser.test.ts -t "enterprise operational identity settings section"`
  - Result: 1 file passed, 1 test passed, 60 unrelated tests skipped by filter.

## Notes

- This pass did not edit runtime/UI implementation files.
- The working tree still contains unrelated WIP from other task streams; this report is scoped to `operational-identity-governance`.
