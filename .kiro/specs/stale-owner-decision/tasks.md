# Historical owner decision replay

## Agents

- codex-kb-review · role: owner · scope: independent review, integration and deployment · paths: ui/src/ui/chat/owner-decision-card*, src/gateway/collaboration-learning/owner-decision-delivery*, src/gateway/collaboration-learning/claim-contract-entry.ts, .kiro/specs/stale-owner-decision/** · since: 2026-11-23

- codex-kb-implement · role: contributor · scope: stale card replay, delivery reconciliation and audit archive helper · paths: ui/src/ui/chat/owner-decision-card*, src/gateway/collaboration-learning/owner-decision-delivery*, src/gateway/collaboration-learning/claim-contract-entry.ts · since: 2026-11-23

- [x] Fresh main baseline checked before edits. — codex-kb-implement
- [x] Root cause: recovery list kept each historical todolist/version delivery as replay material, checked plan readability but did not reconcile live status/version. Trusted auth/locator was not forwarded to the same canonical store. Version refusal was an in-memory UI set lost on reload, and stale/superseded collapse helper explicitly preserved stale cards. — codex-kb-implement
- [x] Recovery list now derives replay eligibility from authorized current plan. Obsolete versions/superseded plans become stale skipped rows with no redraw card; processed human confirmations become consumed with no redraw card. Valid new proposed plans and peer-confirmed current receipts remain intact. Trusted group locator/auth/store flows to plan reads. — codex-kb-implement
- [x] A proven obsolete decision now gets a persistent presentation dismissal. This changes no confirmation, task or transcript state. Superseded lifecycle collapses even when peer flags exist. — codex-kb-implement
- [x] Explicit append-only archiveInvalidOwnerDecisionDeliveries helper with dryRun + caller-provided authorized plan reader. Tests preserve original log, append one tombstone and append zero on subsequent runs. No automatic archive on read or implicit plan confirmation. — codex-kb-implement
- [x] 40 tests passed: UI 27, delivery 6, existing ACL/RPC 7. /tmp/stale-card-tests.log. — codex-kb-implement

Types: /tmp/stale-card-types.log. Type-aware lint: /tmp/stale-card-lint.log.

## Read-only audit

Canonical group runtime delivery log has 29 latest (todolistId,version) keys. At final inspection the F4 old plan 0865aa6b-1de2-4d99-8861-23d0ff303abb v1 already had skipped delivery and superseded plan; current ce979bfd-67b9-40b1-a8bd-eafd5c51873c v2 had confirmation_consumed and confirmed plan. Runtime cleanup is root-owned; contributor made no live data writes or approvals. Chat正文 and plan history remain audit records. — codex-kb-implement

Independent acceptance: 33 UI/delivery tests passed; root reviewed trusted locator forwarding, current plan reconciliation and preservation of valid proposed/peer cards. — codex-kb-review
