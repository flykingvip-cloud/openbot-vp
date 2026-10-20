import type { ErrorShape } from "./types.js";

export const ErrorCodes = {
  NOT_LINKED: "NOT_LINKED",
  NOT_PAIRED: "NOT_PAIRED",
  AGENT_TIMEOUT: "AGENT_TIMEOUT",
  INVALID_REQUEST: "INVALID_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  UNAVAILABLE: "UNAVAILABLE",
  /** Method is only available on a local (non-managed) gateway; rejected in SaaS/managed mode. */
  LOCAL_ONLY: "LOCAL_ONLY",
  /** Authorization denied (CQ-O0 memory health: numeric 403 on the wire). */
  FORBIDDEN: "403",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export function errorShape(
  code: ErrorCode,
  message: string,
  opts?: {
    details?: unknown;
    retryable?: boolean;
    retryAfterMs?: number;
    reasonCode?: string;
    reason?: string;
  },
): ErrorShape {
  return {
    code,
    message,
    ...opts,
  };
}
