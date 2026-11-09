const INBOUND_STAMP_RE = /^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} [0-9:]{4,8} GMT[+-]\d+\]\s*/;

export function stripInboundStamp(text: string): string {
  return text.replace(INBOUND_STAMP_RE, "").trim();
}
