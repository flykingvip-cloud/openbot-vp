/**
 * Structured errors for enterprise model governance RPCs / probes.
 */

import type { EnterpriseModelProbeCode } from "./types.js";

export class EnterpriseModelError extends Error {
  readonly code: EnterpriseModelProbeCode;
  readonly retryable: boolean;

  constructor(code: EnterpriseModelProbeCode, message: string, opts?: { retryable?: boolean }) {
    super(message);
    this.name = "EnterpriseModelError";
    this.code = code;
    this.retryable = opts?.retryable ?? false;
  }
}

export function isEnterpriseModelError(error: unknown): error is EnterpriseModelError {
  return error instanceof EnterpriseModelError;
}
