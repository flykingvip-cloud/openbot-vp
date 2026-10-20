# Context Compiler Contract

**Date:** 2026-08-20
**Status:** P0 implementation contract
**Related:** [chat-inbound-depth-router-revised-proposal-2026-08-20.md](./chat-inbound-depth-router-revised-proposal-2026-08-20.md)

## Engineering contract

Durable History can grow without bound. Model Context must be finite, relevant, and explainable. Context Compiler is the only boundary between History and the Model.

```text
Conversation History (append-only JSONL)
Memory (durable, versioned, idempotent)
Task State (durable)
        │
        ▼
Context Compiler  ← sole outbound authority
        │
        ▼
Model Context (lane-budgeted atomic units + recalled memory)
```

This is History-to-Context Compilation, not History Truncation.

## Frozen decisions

- `chat.send` remains the only real chat entry. Do not reconnect `user.daibai.ask`.
- No D1 greeting shortcut. No intent LLM. No no-model ack.
- JSONL is the source of truth. Do not delete history.
- Compaction is overflow recovery, not the compiler.

JSONL 继续作为 durable source of truth。`chat.history` 使用派生 sidecar 索引（`*.jsonl.idx.json`）按页读取字节；索引损坏则删除重建，不得阻塞消息持久化。

## Model-context boundary (P0-0)

Verified against `@mariozechner/pi-agent-core` `agent-loop.js` `streamAssistantResponse`:

```text
Agent._state.messages          // full session, persisted via SessionManager
        │
        ▼
transformContext(messages)     // Context Compiler (AgentMessage[])
        │
        ▼
convertToLlm(messages)
        │
        ▼
streamFn(model, llmContext)    // llmContext.messages == provider request
        │
        ▼
provider API (anthropic.js uses context.messages)
```

`transformContext` is the official compile hook. `streamFn` wrapping is the production invariant: if a later Pi upgrade reassembles the transcript after compile, the wrap fail-closes by slicing the outbound payload.

Acceptance is not “compiler output looks small”. Acceptance is `actual provider request ≈ compiled context`.

## Lane budgets (targets, not a single 2–6k hard cap)

These are floors. When the model `contextWindow` is known, each lane target scales with that window and never drops below the floor. Act is min(25% of the window, 48k). Chat and retrieve use the same share and cap, weighted by their floor relative to act (6/16 and 10/16).

| Lane | Floor target | Admission (0.8 × target, then 1.2 estimate margin) |
| chat | 6k | ~4.8k estimated at the floor |
| retrieve | 10k | ~8k estimated at the floor |
| act | 16k | ~12.8k estimated at the floor |

Unknown lane uses **act** so execution is not starved.

## Atomic context units

An over-budget unit is shrunk before any whole unit is dropped. The user message and the final assistant text stay. Each toolCall/toolResult pair is replaced together by a short digest (tool name, key args, about 300 characters of the result). Orphan calls and results are omitted together so `assertToolTransactionIntegrity` still holds.

Whole units are dropped only after those digests are exhausted:

- `plain_turn`
- `tool_execution_turn`
- `current_execution_turn` (never dropped)

The most recent earlier turn's user text and final reply are never dropped. The current turn is a hard invariant. If compile would drop it, the compiler refuses and returns the uncompiled source.

When no task context exists, the compiler seeds `active_task` from the last explicit user goal in the transcript. A shrink or drop of a unit that contains a user request is logged at info.

## Assembler vs Compiler

- Assembler / `loadContextCandidates`: candidates only (`userProfile`, `task`, `memory`, `evidence`).
- Compiler: the only component that admits candidates into outbound model context.

Assembler must not inject `recent_messages` into the system prompt.

## Preference mutation

High-confidence imperative patterns only. Writes may miss; they must not invent.

Stored as versioned user-profile entries with `source`, `sourceMessageId`, `updatedAt`, `version`, optional `previousValue`. Idempotent on `sourceMessageId`.

## Disable

`OPENBOT_CONTEXT_COMPILER=0`
