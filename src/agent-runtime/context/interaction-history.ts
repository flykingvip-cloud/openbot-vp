import type { InteractionModelInput } from "../contracts/interaction.js";

export type InteractionHistoryProjection = {
  context: InteractionModelInput["context"];
  complete: boolean;
};

/** A bounded model view of authoritative branch messages; never a history writer. */
export function projectInteractionHistoryWithStatus(
  messages: readonly unknown[],
  currentMessageId: string,
  maxChars = 24000,
): InteractionHistoryProjection {
  const selected: { role: "user" | "assistant"; content: string }[] = [];
  let remaining = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0;
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
    // Retain a contiguous suffix of whole messages. A partial sentence can
    // remove a negation, condition, source, or the subject of an instruction.
    if (text.length > remaining) {
      complete = false;
      break;
    }
    selected.push({ role: row.role, content: text });
    remaining -= text.length;
  }
  return { context: selected.toReversed(), complete };
}

/** Compatibility projection; hosts making task decisions must also check completeness. */
export function projectInteractionHistory(
  messages: readonly unknown[],
  currentMessageId: string,
  maxChars = 24000,
): InteractionModelInput["context"] {
  return projectInteractionHistoryWithStatus(messages, currentMessageId, maxChars).context;
}
