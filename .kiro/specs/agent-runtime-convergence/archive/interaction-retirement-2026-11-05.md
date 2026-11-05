# Interaction retirement record

Owner: codex-runtime-manager. Source snapshot: d2593caf9. Archived intent and source are recoverable with git show; no executable archive is imported or discovered at runtime.

| Retired entry | Original intent | Consumer audit | Replacement | Disposition |
| --- | --- | --- | --- | --- |
| src/agent-runtime/command/active-turn.ts | Compatibility export for the earlier busy-turn facade | No source imports or dynamic import references | command/index -> handleInteraction | Removed; no legacy fallback |
| src/auto-reply/reply/mid-task-aside.ts | Task query projection and old aside result vocabulary | Only two test suites; no production consumer | command dialogue-intent with fixed wiring rule bindings | Removed; assertions migrated to the actual public interaction behavior |
| Old aside-label routing | Keep ordinary recall separate from amendments | Removed in d2593caf9 | Shared semantic task relation | Historical intent retained; labels cannot override task changes |

The response lane is NOT retired: parent session lock isolation, cancellation registration before prepare, untrusted user-body history, stable message identity, and final-run separation remain necessary. Its existing prepared shared context, skill snapshot, authenticated identity and knowledge lineage must reach the same embedded model boundary; no new context retrieval or weaker source authorization is introduced.

Evidence: context forwarding test fails before fix (1 FAIL / 16 PASS) and passes after fix (17 PASS). Four affected suites pass 34 tests. Read-only repository searches find no imports of either retired module. Storage formats and historical sidecar names remain compatible.

Remaining architectural gaps are explicit: idle conversation still enters task orchestration; depth classification is scoped to selected sessions; context lane rules currently conflate capability restriction and optional context reduction; actual whole-runtime acceptance and deployment are not complete. Do not enable an alternate runtime or claim full cutover from this checkpoint.
