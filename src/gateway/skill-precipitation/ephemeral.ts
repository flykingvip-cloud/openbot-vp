/**
 * Strip one-off / session-bound tokens from precipitation text.
 * Keep topology constants and reusable instructions; parameterize tip SHA,
 * SHORT digests, absolute run evidence paths, and ISO timestamps.
 */

const EPHEMERAL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // git SHAs (7–40 hex)
  { re: /\b[0-9a-f]{7,40}\b/gi, label: "gitSha" },
  // evidence / workspace run paths
  { re: /\/workspace\/[^\s`'"]+/g, label: "workspacePath" },
  { re: /\/Users\/[^\s`'"]+/g, label: "userPath" },
  { re: /\/tmp\/[^\s`'"]+/g, label: "tmpPath" },
  // ISO dates / timestamps
  { re: /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?\b/g, label: "timestamp" },
  // tip / SHORT placeholders that look like cutover digests
  { re: /\b(?:tip|SHORT|PIN|PREV)=[A-Za-z0-9._/-]+/g, label: "cutoverPin" },
  { re: /\bhk-cutover-[a-z0-9_-]+/gi, label: "cutoverEvidenceDir" },
];

export function collectEphemeralTokens(text: string): string[] {
  const found = new Set<string>();
  if (!text) {
    return [];
  }
  for (const { re, label } of EPHEMERAL_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      found.add(`${label}:${match[0]}`);
      if (found.size >= 40) {
        return [...found];
      }
    }
  }
  return [...found];
}

export function stripEphemeralFromText(text: string): string {
  if (!text) {
    return "";
  }
  let out = text;
  for (const { re, label } of EPHEMERAL_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, `<${label}>`);
  }
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
