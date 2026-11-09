# Batch D context supply and retirement evidence

- Date: 2026-11-09
- Base: accepted Batch C `46f0b7ae019c72398307c129e7ce606b26ffeb74`
- New draft stacked on that head so PR #260 stays the accepted Batch C review.
- Not merge, deploy, typecheck, or build approval. Batch E is not started.

## T7 supply chain

For the reply host (`get-reply-run.ts`):

1. Read: session entry, inbound body, profile, seat, knowledge, skills, and `openSessionManager(sessionFile).buildSessionContext().messages`. That JSONL history is the authoritative transcript. It is not an optional context source and this batch does not add a switch to drop it.
2. Select: `shouldUseCollaborationRuntimeAssembly` is the only collaboration binding. `selectContextCatalog` then returns `individual` or `collaboration-member`. `ChatType === "group"` without that binding stays `individual`.
3. Order and render: the host renders fragments. `assembleIndividual` or `assembleCollaborationRuntimeContextParts` (which calls `assembleCollaborationMember`) orders them. Group ids are absent from the individual catalog and throw if passed.
4. Audit and trust: untrusted speaker and `UntrustedContext` stay on the user body via `appendUntrustedContext`. System events are drained once into the system tail.
5. Model messages: the admitted runner embeds `extraSystemPrompt` through the existing `buildAgentSystemPrompt`. `compileModelContext` only compresses history when its switch is on. It is not a second chapter compiler.

Host reads that stay outside context: knowledge retrieval and receipts, learning exposure, profile and seat and runtime identity, skill policy, the one-shot system-event queue, and `DeliveryToolSideEffect` written before the delivery text is passed into the collaboration catalog.

`collaboration-compile-sections.ts` is not split. That debt stays registered.

## Capability boundary

`wrapToolWithBeforeToolCallHook` stamps `declareCapability` before `execute`. Unknown tools stay `sideEffect: "unknown"` and `idempotency: "not_declared"`. A task-boundary refusal during the hook wait blocks the call. No new adapter platform and no permission change in this batch. Lobster remains an external workflow with an opaque resume token.

## T8

See `retirement-disposition.md`. Nothing was deleted. Hooks transform, Lobster, OpenProse, and the readonly orchestration path stay because consumer or asset evidence is insufficient.

## Regression

`OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/agent-runtime/context/catalog/select-catalog.test.ts src/agent-runtime/context/assembly.test.ts src/agent-runtime/command/scenarios/collaboration-entry.test.ts src/agent-runtime/capabilities/catalog.test.ts src/auto-reply/reply/get-reply-run.aside-dialogue-context.test.ts src/auto-reply/reply/runtime-context-assembly.test.ts`

## Non-goals

No delegation supplement, no new confirmation mode, no collaboration card, no `assembleEverything`, no `buildAgentSystemPrompt` move, no merge, no deploy.
