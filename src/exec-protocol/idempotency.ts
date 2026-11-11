import type { ExecProtocolConfig } from "./config.js";
import { ExecProtocolError } from "./errors.js";
import type { ExecInput, ExecTaskKind } from "./types.js";

export function assertIdempotencyKey(key: unknown, config: ExecProtocolConfig): string {
  if (typeof key !== "string") {
    throw new ExecProtocolError("EXEC_CONFLICT", "idempotencyKey is required");
  }
  if (key.length < config.idempotencyKeyMinLength || key.length > config.idempotencyKeyMaxLength) {
    throw new ExecProtocolError(
      "EXEC_CONFLICT",
      `idempotencyKey length must be ${config.idempotencyKeyMinLength}-${config.idempotencyKeyMaxLength}`,
    );
  }
  if (!new RegExp(config.idempotencyKeyPattern).test(key)) {
    throw new ExecProtocolError("EXEC_CONFLICT", "idempotencyKey must use charset [A-Za-z0-9._:-]");
  }
  return key;
}

export function idempotencyLookupKey(tenantId: string, idempotencyKey: string): string {
  return `${tenantId}\u0000${idempotencyKey}`;
}

export function canonicalizeIntent(params: {
  tenantId: string;
  toolCallId: string;
  kind: ExecTaskKind;
  input: ExecInput;
  probeId?: string;
  sleepMs?: number;
}): string {
  return JSON.stringify({
    tenantId: params.tenantId,
    toolCallId: params.toolCallId,
    kind: params.kind,
    input: params.input,
    probeId: params.probeId ?? null,
    sleepMs: params.sleepMs ?? null,
  });
}
