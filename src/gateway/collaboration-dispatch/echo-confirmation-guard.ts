const ECHO_CONFIRMATION_SIGNALS = [
  "老大批了",
  "老大明确了",
  "老大明确指示",
  "条件齐了",
  "开工信号",
  "信息已明确",
  "决策确认",
  "总结一下",
  "我总结一下",
  "收到！老大",
  "收到，已记录",
  "已记录老大决策",
  "@",
  "开工吧",
  "可以开工",
];

export function classifyEchoConfirmationReply(text: string) {
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
