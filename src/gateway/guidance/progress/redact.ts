/**
 * Redact / drop unsafe progress metadata.
 * Never persist task body, AppSecret, API keys, or passwords.
 */

import { redactGuidanceFreeText } from "../../agent-growth/guidance-event.js";
import type { GuidanceProgressMetadata } from "./types.js";

const FORBIDDEN_METADATA_KEYS = new Set([
  "taskbody",
  "task_body",
  "tasktext",
  "task_text",
  "message",
  "prompt",
  "appsecret",
  "app_secret",
  "apikey",
  "api_key",
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "credential",
  "credentials",
]);

function isForbiddenKey(key: string): boolean {
  const normalized = key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  if (FORBIDDEN_METADATA_KEYS.has(normalized)) {
    return true;
  }
  return /secret|password|token|apikey|appsecret|credential/.test(normalized);
}

export function sanitizeGuidanceProgressMetadata(
  input: Record<string, unknown> | GuidanceProgressMetadata | undefined | null,
): GuidanceProgressMetadata | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const out: GuidanceProgressMetadata = {};
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = rawKey.trim();
    if (!key || isForbiddenKey(key)) {
      continue;
    }
    if (rawValue === null) {
      out[key] = null;
      continue;
    }
    if (typeof rawValue === "boolean" || typeof rawValue === "number") {
      if (typeof rawValue === "number" && !Number.isFinite(rawValue)) {
        continue;
      }
      out[key] = rawValue;
      continue;
    }
    if (typeof rawValue === "string") {
      const redacted = redactGuidanceFreeText(rawValue).trim();
      if (redacted) {
        // Cap free-text metadata length — never store long task bodies.
        out[key] = redacted.slice(0, 240);
      }
      continue;
    }
    // Drop nested objects / arrays — progress metadata is flat scalars only.
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function redactOptionalProgressText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return redactGuidanceFreeText(trimmed).slice(0, 240);
}
