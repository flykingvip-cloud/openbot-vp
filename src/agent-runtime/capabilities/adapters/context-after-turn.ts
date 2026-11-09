import type { ContextEngine } from "../../../context-engine/types.js";

/** Existing post-turn hook and ingest fallback; no task control. */
export async function invokeContextAfterTurn(
  engine: ContextEngine,
  input: Parameters<NonNullable<ContextEngine["afterTurn"]>>[0] & {
    warn: (message: string) => void;
  },
) {
  if (typeof engine.afterTurn === "function") {
    try {
      await engine.afterTurn({
        sessionId: input.sessionId,
        sessionFile: input.sessionFile,
        messages: input.messages,
        prePromptMessageCount: input.prePromptMessageCount,
        tokenBudget: input.tokenBudget,
        runtimeContext: input.runtimeContext,
      });
    } catch (afterTurnErr) {
      input.warn(`context engine afterTurn failed: ${String(afterTurnErr)}`);
    }
  } else {
    // Fallback: ingest new messages individually
    const newMessages = input.messages.slice(input.prePromptMessageCount);
    if (newMessages.length > 0) {
      if (typeof engine.ingestBatch === "function") {
        try {
          await engine.ingestBatch({
            sessionId: input.sessionId,
            messages: newMessages,
          });
        } catch (ingestErr) {
          input.warn(`context engine ingest failed: ${String(ingestErr)}`);
        }
      } else {
        for (const msg of newMessages) {
          try {
            await engine.ingest({
              sessionId: input.sessionId,
              message: msg,
            });
          } catch (ingestErr) {
            input.warn(`context engine ingest failed: ${String(ingestErr)}`);
          }
        }
      }
    }
  }
}
