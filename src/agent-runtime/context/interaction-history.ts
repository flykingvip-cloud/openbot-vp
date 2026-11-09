import type { InteractionModelInput } from "../contracts/interaction.js";

/** A bounded model view of authoritative branch messages; never a history writer. */
export function projectInteractionHistory(
  messages: readonly unknown[],
  currentMessageId: string,
  maxChars = 24000,
): InteractionModelInput["context"] {
  const selected: { role: "user" | "assistant"; content: string }[] = [];
  let remaining = Math.max(0, maxChars);
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
    if (!text || remaining <= 0) {
      continue;
    }
    const content = text.slice(-remaining);
    selected.push({ role: row.role, content });
    remaining -= content.length;
  }
  return selected.toReversed();
}
