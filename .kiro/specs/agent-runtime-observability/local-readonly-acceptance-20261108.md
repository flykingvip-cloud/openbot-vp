# Local read-only executor observation acceptance

Agent: codex-observe-owner

## Delivered commits

- 5c8e9b533: governed metadata reasoning resolver, zero-tool transport, query integration, accounting and bounded cleanup.
- 9bc789846: gateway startup composition and paired state public exports.
- 94464bb82: legacy URL-encoded outcome path compatibility, without migration.

## Real local data

User authorized existing local data reads only; no paid inference or configuration change.
Eight configured agents, 223 current outcome files: initially 218 readable; five legacy long filenames missed the hash-path lookup. A regression failed before the read-only compatibility fix and passed after it. Final run read 223/223 successfully. All 223 remained outcome_only; technical evidence and provenance were unknown. No executor-evidence directory existed for these configured stores; zero model calls or associations were available. These records must not be promoted to fully_linked or labelled live merely because they exist on disk.

Content fingerprints across 13,638 source files matched before and after the final read. No source records were changed. The verification invoked the internal read projection with each stored scope identity; it does not prove gateway membership authentication.

## Checks actually run

- Governed resolver/pass/gateway/metadata/query composition and governance contract: 6 files, 127 passed.
- Real isolated WebSocket gateway: 2 passed, using actual ResultService disk writes and test identity ports; injected provenance, not production validation.
- Paired public entry acceptance: 3 files, 6 passed, including the WebSocket tests and query composition.
- Legacy reader, query gateway and executor technical projection after the fix: 3 files, 37 passed.
- Changed-file type-aware lint and format passed.
- Full TypeScript check passed before the legacy reader fix; latest retry was blocked by concurrent embedded-run-attempt/auth/result edits with syntax errors. No claim of current full-tree green.
- Full build including UI passed before the legacy reader fix. Existing ineffective dynamic import warnings were emitted for unrelated sandbox/collaboration modules; pinned Control UI sync was skipped. No later full build or browser rerun after the reader-only fix.

## Contract and limits

Existing diagnosis.observation.query retains explicit agentId/taskId/outcomeVersion/from/to and fresh ACL checks. Reasoning requires explicit request and OPENBOT_OBSERVATION_REASONING=1; default remains closed. Its output is hypotheses/suggestions, never task judgement or confirmed diagnosis. Admission, routing, credentials, accounting and lease release reuse the existing governed host. Late usage reconciliation remains process-only, not a durable billing ledger.

Read-only legacy fallback is used only if the modern tip is absent, with the corresponding legacy version path. Modern tips never pair with stale legacy versions. No database or event migration.

Rollback: revert 94464bb82, 9bc789846 and 5c8e9b533 in reverse order after preserving later dependent changes. Reverting code does not remove evidence already written by other runs.

No real provider invocation, production authentication verification, production switch activation, restart, deployment, push, PR or automatic improvement was performed. Starting future evidence collection requires separately authorized runtime activation; historical execution evidence cannot be reconstructed from result records alone.
