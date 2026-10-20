import { createHash } from "node:crypto";

export type DigestKind = "skill" | "tool" | "text" | "tag" | "run" | "session";

export function digestName(kind: DigestKind, value: string): string {
  return createHash("sha256")
    .update(`${kind}:${value.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
}

export function isDigest16(value: string): boolean {
  return /^[0-9a-f]{16}$/.test(value);
}

export const FORBIDDEN_SUBSTRINGS = [
  "sk-",
  "Bearer ",
  "api_key",
  "apiKey",
  "SKILL.md",
  '"parameters"',
  "https://",
  "http://",
  "sessionKey:",
  "Official ",
] as const;

export function scanForbiddenSubstrings(serialized: string): string[] {
  return FORBIDDEN_SUBSTRINGS.filter((needle) => {
    if (needle === "sk-") {
      return /(?:^|[^A-Za-z])sk-[A-Za-z0-9]/.test(serialized);
    }
    return serialized.includes(needle);
  });
}
