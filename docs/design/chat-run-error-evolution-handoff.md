# Chat run errors and the evolution handoff

Chat-scoped agent run errors are a transcript event, not a crash banner.

## Surfaces

1. Transcript. The sanitized error is an assistant message so the person can continue or try another approach. The top danger rail stays for gateway disconnect copy and send or attachment limits.
2. Evolution, only when the chat copy cannot resolve the failure. The hook is `noteUnresolvedChatRunError` in `src/auto-reply/reply/chat-run-error-escalation.ts`. It calls the existing `recordExperienceCapsuleSafely` writer with trigger `task_failure`. That writer stores a candidate anti-pattern capsule. It does not approve, apply, or change working DNA.

## What stays in chat only

Missing model API keys, workspace authorization, catalog or asset gaps, and collaboration permission errors. Those messages tell the person what to do.

## Fail closed

No agent or collaboration scope means the capsule writer skips. Session lookup or writer failures must not block the chat error broadcast. Placeholder text `chat error` is not a lesson and is not escalated.
