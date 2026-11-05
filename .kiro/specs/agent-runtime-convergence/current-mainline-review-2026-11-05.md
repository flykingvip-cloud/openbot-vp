# Runtime mainline review, 2026-11-05

Owner: codex-runtime-manager. Scope: source and local regression; production cutover remains deferred.

## Verified current flow

1. Existing ingress prepares session and authenticated identity.
2. runPreparedReply assembles shared context (scope authorization, identity, user profile, history, knowledge, memory and skills). Depth classification currently applies only to selected session kinds.
3. Unified handleInteraction handles control, board queries, dialogue relation, amendment and queue disposition.
4. Occupied-session ordinary dialogue uses isolated tools-disabled model response; other requests can reach runAdmittedTurn.
5. Admitted turn handles commercial authorization, model fallback, retry and accounting. Existing embedded runner still owns mixed bootstrap/preflight/model/tool behavior.
6. Delivery facade prepares output and confirmed receipts; task closure retains binding/acceptance/delivery fences.

This is not yet a complete independent interaction model service: idle dialogue still reaches task entry; isolated dialogue still uses the embedded model/tool substrate. Do not describe disableTools as proof of taskless inference.

## Changes and retired conflicts

- f2e70e4c5 removes active-turn and mid-task-aside compatibility adapters after consumer audit. Tests now use actual interaction binding; intent/source archive records the recoverable source commit.
- Isolated dialogue now inherits already-authorized shared system material, skills, context scope references, auth profile and canonical identity. Existing untrusted user-body history placement, sidecar persistence and cancellation are retained.
- Retired automatic chat bootstrap clearing: conversation does not mean identity/memory may disappear. Existing explicit bootstrap modes are still respected.
- Retired automatic empty chat skill filter and disabled learning recall: relevant context remains available; action-required mandatory skills are still not forced into conversation.
- Retired selected-knowledge-to-action-tools coupling: authorized prefetch may supply knowledge without enabling tools. Read/retrieve and execution authorization remain distinct.
- Architecture manifest forbids imports of retired interaction entry modules from all source paths. No executable archive, configuration script or legacy fallback was added.

## Acceptance and remaining sequence

Context forwarding red/green: old implementation 1 FAIL / 16 PASS; repaired implementation 17 PASS. Context/action-boundary red/green: old implementation 4 FAIL / 26 PASS; revised context suite 31 PASS; related four suites 42 PASS. Configured reply E2E 47 PASS. Typecheck remains 44 pre-existing diagnostics; build succeeds with 209 existing dynamic-import warnings.

P0 remains: shared governed inference boundary must preserve authorization/accounting without task-state ownership; interaction should answer or emit an explicit execution request; only execution requests may start task attempts/preflight/recovery. Do not globally promote regex default_chat to an accepted taskless response or route all knowledge questions through a tools-disabled lane before coverage exists. Individual and collaboration authorization/history domains must remain distinct.

After that: finish command/state and wiring convergence, job/attempt-bound recovery and final delivery; capability contracts and pre-tool constraint gates; full Builder lifecycle; evidence-backed extension disposition; artifact lifecycle and quality; final same-version individual/collaboration/model/channel acceptance. Old extension paths need consumer and persisted-asset evidence before retirement. No new runtime is enabled and no whole-migration completion is claimed.
