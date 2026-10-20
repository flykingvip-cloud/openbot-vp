import { createHash } from "node:crypto";

export const PERF_SCHEMA = "openbot.execution-router.performance.v1";
export const PERF_GENERATOR_VERSION = "phase03-perf-0.1.0";

export const TRACKED_SUMMARY_RELPATH =
  ".kiro/specs/execution-router-phase03/performance-summary.json";
export const TRACKED_SUMMARY_SHA_RELPATH =
  ".kiro/specs/execution-router-phase03/performance-summary.sha256";

const FORBIDDEN_SUBSTRINGS = [
  "agent:main:",
  "sk-",
  "Bearer ",
  "api_key",
  "apiKey",
  "OPENAI_API_KEY",
  "Official ",
  "SKILL.md",
  '"parameters"',
  "browser_open",
  "https://",
  "http://",
  "what is the weather",
  "cookie",
  "sessionKey:",
];

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function digestId(kind: "run" | "session" | "provider" | "model", value: string): string {
  return createHash("sha256")
    .update(`${kind}:${value.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
}

export function scanForbiddenSubstrings(serialized: string): string[] {
  return FORBIDDEN_SUBSTRINGS.filter((needle) =>
    serialized.toLowerCase().includes(needle.toLowerCase()),
  );
}

export function isHexDigest16(value: string | undefined): boolean {
  return Boolean(value && /^[0-9a-f]{16}$/.test(value));
}
