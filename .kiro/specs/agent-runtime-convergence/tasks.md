# Agent Runtime convergence

## Autonomous closure checkpoint

- Observability/UX v2 included in current migration: observability-handoff-v2.md fixes source ownership, identity limits and phased acceptance; collapsible work detail is now migration acceptance support rather than a separate executor. Added frontend metadata-only projectRuntimeObservation adapter; no page integration, persistent event collection, fully-linked qualification or production rollout claimed. — codex-runtime-manager

- Two-difference alignment: decisions and substantive gap ownership fixed in structure-alignment.md. Execution admission DTO moved to contracts/execution; state repository/resume mutation moved with old files removed; all existing repository consumers use state/index and three manifest rules prohibit deep imports. 39 files / 233 PASS; isolated cross-process 7 PASS; first joint race failure retained explicitly, not waived. Build PASS/209 warnings, manifest 44 PASS, tsgo 47 baseline. — codex-runtime-manager

- Current paused-task semantic resume connected through original authenticated Gateway/state/admitted execution (ce8c74977, 259e36364). Two independent specified-path reviews found no confirmed blocker; process-local stop and parked-target selection limits remain explicit. Combined 122 files / 973 PASS; shared builder/source regression 8 files / 48 PASS. Build PASS/209 warnings, architecture 41 PASS, tsgo 47 baseline errors. Current evidence document updated; whole migration/live acceptance still not claimed. — codex-runtime-manager

- Current evidence and remaining gates are consolidated in current-mainline-review-2026-11-06.md. Normal/queued delivery now shares receipt preparation and confirmation (ae945403f), and queued inference uses the shared governed model session (d89442132). Final combined 119 files / 927 PASS; separate receipt tests 23 PASS; build PASS/209 warnings; architecture 41 PASS; tsgo remains 47 baseline diagnostics. Independent queued-delivery review PASS. Whole migration and live acceptance remain open; no deployment. — codex-runtime-manager

- Additional verified checkpoints: mixed questions preserve bound amendments/controls; PPTX edits carry content hashes and reject stale writes; capability before-call implementation has one runtime owner; context compilation and learning projection moved without duplicate implementations; human channel dispatch consumes governed interaction/admission. These are component/source checkpoints, not final real-model acceptance. — codex-runtime-manager
- 35ff9a762 preserves image attachments for vision interaction candidates and explicitly discloses unavailable pixels for text-only candidates. 7f13e7930 retires the eager composer mention executor (automatic argument guessing and direct tool.execute). Mention guidance and optional plugin availability remain in the admitted runner; no automatic action is granted by a mention. Deleted implementation is recoverable in its parent commit. — codex-runtime-manager
- 2282db7b2 binds background process completion notification to the originating task/attempt/constraint snapshot. Actual Node children verify current completion wakes once, while pause/replacement/constraint change cannot wake from the obsolete snapshot. This does not terminate an already-backgrounded child or guarantee restart persistence. — codex-runtime-manager
- Final local combined regression at this checkpoint: 37 files / 192 PASS; background compatibility group 3 files / 12 PASS; separate mention binding/runner forwarding group 3 files / 59 PASS. Build PASS, dynamic-import warnings 209 unchanged; architecture 41 rules PASS; typecheck remains 47 baseline errors. Tests use mocked provider transport except actual local background children. No live-model, production, or complete migration acceptance is claimed. — codex-runtime-manager
- Still mandatory: deterministic enforcement of accepted action restrictions (snapshot freshness alone is insufficient); full capability adapter contracts; managed interaction concurrency; real asynchronous wait/resume/delivery including restart; complete builder lifecycle; extension effective-consumer/asset disposition; quality and artifact reuse chain; final individual/group/channel same-version acceptance. User autonomy authorization does not waive these gates. — codex-runtime-manager

- Owner authorized autonomous remaining migration closure; no deployment until combined acceptance. Tool dispatch now rechecks original task/attempt and captured accepted constraints, including after asynchronous hooks; stale actions are refused before server execution or client delegation. Existing continuation refreshes its constraint snapshot with its rebuilt prompt. No new executor or model call introduced. — codex-runtime-manager
- Completion notices now append through SessionManager with parent identity and an idempotency key; the raw JSONL message append was removed. This protects notice identity, not universal cross-process transcript serialization. — codex-runtime-manager
- Joint eight suites / 89 PASS; before-tool integration E2E 9 PASS; changed-file typed lint clean; architecture 41 rules PASS; tsgo retains 47 existing diagnostics; build PASS with 209 existing dynamic-import warnings. Constraint gate fences stale attempts rather than proving arbitrary natural-language restrictions semantically executable. CLI delegation, mixed intents, remaining capability/context/quality/retirement work remain open. — codex-runtime-manager

## Agents

