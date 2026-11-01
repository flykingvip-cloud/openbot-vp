/**
 * Cross-boundary sanitizer for wake/Mode B failure text.
 * Logs, dispatch results, wake-op ledger detail, wake events, and human-attention
 * reasons must never persist raw credential-bearing exception messages.
 */
import { redactSensitiveText } from "../../logging/redact.js";

export type WakeRunBotErrorPayload = {
  category?: string;
  message?: string;
  groupId?: string;
  agentId?: string;
  source?: string;
};

export function sanitizeDispatchErrorMessage(message: string, maxLen = 240): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return redactSensitiveText(compact.slice(0, Math.max(1, maxLen)), { mode: "all" });
}

function readWakeRunBotError(error: unknown): WakeRunBotErrorPayload | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const payload = (error as { wakeRunBotError?: unknown }).wakeRunBotError;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return payload as WakeRunBotErrorPayload;
}

/**
 * Prefer already-sanitized wakeRunBotError.message when present; otherwise redact
 * Error.message / String(error). Always re-run redact for defense in depth.
 */
export function sanitizeDispatchError(
  error: unknown,
  maxLen = 240,
): { category: string; message: string } {
  const wake = readWakeRunBotError(error);
  const err = error instanceof Error ? error : new Error(String(error));
  const category =
    (typeof wake?.category === "string" && wake.category.trim()) || err.name || "Error";
  const rawMessage =
    (typeof wake?.message === "string" && wake.message.trim()) ||
    (typeof err.message === "string" && err.message) ||
    String(error);
  return {
    category,
    message: sanitizeDispatchErrorMessage(rawMessage, maxLen),
  };
}
