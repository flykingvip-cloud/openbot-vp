/**
 * Stage 3 CLI **errors** helpers: non-zero exit + stderr must distinguish
 * usage mistakes from Gateway rejects (§5.2 CLI errors column).
 *
 * Convention (narrow product contract):
 * - usage → stderr prefix `usage:`, exit code 2
 * - gateway reject → stderr prefix `gateway reject:`, exit code 1
 *
 * Not a full argv spawn suite; not Stage 3 overall PASS.
 */

export const CLI_EXIT_USAGE = 2;
export const CLI_EXIT_GATEWAY_REJECT = 1;

export type CliErrorKind = "usage" | "gateway_reject";

const USAGE_PREFIX = "usage:";
const GATEWAY_REJECT_PREFIX = "gateway reject:";

export function isCommanderUsageError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as { name?: string; code?: string };
  if (e.name === "CommanderError") {
    return true;
  }
  return typeof e.code === "string" && e.code.startsWith("commander.");
}

export function isGatewayRejectError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as { name?: string; gatewayCode?: unknown; message?: unknown };
  if (e.name === "GatewayClientRequestError") {
    return true;
  }
  if (typeof e.gatewayCode === "string" && e.gatewayCode.length > 0) {
    return true;
  }
  const message = typeof e.message === "string" ? e.message : "";
  return isGatewayRejectMessage(message);
}

export function isGatewayRejectMessage(message: string): boolean {
  const text = message.trim();
  if (/^gateway reject:/i.test(text)) {
    return true;
  }
  // callGateway / GatewayClient connection and RPC surfaces
  if (/^gateway\b/i.test(text)) {
    return true;
  }
  if (/\bgateway (closed|timeout|url|remote|not connected|request failed)\b/i.test(text)) {
    return true;
  }
  if (/\b(gateway token mismatch|device token mismatch)\b/i.test(text)) {
    return true;
  }
  return false;
}

/**
 * Classify an thrown value. Prefer explicit markers; fall back to message shape.
 * Ambiguous errors default to `usage` only when they look like local validation;
 * otherwise callers that know they are on a Gateway path should force `gateway_reject`.
 */
export function classifyCliError(err: unknown): CliErrorKind {
  if (isCommanderUsageError(err)) {
    return "usage";
  }
  if (isGatewayRejectError(err)) {
    return "gateway_reject";
  }
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/^usage:/i.test(message) || /^error:\s/i.test(message)) {
    return "usage";
  }
  // Local option validation (e.g. `--timeout must be a positive integer`)
  if (/^--[\w-]+\s+must be\b/i.test(message.trim())) {
    return "usage";
  }
  if (isGatewayRejectMessage(message)) {
    return "gateway_reject";
  }
  // Default: treat as usage when the string is a Commander-style "error: ..." already
  // stripped; otherwise leave as gateway_reject only when caller forces it.
  return "usage";
}

export function stripCliErrorPrefix(message: string): string {
  return message.replace(/^(usage|gateway reject|gateway|error):\s*/i, "").trim();
}

export function formatCliErrorMessage(kind: CliErrorKind, message: string): string {
  const cleaned = stripCliErrorPrefix(message);
  return kind === "usage" ? `${USAGE_PREFIX} ${cleaned}` : `${GATEWAY_REJECT_PREFIX} ${cleaned}`;
}

export function exitCodeForCliErrorKind(kind: CliErrorKind): number {
  return kind === "usage" ? CLI_EXIT_USAGE : CLI_EXIT_GATEWAY_REJECT;
}

/** Report a classified CLI failure to runtime (stderr + exit). */
export function reportCliError(
  runtime: { error: (message: string) => void; exit: (code: number) => void },
  kind: CliErrorKind,
  message: string,
): void {
  runtime.error(formatCliErrorMessage(kind, message));
  runtime.exit(exitCodeForCliErrorKind(kind));
}
