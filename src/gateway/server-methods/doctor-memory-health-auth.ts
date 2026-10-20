import { ErrorCodes, errorShape, type ErrorShape } from "../protocol/index.js";

export const MEMORY_HEALTH_RPC_METHODS = [
  "doctor.memory.health",
  "doctor.memory.health.tenant",
  "doctor.memory.health.summary",
] as const;

export type MemoryHealthRpcMethod = (typeof MEMORY_HEALTH_RPC_METHODS)[number];

export function isMemoryHealthRpcMethod(method: string): method is MemoryHealthRpcMethod {
  return (MEMORY_HEALTH_RPC_METHODS as readonly string[]).includes(method);
}

/**
 * CQ-O0 §6.3.2 dispatch deny:
 * `{ ok: false, error: { code: "403", reasonCode: "scope.denied", reason } }`
 * (`message` is required by ErrorShape; it mirrors `reason`.)
 */
export function createMemoryHealthScopeDeniedError(reason: string): ErrorShape {
  return errorShape(ErrorCodes.FORBIDDEN, reason, {
    reasonCode: "scope.denied",
    reason,
  });
}
