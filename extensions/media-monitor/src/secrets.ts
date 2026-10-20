import { redactText } from "./redact.js";

/**
 * Resolve cookie material for the sidecar.
 *
 * MVP support only:
 * - plaintext string
 * - SecretRef `{ source: "env", id: "ENV_VAR_NAME" }`
 *
 * `file` / `exec` / `encrypted-local` may appear in the shared schema but are
 * NOT resolved here — they return undefined until wired to the gateway secret pipeline.
 * Values are never returned to logs by callers.
 */
export function resolveCookieSecret(raw: unknown): string | undefined {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed || undefined;
  }
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const ref = raw as { source?: unknown; id?: unknown; provider?: unknown };
  if (ref.source === "env" && typeof ref.id === "string" && ref.id.trim()) {
    const value = process.env[ref.id.trim()];
    return value?.trim() || undefined;
  }
  // Intentionally unsupported in MVP (schema may still accept these shapes).
  return undefined;
}

export function describeCookieConfigured(raw: unknown): string {
  if (typeof raw === "string") {
    return raw.trim() ? "string(redacted)" : "empty";
  }
  if (raw && typeof raw === "object") {
    const ref = raw as { source?: unknown; id?: unknown };
    return `ref:${String(ref.source ?? "?")}:${redactText(String(ref.id ?? ""), 40)}`;
  }
  return "unset";
}
