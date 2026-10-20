import { createHash } from "node:crypto";

export const SHADOW_SCHEMA = "openbot.execution-router.shadow.v1";
export const SHADOW_GENERATOR_VERSION = "phase0-shadow-e2e-0.2.0";

const FORBIDDEN_SUBSTRINGS = [
  "agent:main:",
  "Official ",
  "SKILL.md",
  "sk-user-secret",
  "what is the weather",
  "please open https://",
  '"parameters"',
  "browser_open",
  "hook-prepend",
  "context-engine-addition",
];

export function digestCatalogId(kind: "skill" | "tool" | "run", value: string): string {
  return createHash("sha256")
    .update(`${kind}:${value.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function scanForbiddenSubstrings(serialized: string): string[] {
  return FORBIDDEN_SUBSTRINGS.filter((needle) => serialized.includes(needle));
}

export function isSessionKeyHash(value: string | undefined): boolean {
  return Boolean(value && /^[0-9a-f]{16}$/.test(value));
}

export function recall(gold: readonly string[], observed: readonly string[]): number | null {
  if (gold.length === 0) {
    return null;
  }
  const seen = new Set(observed);
  const hit = gold.filter((id) => seen.has(id)).length;
  return hit / gold.length;
}
