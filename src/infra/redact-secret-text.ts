/**
 * Best-effort secret redaction for free-form text that gets persisted or shown.
 *
 * Canonical implementation shared by CLI diagnostics and by anything that stores
 * error text (for example derived experience capsules, whose summaries are later
 * re-injected into system prompts and can be projected to other bots in a group).
 *
 * This is a defence-in-depth filter, not a guarantee: callers must still avoid
 * deliberately writing secrets into text.
 */

const SECRET_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // key/value style assignments: token=..., api_key: "..."
  {
    pattern:
      /(\b(?:access[_-]?token|refresh[_-]?token|token|password|passwd|secret|api[_-]?key|authorization)\b\s*[:=]\s*)("?)([^"\s]+)("?)/gi,
    replacement: "$1$2***$4",
  },
  { pattern: /\bBearer\s+[A-Za-z0-9._-]+\b/g, replacement: "Bearer ***" },
  // Common provider key shapes (OpenAI-style, Anthropic-style, Google-style).
  { pattern: /\bsk-[A-Za-z0-9._-]{10,}\b/g, replacement: "sk-***" },
  { pattern: /\bsk-ant-[A-Za-z0-9._-]{10,}\b/g, replacement: "sk-ant-***" },
  { pattern: /\bAIza[A-Za-z0-9._-]{10,}\b/g, replacement: "AIza***" },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, replacement: "gh_***" },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, replacement: "xox-***" },
];

export function redactSecretText(text: string): string {
  if (!text) {
    return text;
  }
  let out = text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
