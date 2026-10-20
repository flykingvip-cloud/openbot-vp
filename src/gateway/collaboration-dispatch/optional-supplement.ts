const OPTIONAL_SUPPLEMENT_SIGNALS = [
  "如需",
  "如果需要",
  "如有需要",
  "随时喊我",
  "随时吩咐",
  "可补",
  "我可以补",
  "我可以协助",
  "可选补充",
  "如果需要我",
  "需要我协助",
  "需要我补充",
  "这事我熟",
];

export function classifyOptionalSupplementReply(text: string) {
  const normalized = text.replace(/\s+/g, "");
  if (!normalized || normalized.length < 12) {
    return false;
  }
  return OPTIONAL_SUPPLEMENT_SIGNALS.some((signal) => normalized.includes(signal));
}

export function extractOptionalSupplementTitle(text: string, agentName: string) {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) {
    return `${agentName} 的可选补充`;
  }
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
}
