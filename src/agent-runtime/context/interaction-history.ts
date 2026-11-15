import type { InteractionModelInput } from "../contracts/interaction.js";

export type InteractionHistoryProjection = {
  context: InteractionModelInput["context"];
  /** False when the budget dropped any authorized history. Empty history is complete. */
  complete: boolean;
};

/**
 * Factual omission notice placed in the projected prompt material itself so
 * callers cannot ignore incompleteness. Projected as user-role reference data
 * so a later host-assembled user-role prefix (such as peerContext) cannot
 * place a system message after history has started. The completion builder
 * quotes earlier user-role context as {source: reference_context}. Not a task
 * decision and not a restrict.
 */
export const INTERACTION_HISTORY_OMISSION_NOTICE =
  "部分历史因预算省略，不能将本段视为完整记录。不得推断缺失内容。若当前请求依赖被省略的原文、先前授权或指代内容，应澄清，不要编造。独立且自足的新请求仍可理解与准入。当前目标、验收与有效约束以任务板等权威状态为准。";

function budgetChars(maxChars: number): number {
  return Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0;
}

/** A bounded model view of authoritative branch messages; never a history writer. */
export function projectInteractionHistoryWithStatus(
  messages: readonly unknown[],
  currentMessageId: string,
  maxChars = 24000,
): InteractionHistoryProjection {
  const selected: { role: "user" | "assistant"; content: string }[] = [];
  let remaining = budgetChars(maxChars);
  let complete = true;
  for (const value of [...messages].toReversed()) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const row = value as Record<string, unknown>;
    if (row.role !== "user" && row.role !== "assistant") {
      continue;
    }
    if (row.idempotencyKey === currentMessageId || row.id === `local-${currentMessageId}`) {
      continue;
    }
    const text =
      typeof row.content === "string"
        ? row.content
        : Array.isArray(row.content)
          ? row.content
              .flatMap((part: unknown) => {
                if (!part || typeof part !== "object") {
                  return [];
                }
                const block = part as Record<string, unknown>;
                return block.type === "text" && typeof block.text === "string" ? [block.text] : [];
              })
              .join("\n")
          : "";
    if (!text) {
      continue;
    }
    // Retain a contiguous newest suffix of whole messages. A partial sentence
    // can remove a negation, condition, source, or the subject of an instruction.
    if (text.length > remaining) {
      complete = false;
      break;
    }
    selected.push({ role: row.role, content: text });
    remaining -= text.length;
  }
  const history = selected.toReversed();
  // User-role keeps the notice in the existing reference-context contract and
  // preserves message order when the reply host prepends peerContext.
  const context: InteractionModelInput["context"] = complete
    ? history
    : [{ role: "user", content: INTERACTION_HISTORY_OMISSION_NOTICE }, ...history];
  return { context, complete };
}

/** Compatibility projection; the incompleteness notice is already in `.context`. */
export function projectInteractionHistory(
  messages: readonly unknown[],
  currentMessageId: string,
  maxChars = 24000,
): InteractionModelInput["context"] {
  return projectInteractionHistoryWithStatus(messages, currentMessageId, maxChars).context;
}
