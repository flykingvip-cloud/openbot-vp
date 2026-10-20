const ECHO_CONFIRMATION_SIGNALS = [
  "老大批了",
  "老大明确了",
  "老大明确指示",
  "条件齐了",
  "开工信号",
  "信息已明确",
  "决策确认",
  "我总结一下",
  "收到！老大",
  "收到，已记录",
  "已记录老大决策",
  "开工吧",
  "可以开工",
];

export function isCollaborationEchoConfirmationText(text: string) {
  const normalized = text.replace(/\s+/g, "");
  if (!normalized || normalized.length < 8) {
    return false;
  }
  let hits = 0;
  for (const signal of ECHO_CONFIRMATION_SIGNALS) {
    if (normalized.includes(signal.replace(/\s+/g, ""))) {
      hits += 1;
    }
  }
  return hits >= 2 || (hits >= 1 && normalized.length <= 120);
}

export function shouldHideCollaborationAssistantMessage(message: unknown) {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  const role = typeof entry.role === "string" ? entry.role.toLowerCase() : "";
  if (role !== "assistant") {
    return false;
  }
  const text =
    typeof entry.text === "string"
      ? entry.text
      : Array.isArray(entry.content)
        ? entry.content
            .map((block) =>
              block &&
              typeof block === "object" &&
              (block as { type?: string; text?: string }).type === "text"
                ? ((block as { text?: string }).text ?? "")
                : "",
            )
            .filter(Boolean)
            .join("\n")
        : typeof entry.content === "string"
          ? entry.content
          : "";
  if (!text.trim()) {
    return false;
  }
  if (/^\s*NO_REPLY\s*$/i.test(text)) {
    return true;
  }
  return isCollaborationEchoConfirmationText(text);
}
