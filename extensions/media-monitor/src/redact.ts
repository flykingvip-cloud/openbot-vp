const SENSITIVE_KEY = /cookie|authorization|password|token|secret|api[_-]?key|set-cookie/i;

const SENSITIVE_QUERY = /([?&](?:cookie|token|access_token|auth|key|secret|session)=)[^&\s]+/gi;

export function redactText(input: string, maxLen = 2000): string {
  let out = input
    .replace(SENSITIVE_QUERY, "$1[REDACTED]")
    .replace(/Authorization\s*[:=]\s*Bearer\s+[^\s;]+/gi, "Authorization=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]")
    .replace(
      /(cookie|authorization|password|token|secret|api[_-]?key)\s*[:=]\s*["']?[^;\s"']+/gi,
      "$1=[REDACTED]",
    );
  if (out.length > maxLen) {
    out = `${out.slice(0, maxLen)}…`;
  }
  return out;
}

export function redactUnknown(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[truncated]";
  }
  if (typeof value === "string") {
    return redactText(value, 1000);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactUnknown(item, depth + 1));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = redactUnknown(nested, depth + 1);
  }
  return out;
}

export function sanitizePayloadForStorage(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return redactUnknown(payload) as Record<string, unknown>;
}