- codex-runtime-manager · role: owner · scope: integration, M0 acceptance, M1 context extraction · paths: .kiro/specs/agent-runtime-convergence/**, src/agent-runtime/context/**, src/auto-reply/reply/get-reply-run.ts, src/auto-reply/reply/get-reply-run.aside-dialogue-context.test.ts, scripts/architecture/manifest.json · since: 2026-11-03

Registry is authoritative. Contributors below execute delegated bounded changes; only owner commits.

## Checkpoints

- [x] Create isolated branch from fresh main and install dependencies — codex-runtime-manager
- [x] Read-only three-part baseline audit — codex-runtime-manager
- [x] M0 authority, extension disposition and boundary records — codex-runtime-manager
- [x] M1 first checkpoint: equivalent system-material assembly extraction and contract tests — codex-runtime-manager
- [x] Scoped integration tests, diagnostic delta, architecture gate and build (baseline failures recorded below) — codex-runtime-manager
- [x] Independent review and scoped checkpoint commits through aba67ae70 — codex-runtime-manager

## Scope

Preserve source builder evaluation order, prompt content/order/trust, limits, cancellation and existing execution loop. No task schema change, arbitrary executable configuration, new scheduling path or production rollout. No M2+ automatic implementation until M1 acceptance.

## Baseline verification

- Architecture manifest: PASS (12 rules).
- Normal reply aside-context baseline: 1 test PASS.
- Full tsgo baseline: exit 2, 47 TS diagnostics; candidate must add none.
- Full build baseline: PASS, 209 INEFFECTIVE_DYNAMIC_IMPORT warnings; compare candidate delta.
- M1 contributor delivers bounded patch for owner integration; no production rollout. — codex-runtime-manager

## M1 WIP verification

- Pure system selection/append/finalize integrated; untrusted assembly unchanged. — codex-runtime-manager
- Component + normal aside entrance: 4/4 PASS. Other scoped entrance tests: 58 PASS / 2 FAIL; the same two media-only learning-capability assertions fail on untouched HEAD (15 PASS / 2 FAIL). — codex-runtime-manager
- tsgo candidate equals baseline: 47 diagnostics, zero added. Changed-file oxlint clean; architecture 13 rules PASS. Full pnpm check stops at 59 pre-existing formatting failures; changed files formatted separately. — codex-runtime-manager
- Candidate build PASS; dynamic-import warnings 209 vs baseline 209 (zero increase). Independent review found no equivalence blocker. Scoped checkpoint ready; no push/merge/deploy. Registry changes excluded from owner commit because shared-path lander owns it. — codex-runtime-manager

## Deferred follow-up

- [ ] After runtime convergence acceptance: user-facing collapsible action timeline. Project actual execution events into readable actions; separate plan from history; preserve task/aside identity and expose important stop/failure/auth changes. No UI work in M1. — codex-runtime-manager

## Accepted M1 checkpoint

- Owner accepted equivalent system-material assembly checkpoint: 48a49d687; dependency boundary: 595512edd; real normal/collaboration entrance contract: aba67ae70. — codex-runtime-manager
- Entrance suite now 3 PASS; component 3 PASS; other entry regressions unchanged (58 PASS / 2 reproduced baseline FAIL). Full tsgo remains 47 baseline diagnostics, no additions. Build passes, dynamic import warning count unchanged at 209. — codex-runtime-manager
- Limited Loom proxy authorized by user; registration saved in 6f9624819 and 6b643d686, other registrations unchanged. — codex-runtime-manager
- This is only the pure system-material base, not a complete unified context service. Remaining M1 source/trust/budget boundaries require separate review before further extraction. — codex-runtime-manager
- No push, main merge or production deployment. Collapsible action timeline stays deferred until the principal convergence work is accepted. — codex-runtime-manager

## Accepted M1b checkpoint

- Untrusted formatter moved to context with identical bytes; newline normalization moved to shared. Existing source import paths directly re-export the same functions, no duplicate implementations. Commit de88944e2. — codex-runtime-manager
- Four suites / 59 tests PASS; architecture 13 rules PASS; type-aware lint clean; tsgo 47 baseline diagnostics unchanged; build PASS and dynamic import warnings 209 unchanged. — codex-runtime-manager
- Independent reviewer confirmed no new trust decisions, sanitation behavior, task mutation or scheduling. Runtime identity check confirmed both compatibility exports are the same function references. — codex-runtime-manager
- Budget and source builders have NOT been migrated. Next work first records their owners and side effects; no batch move or new general-purpose context engine. — codex-runtime-manager
- Compatibility retirement: get-reply-run already consumes context directly. inbound-text still serves multiple inbound consumers; retain its re-export until those consumers migrate under a dedicated reviewed checkpoint. The legacy untrusted-context re-export is transitional and must not gain logic. — codex-runtime-manager

## M1c in progress

- Source and budget ownership inventories delegated to independent contributors (read-only). — codex-runtime-manager
- Proposed bounded component: existing aside dialogue data contract and character-budget selection, extracted without changing limits or selection semantics. Storage, history merge, trusted/untrusted wrapping and source I/O remain with their existing owners. — codex-runtime-manager

## M1c verification

- Source inventory: context-source-map.md. Budget scope/unit/owner inventory: context-budget-map.md. Both explicitly distinguish I/O, tool execution and audit side effects; not all builders are pure context sources. — codex-runtime-manager
- Aside budget selector/type/constants extracted without changing limits, UTF-16 truncation, newest suffix selection or header accounting; historical storage/merge/wrapping stays in its original module, with same-reference compatibility exports. — codex-runtime-manager
- Four suites: 31 tests PASS after added UTF-16/minimum-budget case; architecture 13 rules PASS; changed-file typed lint clean; full tsgo baseline 47/candidate 47, zero new; build PASS with 209 dynamic import warnings unchanged. — codex-runtime-manager
- Next: review source provider contracts before extracting any mixed-I/O builder; no unified-budget rewrite, new classifier or model invocation. Deferred action timeline remains outside current scope. — codex-runtime-manager

## Deferred builder component standardization

- [ ] After initial boundary migration: inventory the complete builder lifecycle (resolve/read/render/audit), define component contracts and rerun normal/collaboration/recovery/aside/heartbeat scenarios. Preserve existing design invariants and evaluation order; do not fragment cohesive builders for directory aesthetics. — codex-runtime-manager
- [ ] Verify builder inputs/outputs, trust placement, budgets, cancellation, source invocation count and audit/exposure side effects; add regression evidence before any behavior-changing normalization. — codex-runtime-manager

## M1d scope

- Pure collaboration mission rendering only; original adapter retains profile selection and original call timing. No movement of mixed-I/O runtime-context assembly, knowledge, learning or composer execution. Latest main #223 merged before new edits. — codex-runtime-manager

## M1d acceptance

- Cohesive collaboration mission projection extracted as one domain component; original adapter retains resolved-profile selection and call timing. No mixed-I/O builder was moved. Independent review PASS. — codex-runtime-manager
- Baseline runtime-context assembly 12 PASS; candidate component + assembly + normal/aside entrance 17 PASS. Typed lint clean; architecture 13 rules PASS; build PASS with 209 dynamic-import warnings unchanged. — codex-runtime-manager
- Main #223 introduced five additional TS test diagnostics; after temporary restoration of the unchanged source, post-merge baseline 52 equals candidate 52 (zero added). Do not attribute these to this extraction or mix their fixes into runtime scope. — codex-runtime-manager
- Deferred builder standardization and comprehensive retest explicitly remain mandatory follow-up; contract in builder-component-contract.md protects original business invariants and cohesive components. — codex-runtime-manager

## Cross-layer contract checkpoint

- Full migration matrix, core authority contract map and retirement gates recorded. Existing SessionTaskBoard types extracted as type-only contracts; original state owner retains all runtime behavior. — codex-runtime-manager
- State/continue/concurrency regression: 4 suites / 52 PASS. Architecture 14 rules PASS, changed-file typed lint clean; tsgo post-#223 baseline 52/candidate 52, zero new; build PASS and dynamic-import warning count remains 209. — codex-runtime-manager
- This does NOT complete contracts or any business layer. Proposed next complete vertical component is task-status query; pause/cancel transaction extraction requires preserving distinct Gateway vs agent-runner side-effect order. — codex-runtime-manager

## Command status-query checkpoint

- Current-task status use case now lives in command/task-status.ts: recognize -> read once through port -> project recorded facts. Original agent-runner position and control priority preserved; compatibility exports are direct, amend ack stays separate. Commit ddc52146f. — codex-runtime-manager
- Five suites / 18 tests PASS; changed-file typed lint clean; architecture 15 rules PASS; tsgo baseline 52/candidate 52 zero new; build PASS with 209 warnings unchanged. — codex-runtime-manager
- Debt: status projection still uses original board focus formatter. No task mutation, model call, new queue or runtime path; command is PARTIAL, not independently managed in full. — codex-runtime-manager

## Active-task amendment checkpoint

- Transaction extracted to command/amend-active-task.ts, with read identity / persist / steer ports. Original runner owns eligibility, touch/cleanup, presentation and followup fallback. Commit 8906041c7. — codex-runtime-manager
- Unit tests 7 plus original runner/sequence/identity tests 12 PASS (19 total distinct tests); typed lint clean; architecture 15 rules PASS; tsgo 52 baseline/candidate unchanged; build PASS, dynamic import warnings 209 unchanged. Independent semantic review PASS. — codex-runtime-manager
- Existing limitation recorded for separate behavior fix: persisted restriction plus steering is not a per-tool hard barrier. Do not claim these records prove immediate tool enforcement; preserve current user-facing behavior only for this structural migration. — codex-runtime-manager
- [ ] Follow-up correctness slice: trace restrictive amendments to actual before-tool enforcement, reproduce any gap, then fix through the original policy/tool boundary with red/green evidence (not a second execution loop). — codex-runtime-manager

## Current-task control checkpoint

- Agent-runner owner control transaction now delegates to command/current-task-control.ts through explicit state/abort/queue ports. Atomic persistence then main/aside/queue order preserved. Gateway asynchronous protocol adaptation remains separate and NOT MIGRATED. — codex-runtime-manager
- Four suites / 9 tests PASS (including real Gateway handler and original stop sequence); independent review PASS; typed lint clean; architecture 15 rules PASS; tsgo 52 baseline/candidate unchanged; build PASS, dynamic-import warnings 209 unchanged. — codex-runtime-manager
- Next control work must first document Gateway async abort and queue-key differences; do not unify by flattening side-effect order. No new stop state machine or executor. — codex-runtime-manager

## Gateway stop checkpoint

- Gateway task-stop transaction extracted to command/gateway-task-stop.ts (036e9a66b), preserving async chat abort before owner-only embedded/queue cleanup. Original admission, board mutation, transcript, dedupe, final and cleanup stay in protocol adapter. — codex-runtime-manager
- Four suites / 11 tests PASS, including real Gateway owner stop and A/B final isolation; independent review PASS; typed lint clean; architecture 15 rules PASS; tsgo baseline/candidate 52 unchanged; build PASS and 209 dynamic-import warnings unchanged. — codex-runtime-manager
- Gateway and agent-runner control remain distinct use cases with legitimate sequencing/scope differences. Shared command ownership does not claim all control flow or planning migrated. Next review should consolidate command public contracts and adapter dependency inventory before adding more port wrappers. — codex-runtime-manager

## Command public facade checkpoint

- Explicit named/type exports in command/index.ts; auto-reply and Gateway consumers now import the facade (65001431e). No new use case, registration bus, model call or task state. — codex-runtime-manager
- Ten suites / 38 tests PASS; architecture 17 rules PASS and forbidden deep-import negative probe PASS; changed-file typed lint clean; tsgo baseline/candidate 52; build PASS, 209 dynamic import warnings unchanged. — codex-runtime-manager
- command-public-api.md records each port and remaining adapter responsibilities. Board focus formatter remains a static dependency; coherent read-only projection extraction is the next boundary candidate, not another callback wrapper. — codex-runtime-manager

## Transition and wiring checkpoint

- transition-baseline.md records existing event/guard/mutation/recovery invariants; no empty policy implementation or parallel state enum introduced. wiring-policy-boundaries.md records target five execution responsibilities and mandatory governance boundaries. — codex-runtime-manager
- Focus projection dependency debt closed by 434c47b6c: command consumes pure projection, board only re-exports; command cannot import task persistence implementation. Eight suites / 46 PASS; independent review PASS; typed lint clean; architecture 17 rules PASS; tsgo baseline/candidate 52; build PASS with 209 dynamic import warnings unchanged. — codex-runtime-manager
- Accepted external review constraints: Gateway remains same process with explicit APIs; planning governs goals/acceptance/skeleton, not a competing model loop; transcript authority remains SessionManager; mandatory AOR/constitutional constraints cannot become optional plugins. — codex-runtime-manager

## Execution bounded-recovery checkpoint

- execution-five-stage-map.md distinguishes selection/preparation/runner/verification/recovery and actual side effects. No monolithic attempt relocation or empty stage facades. — codex-runtime-manager
- Existing bounded stall loop moved unchanged to execution/recovery and exposed via execution/index (ac0f448e1); original attempt consumer imports public entry; old path is same-function compatibility export. Only one production loop implementation remains. — codex-runtime-manager
- Four suites / 81 tests PASS including original attempt integration; independent byte-equivalence review PASS; typed lint clean; architecture 19 rules PASS; tsgo baseline/candidate 52 unchanged; build PASS and 209 dynamic import warnings unchanged. — codex-runtime-manager
- Narrow legacy dependencies remain: continuation prompts/type and protocol guard. Recovery owns no task persistence, completion, model provider selection or cross-turn wake scheduling. Remaining execution stages are NOT migrated. — codex-runtime-manager

## Integrated checkpoint review

- Complete branch reviewed independently for behavior and boundaries (overall-code-review.md, overall-boundary-review.md). No new P0/P1/P2 behavior blocker found; this is not production coverage or full migration completion. — codex-runtime-manager
- Combined low-profile regression: 40 files / 483 tests PASS, including migrated components, original attempt, control, constraints/concurrency, aside history, Gateway and UI. No real model call or production rollout was performed. Log: /tmp/runtime-convergence-overall-tests.log (local diagnostic, not durable evidence). — codex-runtime-manager
- git diff --check PASS; architecture 19 rules PASS. Nested command deep-import rejection verified with a temporary negative probe and removed; contracts deny all new runtime implementation areas. Existing full-type/build baseline remains recorded per last code change. — codex-runtime-manager
- execution-ports-plan.md identifies preparation/result boundaries. Existing pure helpers already cover part of preparation, so the next implementation must demonstrate a coherent responsibility being removed from the old function rather than add another forwarding helper. Admission, task budget, failover, transport, identity and accounting/finalizers remain mandatory. — codex-runtime-manager
- No main merge/deploy authorization. Builder and collapsible action timeline follow-ups remain deferred as registered. — codex-runtime-manager

## Legacy embedded preparation checkpoint

- Existing buildEmbeddedRunBaseParams / resolveEnforceFinalTag / scoped-auth projection moved as a cohesive internal preparation adapter (7878b9bf9). Original helpers re-export one implementation. Separate preparation/index avoids widening recovery-only imports. — codex-runtime-manager
- Four green suites / 82 PASS (utils, BYOK, credit snapshot, original attempt). Entitlement suite has 4 FAIL / 3 PASS reproduced on untouched HEAD; no claim that these baseline failures are fixed. Independent byte-equivalence review PASS; typed lint clean; architecture 21 rules PASS; tsgo baseline/candidate 52 unchanged; build PASS with 209 warnings unchanged. — codex-runtime-manager
- Preparation still uses FollowupRun type and original execution-identity helper; its transitive Gateway dependency is explicit debt. It is not a final SDK contract. Admission/fallback/transport/provider invocation/budget/accounting/finalizers remain at original positions. No extra preparation wrapper added. — codex-runtime-manager

## Delivery candidate payload checkpoint

- Complete legacy candidate-payload preparation migrated to delivery/presentation through delivery/index (5907080c3): sanitation/threading/directives/media/render/stream fallback/same-target dedupe unchanged. Old export points to one implementation; runner call position unchanged. Independent body-equivalence review PASS. — codex-runtime-manager
- Three unit/integration suites / 27 PASS. Additional e2e configured run: 35 PASS / 8 FAIL / 1 unhandled error; restored HEAD implementation reproduces the same totals and failing cases. Do NOT mark e2e green. Typed lint clean; architecture 23 rules PASS; tsgo baseline/candidate 52 unchanged; build PASS, 209 warnings unchanged. — codex-runtime-manager
- Component is not pure: media callback and pipeline methods may have I/O/state. Legacy formatting/threading/dedupe dependencies remain. No task acceptance, completion, actual transport acknowledgement or growth commit moved. — codex-runtime-manager
- [ ] Independently triage pre-existing agent-runner.runreplyagent.e2e failures before claiming full delivery-chain acceptance; do not mix those fixes into equivalent module relocation. — codex-runtime-manager

## Acceptance boundary and e2e diagnostic checkpoint

- acceptance-boundary.md documents mixed FS probes/writes, SLA clock, OGUI and trial short-circuit ownership. Do not relocate the entire contract as a pure acceptance module or eagerly evaluate effects. — codex-runtime-manager
- E2E missing-export diagnosis: model-fallback test mock omitted isModelEntitlementEmptyError. Partial real-module mock restores that export without altering production code. Full configured e2e improves from 35 PASS/8 FAIL/1 error to 42 PASS/1 FAIL/no unhandled errors. Remaining channelData approval-tool-result forwarding assertion fails independently and remains open. — codex-runtime-manager
- Changed-file type-aware lint clean; tsgo remains 52 baseline/candidate, no new; architecture 23 rules PASS. No production files changed in this diagnostic slice. — codex-runtime-manager
- [ ] Investigate remaining approval channelData forwarding failure with a faithful real-runner reproducer before altering normalization/approval behavior; do not weaken the test or silence it. — codex-runtime-manager

## Approval forwarding correctness checkpoint

- Reproduced product issue: sanitizeUserFacingText removes raw approve protocol to empty; generic skip dropped the structured execApproval card. Fix only restores safe APPROVE_CARD_CTA for sanitized-empty text carrying valid existing metadata and explicit allow-once protocol; silent/heartbeat/empty/malformed remain suppressed. This is a separate behavior fix, not equivalent migration. — codex-runtime-manager
- Configured e2e now 46/46 PASS (including silent/card, heartbeat/card and empty-id negative cases). Independent review PASS; typed lint clean; tsgo baseline/candidate 52 unchanged; final build PASS and dynamic-import warnings 209 unchanged. Raw command/approval protocol is not restored in visible text. — codex-runtime-manager
- Earlier 8-failure baseline is superseded by the mock repair and this explicit product regression fix. Existing unrelated entitlement suite remains baseline-red as separately recorded. — codex-runtime-manager

## Pure blocker policy checkpoint

- Existing blocker grades/probe DTO/side-path and cleared-evidence classification moved unchanged to policy/index (020bf5a37). Original contract imports shared rules and re-exports existing public symbols; FS probes/writes, clock, OGUI, trial and settlement remain original. — codex-runtime-manager
- Three suites / 26 PASS; independent equivalence review PASS; typed lint clean; architecture 24 rules PASS; tsgo baseline/candidate 52 unchanged; build PASS, 209 dynamic-import warnings unchanged. — codex-runtime-manager
- Policy is PARTIAL: this is not a new transition engine or complete acceptance migration. Next settlement migration must retain lazy side effects and original precedence as recorded in acceptance-boundary.md. — codex-runtime-manager

## Settlement effect-preservation contracts

- Added real contract tests for WAIT laziness and side-path receipt-before-artifact ordering, preserving actual filesystem trailing-newline and clock behavior. No production implementation moved in this checkpoint. — codex-runtime-manager
- Three suites / 28 PASS; independent review corrected the test's newline assumption rather than changing implementation; typed lint clean; full tsgo baseline/candidate 52, zero added. No build required for this test/spec-only checkpoint. — codex-runtime-manager
- Complete settlement remains original; further adapter extraction must preserve lazy probes, OGUI/trial precedence, existing artifact handling, degradation writes and clock cleanup. — codex-runtime-manager

## Turn settlement orchestration checkpoint

- Complete existing settle sequence moved to delivery/acceptance (ebb00f983), with explicit fixed source-code ports preserving lazy I/O/clock/OGUI/trial invocation. Legacy adapter retains implementations and compatible entry. Acceptance/probe data contracts single-source in contracts. — codex-runtime-manager
- Five suites / 34 PASS including WAIT, real write/clock order and original tool WAIT gates; independent semantic review PASS; typed lint clean; architecture 25 rules PASS; tsgo baseline/candidate 52 unchanged; build PASS, dynamic-import warnings 209 unchanged. — codex-runtime-manager
- Approx. 23 effect/predicate ports are a transitional legacy boundary, NOT configurable callbacks or plugin API. Do not add arbitrary registration; future cleanup groups coherent policy/environment/result adapters after characterization. No new queue or executor invocation. — codex-runtime-manager
- This settles an applicable TURN contract, not general task acceptance or transport success. State/delivery artifact lifecycle and reuse remain unmigrated. — codex-runtime-manager

## Whole-runtime completion gates and first retirements

- completion-gates.md and final-convergence-plan.md supersede any assumption that directories imply completion. Core accepted-turn execution, general task evidence close, async job recovery and production extension consumers remain required gates. — codex-runtime-manager
- safe-retirements.md records repo-wide import/SDK/build/dynamic-reference audit. Removed three consumed compatibility shells; original capability implementations remain, tests now consume public APIs. Four suites / 75 PASS. — codex-runtime-manager
- Real command host binding moved to wiring/command-adapters.ts; original runner no longer binds state/steer/abort/queue inline. Wiring contains no routing or transition decision. Seven suites / 24 PASS and independent semantic review PASS. — codex-runtime-manager
- Combined candidate tsgo baseline/candidate 52, no new; build PASS with 209 warnings unchanged. Three-layer convergence remains INCOMPLETE; do not delete externally used hooks/workflows without effective enablement and consumer evidence. — codex-runtime-manager

## Original design intent preservation gate

- User requires purpose recovery BEFORE further deletion. retirement-intent-contract.md now requires original motivation, invariants, replacement owner, evidence, external-consumer/rollback checks; zero imports alone is insufficient. — codex-runtime-manager
- Retrospective three-shell audit (retirement-intent-audit.md): original untrusted data separation, payload delivery/dedupe/media handling and bounded protocol isolation remain in new components. Only consumed re-export shells were removed. Repository exports/build consumers checked; unknown private external imports require operator confirmation before production retirement claims. — codex-runtime-manager
- original-intent-preservation.md maps group confirmation/ACL/version/review and complex-task shaping/acceptance constraints to future owners. Keep or explicitly replace these capabilities before old retirement; no blanket deletion of loops/DSLs by name. — codex-runtime-manager
- Five intent-focused suites / 38 tests PASS, including group private plan and complex-task acceptance, plus migrated untrusted/payload/recovery behavior; architecture 25 rules PASS. This checkpoint changes specs only, no additional implementation deletion. — codex-runtime-manager

## Separate orchestration, shared execution checkpoint

- scenario-architecture.md fixes individual vs collaboration bounded contexts: separate planning/claim/review/stop semantics, shared admitted work-item execution and transport facilities. No merged TodoList table or optional authorization plugin. — codex-runtime-manager
- Original explicit collaboration assembly admission and group-ID resolution now owned by command/scenarios, with original adapter compatibility and metadata precedence. This is not a new semantic classifier, permission gate or complete collaboration migration. — codex-runtime-manager
- Four suites / 29 PASS; original adapter/normal entrance rechecked 15 PASS after correcting missing internal import caught by tsgo. Final typed lint clean; architecture 25 rules PASS; tsgo baseline/candidate 52; final build PASS with 209 warnings unchanged. — codex-runtime-manager
- Remaining work: admitted work-item execution main entry, per-scenario acceptance and stop scope, production extension consumer inventory. Do not count scenario routing as completion of shared executor convergence. — codex-runtime-manager

## Shared execution and per-scenario acceptance audit

- Explicitly retain individual vs group lifecycle separation. task-close-audit.md finds recordCheckedTaskCompletion drops task/attempt/artifact identity; original finishCurrentTask guards are optional and bypassed by the wrapper. — codex-runtime-manager
- API-level isolated repro on temporary board with task-b current: calling old closed:true record (unable to carry task-a identity) produces BIncorrectlyClosed=true. No production task data touched. This is a pre-existing correctness gap, not a migration-induced failure. — codex-runtime-manager
- [ ] Priority correctness slice: bind completion to originating session-board task/attempt/artifact through real caller paths; never substitute CTR id or newest current task. Preserve old checked-notice design, examine raw transcript append via SessionManager evidence; do not silently delete notices. — codex-runtime-manager
- admitted-backend-port.md defines the next shared execution component: full admitted candidate CLI/embedded dispatch/prepare/invoke/lifecycle, leaving admission/fallback/aggregate/finalizers at their existing owner. No three-line forwarding wrapper, new retry loop or optional governance. — codex-runtime-manager

## Checked-completion identity correctness checkpoint

- Original API-level repro closed current B from an unbound late A callback. recordCheckedTaskCompletion now requires a captured board binding and rechecks task/attempt/artifact fields under the original lock; rejection produces no completion notice. Already-completed matching tasks are rejected to avoid duplicate notices. — codex-runtime-manager
- Individual dispatch captures before reply execution and passes binding to observer (no late-current read); runner captures before model execution for complex-task shaping. Production capture also requires normalized incoming goal match; ambiguity fails closed. CTR IDs are not substituted for board IDs. — codex-runtime-manager
- Four suites / 48 PASS; final cross-process run 7 PASS. Earlier runs showed constraint-count competition failures; do not claim that flake fully resolved. Worker uses canonical activeConstraintTexts to normalize legacy string/log contracts and removes 8 baseline TS errors. Candidate TS 44 vs baseline 52, zero added; typed lint clean; architecture 25 rules PASS; build PASS, warnings 209 unchanged. — codex-runtime-manager
- Remaining identity gate: same-text different task instances still require explicit upstream request/task binding, not semantic matching. bindCurrentExecution production wiring is not established, so attempt/version may be absent; do not claim per-attempt protection is fully active. Newly created tasks after early capture may remain unclosed rather than infer ownership. — codex-runtime-manager
- Completion notice raw transcript append remains an independently recorded SessionManager compatibility problem; this fix preserves the notice behavior and does not silently remove its original purpose. — codex-runtime-manager

## Request-carried completion identity checkpoint

- FollowupRun.run now carries admitted task completion binding, captured from original inbound body rather than context-wrapped queuedBody. Normal runner no longer reclaims latest current; startBoundTaskExecution atomically checks captured task/attempt/version and existing pause/tombstone before stamping the normal attempt. Host callback updates immediate dispatch completion identity, never a model-derived field. — codex-runtime-manager
- Same-goal A→B replacement, stale attempt, missing queue binding, and real get-reply entrance with untrusted history are covered. Five suites / 48 PASS; configured original e2e 46 PASS; changed-file typed lint clean; tsgo remains 44 baseline diagnostics, zero new; build PASS with 209 warnings unchanged. — codex-runtime-manager
- IMPORTANT remaining gates from independent review: followup-runner drains directly to embedded and has NOT been integrated with attempt binding/completion callbacks. startBound rejection prevents checked close but does not yet reject all stale business execution. Capture before producer association remains a gap for same-text instances if no explicit upstream task/request identity exists. Do not describe this as complete queue lifecycle or full shared execution migration. — codex-runtime-manager
- Original task/attempt/artifact binding type now belongs to contracts/task.ts; original board API type re-export retained. Internal callback is fixed host wiring, not config or public RPC input. — codex-runtime-manager

## Followup queue binding claim checkpoint

- followup-runner now claims original request binding before outcome/admission side effects, rejects stale bound requests, and refuses unbound individual requests when a tracked current task exists. Untracked legacy work and unbound collaboration private/round plans retain existing admission rather than being silently claimed as current. — codex-runtime-manager
- Claim exceptions and rejections clean both typing signals. After async transport preparation, each backend attempt rechecks task/attempt/version/stop before provider startup; existing host abortSignal is forwarded. Normal runner stores its accepted binding back on followupRun.run for original continuation propagation. — codex-runtime-manager
- Four suites / 28 PASS including real followup stale A→same-goal B and owner pause during transport (provider call count zero); independent review PASS; typed lint clean; tsgo baseline/candidate 44; build PASS, 209 warnings unchanged. — codex-runtime-manager
- Remaining startup gate: without a host abortSignal, the final check to embedded registration window is not completely closed. Normal runner's failed startBound still needs an explicit execution rejection policy; do not claim all stale business execution or stop races eliminated. Queued post-delivery task close callbacks are not yet a universal acceptance mechanism. — codex-runtime-manager

## Normal-turn stale execution rejection checkpoint

- Binding claim moved before memory flush and provider effects. Tracked individual or explicitly bound requests that fail claim return a clear refusal rather than proceeding. Untracked and unbound collaboration plans retain their existing domain admission. — codex-runtime-manager
- CLI and embedded candidate calls recheck original task/attempt/version/stop at startup. Rejected and exceptional claims use original finalizeWithFollowup to schedule subsequent drain and clean both typing states; normal followup factory still constructs after memory flush with updated session entry. — codex-runtime-manager
- Configured e2e 47/47 PASS including stale A→B provider-zero and drain-scheduled assertion; independent review PASS; changed-file typed lint clean; architecture 25 rules PASS; tsgo baseline/candidate 44; final build PASS with 209 dynamic-import warnings unchanged. — codex-runtime-manager
- This closes normal binding-rejected-but-still-executed and rejection-skips-drain gaps. No claim that mock drain scheduling proves actual queue consumption; original scheduler unchanged. Without a host cancellation signal the last startup-check to embedded registration window still requires lifecycle-level work. — codex-runtime-manager

## Embedded startup registration handshake checkpoint

- Trusted taskExecutionBinding data now propagates through normal/followup -> embedded run -> attempt. Original active handle is registered before synchronous task-board revalidation; invalid original task calls original abortRun, then AbortError within the protected try prevents prompt startup. No second cancellation registry or model-controlled guard. — codex-runtime-manager
- Guard and read errors are inside original cleanup boundary. Real runEmbeddedAttempt test pauses during create-session preparation, uses the actual active-run registry, asserts no provider prompt, session lock released exactly once, and active handle removed. Four suites / 88 PASS; independent lifecycle review PASS. — codex-runtime-manager
- Typed lint clean; architecture 25 rules PASS; tsgo 44 baseline/candidate unchanged; final build PASS, dynamic-import warnings 209 unchanged. — codex-runtime-manager
- Scope is same-process embedded startup only. Earlier preparation I/O/hooks may occur; CLI remains startup-guarded but has no equivalent registration handshake; cross-process real-time abort is not established. Do not claim all execution surfaces are race-free or all side effects cancellable. — codex-runtime-manager

## CLI host cancellation checkpoint

- runCliAgent and legacy Claude wrapper accept the host AbortSignal. Existing supervisor is reused: entry/pre-spawn abort checks, post-spawn cancellation catch-up, live managedRun.cancel listener, post-wait abort assertion, listener removal in finally. Normal CLI caller forwards existing opts signal. No new cancel registry. — codex-runtime-manager
- AbortError is preserved before failover/session-expired handling, so a cancelled host request does not return late success or start a recovery retry. Cancellation callback exceptions are logged without error content and do not escape EventTarget. — codex-runtime-manager
- Two CLI suites / 16 PASS, original configured e2e 47 PASS; independent review PASS; typed lint clean; tsgo baseline/candidate 44; final build PASS, warnings 209 unchanged. — codex-runtime-manager
- Guarantee requires a provided host signal. If supervisor cancellation fails, logical abort/late-result suppression does not prove the child process exited. Unsignalled and cross-process cancellation still need separate evidence; do not claim universal owner-stop coverage. — codex-runtime-manager

## Admitted candidate backend execution checkpoint

- Complete CLI/embedded candidate dispatch, backend preparation, real provider invocation, lifecycle events and tool callbacks moved to execution/runner/admitted-candidate.ts (56bf21ea1). Original outer callback retains onModelSelected then delegates; roughly 500 lines of old backend body removed. Original admission/fallback/aggregate/finalizers remain original owner. — codex-runtime-manager
- Typed host effects retain budget checks/charges, shared bootstrap warnings, commercial/modality/compaction aggregate mutation and directly-sent Set identity; original lazy session/model gate reads, auth/transport distinction, abort/task checks, serialized tool chain and pending cleanup preserved. Independent body-equivalence review PASS. — codex-runtime-manager
- New component 3 PASS; original integration 24 PASS; configured original e2e 47 PASS. Post-migration joint low-profile run: 39 files / 418 PASS (pre-migration 38/415). Typed lint clean; architecture 27 rules PASS; tsgo baseline/candidate 44; build PASS, 209 warnings unchanged. — codex-runtime-manager
- Old outer module no longer imports or calls CLI/embedded providers; manifest enforces this and public candidate entry. No new retry/queue/agent loop. Candidate extraction maps/invariants preserve original intent and side-effect order. — codex-runtime-manager
- Legacy debt: candidate type-only references original AgentTurnExecutionParams and directly uses existing host identity/transport/observer/delivery helpers. It is an internal adapter, not a final SDK. Full admitted-turn outer lifecycle, common acceptance/delivery ownership, state and extension retirement gates remain unfinished. — codex-runtime-manager

## Internal execution turn contract ownership checkpoint

- Existing AgentRunLoopResult / AgentTurnExecutionParams type blocks moved unchanged to execution/runner/turn-contract.ts (1f6fde62e), with type-only compatibility exports. Candidate now depends locally rather than back on the old large outer execution module. — codex-runtime-manager
- Full original fields/callback/result semantics retained; all contract dependencies are import type. This is an internal legacy adapter contract, not the final general work-item SDK. No runtime model/state effect moved. Independent byte-equivalence review PASS. — codex-runtime-manager
- Four relevant suites / 26 PASS; typed lint clean; architecture 28 rules PASS; tsgo baseline/candidate 44; build PASS, warnings 209 unchanged. Reverse import from candidate to old outer owner is now denied by manifest. — codex-runtime-manager
- Outer admitted-turn lifecycle and general delivery/state/capability boundaries remain unfinished. Do not equate request/result type ownership with complete shared execution entry migration. — codex-runtime-manager

## Per-turn admission lifetime checkpoint

- Original enterpriseRunSlotHeld ownership moved to execution/lifecycle/admission-lease (2d81b2b48). Lease records successful acquisition, exposes held state to original routing/snapshot logic, and disposes acquired slot then forgets snapshot in original order. No change to deny/skip decisions, metadata, snapshot publication or fallback loop. — codex-runtime-manager
- Fixed host ports are source-code dependencies, not config callbacks; original async release remains fire-and-forget (same semantics). Dispose is idempotent for one serial turn owner; concurrent acquire/dispose is not supported or claimed. Original typed acquisition results are plain data; pre-return held update is a documented transitional implementation detail. — codex-runtime-manager
- Component tests 5 PASS plus original BYOK/credit integration 6 PASS; configured e2e 47 PASS; independent semantic review PASS; typed lint clean; architecture 30 rules PASS; tsgo baseline/candidate 44; build PASS, 209 dynamic import warnings unchanged. — codex-runtime-manager
- This is the slot lifetime, not complete admission governance: original outer still owns entitlement decisions, capability routing, model snapshot content and audit/usage aggregate. Skip-mode snapshot handling is not silently changed in this equivalence extraction. — codex-runtime-manager

## Turn outcome aggregation checkpoint

- Cohesive tool-result counters, modality artifact evidence, failure classification and TaskOutcome write/growth/failure observability moved to execution/outcomes (69590c164). Original execution host retains task entry, model budget and delivery-triggered commit timing; candidate ports record shared evidence via the new owner. — codex-runtime-manager
- Each commit snapshots/resets original signals then reads current context; heartbeat/no-agent early return, missing-task diagnostic, explicit failure/cancel precedence, record->growth->observable failure preserved. No new exact-once guard: original repeated commit zero-count behavior stays, original delivery wrapper still controls once-consumption. Fixed host run config/agent/signal and per-run task identity are immutable assumptions. — codex-runtime-manager
- Component 6 PASS, original integration 7 PASS, configured e2e 47 PASS; independent semantic review PASS; typed lint clean; architecture 32 rules PASS; tsgo baseline/candidate 44; build PASS with 209 dynamic-import warnings unchanged. — codex-runtime-manager
- Execution-return success is not user acceptance/delivery. Common task acceptance, actual transport receipts and final main-chain orchestration remain unfinished; no model or scheduling added to outcome recording. — codex-runtime-manager

## Visible delivery preparation checkpoint

- Original complete visible-reply preparation transaction (170c19917) moved from agent-runner to delivery/dispatch/prepare-visible through the delivery public API: pinned acceptance gates, awaiting phase, awaited outcome persistence, stable pending registration and publication to the existing shared dispatch reference. Actual transport confirmation remains dispatch-from-config; no new execution or state loop. — codex-runtime-manager
- Host supplies the existing agent storage root through a fixed source dependency; delivery cannot import execution providers or task-control paths. Existing immutable run identity assumptions, missing-agent behavior and exception propagation preserved. No task completion or actual delivery is inferred from prepared output. — codex-runtime-manager
- Four component cases cover deferred persistence ordering, rejected persistence, missing identity/verified acceptance, and rejected registration; joint 4 files / 57 PASS, original configured e2e 47 PASS. Typed lint clean; architecture 33 rules PASS; tsgo remains 44 existing diagnostics without new changed-file errors. Independent semantic review PASS; build PASS with 209 existing dynamic-import warnings. — codex-runtime-manager
- Common acceptance, silent/filtered/placeholder result routing and complete transport receipt ownership remain unfinished; this is an internal turn delivery component, not a finalized generic SDK. Builder normalization/retesting and user action timeline remain deferred as previously agreed. — codex-runtime-manager

## Terminal reply delivery outlet checkpoint

- Post-execution empty, language-filtered, process-placeholder and prepared visible results now use completeReplyDelivery (a5a9df710) through the delivery public entry. The original adapter captures live empty-delivery evidence, binds original effects and delegates one terminal finalizer. Original pre-execution command/admission/aside paths and outer exceptional cleanup retain their owners. — codex-runtime-manager
- Empty-turn pure decisions/types/formatting moved byte-equivalently to delivery/presentation/empty-reply; old honest-empty helper re-exports that implementation and retains original marker parsing/rate limits and gap I/O. No parallel classifier or new scheduler. Original cancellation priority, non-visible fire-and-forget outcome timing, placeholder incompleteness, continuation-before-drain order and visible []/single/array return semantics preserved. — codex-runtime-manager
- New component 18 PASS; original normal-entry cases expanded to 15 PASS, including filtered finals with/without tool results; the same 15 entry cases PASS against the pre-migration HEAD archive. Core joint 7 files / 127 PASS; configured original e2e 47 PASS. Independent semantic review PASS; changed-file typed lint/format clean; architecture 34 rules PASS; tsgo 44 existing diagnostics, zero new. Build PASS with 209 dynamic-import warnings unchanged. — codex-runtime-manager
- Broader joint includes 4 FAIL / 1 unhandled error in the existing misc suite: incomplete fallback mock exports and two reminder assertions. Exact same four tests and error reproduce against pre-migration HEAD archive (24 PASS / 4 FAIL / 1 error); not claimed green or fixed by this extraction. pnpm check stops at 64 formatting failures, same file set as the untouched HEAD archive; changed files are clean. — codex-runtime-manager
- Known legacy semantics explicitly retained: silent exemptions (group/heartbeat/internal/visible-filtered) use the existing successful skip bookkeeping and are mapped to delivered without independent transport evidence. Separate evidence-backed correction required; do not claim universally correct delivery receipts or whole-task acceptance. See delivery-outlet-map.md. — codex-runtime-manager
- Limited authorized Loom proxy adds only the original honest-empty implementation/test paths to this task and its existing landing stream. Existing broad ownership overlaps remain; final registry delta leaves every other task registration unchanged. A broad replacement briefly added four unrelated test-path rows in 4413da484; 5a60b1716 restored them before code landing, and the net scoped diff was verified. No push, merge or production deployment. — codex-runtime-manager

## Follow-up after terminal outlet extraction

- [x] Separate legitimate silence from confirmed delivery in the terminal empty-reply outlet. No send evidence leaves delivery pending, without waiving task acceptance. — codex-runtime-manager

## Delivery quality and lifecycle workstream

- [x] Inventory existing output conventions, validators, artifact/hash/preview/edit/save/archive/source-trace foundations; independent read-only quality/lifecycle audits reviewed. Existing backend foundation 4 files / 33 PASS and UI Node foundation 2 files / 21 PASS; no browser E2E or actual rendering/source verification claimed. Specification in delivery-quality-lifecycle-plan.md. — codex-runtime-manager
- [x] DQ0a: Map existing artifact identities/hash/state and validator required-items; trace actual production invocation/receipt production and migrate the single validator registry/receipt matcher into delivery acceptance. Contract/coverage matrix in delivery-quality-contract-map.md. — codex-runtime-manager
- [ ] DQ0b: Encode versioned report/PPTX quality profiles and rubric datasets after their validator capability bindings are implemented; no fictional registry entries or automatic pass for missing checks. — codex-runtime-manager
- [ ] DQ1: Prove one existing PPTX lifecycle end to end; add stale-edit/preview-save counterexamples and correct original version-aware write boundaries, including concurrency and permissions. Reuse original individual/collaboration adapters. — codex-runtime-manager
- [ ] DQ2: Bind report claims to original source locations, timestamps, data scope and reproducible computations; integrate original validator/acceptance receipts, preserving unknown/conflicting evidence. — codex-runtime-manager
- [ ] DQ3: Real-format rendering/readability checks plus independent aesthetic rubric; bind evidence to original artifact bytes/version, recheck after edits, return failures through original recovery. — codex-runtime-manager
- [ ] DQ4: Cross-entry preview/download/save/edit/archive/reload consistency, separate archive/index/send receipts, partial failure/idempotency/stop tests, then governed reuse. — codex-runtime-manager

This workstream extends the existing delivery migration; no new orchestration engine, configurable scripts or parallel artifact authority. Existing silence-receipt correction, builder normalization/retesting and deferred action timeline remain tracked. This checkpoint records audited design and queued implementation only; no production code change or deployment. — codex-runtime-manager

## DQ0 existing quality contract checkpoint

- Original validation registry, receipt signing/matching/query/reset and decision counts (c5df196c9) moved unchanged to delivery/acceptance/validation; ValidationReceipt moved unchanged to contracts/quality. The legacy validation module re-exports the same public functions/state. Production validator signing and delivery matching use the new acceptance facade directly. No new quality loop or persistence authority. — codex-runtime-manager
- Trace confirms required validators originate from Skill contract data via preflight, then original attempt runs the actual validator and original delivery gate matches required items against original artifact bytes. The downstream hook receipt summary is not evidence of an upstream bypass. Current production validator audited: JSON Canvas only, original canary behavior retained. — codex-runtime-manager
- Component ownership 3 PASS proves function identity/shared state, missing required receipt and task/path/content/validator-version isolation. Core 7 suites / 28 PASS; original configured e2e 47 PASS. Independent byte-equivalence review PASS; changed-file typed lint/format clean; architecture 36 rules PASS; tsgo 44 existing diagnostics with no added changed-file errors; build PASS and 209 dynamic-import warnings unchanged. — codex-runtime-manager
- Broader preflight run 43 PASS / 5 FAIL, with all five failures reproduced on untouched 8762fffde archive (29 PASS / 5 FAIL). Includes outdated source-string assertions and old behavioral/trace/skill expectations; do not claim those suites green or fix them speculatively in this relocation. — codex-runtime-manager
- Explicit identity/hash matrix separates UI preview hash, logicalId, capture deliverableId, raw original bytes, archive expectedRawHash, KB documentId and quality/transport receipts. Existing PPTX patch has no audited original-content precondition; DQ1 must establish counterexamples before changing the original authorized write boundary. No concurrent-write fix or full lifecycle E2E claimed here. — codex-runtime-manager
- pnpm check still stops at the same 64 baseline formatting files (zero added); changed files are formatted. Report/PPTX source support, actual-format rendering, aesthetic validators and runtime profile datasets remain unfinished. DQ0a is the existing contract ownership/mapping checkpoint, not complete delivery-quality coverage. All other task registrations remain untouched; no push, merge or production deployment. — codex-runtime-manager

## PPTX reported preview/download defects checkpoint

- User-reported text-only preview traced to original OOXML text-card implementation; unreadable download has a demonstrated generic path: rendered HTML openUrl selected by download fallback and named .pptx. Office HTML without original bytes could also be archived as document content. Before/after regressions captured; original Office download/save isolation committed as 37ce53655. — codex-runtime-manager
- Complete static-page rendering added through the original Office preview service and fixed local isolated worker (559bbaa74): stdin bytes, explicit local Unix daemon, no network/mounts, resource limits, original page-count match, bounded cleanup and single process-local in-flight conversion with same-content sharing. Fixed worker is an action adapter, not a second runtime or config script. Missing capability/capacity retains explicit text fallback. — codex-runtime-manager
- Eight suites / 88 PASS; typed lint/changed-file formatting clean; architecture 36 rules PASS; tsgo stays 44 existing diagnostics without added changed-file errors; full build PASS, 209 dynamic-import warnings unchanged. Additional original consumers 16 PASS / 3 FAIL, all three knowledge preview RPC failures reproduced against pre-change archive. pnpm check still stops at repository formatting failures; current task's changed files separately clean. — codex-runtime-manager
- Real offline isolated renderer verified 3-page shapes/image-only/chart fixture with source unchanged. Read-only located Panda eight-page lecture original has valid ZIP/CRC; repaired actual UI download function gives exactly equal SHA-256, and final actual isolated Gateway adapter renders all 8 pages. No user content is committed; private original evidence retained temporarily. — codex-runtime-manager
- User requested November 3 Panda outputs. Located canonical Panda originals have older mtimes; matching session/owner and Shanghai-day PPTX-reference investigation did not uniquely identify the reported incident. Do not claim the older lecture is that incident, that every bad source is repaired, or that production is fixed. Evidence/limitations and dedicated renderer deployment prerequisite: pptx-preview-download-fix.md. — codex-runtime-manager
- Main advanced by unrelated PR #228; preserved local annotated archive/runtime-convergence-pre-228-20261104 and replayed convergence with rebase-merges onto fresh main, restoring and verifying all then-current repair files byte-for-byte. Earlier evidence hashes remain reachable in archive. No remote push/force-push, merge to main, renderer installation on production or cutover. — codex-runtime-manager
- DQ1 edit CAS/full lifecycle closure and DQ2 source/aesthetic checks remain distinct unfinished work. This fixes preview/download defects, not the complete quality/lifecycle workstream. — codex-runtime-manager

## Ordered remaining migration work

Deployment is deferred by explicit user instruction until the migration and combined acceptance are complete. Dedicated renderer candidate PR #231 remains separate; do not deploy it independently.

- [x] F2 entry ownership: complete existing normal-turn orchestration through the execution public API, mandatory grouped host bindings, original legacy loop retired to compatibility delegate, main consumer replaced. Remaining legacy helper/Pi adapter limitations explicit in admitted-turn-ownership.md. — codex-runtime-manager
- [ ] F1: command intake/disposition and authoritative state-port convergence, retaining separate individual/shared/private task domains. — codex-runtime-manager
- [ ] F4: compose real command/execution/delivery dependencies and thin original adapters; no rules or second controller in wiring. — codex-runtime-manager
- [ ] F3 lifecycle correctness: task acceptance versus delivery receipts, legitimate-silence correction, final user-goal evidence and stale callback protection at every completion caller. — codex-runtime-manager
- [ ] Long-running task proof: async wait/job identity, interruption/amendment, stale result rejection, bounded original wake/resume, and proactive final delivery across supported lifecycle. — codex-runtime-manager
- [ ] Capability/policy contracts and before-tool restrictive-amendment enforcement; builder lifecycle normalization/retesting; evidence-backed extension control retirement. — codex-runtime-manager
- [ ] DQ1–DQ4 artifact version/preview/edit/save/archive consistency and source/visual/aesthetic quality; actual November 3 incident identification remains unproven. — codex-runtime-manager
- [ ] Final individual/collaboration/model/channel/stop/recovery acceptance on one candidate SHA; coordinated Gateway/UI/renderer main-only deployment after acceptance. — codex-runtime-manager

## Complete existing admitted-turn entry checkpoint

- Full runAgentTurnWithFallback body (9a299b065) moved to execution/runner/admitted-turn, retaining the original while/fallback/retry and finally. Platform effects grouped in mandatory typed internal host capabilities; fixed wiring binds the existing implementations and original guarded corrupted-session effect transaction. No provider duplication, optional authorization, config scripts or new task state. — codex-runtime-manager
- Main runReplyAgent imports execution/index directly and supplies the required host; old agent-runner-execution retains only compatibility function/type exports and delegates to that same use case. Model/commercial audit metadata and relevant source evidence anchors updated to actual owners. — codex-runtime-manager
- Complete-turn component 3 PASS covers deny-before-candidate, success through original fallback, and non-retryable failure cleanup. Joint 10 files / 47 PASS; original configured e2e 47 PASS; independent normalized-body and effect-order review PASS. Type-aware lint clean; architecture 39 rules PASS; tsgo baseline/candidate 44, no new errors; build PASS with 209 dynamic-import warnings unchanged. — codex-runtime-manager
- Expanded authorization-helper suite has 4 baseline failures (3 PASS); exact same four reproduced on untouched archive. Identity/commercial source audits have 2 baseline failures (100 PASS in expanded audit group); both also reproduce before migration. Relevant new model-caller registration and tool-observer evidence tests PASS; no weakening of the existing assertions to force global green. — codex-runtime-manager
- Full pnpm check stops at 66 repository formatting failures, same pre-F2 failing file set; changed files clean. No whole-runtime completion or baseline-red fixes claimed. Source state, contracts, capabilities, command/wiring closure and long-job delivery still follow the ordered list above. No push/main merge/deploy for this checkpoint. — codex-runtime-manager

## F1 reply command and task-state checkpoint

- Main reply now consumes a typed command disposition for control, status, aside, steer, amendment and queue routing. Original classifier calls, fresh board reads and mutation order are preserved; async aside execution, enqueue and typing remain in the original host. — codex-runtime-manager
- Session task state exposes existing reads, atomic control/constraint updates and execution binding without duplicating the board schema, storage or locks. Gateway protocol/focus and collaboration task stores retain their own adapters. — codex-runtime-manager
- Targeted 50 PASS, configured reply e2e 47 PASS, independent review PASS, architecture 40 rules PASS. Build passed with 209 existing dynamic import warnings; typecheck retains 44 existing diagnostics and full check stops on 66 existing format failures. Composition-root convergence and broader task lifecycle work remain open. — codex-runtime-manager

## F4 main reply composition checkpoint

- Main reply consumes a fixed composition for command, session task state, admitted execution and delivery. Visible receipt storage resolution moved to wiring and remains lazy. The composition binds existing effects; it does not route, retry, or finish a turn. Transport, presentation sequencing and cleanup stay in the reply host. — codex-runtime-manager
- Targeted 31 PASS, reply e2e 47 PASS, architecture 41 rules PASS, changed-file lint clean, build PASS with 209 existing dynamic import warnings. Typecheck unchanged at 44 diagnostics; full check stops at 66 existing formatting failures. Broader entrypoint convergence and task acceptance versus delivery receipt semantics remain open. — codex-runtime-manager

## F3 silent delivery evidence checkpoint

- Empty-turn settlement now distinguishes silence and unconfirmed stream/tool callbacks from recorded messaging-tool sends and reactions. The former keep delivery pending; the latter can satisfy the delivery gate independently of group silence rules. Acceptance uses the original contract and cancellation takes precedence. — codex-runtime-manager
- Before/after regression: 8 failing assertions on the old behavior; the scoped suite passes 75 tests. No new scheduler or send path. Correlating stream/tool callbacks with transport receipts and general task acceptance remain separate work. — codex-runtime-manager

## F3 task-board completion fence checkpoint

- Audited the two production callers of recordCheckedTaskCompletion: reply completion after ledger processing and complex-task reply shaping. Both provide captured task bindings; neither bypasses the board's completion gate. Ledger completion and transport receipt semantics still require separate verification. — codex-runtime-manager
- Checked completion now shares the live-binding predicate with execution startup and evaluates it under the existing board lock. Paused, already finished, tombstoned or stale identities cannot write the board or append a completion notice. Rejected callbacks no longer increment writeEpoch. — codex-runtime-manager
- Four before/after cases cover pause, duplicate completion, newer attempt and newer deliverable version. Targeted regression: 53 PASS. Existing successful completion-notice persistence is unchanged; its transcript adapter and acceptance/transport sequencing remain follow-up work. — codex-runtime-manager

## F3 dispatch completion evidence checkpoint

- Dispatch previously called the conversation-task completion observer after enqueue-only or failed final sends as well as delivered replies. New fail-before/pass-after integration cases distinguish unknown, failed and successful real dispatcher outcomes. The observer is now called only when existing required-delivery AND aggregation confirms delivered. — codex-runtime-manager
- Reply dispatch plus original completion regression: 67 PASS; changed-file typed lint clean; typecheck unchanged at 44 existing diagnostics. This prevents premature closure on this dispatch path; complex-task pre-send acceptance and delayed receipt-driven retry/closure remain unfinished, so pending tasks are not claimed automatically recovered. — codex-runtime-manager

## F3 complex-task pre-send completion checkpoint

- Complex reply shaping previously closed the task board on text alignment before dispatch. The former success test now asserts the board stays unfinished and no checked-delivery notice is appended; this fails against the old behavior and passes after removal of the pre-send state mutation. Text shaping/alignment remains unchanged. — codex-runtime-manager
- The pure presentation path no longer calls recordCheckedTaskCompletion. Actual delivered completion remains on the separately guarded dispatch/ledger path. When that path is unavailable or a receipt arrives later, the task deliberately stays pending; durable acceptance-to-late-receipt completion is still unfinished and must preserve original task/attempt/version identity. — codex-runtime-manager

## Late receipt checked-task completion checkpoint

- Visible preparation persists an optional captured board task/attempt/artifact-version binding in the existing awaiting-delivery row only for explicit passed acceptance and the same run. Legacy pending rows remain readable without a completion binding. No current-focus reconstruction or new scheduler. — codex-runtime-manager
- Actual delivery confirmation requires matching locator IDs, confirmed outcome task/run/delivery identity and passed acceptance before invoking the existing locked completion gate. Unknown/failed sends do not close; stale/paused/replaced tasks are rejected. Successful receipt-based completion updates the board without raw transcript append or another completion bubble. Transient lock rejection retains the existing association for caller retry. — codex-runtime-manager
- Regression: same new tests on pre-change archive produce 3 FAIL / 8 PASS; candidate joint 9 files / 101 PASS including actual durable outcome preparation, memory reset, unknown-to-delivered confirmation and original board closure. Changed-file lint clean, architecture 41 rules PASS, typecheck remains 44 existing diagnostics; full check stops at 63 repository format failures after current main integration. — codex-runtime-manager
- Main advanced; replay preserved the migration and separately merged renderer registry entries, with pre-replay history archived locally. No production deployment. This adds receipt-triggered closure for explicitly accepted captured work; it does not synthesize missing acceptance, add receipt polling, repair old transcript notices, or complete all asynchronous recovery. — codex-runtime-manager

## P0 queued continuation context checkpoint

- Found and reproduced stale continuation context: timer claim rebuilt a resume prompt, but the queued item lost its wake ticket and could execute that prompt after a later accepted constraint. Original queue now carries task/focus identity and revalidates/rebuilds at dequeue before existing task-attempt claim and provider startup. No new timer, job engine or persistence. — codex-runtime-manager
- Red regression: new constraint after enqueue was absent from the original provider prompt. Candidate tests cover refreshed constraints plus paused, changed focus and superseded attempt rejection. Combined continuation/followup/completion/late-receipt regression 59 PASS; changed-file typed lint clean, architecture 41 rules PASS, typecheck 44 existing diagnostics, full check stops on 63 existing formatting failures. — codex-runtime-manager
- This is an in-process queued continuation repair, not full long-job lifecycle acceptance. Real background-job waiting, restart survival, individual/collaboration scope and proactive final delivery remain required. New-attempt claim preserves original writeEpoch behavior while refusing provider execution; no claim of universal write-free rejection. Deployment remains deferred until combined migration acceptance. — codex-runtime-manager

## Real background-process lifecycle evidence checkpoint

- Added an integration test using the actual process supervisor and a real asynchronous Node child, original session event queue, task board, status query, constraint mutation and continuation claim. Both running and owner-paused cases prove process completion does not itself complete the task; status queries are read-only and latest accepted constraints enter the resume prompt. — codex-runtime-manager
- Combined process/continuation/followup/completion/receipt regression: 61 PASS; changed-file typed lint clean; typecheck remains 44 existing diagnostics; full check stops on 63 repository format failures. Test uses actual subprocess execution, but does not claim a real-model or production end-to-end delivery proof. — codex-runtime-manager
- Important remaining gap: exec exit notifications bind only a session key, not original task/attempt/artifact identity. System events and process registry are in-memory. Existing downstream task guards reject paused continuation, but this does not prove task-aware exit wake fencing or cross-restart job recovery. Preserve this original behavior until a separately evidenced binding change is implemented. No production code or deployment changed. — codex-runtime-manager

## Unified interaction checkpoint (2026-11-05)

- Production reply uses handleInteraction. Control and board queries no longer depend on executor occupancy; ordinary dialogue uses the existing isolated response lane only when execution resources are occupied. Legacy active-turn/mid-task-aside are compatibility adapters without a second classifier. — codex-runtime-manager
- Shared relation is conversation/amend/new_work; removed lane-label keyword override. Real amendments containing historical labels still amend; ordinary answer recall needs no lane label; explicit new work is preserved. Existing constraint persistence, stop ordering, cancellation and lane trust isolation remain. — codex-runtime-manager
- Scoped 8-file regression 73 PASS, final added explicit-new-work case and interaction subset 20 PASS; configured reply e2e 47 PASS. Architecture 41 rules PASS; changed-file lint clean; tsgo retains 44 existing diagnostics. Build PASS with 209 existing dynamic-import warnings; full check stops at 63 existing formatting failures. — codex-runtime-manager
- Human explicitly authorized exact-file landing responsibility transfer. Existing Loom matcher has no exclusion semantics, so exact-file sole-lander bindings resolve historical broad claims while retaining other declarations and histories; new session registered. Attribution has no unattributed/conflict files. No push, merge or deployment. Historical lane storage/API names remain compatibility vocabulary, not a user-message category. — codex-runtime-manager

## Shared interaction context and retired entries (2026-11-05)

- Verified context loss in the isolated response call: assembled extraSystemPrompt, skill snapshot and authenticated identity were omitted. Regression fails before repair (1 FAIL / 16 PASS), passes afterward (17 PASS). Forward admitted shared material and identity using the existing inheritance operator; no new retrieval, source authorization or task writes. — codex-runtime-manager
- Removed consumer-free active-turn compatibility entry and test-only mid-task-aside classifier adapter. Migrated assertions to the actual interaction binding; archived original intent, source commit and consumer evidence in archive/interaction-retirement-2026-11-05.md. No live fallback to these retired entries. — codex-runtime-manager
- Affected 4 suites / 34 PASS; configured reply e2e 47 PASS; changed-file lint clean; typecheck retains 44 existing diagnostics. Build PASS with 209 existing dynamic-import warnings. Architecture gate must be rerun after the scoped deletion commit because its cached file scanner includes deleted tracked files before staging. — codex-runtime-manager
- Remaining mainline gaps explicitly identified: idle dialogue still enters task orchestration; depth routing applies to selected sessions; context selection and capability ceilings are coupled. These are not solved by reusing the old aside path or adding another executor. No push, main merge or production deployment. — codex-runtime-manager

## Shared context versus action admission checkpoint (2026-11-05)

- Retired chat-triggered bootstrap clearing, forced empty skill filter and learning-recall suppression. Explicit source/skill choices and normal workspace identity remain available to interaction; action-only required skills stay out of chat. Selected knowledge prefetch no longer reopens all action tools. — codex-runtime-manager
- Before/after boundary regression: old code 4 FAIL / 26 PASS; revised router suite 31 PASS and related four suites 42 PASS. Configured reply E2E 47 PASS; changed-file lint clean; tsgo retains 44 existing diagnostics; build PASS, 209 existing dynamic-import warnings. Architecture 42 rules PASS, including retired-entry import prohibition. — codex-runtime-manager
- Post-deletion architecture gate for f2e70e4c5 also passed (41 rules). Full current-flow review and remaining P0 inference/task admission gap recorded in current-mainline-review-2026-11-05.md; neither taskless conversation nor whole-runtime migration is marked complete. No push/merge/deploy. — codex-runtime-manager

## Retired legacy execution facade (2026-11-05)

- Removed unused runAgentTurnWithFallback adapter after checking production function callers (none) and migrating the sole type-only consumer to the actual type owner. Governance E1/E5 and source assertions now describe the live admitted-turn/candidate path, not compatibility comments. Persisted validator and submitter identities remain unchanged. — codex-runtime-manager
- Fallback/governance/admitted-turn regression: 3 suites / 106 PASS; implicated original embedded-entry assertion 1 PASS / 21 unselected. Typecheck retains 44 existing diagnostics; build PASS with 209 existing dynamic-import warnings. Retired-import guard expanded; post-deletion gate still required after staging. No push/merge/deploy. — codex-runtime-manager

## Shared model authorization session checkpoint (2026-11-05)

- Extracted original commercial slot, model governance snapshot and billing identity lifetime into model/authorized-session. Existing admitted execution consumes that same component; task creation, budget charging, provider fallback and delivery remain outside it. Original execution/lifecycle lease moved without a compatibility implementation. — codex-runtime-manager
- Six suites / 114 PASS, including acquired credit snapshot and BYOK identity; configured reply E2E 47 PASS. Typecheck retains 44 existing diagnostics; changed-file lint clean; build PASS with 209 existing dynamic-import warnings. Main #239 replayed before final verification; ancestry gate restored. — codex-runtime-manager
- This establishes task-independent authorization infrastructure, not a completed taskless interaction service. Ordinary-chat admission, Gateway pre-seeding and embedded preflight separation remain required. No push/merge/deploy. — codex-runtime-manager

## Interaction interpretation contract checkpoint (2026-11-05)

- Added a bounded interaction interpretation use case: one inference returns a reply, clarification or execution proposal with goal and acceptance. Unknown/executable fields are rejected; cancellation before and after inference prevents late decisions. Context roles are preserved. No task writer or tool capability is exposed. — codex-runtime-manager
- Component plus existing interaction/model authorization: 3 suites / 16 PASS; architecture 41 rules PASS; changed-file lint clean; typecheck retains 44 existing diagnostics; build PASS with 209 existing dynamic-import warnings. — codex-runtime-manager
- Contract is not wired to production yet. Provider transport, accounting/history and explicit task admission still require integration; Gateway pre-seeding and embedded preflight remain unchanged. No claim of completed interaction/execution separation or deployment. — codex-runtime-manager

## Interaction target binding checkpoint (2026-11-05)

- Interpretation proposals now distinguish task changes and pause/cancel/resume controls, bound to a trusted host-captured task/revision. Missing or mismatched targets are rejected before returning a decision; proposals still cannot mutate or execute. Cancellation guards remain before and after the single inference. — codex-runtime-manager
- Interpretation 11 PASS; architecture 41 rules PASS; changed-file lint clean. Current typecheck has 46 diagnostics: two newly integrated main feed-delete test errors versus prior 44; no errors in changed interaction files. Replayed onto main #240/#241; post-replay prior component group 16 PASS and build PASS with 209 warnings. Production inference transport and Gateway admission remain unfinished. No deployment. — codex-runtime-manager

## Shared governed inference checkpoint (2026-11-05)

- Shared authorized model session now owns the original governed fallback call; admitted execution supplies the same candidate callback. Calling inference requires successful admission and prepared model governance; disposed/unprepared sessions refuse calls. Optional cancellation is checked before/after each candidate and final response. No task writer or scheduler added. — codex-runtime-manager
- Governance caller registration follows the actual shared owner. Six suites / 116 PASS; configured reply E2E 47 PASS; architecture 41 rules PASS; changed-file lint clean; typecheck remains 46 baseline diagnostics; build PASS with 209 existing dynamic-import warnings. — codex-runtime-manager
- This is shared inference integration into the existing execution consumer, not production taskless interaction cutover. Provider transport, shared history, response accounting and Gateway execution admission still need connection. No push/merge/deploy. — codex-runtime-manager

## Shared model usage recording checkpoint (2026-11-05)

- Moved original successful model credit-usage input construction and record invocation behind the authorized model session. Existing admitted execution consumes the same method; run identity, subscription/authorization snapshot, token normalization, tool counts and fallback attempts remain unchanged. No business task creation is required by this method. — codex-runtime-manager
- Four suites / 17 PASS, including reporting identity and skipped-admission no-reporting cases; configured reply E2E 47 PASS; architecture 41 rules PASS; changed-file lint clean; typecheck remains 46 existing diagnostics; build PASS with 209 existing dynamic-import warnings. — codex-runtime-manager
- Actual standalone interaction transport/history and Gateway admission are still unfinished. This checkpoint closes shared accounting ownership only; it does not claim ordinary chat is taskless. No push/merge/deploy. — codex-runtime-manager

## One-shot interaction completion checkpoint (2026-11-05)

- Added a one-response completion adapter and connected it to prepared shared inference, usage recording and strict interaction decision validation. No embedded runner, tool execution, task preflight or task persistence is imported. Context roles remain distinct; late system blocks are rejected rather than promoted/reordered. Timeout, cancellation, truncated output and unexpected tool calls are rejected. — codex-runtime-manager
- Four suites / 117 PASS; architecture 41 rules PASS; changed-file lint clean; typecheck remains 46 baseline diagnostics; build PASS with 209 existing dynamic-import warnings after replay onto main #242–#244. Governance registry explicitly tracks the new provider boundary. — codex-runtime-manager
- Provider resolution is an explicit host dependency; production ingress, authenticated candidate resolution and durable history integration are NOT activated yet. Joint tests mock the provider completion and do not constitute real-model acceptance. No push/merge/deploy. — codex-runtime-manager

## Trusted interaction candidate resolution checkpoint (2026-11-05)

- Added fixed candidate resolution using canonical inherited identity, the existing managed-account requirement, tenant BYOK transport and model/auth stores. Primary auth profile is not forwarded to another fallback provider; missing identity/model/credentials fail before model invocation. Copilot token conversion and keyless AWS mode preserved. — codex-runtime-manager
- Four suites / 112 PASS; architecture 41 rules PASS; changed-file lint clean; typecheck remains 46 baseline diagnostics; build PASS with 209 existing dynamic-import warnings. Adapter is not activated on ingress yet; history and task admission integration remain open. No push/merge/deploy. — codex-runtime-manager

## Explicit execution admission transaction checkpoint (2026-11-05)

- Added command admission requiring trusted authorization before state commit; cancellation during authorization refuses commit. Existing board lock rechecks task identity, focus revision and write epoch. Accepted tasks persist explicit acceptance criteria and request identity; duplicate requests return a non-executing duplicate disposition. Stale/conflicting/paused requests do not write. — codex-runtime-manager
- Three suites / 29 PASS; architecture 41 rules PASS; changed-file lint clean; build PASS with 209 existing dynamic-import warnings. Typecheck currently 47 diagnostics, none in changed admission/board files; not globally green. Latest main #246 replayed and registry parses without conflict markers. — codex-runtime-manager
- Gateway early task creation has NOT yet been replaced. This transaction is the tested replacement boundary, not a production cutover; individual/collaboration integration and whole-chain real-model acceptance remain open. No push/merge/deploy. — codex-runtime-manager

## Interaction-to-admission routing checkpoint (2026-11-05)

- Command routing joins validated interpretation to explicit execution admission. Replies/clarifications bypass admission and state mutation; bound task changes remain proposals; only execution_request invokes authorization/commit. No executor, queue or retry loop is introduced. — codex-runtime-manager
- Four suites / 33 PASS; architecture 41 rules PASS; changed-file lint clean; typecheck remains 47 diagnostics; build PASS with 209 dynamic-import warnings. Production ingress/history and task-change application are still not switched. No push/merge/deploy. — codex-runtime-manager

## Governed completion-to-admission checkpoint (2026-11-05)

- Prepared interaction now routes its single governed completion directly through command admission. The admission binding is mandatory: no optional legacy bypass, second classifier inference, executor or scheduler. Direct replies bypass task authorization/write; execution proposals retain host authorization and atomic revision rejection. — codex-runtime-manager
- Five suites / 22 PASS; final focused rerun 6 PASS; changed-file typed lint clean; architecture 41 rules PASS; typecheck remains 47 existing diagnostics with none in changed files; build PASS with 209 existing dynamic-import warnings. Production Gateway pre-seeding, transcript integration and interaction cutover remain unfinished. No push/merge/deploy. — codex-runtime-manager

## Gateway interaction ingress checkpoint (2026-11-05)

- Gateway human chat now persists conversation independently of task creation; the focus gate applies only explicit controls/resume with existing live rechecks. Ordinary messages reach shared-context governed interaction, direct replies use the existing Gateway transcript/final outlet, and accepted requests carry task binding and acceptance into the original executor. Duplicate/rejected admission never starts execution; missing admitted binding fails closed. — codex-runtime-manager
- History reads use SessionManager's active branch and a bounded role-preserving view. Existing Gateway SessionManager append owns user/assistant persistence; already-persisted user leaves survive executor preparation and are not duplicated. Bound executor appends refresh the persisted leaf to retain concurrent interaction leaves. This proves same-process interleaving, not cross-process atomic transcript writes. — codex-runtime-manager
- Bound semantic amendments use the original locked constraint log and original user text; stale proposals refuse writes. Pause/cancel keep abort and queue cleanup; semantic resume refuses automatic execution and requires the existing live Gateway recheck. Legacy composer mention execution is suppressed before admission. Deferred follow-up: restore its required behavior only inside the admitted capability boundary, verify attachment modality, managed concurrency and collaboration/channel entrances with a real model. — codex-runtime-manager
- Red evidence: original Gateway focus gate fails all three new ordinary-ingress no-write cases; candidate passes. Joint 10 files / 111 PASS, then added missing-binding regression / 3 PASS; configured reply E2E 47 PASS. Architecture 41 rules PASS; changed-file typed lint and format clean; typecheck retains 47 diagnostics; build PASS with 209 dynamic-import warnings. Full check stops at 61 existing format failures. Main #247 merged; no push, trunk merge or deployment. — codex-runtime-manager

## State facade and wiring closure checkpoint (2026-11-06)

- Gateway task reads/resume binding, admitted-turn host checks, normal/queued task capture/start and delivery completion now consume the state public facade. Original board locking, CAS, tombstones and completion implementation remain single-owned; no copied storage or new task lifecycle. Three manifest guards reject direct old-board imports at migrated Gateway/delivery/execution host consumers. Commits 153c402a7, dac7d5417, c206acb8c. — codex-runtime-manager
- Moved the existing Gemini corruption cleanup sequence out of wiring into state/session-recovery with explicit storage ports. Missing transcript cleanup remains best effort; in-memory removal precedes the original locked store update; failures remain reported. This equivalent extraction does not solve concurrent session-reset races or unify the different compaction/role-conflict reset behavior still in agent-runner. Commit 7a32e3713. — codex-runtime-manager
- Final joint regression: 9 files / 97 PASS; earlier binding-specific group: 7 files / 97 PASS (overlapping, not summed). Changed-file type-aware lint clean; architecture 47 rules PASS; final build PASS with 209 dynamic-import warnings; tsgo retains 47 diagnostics and none in this slice. No deployment or running gateway restart. — codex-runtime-manager
- Remaining original-scope order: finish old reply adapter responsibility inventory and coherent session-reset extraction; complete builder resolve/read/render/audit acceptance; per-adapter capability contracts and evidence-backed extension disposition; restart-safe asynchronous recovery/final delivery and artifact lifecycle; same-version individual/collaboration/model/channel acceptance. F1/F4 are advanced, not globally closed. UI observability remains a read-only supporting projection. — codex-runtime-manager

## Recovery state and binding-policy checkpoint (2026-11-06)

- Original replacement-session model snapshot preparation now has one state owner; old reply adapter calls it through fixed wiring. User preferences remain, transcript-bound model/fallback fields reset exactly as before. Original reply E2E 47 PASS before and after; state recovery component 4 PASS. Commit 1472d742d. — codex-runtime-manager
- Original live-task binding predicate moved to pure policy/task-binding; board startup and locked completion consume the same rule, old implementation removed. Before-action check reads one board snapshot for identity and constraints, avoiding mixed-snapshot decisions. Commits a0b45986c, c84307508. This does not claim atomicity between check and external side effect or semantic enforcement of all natural-language restrictions. — codex-runtime-manager
- Final combined 10 files / 101 PASS, including 7 cross-process board tests and real background-child stale/pause/constraint wake checks. Architecture 47 rules PASS; changed-file typed lint clean. Last full build preceded binding-policy extraction and passed with 209 warnings; not represented as final-tip build. Whole-tree tsgo currently 53 errors: prior 47 plus 6 in concurrently edited observation workbench/diagnosis files; this slice has no diagnostics. Foreign UI/registry WIP excluded from these commits. — codex-runtime-manager
- Source audit additionally confirms commands/agent.ts retains its own command/subagent orchestration, commercial admission and fallback path. Do not declare all execution entrances unified based solely on normal reply entry. Preserve command/subagent snapshot/parent-budget semantics before migration; this is an explicit remaining consumer, not an implicit fallback approved for deletion. — codex-runtime-manager

## Command entrance baseline blocker (2026-11-06)

- Before modifying command execution, ran agent.test, agent.governance-path, agent.credit-usage and lifecycle-attribution suites. Three suites fail during module import because isolated-agent.mocks omits queueEmbeddedPiMessage now required by command-adapters; lifecycle source test passes. No command behavior was changed and no failing suite was counted as passed. Repair the faithful shared test adapter before extracting command candidate/fallback orchestration; preserve parent snapshots, child budget and CLI session-expiry semantics. Concurrent observation/registry WIP belongs to its separate stream and is not included. — codex-runtime-manager

- Command baseline restored without production changes: added missing idle-run/steer mock exports; corrected two stale canonical-directory expectations to the existing custom-store directory contract, including macOS realpath normalization. Command, governance and credit suites now 3 files / 54 PASS. Production candidate extraction has not begun; preserve this green baseline before moving the original candidate body. Commit 3956bb6d5. — codex-runtime-manager

## Command candidate migration checkpoint (2026-11-06)

- Original runAgentAttempt body moved from commands/agent.ts to execution/runner/command-candidate.ts; real consumer calls execution/index.runCommandCandidate. Old candidate implementation removed. CLI credential resolution, expired-session retry/persistence, usage attribution, enterprise transport, provider-scoped auth and inherited execution identity retained. Fixed session persistence is an internal typed port, not configurable executable policy. Commit a5b9c926a. — codex-runtime-manager
- Command/governance/credit regression 3 files / 54 PASS after migration; identity/lifecycle source checks 2 files / 3 PASS. Updated stale identity anchor from agent-runner-utils to actual preparation owner. Changed-file typed lint clean; architecture 47 PASS; build PASS with 209 dynamic-import warnings. Whole-tree tsgo 53 diagnostics, none in candidate/command/public-entry files. — codex-runtime-manager
- This retires the command-local candidate implementation, not the full command orchestration. Outer fallback, commercial gate, parent-budget accounting, ACP and command delivery still retain their explicit original scenario owners. No claim of unified all-entry orchestration or production acceptance; no push/merge/deploy. — codex-runtime-manager

## Command state integration checkpoint (2026-11-06)

- Command session writes moved into state/command-session; original merge, explicit override deletion, locked store update and in-memory refresh retained. Command candidate now binds the same authoritative writer directly through state/index; removed caller-supplied persistence callback. Commits 9850e00c9, 62e1e86e2. — codex-runtime-manager
- Command/state/governance/credit regression 4 files / 55 PASS before callback removal; command/credit 2 files / 46 PASS afterward; state/session-store 2 files / 4 PASS. Overlapping counts are not summed. Architecture 48 PASS; changed-file typed lint clean; tsgo 53 diagnostics, none in command-state/candidate/command entrance. No final-tip build or real-model acceptance claimed. — codex-runtime-manager
- Outer command fallback/parent-budget/ACP/delivery ownership remains open. Concurrent observation source and registry changes are excluded. No push, merge or deployment. — codex-runtime-manager

## Command cancellation integration checkpoint (2026-11-06)

- Found command CLI candidate omitted opts.abortSignal although the CLI runner supports it; embedded candidate already forwards it. Added forwarding through the shared initial/expired-session retry constructor. Command regression 32 PASS includes identical signal on both attempts. Commit c5080ed65. This proves signal propagation, not cross-restart cancellation. — codex-runtime-manager
- Command state integration full build PASS before this one-field fix, 209 dynamic-import warnings; architecture 48 PASS; changed-file typed lint clean. Concurrent observation sources and registry edits remain excluded. Outer fallback, parent budget, ACP and delivery closure remain open. — codex-runtime-manager

## Command budget ownership checkpoint (2026-11-06)

- Moved the original per-command budget sequence and parent attribution arguments to execution/runner/command-budget; command consumer uses the execution public API. Original pre-call gate, successful/unknown usage charge, error precedence and closeout flags remain at their original invocation points. Old local sequence and direct budget calls removed. Commit 7bc21b28b. — codex-runtime-manager
- Command/governance/credit 3 files / 54 PASS; separate command/credit/task-budget 3 files / 55 PASS (overlapping). Architecture 48 PASS and changed-file typed lint clean. Whole-tree tsgo 54 diagnostics, none in command-budget or command entrance. Component-specific sequence/failure tests and final build remain required before whole-chain acceptance. No push/merge/deploy. — codex-runtime-manager

- Budget component regression now verifies trimmed parent identity, monotonically increasing call sequence after a failed charge, and no fabricated task/charge without binding (2 PASS, 3ee61b6d2). Final budget-candidate build PASS with 209 dynamic-import warnings. Command/credit/task-budget group 3 files / 55 PASS; architecture 48 PASS. Outer command fallback, ACP and delivery migration remain open. — codex-runtime-manager

## Command fallback boundary checkpoint (2026-11-06)

- Command fallback invocation and retry identity moved behind execution/index.runCommandFallback; original model fallback remains the only retry engine. Old command-local attempt counter removed; governance parameters and budget timing preserved. Commits f79d372b6, 24f2cb83a. — codex-runtime-manager
- Updated model caller registry to actual command invocation owner and removed stale followup call-site row (followup already consumes the shared authorized model session). Governance scan retains source-completeness checks and now passes 96 tests; command governance plus budget joint 106 PASS; command/governance/credit 54 PASS separately. Retry identity isolation test 1 PASS; changed-file typed lint clean; architecture 48 PASS. — codex-runtime-manager
- Full build after fallback extraction PASS with existing dynamic import warnings; tsgo 52 diagnostics, none in this slice. Command budget error handling/closeout, commercial admission, ACP, delivery and complete same-version real-model acceptance remain open. No push/merge/deploy. — codex-runtime-manager

## Shared command admission lifetime checkpoint (2026-11-06)

- Command execution now uses the existing shared admission lease; removed local held flag and duplicated release/forget branch. Typed input/result parameters preserve the original commercial gate result and default model-session API. Denied/skipped runs do not release; acquired runs release before snapshot forgetting. Commit ee04e7113. — codex-runtime-manager
- Shared lease/model-session/command credit/governance joint 4 files / 34 PASS; command behavior 32 PASS separately; governance contract plus lease 101 PASS after updating the real acquisition anchor. Architecture 48 PASS; changed-file typed lint clean. Whole-tree tsgo 57 diagnostics, none in this slice; parallel observation changes excluded. No final-tip build or real-model acceptance claimed. Commercial gate policy, command outcome closeout, ACP and delivery responsibility migration remain open. No push/merge/deploy. — codex-runtime-manager

## Command and ACP presentation checkpoint (2026-11-06)

- Nested command output formatting and ACP visible-text accumulation now live in delivery/presentation/command-output; original command implementations removed and consumers use delivery/index. Preserved silent-prefix suppression, repeated deltas, cumulative snapshots, raw transcript whitespace and nested identity prefixes. Commits 3eb6b2546, 4185a5d1a. — codex-runtime-manager
- Delivery and ACP regression 2 files / 28 PASS before and after; changed-file typed lint clean; architecture 48 PASS. Whole-tree tsgo 53 diagnostics, none in changed presentation/command files. This is presentation ownership only: channel dispatch, receipts, ACP run orchestration and transcript state migration remain open. No push/merge/deploy. — codex-runtime-manager

## ACP transcript state checkpoint (2026-11-06)

- Original ACP transcript persistence moved into state/acp-transcript; command calls state/index and the old body is removed. SessionManager remains the message writer; raw transcript whitespace, session-file preparation, original synthetic usage and transcript update notification remain unchanged. Commit cb4fc7b61. — codex-runtime-manager
- ACP/delivery/interaction-transcript joint 3 files / 29 PASS; changed-file typed lint clean; architecture 48 PASS. This does not claim cross-process transcript serialization or ACP execution orchestration migration. Channel receipts, ACP run ownership and final same-version acceptance remain open. No push/merge/deploy. — codex-runtime-manager

## ACP execution ownership checkpoint (2026-11-06)

- ACP command policy checks, observational preflight, backend invocation and lifecycle emission moved to execution/runner/acp-turn through execution/index. Removed original command-local body; transcript writes remain in state and text projection remains in delivery. Policy-before-backend ordering, cancellation signal, raw transcript text and error/end events preserved. — codex-runtime-manager
- Joint command/ACP/delivery/governance/credit regression: 5 files / 82 PASS. Source contract now checks actual execution owner and command public-entry consumption. Architecture 48 PASS; changed-file typed lint clean; full build PASS with 209 dynamic-import warnings. Whole-tree tsgo 53 diagnostics, none in changed files. No gateway restart, push, merge or deployment. Commercial gate policy, command outcome settlement, channel receipt ownership and final same-version acceptance remain open. — codex-runtime-manager

## Command dispatch ownership checkpoint (2026-11-06)

- Complete command result dispatch moved to delivery/dispatch/command-result and actual consumer now imports delivery/index; old commands/agent/delivery.ts removed. Original channel selection, target validation, JSON/nested output and best-effort behavior retained. Delivery now consumes a structural metadata/payload contract rather than importing the embedded runner type; lane identity comes from the canonical process enum. No duplicate dispatch implementation retained. — codex-runtime-manager
- Joint command/ACP/delivery/governance/credit regression 5 files / 82 PASS after final boundary changes. Architecture 48 PASS; changed-file typed lint clean; full build PASS with 209 existing dynamic-import warnings. Whole-tree tsgo currently 57 diagnostics, none in changed files. These results do not prove transport receipts, task acceptance or whole migration completion. No push, merge or deployment. — codex-runtime-manager

## Command outcome ownership checkpoint (2026-11-06)

- Original command closeout moved to execution/outcomes/command-outcome through execution/index; old closure removed. Preserved missing-binding deferral, current budget snapshot, at-most-once persistence, failure reporting and explicit entrypoint. Execution success does not fabricate acceptance or delivery evidence. — codex-runtime-manager
- Component plus command/governance/credit regression 4 files / 56 PASS. Tests cover deferred identity, concurrent repeated closeout, budget double-charge prevention and persistence failure. Architecture 48 PASS; changed-file typed lint clean; full build PASS with 209 existing dynamic-import warnings. Whole-tree tsgo 53 diagnostics, none in changed files. Commercial admission policy and final whole-chain acceptance remain open; no push, merge or deployment. — codex-runtime-manager

## Whole-repository typecheck repair (2026-11-06)

- Reproduced 53 TypeScript diagnostics and corrected all implicated contracts: typed mock signatures, reply union narrowing, history role literals, nullable UI state, valid projection fixtures, collaboration timestamps, DOM button types and generic RPC test responses. Removed duplicate production workbench unit declaration; no compiler suppression or production enum widening. Files explicitly registered for bounded repair; unrelated observation WIP excluded. — codex-runtime-manager
- pnpm tsgo PASS (zero diagnostics). Related backend suites 11 files / 62 PASS; UI suites 5 files / 172 PASS. Changed-file typed lint clean; architecture 48 PASS; full build PASS with 209 existing dynamic-import warnings. No gateway restart or deployment. — codex-runtime-manager

## Independent three-perspective acceptance (2026-11-06)

- Three independent read-only reviewers assessed architecture, personal/collaboration mainline and legacy retirement. All refuse overall completion/retirement; reports are expert-1-architecture-acceptance-2026-11-06.md, expert-2-mainline-acceptance-2026-11-06.md and expert-3-retirement-acceptance-2026-11-06.md. Mainline component tests 5 files / 37 PASS; no real-model, restart or production evidence. Preserve active Pi/CLI/ACP, cron and followup adapters until their original responsibilities are covered. — codex-runtime-manager
- Next gates: thin command orchestration; complete builder/capability contracts; distinct execution/acceptance/delivery receipts; restart-safe recovery and personal/group real-model/channel matrix; effective hook/transform/workflow consumer and persisted-asset audit. Delete only after matching evidence and immutable archival; no bulk directory deletion. — codex-runtime-manager

## Command commercial admission ownership (2026-11-06)

- Existing command commercial gate moved into shared model infrastructure, consumed through model/index; old implementation removed. Preserved server-side identity, subscription snapshots, quota and concurrency, E2/E3/E6 attribution, best-effort observation and original release. Updated stale gate-owner registry to actual delegated owners (authorized-session and billable-bot); no gate bypass introduced. — codex-runtime-manager
- Governance/credit/commercial regression 5 files / 127 PASS; full tsgo PASS, architecture 48 PASS, changed-file typed lint clean, build PASS with 209 existing dynamic-import warnings. Complete command orchestration remains open; no push/merge/deployment. — codex-runtime-manager

## Acceptance blocker remediation checkpoint (2026-11-06)

- Command delivery now captures transport status separately from successful execution and persists it through the existing outcome closeout. Empty/unknown adapter ids do not prove delivered; any partial failure stays failed. No acceptance is fabricated. Original transport errors still reject; command cancellation reaches the send boundary. Receiver-side confirmation, durable retry correlation and full end-to-end delivery remain separate open gates. — codex-runtime-manager
- Removed duplicated admission transaction mapping from two wiring entrances into command; transcript persistence consumes state public index. Individual/collective architecture unification is not declared complete. — codex-runtime-manager
- Real two-process pending-delivery tests rehydrate original task/attempt/version and prove duplicate receipt idempotency, paused/cancelled stale completion rejection. This proves durable delivery association, not background shell survival or discovery of external jobs. Fixture lives outside production runtime. — codex-runtime-manager
- Joint command/ACP/receipt/restart regression 5 files / 69 PASS; final placeholder receipt regression 2 files / 17 PASS; relocated restart fixture group 3 files / 19 PASS. Counts overlap. Architecture 48 PASS; typed lint clean; full tsgo PASS after parallel observation repair; full build PASS with 209 existing dynamic-import warnings. No gateway restart, push, merge or deployment. — codex-runtime-manager

## Command attribution and capability contract remediation (2026-11-06)

- Command outcome identity/entry creation moved into command/command-outcome-entry at the original execution point; old command-local subject/tenant and three-way ensure body removed. Preserved CLI/Gateway/subagent identity precedence, parent linkage and missing-binding behavior. No new task storage or normal-chat auto-creation. — codex-runtime-manager
- Capability declarations no longer claim universal signal forwarding/cancellation. Unknown cancellation remains explicit, tool return never grants task acceptance, Lobster external recovery token ownership is declared without a second scheduler. Per-adapter actual cancellation and terminal tests remain open. — codex-runtime-manager
- Combined command/governance/credit/catalog/component regression 5 files / 60 PASS; typed lint clean, architecture 48 PASS, build PASS with 209 existing warnings. Current whole-tree tsgo has one parallel observation browser-fixture error; these changes have no diagnostics. No push, merge or deployment. — codex-runtime-manager

## Command admission and Skill exposure ownership (2026-11-06)

- Command lease, acquired parent-model snapshot and fallback governance mapping now have one model/command-admission-session owner; old commands model-governance implementation removed and consumers migrated. Child E6 slot acquisition retains inherited parent snapshot, release-before-forget ordering and the original fallback engine. — codex-runtime-manager
- Skill prompt/exposure mapping moved into context/sources/run-skills with original resolver and execution environment setup/restoration retained. Rejected a proposed forwarding-only prepare API during integration; only the substantive render/observe component remains. No extra source evaluation, model call or tool activation. — codex-runtime-manager
- Command governance/admission joint 6 files / 136 PASS; Skill/attempt regression 4 files / 68 PASS; recovery-owner regression 5 files / 53 PASS. Counts overlap other checkpoints. Full tsgo PASS at final integration; architecture 48 PASS; changed-file typed lint clean; build PASS with 209 existing dynamic-import warnings. Complete builder and all-entry/real-channel acceptance remain open. No push/merge/deploy. — codex-runtime-manager

## Best-effort transport recovery correctness (2026-11-06)

- Reproduced two failing regressions on the old implementation: partial delivery without caller onError was acknowledged, and recovery counted a best-effort failure as recovered. Fixed internal error tracking regardless of external callback and propagated recovery payload failures into the existing fail/retry path. No new queue or runner dependency. — codex-runtime-manager
- Red baseline 2 FAIL / 104 PASS; candidate 2 files / 106 PASS. Full tsgo PASS; changed-file typed lint clean; build PASS with 209 existing warnings. This does not close unknown-receipt, whole-batch replay idempotency or durable task-binding recovery gates. No external messages, push, merge or deploy. — codex-runtime-manager

## Context overflow recovery ownership (2026-11-06)

- Moved the complete overflow recovery decision/compaction/truncation transaction into execution/recovery/context-overflow; removed the old run-local block. Caller retains the sole attempt loop, fixed compact request, terminal payload/usage and delivery evidence. SDK-compacted attempts do not compact twice; global retry cap is retained across truncation. Fixed typed ports preserve old implementations without reverse imports into the legacy runner. — codex-runtime-manager
- Component plus real run consumer regression 3 files / 24 PASS; architecture 48 PASS; changed-file typed lint clean; full build PASS with 209 existing warnings. Whole-tree tsgo currently has one parallel heartbeat-activity test diagnostic, none in this slice. The loop test needed the same runtime-plugin loader stub already used by the sibling suite; no production loader behavior changed. Full old-run retirement and same-version personal/group live acceptance remain open. No push/merge/deploy. — codex-runtime-manager

## Embedded usage aggregation ownership (2026-11-07)

- Original accumulator, last-call cache projection and error usage metadata moved out of legacy run.ts into execution/outcomes/usage-summary. Old local implementations removed. Pure usage normalization moved to shared/usage; agents/usage is a same-function compatibility export for existing consumers, not a second implementation. Remaining consumers must migrate before that compatibility file is removed. — codex-runtime-manager
- Baseline usage reporting 5 PASS; candidate component/normalizer/real runner overflow and usage regression 5 files / 47 PASS. Architecture 48 PASS; changed-file typed lint clean; build PASS with 209 existing warnings. Parallel observation WIP currently introduces type diagnostics outside these files; no full-tree green claim at this tip. No push/merge/deploy. — codex-runtime-manager

## Runtime command routing contract boundary (2026-11-07)

- Routing context and trusted command entry ids now have a pure runtime contracts owner. Model admission/governance and execution candidates no longer import the old command host for these types; original adapter types re-export identical contracts. No runtime behavior changed. Full command request DTO and remaining host adapters are still explicit debt. — codex-runtime-manager
- Command/admission/governance/credit regression 4 files / 58 PASS; full tsgo PASS at integration; architecture 48 PASS; typed lint clean; build PASS with 209 existing warnings. No push/merge/deploy. — codex-runtime-manager

## Narrow delivery data boundary (2026-11-07)

- Delivery now consumes CommandDeliveryOptions from runtime contracts rather than the complete old command-host options. Model governance and delivery cannot re-import commands under two new architecture guards. No routing, permission or transport behavior changed. — codex-runtime-manager
- Command/ACP/delivery regression 3 files / 64 PASS; full tsgo PASS at integration; architecture 50 PASS; typed lint clean; build PASS with 209 existing warnings. Full request DTO and old backend retirement remain open. No push/merge/deploy. — codex-runtime-manager

## Execution candidate input boundary (2026-11-07)

- Candidate input now uses the exact execution fields and canonical trusted identity contract; the final runtime import of old command-host options is removed. Added an architecture guard prohibiting execution from importing commands. No invocation order, identity forwarding or provider behavior changed. — codex-runtime-manager
- Command/governance/credit regression 3 files / 54 PASS; full tsgo PASS; architecture 51 PASS; typed lint clean. Type-only boundary change after the prior passing full build; no new runtime build claim. No push/merge/deploy. — codex-runtime-manager

## Joint integration checkpoint (2026-11-07)

- Combined current runtime components, command/ACP/delivery/governance/credit, real two-process pending delivery, local background child, embedded usage and overflow regressions: 58 files / 312 PASS. Provider/channel transports remain mocked except the explicitly local child-process evidence. No real external channel or model acceptance is claimed. — codex-runtime-manager
- Full tsgo PASS and architecture 51 PASS at this integration checkpoint. Last full build passed with 209 existing warnings; subsequent candidate change was type-only. Original core loop, durable retry identity, complete builder/adapter contracts and final personal/group live acceptance remain open. No push, merge or deployment. — codex-runtime-manager

## Unknown recovery receipt guard (2026-11-07)

- Reproduced recovery falsely acknowledging missing and placeholder transport receipts (2 FAIL / 65 PASS). Recovery now requires every returned message id to be confirmed; unknown receipt batches are preserved under failed/ for reconciliation and are not automatically replayed on another recovery pass. Original return API and retry owner remain. This does not provide exactly-once transport or complete task-binding recovery. — codex-runtime-manager
- Candidate queue/shared-receipt regression 2 files / 69 PASS; architecture 51 PASS; typed lint clean; build PASS with 209 existing warnings. Parallel comparison UI fixture has an unrelated type error at the latest check; no global green claim for this checkpoint. No external send, push, merge or deploy. — codex-runtime-manager

## Context window policy ownership (2026-11-07)

- Pure context-window selection and limit classification now live in policy/context-window and are consumed through policy/index by run, compaction, extensions and onboarding. Old agents/context-window-guard implementation removed; all source consumers and test mocks migrated, without a compatibility execution path. Existing config priority, cap thresholds and warnings remain unchanged. — codex-runtime-manager
- Baseline guard/onboarding 2 files / 29 PASS; candidate guard/onboarding/overflow/usage regression 5 files / 55 PASS. Full tsgo PASS; architecture 51 PASS; changed-file typed lint clean; build PASS with 209 existing dynamic-import warnings. No push, merge or deployment. — codex-runtime-manager

## Authentication candidate ownership (2026-11-07)

- User-pin validation, provider match, configured order and fallback candidate selection moved from legacy run.ts into model/auth-profile-candidates. Credential reads, cooldown rotation and token refresh stay at their original execution points. Old selection body removed; no new authentication or retry engine. — codex-runtime-manager
- Original auth-rotation configured integration 25 PASS before and after; component/usage 2 files / 7 PASS. Full tsgo PASS; architecture 51 PASS; typed lint clean; build PASS with 209 existing warnings. No real-provider call, push, merge or deploy. — codex-runtime-manager

## Authentication rotation lifecycle (2026-11-07)

- Request-local initial credential traversal and profile advancement moved from legacy run.ts into model/auth-profile-rotation. User pins, cooldown skipping, explicit transient probe, failed credential advancement and original thinking-reset timing preserved. Caller still owns the only model retry loop; no new scheduler or credential store. — codex-runtime-manager
- Original configured auth rotation integration 25 PASS; component 3 PASS; full tsgo PASS; architecture 51 PASS; changed-file typed lint clean; full build PASS with 209 existing warnings. No real-provider invocation, push, merge or deploy. — codex-runtime-manager

## Provider credential refresh lifecycle (2026-11-07)

- Copilot credential refresh timing, bounded scheduled retry and timer cleanup moved from legacy run.ts into model/copilot-token-refresh. Initial credential exchange remains at its original location; run teardown invokes the lifecycle stop method. No task scheduling, new model loop or credential persistence introduced. — codex-runtime-manager
- Original configured authentication integration 25 PASS; lifecycle component 2 PASS after waiting for the mocked dynamic import to settle. Full tsgo PASS; architecture 51 PASS; typed lint clean; full build PASS with 209 existing warnings. No real-provider invocation, push, merge or deploy. — codex-runtime-manager

## Embedded model preparation ownership (2026-11-07)

- Model resolution, BYOK synthesis, endpoint override and effective context-window preparation moved from legacy run.ts into model/prepare-embedded-model. Original provider resolution adapter and public context policy remain single-owned; old run-local preparation body removed. Credential application, hooks and model attempts retain their original order. — codex-runtime-manager
- Component 2 PASS; overflow/usage regression 3 files / 26 PASS; configured authentication integration 25 PASS. Full tsgo PASS; architecture 51 PASS; typed lint clean; full build PASS with 209 existing dynamic-import warnings. No real-provider invocation, push, merge or deployment. — codex-runtime-manager

## Shared run limit policy (2026-11-07)

- Original overall attempt cap, overflow compaction cap and overload backoff parameters moved from legacy run.ts into policy/run-limits. Existing sole loop consumes fixed data and pure budget selection; no executable configuration or additional retry engine. Thresholds and cancellation behavior unchanged. — codex-runtime-manager
- Policy/overflow regression 3 files / 22 PASS; full tsgo PASS; architecture 51 PASS; typed lint clean; full build PASS with 209 existing warnings. No push, merge or deployment. — codex-runtime-manager

## Embedded payload presentation ownership (2026-11-07)

- Complete embedded payload shaping moved into delivery/presentation/embedded-payloads; old run/payloads implementation removed. Fixed wiring binds existing formatting helpers only. Error/raw-payload suppression, silence, reasoning, mutating-tool warnings and directive behavior retain their original implementation and order. No new delivery path or model loop. — codex-runtime-manager
- Baseline payload suites 2 files / 40 PASS; candidate payload/overflow/usage joint 5 files / 66 PASS; configured authentication integration 25 PASS. Full tsgo PASS; architecture 51 PASS; typed lint clean; build PASS with 209 existing warnings. Full legacy-run retirement and real-model/channel acceptance remain open. No push, merge or deployment. — codex-runtime-manager

## Approval failure notification lifecycle (2026-11-07)

- Reproduced an unhandled rejection when approval waiting fails and its detached failure notification also rejects. Gateway and node callers previously discarded the notification Promise. The existing approval helper now awaits and contains notification failure, retaining an unavailable decision and never authorizing execution. No second scheduler or execution path introduced. — codex-runtime-manager
- Red regression exited 1 with an unhandled notification rejection; fixed shared-host/approval-request regression 2 files / 14 PASS. Full tsgo PASS, changed-file typed lint clean, architecture 51 PASS. Isolated Deepseek Gateway live prompt/read/exec probe exited 0 (1 PASS, 1 unrelated test skipped), without unhandled errors; temporary state removed and channels disabled. This does not establish complete personal/group/channel acceptance or old-runner retirement. No push, merge or deployment. — codex-runtime-manager

## Embedded teardown ownership (2026-11-07)

- Moved fixed context disposal, credential timer shutdown and working-directory restoration from the legacy runner into execution/runner/embedded-cleanup. Nested finally guarantees later cleanup even when context disposal or timer shutdown fails; errors remain observable. No configurable script, scheduling or additional execution loop. — codex-runtime-manager
- Cleanup/overflow/usage regression 4 files / 29 PASS; full tsgo PASS; changed-file typed lint clean; architecture 51 PASS; full build PASS. Existing dynamic-import and UI chunk warnings remain. No gateway restart, push, merge or deployment; full old-runner retirement remains open. — codex-runtime-manager

## Attempt terminal attribution ownership (2026-11-07)

- Moved terminal failure/unknown attribution from the legacy attempt into execution/outcomes; removed the original implementation and migrated its regression consumer to the public execution entry. A normal turn still does not invent task success or accepted delivery. — codex-runtime-manager
- Original and migrated attribution/attempt suites both 2 files / 66 PASS. Full tsgo PASS, changed-file typed lint clean, architecture 51 PASS. Core runner and attempt remain active; this checkpoint does not establish complete replacement or retirement. — codex-runtime-manager

## Native tool stream adapter migration checkpoint (2026-11-07)

- Native tool-name/id stream normalization moved out of the legacy attempt into shared model/native-tool-stream, with the original implementation removed and the regression consumer migrated. Protocol-body non-execution checks remain at their original boundary and use the same normalization functions. No new tool invocation or retry path. — codex-runtime-manager
- Attempt regression 59 PASS; changed-file typed lint clean; architecture 51 PASS. Full tsgo currently fails only in concurrent observation/query-gateway and reasoning-gateway test work; no global green or final retirement claim. Migration remains uncommitted pending integration checks. — codex-runtime-manager
- Integration follow-up: combined attempt/overflow/attribution 4 files / 87 PASS; latest full tsgo PASS after concurrent observation corrections. Native adapter migration is now eligible for scoped commit; foreign staged changes must remain untouched. — codex-runtime-manager

## Provider stream adapter ownership (2026-11-07)

- Moved Ollama context-window payload adaptation and XAI native argument decoding from the legacy attempt into separate shared model components. Original bodies removed; caller ordering and protocol boundary preserved. No provider loop or task authority added. — codex-runtime-manager
- Existing attempt regression 59 PASS; full tsgo PASS; changed-file typed lint clean; architecture 51 PASS. Full legacy execution replacement remains open. — codex-runtime-manager

## Prompt composition ownership (2026-11-07)

- Moved admitted system-context composition and context-engine prompt addition from legacy attempt into shared context/prompt-composition. Original implementations removed and tests consume the public context entry. Hook invocation and trust selection remain host responsibilities; composition introduces no model calls or task control. — codex-runtime-manager
- Attempt and execution-order regression 2 files / 85 PASS; full tsgo PASS; changed-file typed lint clean; architecture 51 PASS. Complete legacy runner retirement remains open. — codex-runtime-manager

## Awaited model admission cleanup (2026-11-07)

- Shared model lease disposal now returns one awaitable Promise; command, interaction and admitted execution wait for release. Snapshot cleanup runs even on release failure. No additional execution path. — codex-runtime-manager
- Joint command/governance/credit/model-session regression 8 files / 76 PASS; additional pending-release identity test brings focused lease suite to 6 PASS. Full tsgo PASS; changed-file typed lint clean; architecture 51 PASS. Pending scoped commit and final integration; no retirement or deployment claimed. — codex-runtime-manager

## Shared inference parameter contract (2026-11-07)

- Provider stream parameters now belong to runtime contracts; embedded and CLI backends no longer import command-host options for this shared type. Original command export remains type-only compatibility. — codex-runtime-manager
- CLI/command regression 2 files / 45 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Complete executor replacement remains open. — codex-runtime-manager

## Prompt hook adapter ownership (2026-11-07)

- Existing prompt hook invocation, cached legacy-result reuse and deterministic merge moved from the legacy attempt into capabilities/adapters/prompt-build-hooks. Original implementation removed; no additional hook invocation or execution authority added. — codex-runtime-manager
- Attempt and ordering regression 2 files / 85 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Complete core-loop replacement and retirement remain open. — codex-runtime-manager

## Followup model cleanup integration (2026-11-07)

- Queued followup now awaits the shared model lease disposal. Repaired stale embedded test mocks with the existing queue/abort exports required by command wiring. Followup/BYOK/OGUI regression 3 files / 35 PASS; full tsgo PASS; changed-file typed lint clean. Earlier joint runtime/command/attempt regression 61 files / 346 PASS. Full core-loop replacement and retirement remain open. — codex-runtime-manager

## Cron admission cleanup boundary (2026-11-07)

- Routing and snapshot preparation now sit inside the acquired-slot cleanup boundary. Previously no_executable_candidates could throw before finally and leak the slot. Snapshot forgetting also runs when release fails. Regression rejects before model startup and verifies exactly one release. — codex-runtime-manager
- Cron model/fallback/owner regression 3 files / 10 PASS; added boundary suite 4 PASS; full tsgo PASS and changed-file typed lint clean. Full runtime replacement remains open. — codex-runtime-manager

## Cron shared model lifecycle (2026-11-07)

- Cron now uses createAuthorizedModelSession for authorization, governance snapshot, fallback and awaited disposal; removed its duplicate lifecycle implementation. Candidate execution and durable usage outbox remain unchanged. Updated commercial gate registry to the delegated owner. — codex-runtime-manager
- Cron credit/fallback, long-horizon and commercial gate regression: 4 files / 24 PASS. Full tsgo PASS; typed lint 0 errors; architecture 51 PASS. Pi core loop still has production consumers; no complete retirement, merge or deployment claimed. — codex-runtime-manager

## Model resolution hook ownership (2026-11-07)

- Moved model-resolution hook ordering and legacy-result caching from the old runner into capabilities/adapters/model-resolve-hooks. Removed original body; preserves new-hook precedence per field, legacy prompt result reuse and nonfatal hook failures. No new execution authority. — codex-runtime-manager
- Adapter and attempt regression 2 files / 63 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Old core loop still serves production consumers and remains pending replacement. — codex-runtime-manager

## Provider credential application ownership (2026-11-07)

- Moved resolved credential application from legacy run.ts into model/apply-provider-credential. Preserves AWS SDK identity, missing-key rejection, Copilot token exchange and refresh ordering. Original body removed; no credential store or retry loop added. — codex-runtime-manager
- Credential/refresh regression 2 files / 6 PASS; auth rotation integration 25 PASS. Full tsgo PASS; typed lint clean; architecture 51 PASS. Prior checkpoint full build PASS with dynamic-import and UI chunk warnings; complete retirement remains open. — codex-runtime-manager

## Unique embedded run implementation migration (2026-11-07)

- Moved the sole embedded run implementation to execution/runner/embedded-run; deleted old agents/pi-embedded-runner/run.ts and migrated every source consumer and source-inspection test. Existing agents facade delegates to execution/index. No parallel implementation or implicit fallback remains at the removed path. Archive tag archive/runtime-embedded-run-754681919 preserves the original. — codex-runtime-manager
- Preserves original lane ordering, attempt loop, profile rotation, overflow recovery, cancellation, accounting evidence and cleanup. Shared model/policy/delivery components retain their existing ownership. Added old-path import prohibition to retirement gate. — codex-runtime-manager
- Regression 10 files / 70 PASS; configured embedded/auth/fallback integration 3 files / 34 PASS; full tsgo PASS; architecture 51 PASS; full build PASS with existing dynamic-import and UI chunk warnings. Corrected stale command source assertion to follow command candidate delegation. Remaining attempt implementation and cron/followup orchestration still require migration and real personal/group asynchronous acceptance; this is not overall retirement. — codex-runtime-manager

## Protocol body boundary ownership (2026-11-07)

- Moved protocol body non-execution and stream wrapping from legacy attempt into capabilities/adapters/protocol-body-boundary. Original body removed; native calls remain distinct from text markup. Preserved violation identity, persistence, mixed-message stripping and terminal behavior. No synthesized tools or extra model turn. — codex-runtime-manager
- Attempt/overflow/usage regression 3 files / 74 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Attempt session/tool orchestration remains active and overall retirement remains open. — codex-runtime-manager

## Attempt authoritative state access (2026-11-07)

- Attempt registration recheck and stall quota identity now consume state/index instead of direct task-board imports. Original lock/storage and binding semantics remain unchanged; no additional state writer. — codex-runtime-manager
- Attempt/context runner regression 2 files / 61 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Overall migration and retirement remain open. — codex-runtime-manager

## Shadow wiring scanner migration follow-up (2026-11-07)

- Broader source-scanner regression found five stale-path failures after core-loop relocation. Updated the scanner's sole run owner to execution/runner/embedded-run, preserving all flag-reader, caller allowlist and injection assertions. — codex-runtime-manager
- Scanner 9 PASS; no production behavior change. — codex-runtime-manager

## Attempt sandbox adapter ownership (2026-11-07)

- Moved sandbox resolution and attachment to an already running account browser from legacy attempt into capabilities/adapters/attempt-sandbox. Preserved trusted account scope, existing sandbox policy and browser capability grant; no new scheduler or browser startup path. Caller retains its session identity and workspace lifecycle. — codex-runtime-manager
- Workspace/shadow/context/attempt regression 3 files / 75 PASS after retaining the caller's shared sandboxSessionKey. Full tsgo PASS; typed lint clean; architecture 51 PASS. Overall executor retirement remains open. — codex-runtime-manager

## Session context diagnostics ownership (2026-11-07)

- Moved non-mutating context size/role/image summary from legacy attempt into context/session-summary; original body removed. Logging remains caller owned; no transcript authority, source reads or model invocation added. — codex-runtime-manager
- Attempt/context runner regression 2 files / 61 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Overall migration remains open. — codex-runtime-manager

## Context post-turn capability lifecycle (2026-11-07)

- Moved existing context-engine afterTurn/ingest fallback invocation from legacy attempt into capabilities/adapters/context-after-turn. Preserves hook precedence, new-message slicing and contained errors; does not change transcript authority or add task control. Original body removed. — codex-runtime-manager
- Workspace/shadow/context/attempt regression 3 files / 75 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Overall migration and retirement remain open. — codex-runtime-manager

## Attempt resource cleanup ownership (2026-11-07)

- Moved fixed attempt teardown into execution/runner/attempt-cleanup. Original sequential cleanup could skip session, websocket and lock release if an earlier remover or flush threw. The fixed component attempts every owned release in the original order and propagates collected failures; no scheduling or configurable execution added. — codex-runtime-manager
- Failure injection across all eight cleanup positions and original workspace/context/attempt regression: 4 files / 84 PASS; final focused rerun 11 PASS. Full tsgo PASS; typed lint clean; architecture 51 PASS. Earlier combined runtime regression 64 files / 326 PASS. Complete attempt migration and overall retirement remain open. — codex-runtime-manager

## After-turn context projection ownership (2026-11-07)

- Moved after-turn runtime context projection from legacy attempt into capabilities/adapters/after-turn-context. Preserved identity inheritance, auth profile, tool ceiling, skill policy and original compact context shape; original body removed. No source reads or execution control added. — codex-runtime-manager
- Attempt/context runner regression 2 files / 61 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Overall migration and retirement remain open. — codex-runtime-manager

## Attempt policy ownership (2026-11-07)

- Moved prompt-mode classification into policy/prompt-mode and existing workspace restriction resolution into capabilities/adapters/attempt-workspace-policy. Original bodies removed; collaboration workspace restriction and steward isolation retain their precedence. No additional model call or execution path. — codex-runtime-manager
- Workspace/context/attempt regression 3 files / 75 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Overall migration and retirement remain open. — codex-runtime-manager

## Unique embedded attempt implementation migration (2026-11-07)

- Moved the sole embedded attempt into execution/runner/embedded-attempt after extracting model, policy, context, sandbox, protocol and cleanup components. Deleted old implementation path; migrated production caller, test mocks, identity scans and observation source catalog. Archive tag archive/runtime-embedded-attempt-bb944cfbb preserves the original. No duplicate loop or fallback implementation. — codex-runtime-manager
- Runtime/workspace/context/shadow wiring regression 4 files / 84 PASS; lifecycle/overflow/identity/collaboration regression 10 files / 70 PASS; configured auth/fallback/embedded integration 3 files / 34 PASS. Full tsgo PASS; typed lint clean; architecture 51 PASS; full build PASS with existing warnings. — codex-runtime-manager
- Operational shadow collector remains fail-closed against origin/main production blobs. Exact pre-relocation files were temporarily restored and its original failure reproduced: source attempt blob 5652a477 differs from HEAD/worktree f2f24c8f. Pending relocation files were restored afterward. Canonical observation path updated, identity enforcement unchanged; this collector needs revalidation on the integrated main baseline. No whole-runtime completion, merge or deployment claimed. — codex-runtime-manager

## Queued reply delivery ownership (2026-11-07)

- Moved original queued payload routing into delivery/dispatch/queued-reply with explicit transport and typing ports. Removed run-local delivery body; preserves original destination, same-channel fallback, silence filtering and enqueue-only unknown receipts. No task mutation or execution dependency added. — codex-runtime-manager
- Followup/BYOK/OGUI/closeout regression 4 files / 38 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Repaired stale closeout mock exports and made undefined origin non-routable; enqueue-only assertion now requires delivery_unknown instead of obsolete pending. Overall migration remains open. — codex-runtime-manager

## Queued execution identity ownership (2026-11-07)

- Moved queued continuation ticket validation, constraint refresh and original execution claim into state/mutations/claim-queued-execution. Followup consumes the controlled state API; original board locking, private/collaboration separation and rejection behavior remain unchanged. No new state store or scheduler. — codex-runtime-manager
- Followup/BYOK/OGUI/closeout regression 4 files / 38 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Overall migration remains open. — codex-runtime-manager

## Queued provider candidate ownership (2026-11-07)

- Moved queued provider preparation and embedded invocation into execution/runner/queued-candidate. Followup calls the execution public API; shared model session retains authorization and fallback. Preserved transport preparation, post-preparation task fence, trusted identity, private collaboration fields, warning dedupe and budget charging order. Original invocation body removed. — codex-runtime-manager
- Followup/BYOK/OGUI/closeout regression 4 files / 38 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Overall migration remains open. — codex-runtime-manager

## Shared CLI credential preparation (2026-11-07)

- Consolidated repeated command, admitted-turn and cron CLI credential scope/environment preparation into model/cli-run-credential. Removed three duplicate bodies; preserves all-or-nothing host-default fallback, trusted scope and caller-specific attribution fallback. Usage recording remains after the original execution. No execution loop or credential store added. — codex-runtime-manager
- Command/admitted/cron regression 5 files / 57 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Overall migration remains open. — codex-runtime-manager

## Partial recovery replay fence (2026-11-07)

- Reproduced a recovery batch with one successful receipt plus one payload failure remaining pending for full replay (1 FAIL / 68 PASS). Recovery now moves that batch into existing failed reconciliation storage instead of replaying confirmed messages. Empty-result failures retain their original retry policy. No new queue or exactly-once claim. — codex-runtime-manager
- Outbound queue regression 69 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Original task fencing and reconciliation completion remain separate blockers. — codex-runtime-manager

## Initial partial-send replay fence (2026-11-07)

- Reproduced initial bestEffort partial delivery leaving successful messages eligible for whole-batch replay (1 FAIL / 41 PASS). Initial send now moves batches with returned results and payload failures into existing reconciliation storage; empty-result failures retain retry policy. No exactly-once or reconciliation completion claim. — codex-runtime-manager
- Delivery/queue regression 2 files / 111 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Original-task recovery fencing and final personal/group acceptance remain open. — codex-runtime-manager

## Attempt transcript mutation ownership (2026-11-07)

- Moved trailing-user recovery and prompt-error persistence into state/attempt-transcript. Runner consumes state/index; SessionManager remains the sole writer under the original lock. Collaboration user-transcript preservation and existing nonfatal persistence errors remain unchanged. — codex-runtime-manager
- Workspace/context/attempt regression 3 files / 75 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Full session preparation and overall migration remain open. — codex-runtime-manager

## Attempt session preparation ownership (2026-11-07)

- Moved session repair/open/guard/cache preparation into state/prepare-attempt-session. Runner consumes state/index and retains context-engine bootstrap between open and transcript initialization. Original session lock, policy, collaboration preservation and one SessionManager writer remain unchanged. — codex-runtime-manager
- Workspace/context/attempt regression 3 files / 75 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Overall migration remains open. — codex-runtime-manager

## Scheduled provider candidate ownership (2026-11-07)

- Moved scheduled CLI/embedded backend selection, transport preparation and invocation into execution/runner/scheduled-candidate. Cron consumes execution/index; schedule/ledger and shared model admission/fallback retain existing ownership. Preserved fresh CLI watchdog behavior, tool-less non-qualifying jobs, trusted cron identity and charging model attribution. Original candidate body removed. — codex-runtime-manager
- Cron credit/fallback/long-horizon regression 3 files / 22 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Overall migration remains open. — codex-runtime-manager

## Context compiler adapter ownership (2026-11-07)

- Moved the single compiler transform/model-boundary adapter into capabilities/adapters/context-compiler; removed old install implementation. Pure compilation remains in context; SDK mutation and restoration remain in the capability adapter. Production attempt and existing compatibility facade use the public capability API. No extra compilation or model loop. — codex-runtime-manager
- Boundary/estimate/attempt/context regression 4 files / 69 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Overall migration remains open. — codex-runtime-manager

## Routed task delivery recovery fence (2026-11-07)

- Added host-captured task/action identity to routed final delivery and the existing write-ahead queue. Recovery checks the original task/attempt/version/constraints before sending; initial transport rechecks after asynchronous hooks and before each transport chunk. Stale entries move to existing reconciliation storage, never retarget to the new task. Queued task-result fallback rechecks identity; control/admission notices remain independent. — codex-runtime-manager
- Red recovery cases: paused/replaced/restricted tasks all sent on the prior implementation (3 FAIL / 69 PASS). Candidate routing/dispatch/followup/transport regression 5 files / 218 PASS, including active send and pause during sending hook. Full tsgo PASS; typed lint clean; architecture 51 PASS. Coverage is routed individual task results with explicit bindings; legacy unbound entries, other dispatcher transports, collaboration-specific identity and reconciliation closeout still require completion. No overall retirement or deployment claimed. — codex-runtime-manager

## Dispatcher task output fence (2026-11-07)

- Independent review found same-channel tool/block/final dispatch bypassed routed task fencing. Dispatcher now snapshots the host boundary per queued item and rechecks after queue/human delay before delivery; unbound control notices remain independent. Generic dispatch passes the execution boundary for task output. — codex-runtime-manager
- Red tests reproduced all three late-send branches (3 FAIL). Dispatcher/dispatch regression 2 files / 56 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Transport-specific awaits and durable dispatcher metadata propagation remain under review; overall acceptance not claimed. — codex-runtime-manager

## Explicit execution delivery identity (2026-11-07)

- Delivery fencing now originates only from the execution-bound callback, including its actual sessionFile. This avoids assigning old task boundaries to control replies and covers newly created sessions absent from the ingress store snapshot. Original completion observation remains separate. — codex-runtime-manager
- Dispatcher/dispatch regression 2 files / 56 PASS; full tsgo PASS; typed lint clean; architecture 51 PASS. Full migration remains open. — codex-runtime-manager

## Integrated candidate verification (2026-11-07)

- Candidate f05c52f26: joint runtime/dispatch/cron/followup/transport/context regression 73 files / 560 PASS; configured embedded/auth/fallback integration 3 files / 34 PASS. Full tsgo PASS; architecture 51 PASS; full build PASS with 209 existing ineffective dynamic-import warnings and UI chunk warnings. — codex-runtime-manager
- Isolated Deepseek Gateway prompt/read/exec suite exited 0 (1 PASS, 1 unrelated skipped); temporary state removed, channels and cron disabled. One exec allowlist rejection was logged before successful suite completion. This is not complete personal/collaboration asynchronous or real-channel acceptance. — codex-runtime-manager
- Remaining gates: complete supply/adapter contracts and legacy consumer convergence; durable reconciliation closeout; dispatcher transport metadata propagation through channel-specific awaits; individual/group real asynchronous lifecycle on one integrated candidate. No merge, push or deployment. — codex-runtime-manager

## Capability cancellation composition ownership (2026-11-07)

- Moved the existing abort-signal composition implementation into capabilities/invocation/abort; old pi-tools.abort is a compatibility re-export through the capability public API. No second implementation, cancellation policy or hard-stop guarantee added. Corrected misleading structural-typing comment without changing behavior. — codex-runtime-manager
- Capability cancellation 5 PASS; before-tool adapter integration E2E 9 PASS; full tsgo PASS; changed-file typed lint clean; architecture 51 PASS. Overall retirement and final lifecycle acceptance remain open. — codex-runtime-manager

## Active execution registry ownership (2026-11-07)

- Moved the unique process-local active-run registry into execution/runner/run-registry. Old runs module is a compatibility re-export, embedded attempt uses the runtime registry directly, and command wiring consumes the execution public API for abort/steer. Preserves waiter, compaction and handle-identity cleanup behavior; no second scheduler or persistent resume guarantee. — codex-runtime-manager
- Registry/interaction regression 4 files / 15 PASS, including cross-facade identity and obsolete-cleanup refusal; full tsgo PASS; changed-file typed lint clean; architecture 51 PASS. Overall retirement and final lifecycle acceptance remain open. — codex-runtime-manager

## Candidate legacy facade convergence (2026-11-07)

- Admitted, command, queued and scheduled candidates now invoke the unique runtime embedded implementation directly. Runtime production code no longer imports legacy pi-embedded or runs facades; a new architecture rule prevents regression, exempting only the shared-registry compatibility test. Updated model test doubles at their actual implementation boundary and corrected owner-auth test import ordering. HTTP acceptance still exercises the real run implementation; its asynchronous receipt wait is bounded independently of the HTTP acknowledgement. — codex-runtime-manager
- Final independent-forks joint regression 40 files / 344 PASS, including hook HTTP transport, owner authorization, fallback, billing, queued closeout and scheduled runs. Full tsgo PASS; architecture 52 PASS. Earlier combined failures and isolated rechecks retained in temporary verification logs; no real-channel or complete retirement claim. Prior integrated candidate 356d5346f additionally passed 65 files / 413 tests and full build with 209 existing dynamic-import warnings. — codex-runtime-manager

## Signal task transport boundary (2026-11-07)

- Reproduced task output surviving invalidation during asynchronous media resolution (1 FAIL / 1 PASS). Signal dispatcher now forwards captured task identity through monitor delivery into send options; send rechecks immediately before RPC after attachment resolution. Independent control notices remain unbound. Other channel transports remain pending. — codex-runtime-manager
- Signal regression 4 files / 31 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Candidate b19618dfb full build PASS with 209 existing dynamic-import warnings. No production restart, merge, push or deployment. — codex-runtime-manager

## Routed Signal boundary propagation (2026-11-07)

- Routed outbound Signal text and media now forward the captured task boundary to the transport recheck, matching monitor delivery. No recapture or new task identity is introduced. — codex-runtime-manager
- Outbound/Signal regression 2 files / 46 PASS; full tsgo PASS; changed-file typed lint clean. Other channels and complete retirement acceptance remain open. — codex-runtime-manager

## Discord request task boundary (2026-11-07)

- Reproduced task output surviving invalidation during media loading (1 FAIL / 1 PASS). Discord client request now rechecks the supplied original task identity inside each retry attempt; normal and voice send options accept the boundary. No boundary is inferred for unbound control messages. Caller propagation, webhook and direct monitor paths remain pending. — codex-runtime-manager
- Discord transport regression 2 files / 31 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Overall retirement is not accepted. — codex-runtime-manager

## Routed Discord task identity propagation (2026-11-07)

- Existing outbound adapter context now carries the original optional task boundary. Routed Discord text/media pass it into guarded client requests; webhook checks it before HTTP. No task identity is inferred from the current session and no second delivery engine is added. Direct monitor/preview paths still require convergence. — codex-runtime-manager
- Outbound/Discord regression 4 files / 64 PASS, including stale webhook refusal; full tsgo PASS; typed lint clean; architecture 52 PASS. Overall retirement and same-version lifecycle acceptance remain open. — codex-runtime-manager

## Discord monitor and preview boundary (2026-11-07)

- Direct monitor delivery now propagates original task identity to text/media/voice/webhook transports and final preview edits. Pre-resolved direct text requests recheck inside retries; remaining chunks stop after task invalidation. Existing fallback, chunk ordering and independent control replies remain unchanged. Draft partial streaming still needs separate lifecycle verification. — codex-runtime-manager
- Discord regression 4 files / 52 PASS, including actual direct-chunk invalidation; full tsgo PASS; typed lint clean; architecture 52 PASS. Overall retirement remains open. — codex-runtime-manager

## Discord pending preview boundary (2026-11-07)

- Draft preview binds the host-provided original execution identity and checks it plus cancellation before post/edit, including final flush. Replacement binding stops buffered preview rather than retargeting old text; final delivery retains its separate captured identity. Unbound dialogue previews retain existing behavior. — codex-runtime-manager
- Draft/process regression 2 files / 24 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Integrated candidate 1ed678fda full build PASS. Complete retirement and real lifecycle acceptance remain open. — codex-runtime-manager

## Telegram request task boundary (2026-11-07)

- Reproduced media send and preview edit surviving task invalidation (2 FAIL). Telegram send/edit requests now recheck supplied task identity inside each retry attempt; routed outbound text/media/payload forwards the original boundary. Direct monitor and draft paths remain pending. — codex-runtime-manager
- Scoped transport/adapter regression 2 files / 6 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Broader send suite retains 2 pre-existing retry expectation failures (59 PASS), reproduced using exact HEAD send.ts before this change; no retry policy weakened. Overall retirement remains open. — codex-runtime-manager

## Telegram direct delivery boundary (2026-11-07)

- Direct delivery helpers carry original task identity through text, media, voice fallback, follow-up text and pinning. Thread fallback rechecks before both original and threadless attempts, including after asynchronous media loading. Monitor caller propagation and draft lifecycle remain pending. — codex-runtime-manager
- Direct Telegram regression 2 files / 30 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Overall retirement remains open. — codex-runtime-manager

## Telegram buffered delivery identity (2026-11-07)

- Monitor output and deferred final answers carry their original task boundary through lane delivery, fallback sends and preview edits. Task refusal during edit escapes ambiguous-ack handling instead of being recorded as delivered. Draft transport lifecycle remains a separate pending gate. — codex-runtime-manager
- Lane/dispatch/reasoning regression 4 files / 94 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Overall retirement and final same-version lifecycle acceptance remain open. — codex-runtime-manager

## Scope correction and internal execution contracts (2026-11-07)

- Owner clarified retained external channels are Feishu, WeCom and DingTalk, with channel convergence owned by another agent. This task stops channel implementation work and resumes only runtime mainline convergence and legacy executor retirement. Previously committed channel evidence is preserved for handoff; no further channel implementation is included here. — codex-runtime-manager
- Moved the unique embedded request/result definitions into execution/runner internal adapter contracts; legacy files are type-only facades. Runtime consumers no longer depend on old executor type locations. Existing host-specific fields are preserved explicitly, not misrepresented as pure public contracts or a stable SDK. The pure-contract architecture gate remains unchanged and legacy facade imports are prohibited for runtime sources. — codex-runtime-manager
- Runtime regression 60 files / 236 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Complete executor replacement and retirement remain subject to mainline/lifecycle acceptance. — codex-runtime-manager

## Mainline execution startup fence (2026-11-07)

- Reproduced paused and queue-invalidated accepted requests reaching model preparation (2 FAIL). The unique embedded mainline now checks its original execution binding before enqueue, after dequeue and before each retry iteration, using the existing state API. Existing abort lifecycle remains unchanged; no new classifier or execution path. — codex-runtime-manager
- Startup/admitted regression 2 files / 6 PASS; embedded/auth/fallback integration 3 files / 34 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Channel implementation remains delegated; overall replacement and retirement acceptance remain open. — codex-runtime-manager

## Unique CLI execution adapter ownership (2026-11-07)

- Moved the unique CLI provider implementation into execution/runner/cli-run. Legacy cli-runner is a compatibility re-export; admitted, command and scheduled candidates invoke the runtime implementation directly. Preserved supervisor, credentials, timeout, cancellation, session fallback and usage behavior. Runtime architecture prohibits returning through the legacy facade. — codex-runtime-manager
- CLI/command/billing/cron regression 6 files / 85 PASS with independent forks and polling watchers. Initial runs hit host EMFILE watcher exhaustion; passing rerun changes test environment only. Full tsgo PASS; typed lint clean; architecture 52 PASS. Overall retirement and final lifecycle acceptance remain open. — codex-runtime-manager

## Scheduled CLI cancellation propagation (2026-11-07)

- Reproduced scheduled CLI candidate dropping the original abortSignal (1 FAIL). Candidate now forwards the same signal into the unique CLI adapter; supervisor cancellation remains the existing owner. No new stop path. — codex-runtime-manager
- Scheduled/CLI regression 2 files / 14 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Integrated candidate 5aa1d7fa1 full build PASS with 209 existing dynamic-import warnings. Overall retirement remains open. — codex-runtime-manager

## Mainline result consumer convergence (2026-11-07)

- Queued execution, scheduled execution and command session closeout now consume the result type through execution/index. Removed their legacy execution facade imports used only for ReturnType; no model invocation or closeout behavior changed. — codex-runtime-manager
- Consumer regression 3 files / 72 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Overall retirement remains open. — codex-runtime-manager

## CLI original execution identity (2026-11-07)

- Admitted and scheduled CLI candidates forward their original task execution binding into the unique CLI adapter. The adapter checks the existing state API before preparation, after its queue wait, before spawn and before adopting results or retrying an expired session. Unbound internal calls retain existing behavior. No new classifier, state store or executor. — codex-runtime-manager
- CLI/candidate regression 4 files / 18 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Overall retirement remains open. — codex-runtime-manager

## Delivery confirmation identity retention (2026-11-07)

- Reproduced missing/mismatched/nonterminal confirmation clearing pending reconciliation identity (4 FAIL). Delivery now retains that association until the outcome writer confirms the exact task/run/delivery and requested status. Original board completion remains separately gated by passed acceptance and live binding. No new transport or executor. — codex-runtime-manager
- Confirmation/restart/late-completion regression 4 files / 20 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Overall retirement remains open. — codex-runtime-manager

## Session accounting state ownership (2026-11-07)

- Moved unique session usage persistence and compaction accounting into state components. Normal reply consumes them through existing reply wiring; queued reply uses the state public API. Old accounting/usage modules are compatibility re-exports; skill snapshot and system event preparation remain with their existing owners. Original storage transactions, last-call token semantics and error behavior are preserved. — codex-runtime-manager
- Session/followup regression 2 files / 83 PASS; reply execution integration 1 file / 47 PASS after updating stale provider mocks to the actual runtime boundary; full tsgo PASS; typed lint clean; architecture 52 PASS. Candidate 23abeed37 separately passed 67 files / 300 tests and full build with 209 existing dynamic-import warnings. Overall retirement remains open. — codex-runtime-manager

## Continuation authority migration (2026-11-07)

- Moved the unique existing continuation timer and bounded wake ledger into execution; ticket identity validation belongs to state and data contracts are explicit. Reply mainline uses wiring; the old conversation-task module is a compatibility facade, with no second scheduler or executor. Original human gates, wake suppression, focus revision checks and queue revalidation remain intact. — codex-runtime-manager
- Continuation/background-process/followup regression 3 files / 49 PASS; reply-runner integration 1 file / 47 PASS; full tsgo PASS; formatting and typed lint clean; architecture 52 PASS. Channel implementation remains owned by the separate channel agent. Complete retirement and final same-version lifecycle acceptance remain open. — codex-runtime-manager

## Stop consumer convergence (2026-11-07)

- Fast abort and session stop now use the execution public registry API directly, removing their legacy executor facade dependency. Existing queue cleanup, cutoff persistence, ACP and subagent stop semantics are preserved. Updated stale controller-list test mock to match the existing production API. — codex-runtime-manager
- Abort/commands regression 2 files / 79 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Overall retirement remains open. — codex-runtime-manager

## Admitted execution identity requirement (2026-11-07)

- Reproduced accepted-marker-only requests reaching outcome creation without a task binding (1 FAIL). The unique admitted execution entry now rejects missing bindings before outcome, billing, fallback or candidate construction. Existing internal unmarked entrances retain their current behavior; no new admission path. — codex-runtime-manager
- Admitted entry/candidate regression 2 files / 8 PASS; full tsgo PASS; typed lint and formatting clean; architecture 52 PASS. Complete mainline and retirement acceptance remain open. — codex-runtime-manager

## New-mainline onboarding: explicit human ingress (2026-11-07)

- Reproduced an explicitly external-user request without transport interaction options bypassing governed interaction (1 FAIL / 37 PASS). Prepared reply now supplies the existing interaction entrance and transcript persistence for that trusted provenance; ordinary responses do not enter execution. No new classifier, runner or channel implementation. Unmarked legacy entrances remain pending review. — codex-runtime-manager
- Interaction/admission/router/OGUI regression 4 files / 48 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Updated an incomplete working-style mock to retain actual exports. Overall onboarding and retirement remain open. — codex-runtime-manager

## Rule classification inventory foundation (2026-11-07)

- Added data-only rule classification contract and a detached public inventory of six verified implementations. Separates invariants, lifecycle, classification, operational policy and compatibility retirement candidates. Metadata does not load modules, change enforcement or expose disabling controls. This is a partial inventory, not a platform integration or complete rule audit. — codex-runtime-manager
- Catalog isolation regression PASS; full tsgo PASS; typed lint and formatting clean; architecture 52 PASS. Platform projection, decision-version evidence and full inventory remain pending after mainline onboarding. — codex-runtime-manager

## Same-candidate lifecycle evidence (2026-11-07)

- Candidate c68d88b46 isolated Gateway real-model prompt/read/exec probe PASS using api-proxy-deepseek/deepseek-v4-flash; one unrelated fallback test skipped. Initial sandbox loopback EPERM resolved by approved isolated execution. Channels and cron disabled; temporary state removed. This exercises agent RPC, not complete chat.send interaction or group lifecycle. — codex-runtime-manager
- Async child/semantic admission/resume/collaboration abort/durable delivery restart/receipt identity suites: 6 files / 20 PASS. Collaboration runner uses a test double. Added actual state integration across admission, execution binding, revision, pause, resume and stale completion refusal: 1 PASS. Full tsgo PASS; typed lint clean; architecture 52 PASS. These separate proofs do not constitute a full end-to-end personal/group/channel acceptance; retirement remains blocked on that evidence. — codex-runtime-manager

## Real chat ingress protocol failure and repair (2026-11-07)

- Isolated real-model chat.send greeting failed with natural-language output parsed as JSON, leaving only the user message in history. Shared system guidance followed the decision protocol. Moved the host wire protocol after shared guidance; no parser fallback, extra model call or task admission bypass. Regression verifies protocol ordering. — codex-runtime-manager
- Candidate live chat.send rerun returned agent.wait status=ok and assistant greeting persisted in chat.history. Gateway shutdown logged, but the temporary harness did not exit within 300 seconds; the wrapper terminated its own process group and removed temporary state. Greeting behavior passed; clean shutdown acceptance failed and remains open. Model component 10 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. This is greeting-path evidence only, not full personal/group asynchronous acceptance. — codex-runtime-manager

## Shutdown probe refinement (2026-11-07)

- Confirmed server.close returns. Three placeholder intervals were overwritten by maintenance handles without clearing them. Commit 1d6a65b0b clears the placeholders before replacement. With the probe explicitly stopping its temporary workspace Skill watcher, isolated real-model chat returned ok, history persisted, delayed active resources were empty and process exited normally; temporary state removed. This does not prove general Skill watcher shutdown ownership is complete. — codex-runtime-manager
- The four-line fix was inadvertently classified by the existing observability landing stream rather than the convergence stream. Exact diff contains no observability WIP; preserve the commit and record this attribution deviation rather than rewriting shared history. Full tsgo, typed lint, formatting and architecture 52 PASS before commit. Full personal/group asynchronous acceptance remains open. — codex-runtime-manager

## Real chat artifact acceptance gap (2026-11-07)

- Isolated chat.send file task reached tools and produced result.txt; independent host byte comparison verified MAINLINE_ARTIFACT_OK exactly. agent.wait returned ok, visible result persisted, temporary state cleaned and probe exited normally with explicit temporary Skill watcher cleanup. — codex-runtime-manager
- Gate remains FAIL: after the visible result, task-board continue recorded and dispatched another wake. Accepted natural-language acceptanceCriteria are stored but not consumed by a general criterion validator; prepareVisibleDelivery relies on legacy preflight receipt classification. Host probe verification is not a runtime acceptance receipt and must not be used to force-close the task. Full individual/group lifecycle and delivery closeout remain unaccepted; no legacy deletion or deployment. — codex-runtime-manager

## Verified work waits for delivery (2026-11-07)

- Reproduced verified visible work requesting business continuation before its delivery receipt (1 FAIL). Terminal delivery now skips business continuation when existing trusted acceptance is verified; it still presents the result and does not invent delivery or close the task. Unverified and process-placeholder paths retain existing behavior. This does not supply the missing general acceptance validator. — codex-runtime-manager
- Delivery regression 3 files / 31 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. — codex-runtime-manager

## Receipt and acceptance reconciliation (2026-11-07)

- Reproduced a delivered receipt clearing a checked task association while acceptance remained pending (1 FAIL). Confirmation now preserves that association rather than treating transport success as task acceptance. No task is force-completed. — codex-runtime-manager
- Receipt/restart regression 2 files / 8 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. General accepted-criteria validation remains unfinished. — codex-runtime-manager

## Original identity survives pending acceptance (2026-11-08)

- Reproduced pending acceptance discarding the original board binding at delivery preparation (1 FAIL). Preparation now durably retains the exact original task/run/version even before acceptance passes. Confirmation still requires passed acceptance and a live binding before completion; identity retention is not authorization. — codex-runtime-manager
- Preparation/confirmation/restart regression 3 files / 15 PASS; full tsgo PASS; typed lint and formatting clean; architecture 52 PASS. General criterion validation and full replacement acceptance remain open. — codex-runtime-manager

## Internal triggers leave legacy semantic routing (2026-11-08)

- Reproduced internal execution text being interpreted as user progress/conversation before queue dispatch (1 FAIL). Trusted heartbeat, birth, collaboration round and internal provenance now use resource queue decisions without user semantic classification or amendment writes. Accepted user requests retain their admission bypass of legacy classification. Unmarked legacy user entrances remain pending retirement. — codex-runtime-manager
- Interaction/queue regression 2 files / 14 PASS; reply-runner integration 1 file / 47 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Overall replacement remains open. — codex-runtime-manager

## Verified acceptance contract continuity (2026-11-08)

- Reproduced four execution-kind contracts losing explicit trusted acceptance when named validators are empty (4 FAIL). Preserve that trusted flag without waiving unverified acceptance or changing task kind. No model prose is treated as evidence. — codex-runtime-manager
- Contract/delivery regression 2 files / 33 PASS; full tsgo PASS; changed-file typed lint clean; architecture 52 PASS. General admitted criteria validation and real individual/group closeout remain open; no full retirement or deployment claimed. — codex-runtime-manager

## Continuation rule deduplication (2026-11-08)

- Removed execution runner direct access to legacy board tombstone logic and its duplicate refusal branch. Existing state revalidateContinueTicket remains the single enqueue/claim validator; timer, cap, pause and identity semantics remain intact. — codex-runtime-manager
- Existing continuation regression 15 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. This retires one duplicate rule branch, not the entire legacy state adapter. — codex-runtime-manager

## Bound execution cannot inherit chat waiver (2026-11-08)

- Reproduced a bound execution receiving not_required acceptance through legacy chat classification (1 FAIL). Delivery preparation now preserves execution acceptance requirements whenever the host supplies a task binding; it does not invent validation or delivery. Both immediate and queued preparation share this function. — codex-runtime-manager
- Preparation/confirmation regression 2 files / 13 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. General criterion evaluation remains open. — codex-runtime-manager

## Production-entry regression harness follows new runner (2026-11-08)

- Extended closeout regression exposed four stale mocks still intercepting the retired facade rather than the migrated embedded implementation, causing Unknown model anthropic/claude before delivery. Updated only the provider test seam; real outcome persistence, dispatch and confirmation remain exercised. — codex-runtime-manager
- R85f integration 10 PASS, including four production-entry scenarios; state lifecycle 1 PASS separately. Full tsgo PASS; typed lint clean; architecture 52 PASS. These use mocked inference and are not real-model replacement acceptance. — codex-runtime-manager

## Task resume context and constraint ownership (2026-11-08)

- Moved unchanged task resume rendering and path redaction to shared context; moved unchanged ordered constraint normalization to policy. Original board exports are same-implementation compatibility adapters. Prepared reply and state continuation consume the context public API, retiring those legacy implementation bodies without introducing another planner. — codex-runtime-manager
- Existing board/context/continuation regression 3 files / 47 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Earlier same-candidate runtime sweep: 66 files / 252 PASS before this extraction. General acceptance evidence remains open. — codex-runtime-manager

## Accepted criteria survive automatic recovery (2026-11-08)

- Reproduced accepted criteria remaining in storage but missing from the automatic continuation prompt after revision/pause/resume (1 FAIL). Shared task context now projects the original criteria alongside active constraints. This restores execution context, not criterion validation or acceptance authorization. — codex-runtime-manager
- Lifecycle/constraint/continuation regression 3 files / 24 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Post-extraction ingress/lifecycle/restart regression separately 3 files / 42 PASS. — codex-runtime-manager

## Unique task-board repository migration (2026-11-08)

- Moved existing board file storage, atomic rename, shared lock and epoch CAS into state/repository/task-board-file. Legacy board exports reference the same implementation; no alternate storage or lock was added. Business mutations still use the same locked transaction. — codex-runtime-manager
- Board and true cross-process concurrency regression 2 files / 31 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Prior candidate full build PASS with 209 unchanged dynamic-import warnings; repository extraction still requires downstream integration verification. — codex-runtime-manager

## Pure task rules move to policy (2026-11-08)

- Moved unchanged tombstone checks and active constraint selection into policy; legacy exports reference those same functions. No new classifier or state mutation was added. — codex-runtime-manager
- Policy/resume/lifecycle/continuation regression 4 files / 31 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. — codex-runtime-manager

## State consumers bypass legacy storage facade (2026-11-08)

- Task action checks, continuation claims, paused-task resume and state repository now consume the new repository and policy implementations directly. Remaining legacy imports are business mutations pending migration, not duplicate storage. — codex-runtime-manager
- Lifecycle/resume/continuation regression 3 files / 23 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. Repository downstream ingress/lifecycle/restart regression separately 3 files / 42 PASS. — codex-runtime-manager

## Execution identity mutations move to state (2026-11-08)

- Moved unchanged binding capture, attempt claim, startup validity check and version stamping into state/mutations/execution-binding. Shared board snapshot cloning now belongs to the unique repository. Legacy exports are references to the same implementation; no parallel state writer. — codex-runtime-manager
- Binding/resume/lifecycle and cross-process regression 4 files / 21 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. — codex-runtime-manager

## Execution binding consumers converge (2026-11-08)

- State repository and queued execution now consume the owned execution-binding mutation directly; queued constraint selection uses public policy. Removed their legacy board facade dependencies without changing claim semantics. — codex-runtime-manager
- Binding/lifecycle/continuation regression 3 files / 22 PASS; full tsgo PASS; typed lint clean; architecture 52 PASS. — codex-runtime-manager

## State retirement dependency gate (2026-11-08)

- Added a static dependency rule preventing migrated state components from importing the legacy task-board facade. Explicit exceptions retain the remaining business-transition adapter and compatibility test. Repository ownership comment now reflects actual runtime storage authority. — codex-runtime-manager
- Architecture manifest 53 PASS; no runtime behavior changed in this checkpoint. General acceptance evidence and full replacement remain open. — codex-runtime-manager

## Completion transaction extraction verification (2026-11-08)

- Moved completion identity checks and locked writes into state/mutations; completion notice projection into context and the existing parked capacity into policy. Legacy exports refer to the same implementation. — codex-runtime-manager
- First combined cross-process run had one pause/constraint race failure (wakeSuppress missing); preserve this failure as an unresolved concurrency gate. Isolated seven-case rerun and subsequent combined binding/restart/race run (16 tests) passed; this does not explain or close the first failure. Full tsgo PASS; typed lint clean; architecture 53 PASS. Completion extraction remains uncommitted pending race investigation. — codex-runtime-manager

## Lock inspection replacement race (2026-11-08)

- Deterministically reproduced stale inspection ENOENT deleting a replacement lock (1 FAIL before / PASS after). Sync and async inspection failures now refuse stale deletion; living-owner checks remain intact. This proves the specific lock defect, not the exact event sequence of the earlier pause race. — codex-runtime-manager
- Lock liveness 4 PASS; combined lock/cross-process/restart regression previously 13 PASS; full tsgo PASS; typed lint clean; architecture 53 PASS. — codex-runtime-manager

## Completion transaction checkpoint (2026-11-08)

- Completion transaction and notice extraction passed final targeted regression after the lock inspection repair: 5 files / 38 PASS. Full tsgo, typed lint and architecture 53 PASS. Earlier intermittent pause-race evidence remains recorded; the deterministic lock repair does not prove its exact cause. Legacy completion exports now refer to runtime state implementation. — codex-runtime-manager

## Typed task controls migrate to state (2026-11-08)

- Moved unchanged current/parked pause and cancellation transitions into state/mutations/task-control. Legacy text classification remains outside this component; existing exports point to the unique typed transition implementation. — codex-runtime-manager
- Board/cross-process/lifecycle regression 3 files / 32 PASS; full tsgo PASS; typed lint clean; architecture 53 PASS. — codex-runtime-manager

## Task title and input normalization ownership (2026-11-08)

- Moved unchanged title projection into context and consolidated the duplicated inbound timestamp normalization in policy. Legacy relation and board consumers use those same implementations; no semantic classifier was added. — codex-runtime-manager
- Relation/board regression 2 files / 40 PASS; full tsgo PASS; typed lint clean; architecture 53 PASS. — codex-runtime-manager

## Task identity ownership (2026-11-08)

- Moved unchanged task instance allocation and legacy hash compatibility into the state repository. Legacy board exports reference the same functions; request idempotency and fresh-instance entropy remain unchanged. — codex-runtime-manager
- Board/admission regression 2 files / 26 PASS; full tsgo PASS; typed lint clean; architecture 53 PASS. — codex-runtime-manager

## Task record construction ownership (2026-11-08)

- Moved unchanged task record construction and parked-record capacity handling into state/mutations/task-record. Legacy consumers call that same implementation; no semantic classification or new scheduling was introduced. — codex-runtime-manager
- Board/admission/cross-process regression 3 files / 33 PASS; full tsgo PASS; typed lint clean; architecture 53 PASS. — codex-runtime-manager

## Task focus transition ownership (2026-11-08)

- Moved unchanged explicit task insertion and focus revision into state/mutations/task-focus. Shared focus and archive wording now belongs to context; legacy exports reference the same implementation. Architecture gate rejected a reverse legacy dependency during extraction; moved the original formatter rather than exempting the dependency. — codex-runtime-manager
- Board/focus/admission/context regression 4 files / 38 PASS; earlier cross-process group 34 PASS; full tsgo PASS; typed lint clean; architecture 53 PASS. — codex-runtime-manager

## Explicit admission transaction ownership (2026-11-08)

- Moved unchanged admission identity/version/idempotency transaction into state/mutations/admit-task. The new state repository consumes it directly; legacy board exports reference the same implementation. Admission has no reverse dependency on legacy board business logic. — codex-runtime-manager
- Admission/lifecycle regression 2 files / 3 PASS; full tsgo PASS; typed lint clean; architecture 53 PASS. General acceptance evidence and full replacement remain open. — codex-runtime-manager

## Explicit amendment classification (2026-11-08)

- Added a closed amendment scope enum to interaction decisions: supplement, revise, replace_all. Bound semantic changes now use that field; legacy keyword replacement rules remain only for legacy callers. Missing scope preserves existing constraints. Host target/epoch checks remain mandatory. — codex-runtime-manager
- Parser cases reproduced three failures before support; parser/admission/lifecycle/legacy constraint regression 4 files / 31 PASS. Full tsgo PASS; typed lint clean; architecture 53 PASS. This does not complete general acceptance validation. — codex-runtime-manager

## Typed constraint mutation ownership (2026-11-08)

- Moved the unique constraint log mutation into state/mutations/task-constraints. Legacy keyword gating remains a compatibility adapter; the mutation consumes an explicit scope and has no legacy classifier dependency. — codex-runtime-manager
- Legacy constraint/admission regression 2 files / 11 PASS; full tsgo PASS; typed lint clean; architecture 53 PASS. — codex-runtime-manager

## Bound interaction transaction ownership (2026-11-08)

- Moved target-bound interaction amendment/control transactions into state/mutations/interaction-proposal. The new repository consumes them directly; legacy exports reference the same implementation. The transaction consumes explicit amendment scope and has no legacy board/classifier dependency. — codex-runtime-manager
- Admission/lifecycle regression 2 files / 4 PASS; full tsgo PASS; typed lint clean; architecture 53 PASS. — codex-runtime-manager

## Runtime state authority no longer imports legacy classification (2026-11-08)

- Removed legacy text-control and keyword-constraint methods from the runtime state API. Existing compatibility consumers bind their original adapters explicitly; typed admission, amendment, control, execution binding and completion remain runtime-owned. Removed the repository exception from the no-legacy-state dependency gate. This isolates compatibility behavior; it does not claim all compatibility consumers retired. — codex-runtime-manager
- Interaction/admission/lifecycle regression 3 files / 9 PASS; full tsgo PASS; typed lint clean; architecture 53 PASS with no production state exception. — codex-runtime-manager

## Fresh workspace continuous interaction repair (2026-11-08)

- Real isolated Gateway greeting succeeded, but subsequent amendments failed workspace authorization after bootstrap automatically initialized Git. Preseeded workspace isolated the cause. Conversation bootstrap now explicitly disables Git initialization; the checkout authorization rule remains unchanged and existing callers retain the default. — codex-runtime-manager
- Workspace regression reproduced 1 FAIL before / 16 PASS after. Fresh empty-workspace real-model Gateway greeting plus supplement/local revision/full replacement now PASS with stable task identity, active constraints 1/2/1, normal probe exit and temporary state removed. Explicit temporary Skill watcher cleanup remains part of the probe. Full tsgo PASS; typed lint clean; architecture 53 PASS. This is not full execution acceptance or production deployment. — codex-runtime-manager

## Explicit external requests cannot bypass admission (2026-11-08)

- Reproduced an explicit external_user request reaching legacy classification without admission (1 FAIL). Execution host now refuses that request before legacy routing, memory flush or provider execution. Properly admitted requests and existing internal triggers retain their paths. Unmarked compatibility entrances remain pending retirement. — codex-runtime-manager
- Reply-runner integration 48 PASS; full tsgo PASS; typed lint clean; architecture 53 PASS. Latest real artifact probe failed exact-byte acceptance because the model added a newline; this remains a real acceptance gap, not a successful task closeout. — codex-runtime-manager

## Unlabelled human ingress normalization (2026-11-08)

- The public reply entrance now stamps otherwise unlabelled human input as external_user, using the existing ingress rule and preserving explicit internal, heartbeat, birth and collaboration provenance. The caller context is copied. Prepared interaction therefore cannot silently fall back to legacy routing solely because provenance was omitted. Updated stale workspace/media test seams without changing production authorization. — codex-runtime-manager
- Message-hook regression 5 PASS; full tsgo PASS; typed lint clean; architecture 53 PASS. Full replacement and general task acceptance remain open. — codex-runtime-manager

## Declarative acceptance component foundation (2026-11-08)

- Added a closed data-only artifact acceptance contract and evaluator. Exact UTF-8 bytes are checked independently of completion prose; uncovered criteria stay pending, unsafe paths are not read, and evaluation captures its input before asynchronous reads. No executable configuration, task mutation or scheduler is introduced. This component is not yet connected to production admission or delivery. — codex-runtime-manager
- Component regression 5 PASS, including a reproduced input-mutation failure before snapshot capture; full tsgo PASS; typed lint clean; architecture 53 PASS. General acceptance integration and complete executor retirement remain open. — codex-runtime-manager

## Declarative checks persist through admission (2026-11-08)

- Interaction parsing and host admission now validate a closed declarative check contract through public policy. Accepted checks persist with the original task; idempotent replay cannot change expected bytes. Admission snapshots the proposal before asynchronous authorization. The evaluator consumes the same validation rule, eliminating its private duplicate. No executable fields are accepted. Production model prompting and delivery evaluation are not yet connected. — codex-runtime-manager
- Parser/admission/state/evaluator regression 4 files / 33 PASS; full tsgo PASS; typed lint clean; architecture 53 PASS. General acceptance integration and complete retirement remain open. — codex-runtime-manager

## Accepted artifact checks connected to shared delivery (2026-11-08)

- Normal and queued execution now use the same host-bound acceptance evaluation before receipt preparation. Reads stay within the accepted workspace; task/run/version and board revision checks invalidate stale evidence. Exact checks persist real artifact digests; uncovered criteria remain pending. Verified work waits for delivery rather than scheduling duplicate execution. No executable configuration or second runner added. — codex-runtime-manager
- Delivery/host/queue regression 4 files / 72 PASS; run identity regression 3 PASS after updating its stale embedded-run mock to the migrated implementation. Full tsgo PASS, typed lint clean, architecture 53 PASS. Earlier broad sweep was 69 PASS / 1 FAIL due that stale mock; no blanket full-suite success claim. — codex-runtime-manager
- Isolated real-model file task produced exact bytes once; another probe stopped correctly for exec approval before file creation. Model-generated criteria included uncovered semantic/presentation criteria, so complete task acceptance and final closeout remain unproven. Full replacement, legacy retirement and deployment remain open. No production changes. — codex-runtime-manager

## Execution no longer repeats interaction semantics (2026-11-08)

- Removed the main execution entrance's legacy query/aside/amend/control disposition branch and its secondary reply lane invocation. Prepared interaction owns those decisions; execution now selects only run/enqueue/drop using the unchanged resource occupancy rule moved to public policy. Removed the live composition's handleInteraction binding. Legacy helpers remain compatibility-only pending separate consumer/archive review. — codex-runtime-manager
- Reply execution integration 48 PASS; queue and run identity 2 files / 12 PASS; full tsgo PASS; typed lint and format clean; architecture 53 PASS. This is retirement of a live duplicate routing branch, not complete legacy executor deletion. — codex-runtime-manager

## Retired semantic routing quarantined from production (2026-11-08)

- Separated fixed interrupt/steer effects from the old keyword-routing adapter. Removed handleInteraction from the command public facade; the live reply composition no longer loads that adapter. Architecture now forbids production imports of the retired routing modules, with exact historical-test exceptions only. Source retained pending immutable archival and final deletion. — codex-runtime-manager
- Historical comparison and state lifecycle 3 files / 11 PASS; full tsgo PASS; typed lint clean; architecture 54 PASS. Prior candidate 4f996d952 full build PASS with 209 existing ineffective-dynamic-import warnings and UI chunk-size warnings. No gateway restart or deployment. — codex-runtime-manager

## Real admitted execution acceptance and delivery closeout (2026-11-08)

- Isolated real-model probes exposed invented/redundant acceptance criteria despite a user-specified single criterion. Interaction protocol now preserves explicit acceptance scope and keeps execution-method restrictions in the goal. Unsupported semantic criteria remain pending; no acceptance bypass added. — codex-runtime-manager
- Real Gateway/model probe now verifies exact artifact bytes, persisted acceptance=passed with artifact digest, delivery=delivered, board unfinished=false and deliverableChecked=true, with no continuation wake. Model completion agent.wait precedes delivery settlement; the earlier immediate pending snapshot was not terminal evidence. Probe waited for settlement before inspection and removed temporary state. This proves one individual deterministic-artifact scenario, not general document quality or full group acceptance. — codex-runtime-manager
- Parser/model regression 2 files / 30 PASS; full tsgo PASS; typed lint clean. No merge, production restart or deployment. — codex-runtime-manager

## Archived duplicate semantic routing removed (2026-11-08)

- Preserved original source/tests in local annotated archive/runtime-semantic-routing-20261108 at 07352de77 before removing the three unused semantic routing modules and two historical comparison suites. Recorded original intent, retained owners, public consumer audit and rollback reference. State query non-mutation coverage remains; architecture has no exceptions for removed modules. — codex-runtime-manager
- Current interaction/state/constraint regression 4 files / 15 PASS; full tsgo PASS; changed-file typed lint clean; architecture 54 PASS. Archive tag is local only. Whole executor replacement and same-version group/asynchronous acceptance remain open; no deployment. — codex-runtime-manager

## Standalone aside executor retired (2026-11-08)

- Removed the unused ephemeral aside executor and private registry after consumer/SDK audit and source archival. Ordinary dialogue uses shared governed interaction; historical sidecar reads and Gateway run identity isolation remain. Task cancellation no longer loads an unused secondary embedded executor solely to cancel an empty legacy registry. — codex-runtime-manager
- New late-provider cancellation regression plus current interaction/state/Gateway identity 4 files / 17 PASS; full tsgo PASS; typed lint clean; architecture 54 PASS. Real isolated active-task dialogue leaves board unchanged; supplement/local revision/full replacement maintain task identity and active constraint counts 1/2/1. — codex-runtime-manager
- Earlier candidate 4c119c1cc: runtime regression 69 files / 308 PASS; separate collaboration delivery/real background-process/durable restart 4 files / 17 PASS; full build PASS with 209 existing dynamic-import warnings. These are separate evidence sets, not a combined total or whole-system acceptance. No deployment. — codex-runtime-manager

## Historical event sequence coverage migrated (2026-11-08)

- Audited three obsolete execution-layer semantic sequence suites: 6 FAIL / 1 PASS because they require retired routing. Preserved them in archive/runtime-semantic-routing-20261108 and removed them from active discovery. Necessary long-constraint, revision, stale-write and paused-wake guarantees now run through the current typed mainline/state integration. No production rule was restored. — codex-runtime-manager
- Current lifecycle and route regression 2 files / 6 PASS; changed-file typed lint clean. Broader and type checks follow this checkpoint. — codex-runtime-manager

## Unused amendment policy and acknowledgement adapters removed (2026-11-08)

- Removed two consumerless legacy rule/acknowledgement modules after source archival. Retained resource queue and progress-format coverage in their current policy/command owners. Historical dialogue reads now consume the current public formatter directly. No execution scripts or fallback route introduced. — codex-runtime-manager
- Queue/status 3 files / 9 PASS; history/context 2 files / 10 PASS; full tsgo PASS; typed lint clean; architecture 54 PASS. The history suite initially failed on a missing workingStyleVersion mock export; partial mock now preserves actual exports. — codex-runtime-manager

## Unmarked human input cannot bypass interaction admission (2026-11-08)

- Reproduced an unmarked human request reaching the model without admission (1 FAIL before). Execution now consumes the same ingress rule as the public interaction entrance: missing provenance is human input; explicit internal, heartbeat, birth and collaboration triggers retain their existing entrances. No second classifier added. Provider-loop test fixtures now identify their internal origin explicitly. — codex-runtime-manager
- Run identity/ingress regression 2 files / 5 PASS; reply execution integration 48 PASS; full tsgo PASS; typed lint clean; architecture 54 PASS. Broader downstream fixture audit remains separate. No deployment. — codex-runtime-manager

## Downstream execution fixtures follow explicit ingress (2026-11-08)

- Downstream audit reproduced 22 failures because provider/billing/delivery fixtures supplied unmarked input directly to execution. Fixtures now explicitly identify internal origin and intercept the migrated embedded implementation; original BYOK remapping, credit snapshot, empty/filtered replies and media assertions remain unchanged. No production admission bypass added. — codex-runtime-manager
- Four files / 22 PASS; full tsgo PASS; typed lint clean. These targeted results do not constitute the full repository suite or production acceptance. — codex-runtime-manager

## Comprehensive execution-entry fixtures updated (2026-11-08)

- Updated internal-origin fixtures and migrated embedded/CLI mock boundaries without changing production behavior. Partial fallback mocks retain actual exports; cron/provider mocks reset queued responses between cases; English reminder cases explicitly declare English presentation. Original fallback, cancellation, compaction, streaming, reminder and usage assertions remain. — codex-runtime-manager
- Comprehensive reply-entry regression 28 PASS; full tsgo PASS; typed lint clean. Earlier audit failures were preserved in temporary logs and resolved rather than weakening production admission or restoring retired semantic routes. — codex-runtime-manager

## Artifact paths no longer count as English prose (2026-11-08)

- Reproduced Chinese delivery with a long artifact path being rejected as wrong-language planning (2 FAIL before). Existing language counting now masks opaque paths while preserving the original output and raw planning-marker checks. No new classifier or execution route added. — codex-runtime-manager
- Language regression 2 files / 37 PASS; full tsgo PASS; typed lint clean; architecture 54 PASS. English planning around paths remains rejected. — codex-runtime-manager
- Isolated real Gateway/model long-path delivery now waits for actual board closeout: exact artifact bytes, acceptance=passed, delivery=delivered, unfinished=false and deliverableChecked=true. Earlier agent.wait snapshots could precede delivery settlement; this does not establish the full cause of every earlier intermittent sequence or general business-quality acceptance. No deployment. — codex-runtime-manager

## Collaboration acceptance waits for the matching parent final (2026-11-08)

- Full collaboration audit found one source-isolation failure. Added an acknowledgement identity assertion: Bob's send was returning Alice's in_flight run because the fixture waited for any child final while the parent remained active. The fixture now waits for Alice's matching parent final and requires Bob's distinct started run. No production deduplication or authorization rule changed. — codex-runtime-manager
- Full collaboration entry/delivery regression 3 files / 18 PASS; full tsgo PASS; typed lint clean. This uses a real WS Gateway with mocked model replies and selected identity boundaries; real-model collaboration acceptance remains separate. No deployment. — codex-runtime-manager

## Unused active-task mutation adapters retired (2026-11-08)

- Audited source/package/extension consumers of amendActiveTask and controlCurrentTask: only re-exports and historical tests remained. Preserved source and intent in the existing archive tag, removed both modules and exports, and extended the no-return architecture gate. Typed state transactions and fixed interaction effects retain required ordering and identity safeguards. — codex-runtime-manager
- Current lifecycle/admission/routing/Gateway stop regression 4 files / 13 PASS; full tsgo PASS; typed lint clean; architecture 54 PASS. Whole-system replacement and production cutover remain separate gates. — codex-runtime-manager

## Task context consumes authoritative board facts only (2026-11-08)

- Reproduced historical unadmitted conversation being promoted into a current-task system prompt (1 FAIL before). Prepared reply now reads the sole task-state repository and uses a pure shared-context projection; it does not replay conversation text to infer task ownership. Current and parked facts preserve full active constraints, acceptance checks and pause state; completed work is not rendered as active execution. — codex-runtime-manager
- Context/real prepared entrance/lifecycle regression 3 files / 10 PASS; full tsgo PASS; typed lint clean; architecture 54 PASS. Legacy focus-resume helper has no remaining mainline consumer and awaits its separate archival/deletion checkpoint. No deployment. — codex-runtime-manager

## Transcript task-focus replay module retired (2026-11-08)

- Removed the consumerless legacy focus-resume module and historical replay tests after verifying their source matches the existing archive tag. Recorded original continuity intent and current owners. Dialogue history remains dialogue; admitted task state remains the sole task authority. Extended the no-return dependency gate. — codex-runtime-manager
- Current context/prepared-entry/lifecycle/resume regression 4 files / 17 PASS; full tsgo PASS; architecture 54 PASS. No deployment or transcript/task-data deletion. — codex-runtime-manager

## Post-retirement candidate verification (2026-11-08)

- Candidate 62099be2a: Runtime suites 67 files / 267 PASS; host memory/context/followup/cross-process board suites 5 files / 52 PASS; explicit e2e configuration 1 file / 48 PASS. The ordinary unit invocation excludes the e2e file, so it was run separately. Provider responses remain mocked in these suites. — codex-runtime-manager
- Full tsgo and 54 architecture rules PASS. Full build PASS; 209 existing INEFFECTIVE_DYNAMIC_IMPORT warnings and UI chunk-size warnings remain. UI synchronization was skipped by the existing pin. No running Gateway restart, merge, push or deployment. — codex-runtime-manager
- Remaining legacy facade consumers were audited: registry cancellation, compaction, memory flush, auxiliary filename generation and supervisor CLI calls delegate to migrated implementations. These are not evidence of a second executor body; auxiliary filename generation still invokes the tool-capable runner and requires a bounded shared-model migration before its compatibility dependency can be retired. Memory flush retains intentional file-writing capability and must not be replaced with text-only inference. — codex-runtime-manager

## Prepared interaction uses public execution registry (2026-11-08)

- Prepared reply reads active/streaming status and aborts through execution/index instead of the legacy executor facade. Lane naming remains the existing pure utility; registry identity and control behavior are unchanged. Context and OGUI wait regression 2 files / 9 PASS; full tsgo, changed-file typed lint and 54 architecture rules PASS. — codex-runtime-manager
- Broader media regression found two collaboration capability projection failures, reproduced unchanged on HEAD before this import change: participation overlay and promoted capabilities are absent from their expected prompt. This remains an explicit baseline issue to investigate; no production policy was weakened or test expectation removed. — codex-runtime-manager

## Collaboration media fixtures aligned (2026-11-08)

- Resolved the two preceding baseline failures: fixture executed as default while expecting bot-1 overlay, and wrote learning assets under the retired workspace-local path rather than the configured shared group store. Set the intended executor explicitly and configured the existing shared store in the fixture. Production capability isolation and lookup are unchanged; expected capabilities remain asserted. Updated registry test seam to the public execution API. — codex-runtime-manager
- Media/context suite 17 PASS; changed-file typed lint and format checks PASS. This verifies mocked prepared-reply context, not real-model collaboration or production cutover. — codex-runtime-manager

## External acceptance review and interaction boundary repair (2026-11-08)

- Reviewed the external report against 5a5c7dea8 rather than its db26b3161 snapshot. Its remaining lifecycle duplication, context supply, legacy classification and same-SHA real-model/restart evidence concerns are valid. Later focus-replay retirement and facade convergence do not close those gates. Keep collaboration claim authority separate from individual boards; retain tool backends and live workflow assets until replacement evidence exists. — codex-runtime-manager
- Moved governed interaction sequencing, model routing preparation and task-admission authorization from wiring/interaction-turn into command/governed-interaction through explicit ports. Wiring binds production functions only. The same model lease, input context, cancellation, fallback and atomic task mutation remain; no second classification call or executor was introduced. — codex-runtime-manager
- Expanded the production command-composition regression to cover unauthorized execution proposals without task commit. Joint command/model/candidate/prepared-host regression 5 files / 24 PASS; full tsgo PASS; changed-file typed lint clean; 54 architecture rules PASS. These are mocked-provider checks, not real-model or restart acceptance. Other execution lifecycle entrances remain open and are not declared unified. — codex-runtime-manager

## Shared execution preparation lifecycle (2026-11-08)

- Chat, queued followup and scheduled execution now use execution/runner/execution-lifecycle for commercial admission, routing consumption, candidate-set preparation, fallback access and lease disposal. Removed three duplicated preparation sequences; retained scene task identity, per-call budgets, accounting outboxes, OGUI recovery and delivery adapters. Command execution remains a separate pending adapter; this checkpoint does not claim all execution orchestration unified. — codex-runtime-manager
- Preparation invalidates previous readiness, checks cancellation before/after admission, and prevents an old prepared candidate set from being used after a later failure. Direct lifecycle tests 4 PASS; chat/followup 2 files / 37 PASS. Cron 4 files / 23 assertions passed but the combined run failed with a filesystem watch EMFILE error; isolated long-horizon rerun using polling passed 10 tests with exit 0. Full tsgo, changed-file typed lint and 54 architecture rules PASS. No push, merge or deployment. — codex-runtime-manager

## Rule inventory retirement consistency (2026-11-08)

- Reproduced a stale current-rule declaration pointing to retired command/interaction.ts (one failing test). Replaced that declaration with the current shared execution preparation lifecycle and added a source-existence gate for every current catalog entry. Historical retirement evidence remains in the archive; current metadata does not execute or grant authority. Catalog 2 PASS; typed lint clean. — codex-runtime-manager

## Command joins shared execution stage scope (2026-11-08)

- Command, chat, queue and cron now share execution-scope readiness, cancellation propagation, per-inference fallback attempt identity and disposal ordering. Fixed command authority adapter preserves E2/E3/E6 and child snapshot inheritance; command host no longer constructs fallback governance. Scene candidate parameters, budgeting, accounting and delivery adapters remain explicit; complete task-orchestration convergence is not claimed. — codex-runtime-manager
- Removed the consumerless command-fallback adapter after byte-matching source/tests to the existing archive tag and preserving retry tests on the shared scope. Governance registry now tracks the actual command callsite and associates cron E4 with the shared authorized session instead of a stale direct call. — codex-runtime-manager
- Command governance/credits/delivery/ACP 4 files / 54 PASS; model governance registry 95 PASS; shared scope/lifecycle 2 files / 7 PASS. Full tsgo and typed lint PASS; architecture 54 PASS. No real-model/restart acceptance, merge, push or deployment. — codex-runtime-manager

## Typed Gateway task control and parked recovery (2026-11-08)

- Gateway explicit pause/cancel/parked controls now use a fixed data parser and the locked state control transaction, without calling legacy automatic task creation/switch classification. Ordinary conversation remains read-only at ingress. Moved parked resume ownership into state; legacy exports delegate to the same implementation. Existing telemetry and live auth/stop/budget/workspace checks remain. — codex-runtime-manager
- Reproduced parked resume reviving the old attempt/version binding (one failing regression). Resume now invalidates prior attempt, deliverable version and acceptance evidence while preserving goal and constraints. Existing board/Gateway pause/resume regression 4 files / 58 PASS; parser and old-attempt tests 2 files / 12 PASS (overlap disclosed). Full tsgo, typed lint and 54 architecture rules PASS. — codex-runtime-manager
- Prior shared-stage candidate dd473632a joint regression: 76 files / 370 PASS, including Runtime, command, queue and cron. This remains mocked-provider evidence; no production cutover or whole-migration acceptance is claimed. — codex-runtime-manager

## Identity context source/render separation (2026-11-08)

- Reproduced the system prompt renderer rereading workspace identity despite captured facts (one failing regression). Added explicit captured identity input and moved unchanged identity guard projection to shared context. Embedded, CLI and prompt-inspection production adapters capture source facts before rendering; minimal/none embedded modes retain their original no-read behavior. The legacy direct-call fallback remains compatibility-only and does not establish complete Builder convergence. — codex-runtime-manager
- Prompt/source/embedded regression 3 files / 62 PASS; earlier CLI adapter regression 13 PASS separately. Full tsgo, changed-file typed lint and 54 architecture rules PASS. No deployment, whole-source lifecycle acceptance or rule-inventory completeness claimed. — codex-runtime-manager

## Legacy output replanning disconnected (2026-11-08)

- Reproduced enabled legacy complex-task flags replacing actual executor output with a synthetic plan and lexical acceptance report (one failing host regression). Removed the sole mainline postprocessing hook; command and delivery retain their current authority. Added a no-return import gate. Legacy source/tests remain isolated and archived; collaboration round execution is untouched. — codex-runtime-manager
- Reply-host regression 29 PASS; full tsgo and typed lint PASS; architecture 55 PASS. Prior candidate e07e531ca full build PASS with 209 existing dynamic-import warnings and UI-size warnings; UI sync remained pinned. No production cutover or whole-migration completion claimed. — codex-runtime-manager

## Durable scoped stop records (2026-11-08)

- Reproduced owner stop disappearing after process replacement (restart fixture returned inactive). Replaced process-local authority with state-owned atomic stop records scoped by tenant/user/session/task, opaque version tokens and compare-token clearing. Corrupt/unreadable records fail closed for resume. Explicit test-map adapters remain; no second executor or wake scheduler was introduced. — codex-runtime-manager
- Isolated cross-process and store regression 2 files / 3 PASS; Gateway current/parked resume 2 files / 37 PASS. Earlier combined run timed out during worker startup and was not counted as passing; isolated reruns completed successfully. Full tsgo, typed lint and 55 architecture rules PASS. This proves stop persistence on one shared state root, not distributed multi-host task ownership or complete asynchronous job recovery. — codex-runtime-manager
- Candidate eeef70ea6 joint regression before durable-stop change: 76 files / 439 PASS. No merge, push or deployment. — codex-runtime-manager

## History projection and preserved-source trust (2026-11-08)

- Reproduced preserved external article content entering a system message (one failing trust regression). Retained article rewrite continuity but injects preserved material as explicitly untrusted user content. Moved article and task-history projection to shared context; provider history sanitation no longer imports the legacy semantic focus module. Legacy exports reference the same implementation. — codex-runtime-manager
- Article/focus/board regression 3 files / 45 PASS; provider adapter regression 2 PASS separately. Full tsgo, typed lint and 55 architecture rules PASS. Prior candidate 288bf9110 joint regression 75 files / 359 PASS and build PASS; no Gateway restart or deployment. These checks do not establish complete async-job recovery or final personal/group real-model acceptance. — codex-runtime-manager

## Shared execution preparation race closure (2026-11-08)

- Reproduced disposal racing with pending preparation: late preparation returned ready after disposal; overlapping preparations could overwrite readiness. Shared scope now rejects overlap, rejects late readiness and drains pending admission before releasing its authority, so a late-acquired lease is not abandoned. No new scheduler or scenario classifier. — codex-runtime-manager
- Red/green regression: two failures before fix; scope/lifecycle 2 files / 9 PASS after fix. Full tsgo PASS; changed-file typed lint clean; architecture 55 PASS. This is shared lifecycle component evidence, not final same-version personal/collaboration real-model or restart acceptance. — codex-runtime-manager

## Command candidate budget ownership (2026-11-08)

- Moved candidate budget gating, success/failure charging and accumulated charge facts out of the command host into its execution-owned budget component. Command retains scene input and delivery adaptation; parent identity, sequence and budget-exhaustion precedence remain unchanged. No task creation or additional model call. — codex-runtime-manager
- Budget/command/credit regression 3 files / 50 PASS; full tsgo PASS; changed-file typed lint clean; architecture 55 PASS. Earlier candidate 575bd7900 joint regression 75 files / 386 PASS. Full lifecycle convergence and final real-model/restart acceptance remain open. — codex-runtime-manager

## Current candidate individual real-model recheck (2026-11-08)

- Candidate eeae5d645 local full build PASS; 209 existing ineffective dynamic-import warnings and UI-size warnings remain; pinned Control UI sync skipped. No production restart or deployment. — codex-runtime-manager
- Isolated Gateway with api-proxy-deepseek/deepseek-v4-flash completed the deterministic file task: exact UTF-8 artifact bytes, acceptance passed with digest, delivered receipt, deliverableChecked=true and unfinished=false. Task task-a26b8b0b755e; run/attempt 7b446f57-21c9-4807-9b3d-eb948ea29c42. Probe exited normally and temporary state was removed. This validates one personal artifact scenario, not semantic/layout acceptance, collaboration real-model lifecycle or asynchronous recovery after restart. — codex-runtime-manager

## Individual context excludes collaboration material (2026-11-08)

- Reproduced non-collaboration model input containing GroupSystemPrompt (one failing regression). Individual assembly no longer consumes group context, intro or system prompt; removed unreachable collaboration capability assembly in that branch. Explicit collaboration assembly retains its original source evaluation and ordering; channel adapters and session intro bookkeeping remain unchanged. — codex-runtime-manager
- Context regression 2 files / 16 PASS; full tsgo PASS; changed-file typed lint clean; architecture 55 PASS. Two explicit context catalogs and complete source lifecycle convergence remain open. Collaboration contract/plan/stop regression on the prior production-source candidate: 5 files / 26 PASS, simulated execution only. — codex-runtime-manager

## Speaker label trust placement (2026-11-08)

- Reproduced sender-derived untrusted speaker text entering the system prompt in both individual and collaboration assembly (two failing regressions). Speaker projection now joins the existing untrusted user-body wrapper; trusted inbound metadata, source rendering and task association remain unchanged. No additional model call. — codex-runtime-manager
- Reply/context/inbound metadata regression 3 files / 42 PASS; full tsgo PASS; changed-file typed lint clean; architecture 55 PASS. This does not establish full context catalog migration or final lifecycle acceptance. — codex-runtime-manager

## Individual context material catalog (2026-11-08)

- Moved individual initial material allowlist and fixed ordering into a data-only context catalog. The production reply host supplies named, already-rendered values; unknown material (including empty group material) is rejected. Source reads, learning exposure, late event consumption and collaboration assembly remain with existing owners; no model call or task mutation is introduced. — codex-runtime-manager
- Assembly/production-context regression 3 files / 21 PASS; full tsgo PASS; changed-file typed lint clean; architecture 55 PASS. Scoped attribution follows the previously authorized transfer while preserving predecessor history. Collaboration material catalog and late-material lifecycle remain open. — codex-runtime-manager

## Collaboration context material catalog (2026-11-08)

- Moved established collaboration material allowlist and order to a data-only context catalog. Existing host retains profile/knowledge/identity reads and delivery-side-effect updates, passing named rendered material to shared assembly. Original order, blanks and duplicate text behavior remain; no second classifier, scheduler or model invocation. — codex-runtime-manager
- Assembly/reply/collaboration delivery regression 5 files / 33 PASS; full tsgo PASS; changed-file typed lint clean; architecture 55 PASS. Initial personal/collaboration catalogs now have production consumers; common late materials and complete source lifecycle remain open. This is not final collaboration real-model acceptance. — codex-runtime-manager

## Combined context candidate verification (2026-11-08)

- Candidate 581557cd0 combined regression 84 files / 455 PASS, including personal runtime, command credits, queue, durable stop/delivery restart, collaboration plans/contracts/abort and delivery-side-effect boundaries. Local full build PASS; 209 existing ineffective dynamic-import warnings and UI-size warnings remain; pinned Control UI sync skipped. — codex-runtime-manager
- Same production-source candidate isolated real-model personal file task PASS: task-743981999f8a; run/attempt 01218527-2d55-4465-bbdf-59b9408248ae; exact bytes, acceptance passed with digest, delivery delivered, deliverableChecked=true and unfinished=false. Temporary Gateway exited normally and state was removed. No production restart, push, merge or deployment. Full collaboration real-model sequence, asynchronous restart recovery, late-material catalog and whole-executor retirement remain unaccepted. — codex-runtime-manager

## Shared late-context assembly ownership (2026-11-08)

- Moved common late-material ordering (task surface, clarification, learning recall, runtime events and skill guidance) into shared context assembly. Existing hosts retain source reads, exposure accounting and one-time event consumption. Sender-derived material remains untrusted user-body context. Preserved truthy-only append behavior and original bytes/order; no new scenario or model call. — codex-runtime-manager
- Assembly/production-context regression 3 files / 23 PASS; full tsgo PASS; changed-file typed lint clean; architecture 55 PASS. Complete Builder read/render/audit and full executor lifecycle acceptance remain open. — codex-runtime-manager

## Durable continuation cap (2026-11-08)

- Reproduced automatic continuation cap disappearing after runtime-local reset (one failing regression). Continuation reservations now persist on the scoped task under the existing board lock; policy owns the unchanged three-per-15-minute limit. Removed process-local continuation authority; existing timer and queue remain the only dispatch path. Concurrent reservation revalidates task/focus/pause/tombstone before writing. — codex-runtime-manager
- Continuation/followup regression 2 files / 48 PASS, including a separate Node process reading and enforcing the persisted cap; full tsgo PASS; changed-file typed lint clean; architecture 55 PASS. This proves durable limiting, not restart rescheduling, background process reattachment or complete asynchronous recovery. — codex-runtime-manager

## Continuation reservation concurrency evidence (2026-11-08)

- Two independent Node processes competed for the last available continuation reservation: exactly one accepted and one refused with continue_cap. Another session carrying the same taskId remained eligible, proving the cap is session/task scoped. Continuation suite 17 PASS; full tsgo PASS; changed-file typed lint clean. No production restart or deployment; restart rescheduling remains open. — codex-runtime-manager

## Cron pre-admission tool prefetch retired (2026-11-08)

- Reproduced readonly orchestration invoking a tool before a denied execution admission (one failing regression). Removed the cron-only heuristic prefetch branch. Its original purpose was current-step supporting context; the admitted runner retains memory/web tools and current-step guidance through existing capability checks. No replacement prefetch scheduler or flag-controlled bypass was added; standalone workflow assets remain preserved pending their own consumer audit. — codex-runtime-manager
- Cron long-horizon/owner/credit regression 3 files / 20 PASS, including qualifying tasks retaining tools, nonqualifying reminders remaining tools-disabled and denied admission invoking no prefetch/provider. Full tsgo PASS; changed-file typed lint clean; architecture 55 PASS. This does not establish whole cron/group real-model acceptance or complete workflow retirement. — codex-runtime-manager

## Retired cron path prevention (2026-11-08)

- Added a source dependency gate preventing the scheduled host from importing legacy task-orchestration prefetch again. Added the persisted continuation-limit policy to the detached rule inventory; inventory remains metadata only and cannot disable enforcement or execute configuration. Catalog 2 PASS; architecture 56 PASS; full tsgo PASS; changed-file typed lint clean. No whole-runtime retirement or deployment claimed. — codex-runtime-manager

## Current closure candidate combined verification (2026-11-08)

- Candidate 6bdb1c4f7 combined regression 88 files / 493 PASS across runtime, command credits, queued execution, continuation persistence/concurrency, cron admission/ledger, collaboration contracts/plans/abort and durable stop/delivery restart. Local full build PASS; 209 existing ineffective dynamic-import warnings and UI-size warnings remain; pinned Control UI sync skipped. — codex-runtime-manager
- Same candidate isolated real-model personal file task PASS: task-86bde518b45a; run/attempt a66cc6c6-9cb8-4f5d-ac79-84020b7dd615; exact bytes, acceptance passed with digest, delivery delivered, deliverableChecked=true and unfinished=false. Temporary Gateway exited normally and state was removed. No production restart, merge, push or deployment. Complete collaboration real-model sequence and asynchronous restart rescheduling remain open; whole executor retirement is not accepted. — codex-runtime-manager

## Heartbeat deferral preserves event identity (2026-11-08)

- Reproduced occupied heartbeat dropping pending completion events. Removed automatic parked-task creation from this wake path and retained deferred events for the next eligible turn. Occupancy still suppresses model execution; a wake is not execution admission. Cron result surfacing remains a separate pending audit. — codex-runtime-manager
- Heartbeat focus/notice regression 3 files / 17 PASS; full tsgo PASS; changed-file typed lint clean; architecture 56 PASS. This does not prove durable event storage or restart rescheduling. — codex-runtime-manager

## Cron result presentation state boundary WIP (2026-11-08)

- Reproduced result presentation calling automatic parked-task mutation (one failing regression). Removed that mutation and hypothetical dropped-task reporting; result presentation must not admit or evict personal work. Source changes remain uncommitted pending final presentation wording review and Git access. — codex-runtime-manager
- Result surface 9 PASS; full tsgo PASS; typed lint clean; architecture 56 PASS. Expanded regression had 27 PASS and one HTTP test timeout caused by loopback listen EPERM; isolated non-HTTP hook rerun 14 PASS / 1 explicitly skipped. This is not complete HTTP acceptance. User performed terminal fetch and ancestry gate PASS; sandbox Git write access is not thereby restored. — codex-runtime-manager
- Presentation wording review completed: notification-only result cards no longer claim the result was parked or personal todos were changed. Template/result regression 2 files / 14 PASS; full tsgo PASS; typed lint clean; architecture 56 PASS. No HTTP acceptance or Git write permission restoration claimed. — codex-runtime-manager

- Limited handoff taken by grok-bot (verify-then-take; session 4B333532-6579-45D7-ADBD-DC7ED973013F; prior ownerHistory preserved). Confirmed patch intent: presentation path no longer calls commitAutomaticPark / reports hypothetical dropped parks; formatCronParkedNoticeMessage(presentationOnly:true) says todos were not added/adjusted and does not claim “结果已挂起”; heartbeat/other callers keep prior parked wording. — grok-bot
- Reverification in allowed environment: OPENBOT_TEST_PROFILE=low targeted suite 4 files / 33 PASS, including hook HTTP entry “starts at the hook HTTP entry and still reaches transport once”. Full pnpm tsgo PASS; typed oxlint on 3 changed sources PASS (0 warnings); architecture manifest 56 PASS; git diff --check PASS. Attribution --fail-on-conflict PASS after limited sharedPath lander for cron-result-template.ts. Registry edits remain uncommitted for kiro-loom. No push/PR/merge/deploy. Whole executor migration / collab real-model / async restart recovery / old-executor retirement still open. — grok-bot

## Remaining migration sole-implementer take + fact matrix (2026-11-08)

- Full remaining migration taken by grok-bot as sole implementer (verify-then-take; session 30C981CD-0BBC-45A2-B3E2-BCE53A12092B; prior ownerHistory and sessions preserved, including limited cron-presentation handoff session 4B333532-6579-45D7-ADBD-DC7ED973013F). Independent acceptance agent reviews only; no parallel source edits. — grok-bot
- Baseline after take: branch codex/openbot/runtime-convergence; HEAD f3334196de606e796b9dbf80b585f6c1b906ae96; git fetch origin + merge-base --is-ancestor origin/main HEAD PASS. Uncommitted protected: .loom/registry.yaml (lander=kiro-loom), context-component-plan.md (this task), materials-manifest.md (observability owner), out/ (unattributed observability plan — preserve, do not bag). Attribution --fail-on-conflict PASS (0 CONFLICT). — grok-bot
- Current six-package fact matrix delivered to parent this turn (no package implementation started). Matrix distinguishes 已完成且有证据 / 实现缺口 / 验收缺口 / 退役候选 against HEAD f3334196d, not historical logs alone. Next implement order recommended after matrix review: Package 1 entry/lifecycle residual convergence first, then Package 2 restart-safe async recovery, then 3→4→5→6. — grok-bot

## Package 1 residual entry convergence (2026-11-08)

- Problem: residual production hosts still imported legacy `agents/cli-runner` / `agents/pi-embedded` facades for `runCliAgent` / `runEmbeddedPiAgent`, and `commands/agent.ts` still typed results through `pi-embedded-runner/types`, weakening the unique execution public entry. — grok-bot
- Change: export `runCliAgent`/`runClaudeCliAgent` from `execution/index`; redirect supervisor `worker-executor`, hooks `llm-slug-generator`, reply `agent-runner-memory`, `extensionAPI`, and command result typing to `execution/index`. Keep compatibility facades and embedded/cli backends; no second executor and no wholesale host move into runner. — grok-bot
- Architecture: added `runtime-supervisor-cli-public-entry`, `runtime-hooks-model-public-entry`, `runtime-memory-flush-public-entry`; strengthened `runtime-command-candidate-public-entry` against legacy type/run facades. Manifest 59 PASS. — grok-bot
- Tests: new `public-entry-convergence` identity/source path suite; memory mocks retargeted; repaired pre-existing fragile `cli-run.task-boundary` state mock via importOriginal (red: missing prepareReplacementSessionEntry/persistInteractionMessage on partial mock → green). Combined package-1 suite 10 files / 121 PASS. Full pnpm tsgo PASS; typed oxlint on changed sources PASS; git diff --check PASS. No real-model/restart/channel acceptance claimed. No push/PR/merge/deploy. — grok-bot
- Remaining: commands/agent host still composes lifecycle/budget/outcome glue (uses extracted execution helpers; not a second planner); package 2 async restart persistence; collaboration real-model; whole-executor retirement. — grok-bot

## Package 1 D1 controlled execution use-case (2026-11-08)

- Froze the unique controlled execution stage order (`prepare → assert_budget → infer → record_usage → dispose → record_execution_outcome`) as `createControlledExecutionUseCase` / `CONTROLLED_EXECUTION_STAGE_ORDER`. Command and shared execution lifecycles now implement that use-case; delivery remains outside the sequence. — grok-bot
- Architecture gates: chat/command/cron/followup hosts cannot deep-import model session factories, model-fallback, or execution-scope/controlled-execution internals; they must consume lifecycle factories from execution/index. Manifest 63 PASS. — grok-bot
- Contract suite 5 PASS (stage freeze; deny/unprepared never starts backend; cancel blocks next fallback candidate; dispose once). Related scope/lifecycle 9 PASS. Full tsgo PASS; typed oxlint clean. No host behavior migration in D1; D2+ align callers. No push/merge/deploy. — grok-bot

## Package 1 D2 Chat/runAdmittedTurn alignment (2026-11-08)

- Aligned Chat `runAdmittedTurn` as a scene adapter over the unique controlled execution use-case: renamed lifecycle binding to `controlledExecution`, asserted `stages === CONTROLLED_EXECUTION_STAGE_ORDER`, and corrected the transient-retry comment so retries stay on prepare→infer (no parallel `host.model.runWithModelFallback`). — grok-bot
- Documented that Chat/cron/followup must consume `createExecutionLifecycle` (or the command twin) and must not open a parallel prepare/infer loop. — grok-bot
- Regressions: denied admission never constructs/starts backend; cancel after first fallback candidate never starts the next; dispose-once semantics retained; execution success returns deferred `commitGrowthOutcome` separate from delivery. Admitted-turn suite 9 PASS; controlled+scope+lifecycle 14 PASS (23 total). Full tsgo PASS; typed oxlint clean; architecture 63 PASS. No push/merge/deploy. — grok-bot

## Package 1 D3 Command host → same controlled use-case (2026-11-08)

- Command host (`commands/agent.ts`) now binds `controlledExecution` via `createCommandExecutionLifecycle`, asserts `stages === CONTROLLED_EXECUTION_STAGE_ORDER`, and gates backends on `executionPreparation.kind === "denied"` so ACP/candidate never start after refused admission. Retains E2/E3/E6 entry ports on the command authority adapter. — grok-bot
- Command lifecycle prepare now honors abort signals before/after commercial acquire (parity with chat). — grok-bot
- New command-lifecycle suite 4 PASS (stage freeze + E2 retention; deny never starts backend; cancel blocks next candidate; dispose once). Related controlled + admission-session 9 PASS (13 total). Full tsgo PASS; typed oxlint clean; architecture 63 PASS. No push/merge/deploy. — grok-bot

## Package 1 D4 Cron/Followup controlled-execution alignment (2026-11-08)

- Cron and Followup scene hosts now bind `controlledExecution` via `createExecutionLifecycle` and share `assertControlledExecutionStages` with Chat/Command, removing duplicated hand-written stage-order asserts. Scene adapters retain queue/OGUI/ledger/delivery; no parallel prepare/infer loop and no whole-host move into runner. — grok-bot
- Added `assertControlledExecutionStages` on the controlled use-case contract (exported from execution/index). Chat/Command refactored to the same helper. — grok-bot
- Regressions: controlled suite 6 PASS (incl. assert accept/reject); admitted-turn 9 PASS; command-lifecycle 4 PASS; cron long-horizon ledger 11 PASS (incl. denied admission never starts backend). 30 total PASS. Full tsgo PASS; typed oxlint clean; architecture 63 PASS. No push/merge/deploy. — grok-bot

## Package 1 D5 Memory flush + slug → auxiliary model contract (2026-11-08)

- Added shared `resolveAuxiliaryModelGovernance` (`purpose: memory_flush | slug_filename`) under agent-runtime/model. Auxiliary inference inherits parent model-set when present; never creates or advances business tasks / commercial work-item admission. — grok-bot
- Memory flush `resolveMemoryFlushModelGovernance` now delegates to the shared contract (context stamps `purpose: memory_flush`). Slug generator routes through `runWithModelFallback` + auxiliary governance instead of a bare embedded call. — grok-bot
- Architecture: +2 rules (memory/slug cannot open controlled-execution or commercial admission sessions). Manifest 65 PASS. — grok-bot
- Tests: auxiliary governance 3 PASS; slug auxiliary wiring 1 PASS (under model/); memory governance 8 PASS; memory 1 PASS. Full tsgo PASS; typed oxlint clean. No push/merge/deploy. — grok-bot

## Package 1 D6 Supervisor work-item lifecycle (2026-11-08)

- Added `createSupervisorWorkItemLifecycle` — supervisor commercial acquire/release as authority ports over the unique controlled execution use-case. Denied prepare never arms CLI/node backends; dispose releases an acquired slot exactly once. — grok-bot
- `GatewayWorkerExecutor` / `NodeAgentWorkerExecutor` now admit via controlled lifecycle **before** starting workers or node dispatch; billing `executionId` keeps the commercial admission run id. Preserves permissions, identity, cancel registry, embedded/CLI backends; no second executor. — grok-bot
- Architecture: strengthened `runtime-supervisor-cli-public-entry` against private scope/lifecycle/session/fallback assembly. Manifest 65 PASS. — grok-bot
- Tests: supervisor-lifecycle 5 PASS (stages; deny-no-backend; cancel releases without CLI; dispose once; skipped no release). worker-executor 5 PASS; commercial-hint 2 PASS. Full tsgo PASS; typed oxlint clean. No push/merge/deploy. — grok-bot

## Package 1 D7 re-acceptance evidence pack (2026-11-08)

**Final HEAD for Package 1 independent acceptance:** `2dfcb9c80055b54b0fa28301d5d5883572c48a20`  
**Baseline retained:** `f9b6c4edcf8faede64affc596737c3dc877f121f` (公开 API 消费者收敛子切片). Package 2 **not started**.

### SHA chain (D1→D6)

| Slice | SHA | Summary |
| --- | --- | --- |
| D1 | `46583726e5fc927a7bb77761759210bf2898f862` | Freeze `createControlledExecutionUseCase` / stage order; lifecycle factories implement it |
| D2 | `05d38f2106d61f66b885f07349459c21c5d7c3f3` | Chat `runAdmittedTurn` scene adapter + stage assert; success≠delivery |
| D3 | `2233b3cd3019d2f38c92931244d2174fdb2a65ce` | Command host → same use-case; E2/E3/E6 ports retained; deny before ACP/candidate |
| D4 | `d9410d90d6ef699d8cb7e817152ea1d5adb2533a` | Cron/Followup `controlledExecution` + shared `assertControlledExecutionStages` |
| D5 | `c11635004a53d03a0f4f271eb5990cef01d6545c` | Memory flush + slug → `resolveAuxiliaryModelGovernance` (no task creation) |
| D6 | `2dfcb9c80055b54b0fa28301d5d5883572c48a20` | Supervisor work-item admit via `createSupervisorWorkItemLifecycle` before CLI/node |

### Duty / production call sites

| Host | Owner of stage order | Production entry | Scene retains |
| --- | --- | --- | --- |
| Chat | `createExecutionLifecycle` → controlled use-case | `execution/index.runAdmittedTurn` | task binding, tip budget, recovery, deferred `commitGrowthOutcome` |
| Command | `createCommandExecutionLifecycle` | `commands/agent.ts` | E2/E3/E6, ACP, command budget/outcome |
| Cron | `createExecutionLifecycle` | `cron/isolated-agent/run.ts` | ledger, schedule, delivery |
| Followup | `createExecutionLifecycle` | `auto-reply/reply/followup-runner.ts` | queue/OGUI/typing/delivery |
| Memory/slug | auxiliary model contract (not work-item lifecycle) | `agent-runner-memory.ts`, `hooks/llm-slug-generator.ts` | file write (flush), filename only (slug) |
| Supervisor | `createSupervisorWorkItemLifecycle` | `gateway/supervisor/worker-executor.ts` | placement, node invoke, CLI worker, cancel registry |

### Order regressions (D7 suite on HEAD)

OPENBOT_TEST_PROFILE=low — **12 files / 63 PASS**. No environment failures in this run (stderr lines are expected agent-error logs inside PASS cases, not env FAIL).

| Requirement | Evidence |
| --- | --- |
| Refuse admission → no backend | controlled-execution deny; admitted-turn deny; command-lifecycle deny; supervisor-lifecycle deny; cron ledger “does not prefetch…when admission is denied” |
| Cancel → no next candidate / no CLI start | controlled-execution cancel; admitted-turn cancel; command-lifecycle cancel; supervisor cancel-after-prepare |
| Fail/fallback billing identity | admitted-turn cleanup order release-before-forget; supervisor billing `executionId` uses commercial admission run id; command/admission-session release-before-forget |
| Dispose exactly once | controlled/command/supervisor dispose-once tests; chat finally dispose |
| Execution success ≠ delivery | admitted-turn deferred `commitGrowthOutcome`; command outcome closeout separate from infer |

Also: auxiliary governance 3 PASS; slug wiring 1 PASS; memory governance 8 PASS; worker-executor 5 PASS; commercial-hint 2 PASS.

### Gates on evidence HEAD

- Full `pnpm tsgo` PASS
- Architecture manifest **65** PASS
- Typed oxlint on D6 changed sources PASS (prior slices likewise at land time)
- No push / merge / deploy / production restart

### Remaining Package 1 risks (for acceptor)

1. Supervisor gateway commercial run id is allocated before `worker.start` (worker still mints its own handle.runId for cancel/logs); billing uses commercial id — confirm acceptor accepts this split.
2. Followup/cron scene adapters still hand-assemble prepare input (context estimate / gate input); stage loop is shared, not a second executor.
3. Interaction/mid-task paths (`governed-interaction`) still use `createAuthorizedModelSession` directly — outside D1–D6 chat/command/cron/followup/supervisor/aux scope; flag if acceptor expands Package 1.
4. Real-model / restart-safe async recovery / collaboration real-model remain Package 2+ and are **not** claimed here.

**Ready for independent Package 1 acceptance:** yes (implementer view). Package 2 not started. — grok-bot

## Package 1 Supervisor admission-wait cancel lease fix (2026-11-08)

- Bug: `createSupervisorWorkItemLifecycle` checked abort after acquire but before saving `heldRunId`, so cancel-during-acquire-wait leaked an acquired commercial lease (`dispose` saw nothing to release). — grok-bot
- Fix: register release identity immediately when acquire returns `acquired`, then run the cancel check. Denied/skipped still never hold a lease. — grok-bot
- Regressions (supervisor-lifecycle 7 PASS): cancel during admission wait → no backend + dispose releases once; denied-with-cancel-race → no release; prior deny/dispose/skip/cancel-after-prepare retained. tsgo PASS; typed oxlint clean. No architecture expansion; Package 2 not started; no push/merge/deploy. — grok-bot

## Package 2 P2-D1 durable async-wait job intent (2026-11-08)

- Baseline: `71a266e32fbc56f2f960cc5c8e444499c04edb52` (Package 1 PASSED + supervisor lease fix). Package 2 scope only: existing-task async wait + cross-restart recovery. No new scheduler/executor/task types; no Package 1 redo; no push/merge/deploy. — grok-bot
- Gap closed: bash-process-registry background notify jobs had no durable intent beside the session; in-memory Maps + ephemeral system-events cannot survive restart. — grok-bot
- Change: add `src/agent-runtime/state/repository/async-wait-job.ts` under `dirname(sessionFile)/async-wait-jobs/`. APIs: `recordAsyncWaitJobIntent`, `readAsyncWaitJobIntent`, `listWaitingAsyncWaitJobIntents`, `markAsyncWaitJobExited`, `clearAsyncWaitJobIntent`, `clearAsyncWaitJobsForTask`. Status `waiting` → `exited` on process exit; cleared when boundary refuses notify or owner stops/cancels/replaces the task. — grok-bot
- Call sites: `markBackgrounded` records when `notifyOnExit` + live task boundary + sessionKey; `markExited` marks exited; `maybeNotifyOnExit` clears on TaskActionBoundary refuse; `suppressCurrentTaskWake` / `cancelCurrentTask` / explicit control / interaction proposal / focus-gate clear intents for the owning task (sessionFile threaded). — grok-bot
- Tests: async-wait-job 4 PASS (record/survive-reread; mark exited; clear intent; clear-for-task). async-process-lifecycle 2 PASS retained. Full tsgo PASS; typed oxlint on 9 changed sources PASS. Architecture unchanged this slice (boot claim is P2-D2). Registry sharedPaths for new/conflicted paths appended uncommitted for kiro-loom. Protected files preserved. — grok-bot

## Package 2 P2-D2 recovery claim at boot (2026-11-08)

- Adds `async-wait-job-recovery.ts` next to consumer-boot: gateway `server.impl` calls `recoverAsyncWaitJobsAtGatewayBoot` after TaskOutcome consumer recovery. Light recheck reuses the same claim helper on an unref'd interval (no new scheduler/executor/task type). — grok-bot
- Claim rules: TaskActionBoundary refuse → clear intent (no wake); `waiting` + pid alive → leave waiting; pid dead/missing or already `exited` → mark exited if needed, then **one** bounded wake via existing `enqueueSystemEvent` + `requestHeartbeatNow` / scoped heartbeat options; `recoveryWakeIssuedAtMs` makes wake idempotent. — grok-bot
- Tests: recovery suite 5 PASS (dirs discover; alive wait; exited one wake + skip; pause clears; boot scan + idempotent). Prior async-wait-job 4 PASS retained. Full tsgo PASS; typed oxlint on changed sources PASS. Registry sharedPaths for recovery + server.impl appended uncommitted for kiro-loom. No push/merge/deploy. — grok-bot

## Package 2 P2-D3 stale callback fence (2026-11-08)

- Strengthens exit notify: after TaskActionBoundary refuse, clear durable intent; if intent already `cleared` (owner pause/cancel), do not enqueue system-event or heartbeat wake. — grok-bot
- Regressions: exec.task-binding matrix adds `cancelled` (5 PASS: current wakes; paused/replaced/constraints/cancelled do not). New async-wait-stale-callback 3 PASS (pause→recovery no wake; cancel→claimQueuedExecution rejected; replace→boundary refuse). Delivery/followup retain existing boundary checks. Full tsgo PASS; typed oxlint clean. No new scheduler. — grok-bot

## Package 2 P2-D4 proactive recovered-completion delivery (2026-11-08)

- `deliverRecoveredAsyncWaitCompletion`: after recovery claim marks exited, registers stable pending-delivery (`async-wait-recovery:<jobId>`), enqueues system-event, requests scoped heartbeat wake, and stamps `proactiveDeliveryIssuedAtMs` + `recoveryWakeIssuedAtMs`. Second call / peek hit → `already` (no duplicate event/wake). Boundary refuse → clear, no delivery. — grok-bot
- Boot/recheck claim path uses the same helper with cfg so TaskOutcome persistRoot is available. Reuses pending-delivery + heartbeat/followup; no new scheduler/executor. Tests: recovery suite 6 PASS incl. idempotent proactive delivery. Full tsgo PASS; typed oxlint clean. — grok-bot

## Package 2 P2-D5 evidence pack — stop for acceptance (2026-11-08)

**Final HEAD for Package 2 independent acceptance:** `529eaa1fe12bc133b31971f22de2100bfb5b6cef` (P2-D4). Evidence pack commits sit on top; tip at land time includes this note.  
**Baseline (Package 1 PASSED):** `71a266e32fbc56f2f960cc5c8e444499c04edb52`  
**Package 3 not started.** No push / merge / deploy / production restart.

### SHA chain (P2-D1→P2-D4)

| Slice | SHA | Summary |
| --- | --- | --- |
| P2-D1 | `eb5e1e5303b9fe24245cccac549e3dd08557ecfe` | Durable async-wait job intent under `dirname(sessionFile)/async-wait-jobs/`; record on background+notify; mark exited; clear on refuse/owner stop |
| P2-D2 | `168c164f733c340056cf0cf269f128784c3b955e` | Boot recovery claim next to TaskOutcome consumer-boot in `server.impl`; pid alive → wait; exited → one bounded wake; light recheck |
| P2-D3 | `e7c1763894fbbe32139bbe5eeae8641f724d4c2e` | Stale callback after pause/cancel/replace does not wake/exec; cleared intent short-circuits notify; claimQueuedExecution rejects |
| P2-D4 | `529eaa1fe12bc133b31971f22de2100bfb5b6cef` | Proactive recovered-completion delivery via pending-delivery + system-event + heartbeat; idempotent `proactiveDeliveryIssuedAtMs` |

### Duty / production call sites

| Concern | Owner | Production entry | Notes |
| --- | --- | --- | --- |
| Intent write | `async-wait-job` repo | `bash-process-registry.markBackgrounded` / `markExited` | Only notify+live boundary |
| Intent clear | same | `maybeNotifyOnExit` boundary refuse; `suppressCurrentTaskWake` / `cancelCurrentTask` (+ sessionFile); explicit/interaction control | Owner stop wins |
| Boot recovery | `async-wait-job-recovery` | `gateway/server.impl` next to `recoverTaskOutcomeConsumersAtGatewayBoot` | Scans agent sessions `async-wait-jobs/`; recheck interval unref'd |
| Proactive delivery | `deliverRecoveredAsyncWaitCompletion` | claim path at boot/recheck | Registers `async-wait-recovery:<jobId>` pending-delivery; one event+wake |
| Stale fence | TaskActionBoundary + claimQueuedExecution | exec notify, followup, delivery-queue/deliver | Existing hosts retained |

### Order regressions (P2 suite on evidence HEAD)

OPENBOT_TEST_PROFILE=low — **5 files / 20 PASS**:

| Requirement | Evidence |
| --- | --- |
| Durable intent survives reread | async-wait-job 4 PASS |
| pid alive → wait; exited → one wake | async-wait-job-recovery (alive/exit/boot) |
| Proactive delivery idempotent | recovery “proactive recovered delivery is idempotent” |
| Pause/cancel/replace → no wake/exec | exec.task-binding 5 PASS (incl. cancelled); stale-callback 3 PASS; claimQueuedExecution rejected after cancel |
| Task board authority under real background exit | async-process-lifecycle 2 PASS |

### Gates on evidence HEAD

- Full `pnpm tsgo` PASS
- Typed oxlint on Package 2 changed sources PASS at each land
- Architecture: no new manifest rules required this package (reused board + claimQueuedExecution + pending-delivery + heartbeat/followup)
- Registry sharedPaths / canLandWith edits remain **uncommitted** for kiro-loom; protected `.loom/registry.yaml`, context-component-plan.md, materials-manifest.md, `out/` preserved
- No new scheduler / executor / task types; no Package 1 redo

### Remaining risks (for acceptor)

1. Alive-at-boot jobs depend on the light recheck interval (or next restart) to observe later exit — not a second scheduler, but not instant.
2. System-events remain ephemeral; durability is the intent + pending-delivery registration; followup/heartbeat still consume the event.
3. `server.impl` sharedPath lander temporarily pointed at agent-runtime-convergence for Package 2 boot wiring (uncommitted registry); observe-owner history preserved in reason text.
4. Package 3+ not in scope.

**Ready for independent Package 2 acceptance:** yes (implementer view). **Stop here. Package 3 not started.** — grok-bot

## Package 2 acceptance remediation (2026-11-08)

**Failed tip:** `919c86ac151ef896b0972e468cf2552cfb59c7f9`. Package 3 still NOT started.

### Fixes (in-scope only; no new scheduler)

1. **Continuation mainline, not heartbeat silent drain** — Recovery no longer treats `enqueueSystemEvent` + `requestHeartbeatNow` + pending register as `delivered`. Boot/recheck **claims** under lock then **arms** existing task-board continue via `setAsyncWaitRecoveryContinueEnqueue` → `enqueueFollowupRun` with `taskBoardContinueTicket`. Delivery is only `confirmPendingTurnDelivery` after a real `claimQueuedExecution` run id.
2. **Atomic claim** — `transitionAsyncWaitJobIntent` / `claimAsyncWaitJobForRecovery` read+decide+write under per-job file lock. Dual-process contention → one `claimToken`; owner clear cannot be overwritten by stale snapshots.
3. **Retryable stages** — Stages `claimed → continue_armed → turn_bound → delivery_pending → delivered`. Unconfirmed stages retry; v1 `issued` maps to retryable `continue_armed`, not permanent skip.
4. **Real ids** — `bindAsyncWaitRecoveryTurn` on `claimQueuedExecution` accept; `markAsyncWaitRecoveryDelivered` on exact confirm receipt. No synthetic completion forge.
5. **PID ≠ success** — Alive pid → still waiting. Missing pid → `process_missing_unconfirmed` evidence; continue prompt warns not to treat as success. Live `markExited` records `process_exit_observed` with exitCode/summary.

### Evidence (isolated)

| Kind | Suite | Result |
| --- | --- | --- |
| Unit / same-process | async-wait-job 6, recovery 6, stale-callback 3 | PASS |
| Mock heartbeat/events | removed as delivery proof; continue enqueue mocked in unit recovery | PASS |
| Real two-process | async-wait-recovery.cross-process 4 (A write→B execute+receipt; dual claim; crash-retry; stop concurrent) | PASS |
| Related retain | exec.task-binding 5, async-process-lifecycle 2, confirm-pending 5 | PASS |

Registry sharedPaths remain uncommitted for kiro-loom. Protected files preserved. No push/merge/deploy. ### Remediation SHA chain

| Commit | SHA | Focus |
| --- | --- | --- |
| Atomic claim + evidence | `0255a06bc3e7cab4a5a142dffe86dc36f9eb75e2` | lock transitions; PID unconfirmed ≠ success |
| Continue mainline | `62cc6114cf25c512d13b46f6ec6523ee6988ecfd` | arm task-board continue; bind real runId; confirm→delivered |
| Evidence note | `5c9c5cc6d378f41301f4aea87966caa8e96cfee9` | tasks.md remediations |
| Cross-process coverage | `d2bafcb14b47153e83cafc22d3daebf8ded8a7c3` | A→B execute+receipt; dual claim; crash retry; stop |

**Re-acceptance tip:** `d2bafcb14b47153e83cafc22d3daebf8ded8a7c3`

Ready for Package 2 re-acceptance. — grok-bot

## Package 2 re-acceptance remelt — production loop (2026-11-08)

**Failed tip:** `69aeef0ae08c5345e8d6a2d722222a90f859bcb9`. Package 3 still NOT started.

Preserved: lock-in-RMW, clear protection, PID-missing=unconfirmed, actual boot call site.

### Fixes (closed production loop only; no new scheduler/task types)

1. **Cold-start followup consumer** — `registerFollowupDrainCallback` + `ensureAsyncWaitRecoveryFollowupConsumer` (createFollowupRunner) wired before recovery enqueue; drain no longer no-ops after boot enqueue.
2. **Trusted run fields** — enqueue resolves model/workspace/auth/delivery target from session store + config (`resolveTrustedRecoveryModel`, `resolveAgentWorkspaceDir`, lastChannel/lastTo). Deleted openai/recovery-continue and agentDir-as-workspaceDir.
3. **Claim fences** — jobId+claimToken+stage+attempt; active `turn_bound` not re-claimable; no stage regression to `continue_armed`; bind refuses multiple open jobs by taskId alone; stop then late token cannot overwrite cleared.
4. **Exec vs delivery recovery** — `delivery_pending` → `delivery_only` (no business re-enqueue); bind syncs `executionAttempt` so recheck cannot clear new recovery with stale attempt.
5. **Claimed prompt evidence** — `claimQueuedExecution` merges wake.prompt with recovery appendix (WARNING/unconfirmed retained). Tests assert final claimed prompt.

### Evidence (labeled)

| Kind | Suite | Result |
| --- | --- | --- |
| Real queue/process + model stub + channel stub | `async-wait-recovery.production-path` 1 | PASS (boot→enqueue→followup drain→claim→model stub→channel stub→confirmPending→delivered) |
| Trusted enqueue + cold-start consumer | `async-wait-recovery-enqueue` 2 | PASS |
| Claim prompt merge | `claim-queued-execution.recovery-prompt` 2 | PASS |
| Stage/token fences + overlapping stop | `async-wait-job.claim-fence` 5 | PASS |
| Unit recovery (incl. delivery_only + attempt sync) | `async-wait-job-recovery` 8 | PASS |
| Intent / stale-callback | async-wait-job 6, stale-callback 3 | PASS |
| Real two-process (renamed; NOT full loop proof) | cross-process 4 — manual-inject receipt; dual claim; crash-retry; sequential stop-then-retry | PASS |

Registry sharedPaths for new files appended uncommitted for kiro-loom. Protected files preserved. No push/merge/deploy. Package 3 not started.

**Remelt tip for re-acceptance:** `ec975b057` (production-loop close). Prior failed tip `69aeef0ae` retained above. — grok-bot

## Package 2 remelt — close 4 production gaps (2026-11-08)

**Failed tip:** `8743811fad2901b9a35c81f18f96e6cde461b445`. Package 3 still NOT started.

Preserved: prior remelt cold-start consumer, claim fences, trusted enqueue fields, delivery_only arming, claimed prompt evidence. No new executor/task types. No push/merge/deploy.

### FIRST — production ensure/createFollowupRunner path

`async-wait-recovery.production-path` now registers via real `ensureAsyncWaitRecoveryFollowupConsumer` → `createFollowupRunner`. Stubs only at lowest boundary: `runEmbeddedPiAgent` (via embedded-run → pi-embedded mock) and `routeReply` / `onBlockReply`. Acceptance + delivery status come from production `prepareVisibleDelivery` + `confirmPendingTurnDelivery` driven by stub returns — no hand-written success/acceptance=passed/delivered.

### Gaps closed

1. **turn_bound without boundDeliveryId** — `isBoundAsyncWaitRunLive` (trusted `isEmbeddedPiRunActive(sessionId)` + board.executionAttempt===boundRunId). Live → keep active_exec; dead claim → reopen `continue_armed` via existing recovery (no permanent active_exec; no unconditional re-run).
2. **Real delivery-prep → delivery_pending** — `publishPending` binds `deliveryId` into recovery (`delivery_pending`). Delivery-only retry consumer path (`asyncWaitDeliveryOnly`) skips claim/model; transport + confirm only.
3. **Exclusive job/token/stage/run bind under lock** — `claimQueuedExecution` requires jobId+claimToken; bind failure refuses execution (not accepted) and `restoreBoardExecutionAttempt` rolls back wrong board attempt.
4. **Trusted enterprise/owner identity** — `resolveTrustedRecoveryIdentity` / `hasAuthenticatedIdentity` into `FollowupRun.executionIdentity` (+ owner-tenant fields followup consumes). Missing identity → explicit enqueue refuse; no unscoped exec.

### Validation evidence

| Case | Suite | Result |
| --- | --- | --- |
| ensure+createFollowupRunner → delivered from stubs | production-path happy | PASS |
| channel fail ≠ delivered; delivery-only retry no re-model | production-path channel-fail | PASS |
| missing trusted identity refuse | production-path identity | PASS |
| crash after claim recoverable | cross-process crash-retry | PASS |
| dual-process cannot overwrite same exec | cross-process dual claim | PASS |
| stage/token fences + stop/stale | claim-fence 5 | PASS |
| delivery_only arm + attempt sync | async-wait-job-recovery | PASS |
| Related Package2 suites | 7 files / 30 tests | PASS |

Typed oxlint on changed sources: 0 warnings / 0 errors.

Registry sharedPaths / protected plans left uncommitted for kiro-loom. Package 3 not started.

**Remelt tip for re-acceptance:** `1c98ff7ee` (4-gap close). Prior failed tip `8743811fa` retained above. — grok-bot

## Package 2 remelt — close 4 acceptance defects (2026-11-08)

**Failed tip:** `efe0e2ce9b0f0c9fa07a269f7b3b3df0a92ffbe4`. Package 3 still NOT started.

Preserved: production `ensureAsyncWaitRecoveryFollowupConsumer` → `createFollowupRunner` chain; delivery_pending bind; trusted identity refuse; claimed prompt WARNING. No architecture expansion. No push/merge/deploy.

### Defects closed

1. **Original payload delivery-only retry** — `boundPayloads` (+ `boundDeliverableVersion`) persisted at publishPending bind; delivery-only resends those payloads/media (never “Delivery retry…” placeholder). Transport fail on recovery confirms as `delivery_unknown` (retryable), not terminal failed.
2. **Failed-claim board rollback CAS** — `restoreBoardExecutionAttemptAfterFailedBind` only restores when board.executionAttempt still equals this write’s runId; concurrent newer attempt untouched; empty prior attempt restored to "".
3. **Bind accepted/rejected** — `bindAsyncWaitRecoveryTurn` returns `{accepted:true|false, reason}`; transition `"keep"` / record existence ≠ success. `claimQueuedExecution` refuses business exec on `!accepted`.
4. **Liveness prepare + cross-process** — `holderPid` + embedded active + legacy prepare grace; dead re-claim bumps `claimGeneration` + new `claimToken` (freshClaim) so old holders are fenced (no dual exec).

### Regression evidence

| Case | Suite | Result |
| --- | --- | --- |
| Original payload retry match + channel fail no close/no re-model | production-path 3 | PASS |
| Payload retain / token reject / CAS rollback / prepare holder / no double claim | four-defects 6 | PASS |
| Live/dead fence + exclusive bind + delivery_only | claim-fence 5 | PASS |
| Real process crash/dual/stop | cross-process 4 | PASS |
| Related Package2 | 8 files / 36 tests | PASS |

Typed oxlint on changed sources: 0 warnings / 0 errors.

**Remelt tip for re-acceptance:** `TIP_PLACEHOLDER` (4-defect close). Prior failed tip `efe0e2ce9` retained above. — grok-bot

