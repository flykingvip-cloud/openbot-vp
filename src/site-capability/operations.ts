/**
 * Finite declarative operation set. The trusted runtime owns the code.
 *
 * There is no evaluate / fn / script parameter. `evaluateEnabled` is
 * intentionally absent: the product browser flag must not widen this set.
 * A caller-supplied script is rejected before any page port method runs.
 */

import { SAR_DENIAL_CODE, sarDeny, type SarDenial } from "./codes.js";
import type { SarOpKind } from "./contract.js";
import { denialForForbiddenTarget, findForbiddenTargetKey } from "./session-handle.js";

/** Observable failure from trusted page code. Not a cancelled in-flight action. */
export class TrustedOperationFault extends Error {
  readonly fault: string;

  constructor(fault: string) {
    super(fault);
    this.name = "TrustedOperationFault";
    this.fault = fault;
  }
}

export type CompiledSarOperation =
  | { kind: "navigate"; url: string }
  | { kind: "read_page"; fields: string[] }
  | { kind: "request_context"; name: string }
  | { kind: "capture_result"; fields: string[] };

/** Page port implemented by trusted server code. No evaluate channel. */
export type TrustedPagePort = {
  navigate(url: string): Promise<{ finalUrl: string }>;
  readFields(fields: readonly string[]): Promise<Record<string, string | null>>;
  requestContext(name: string): Promise<{ origin: string; data: Record<string, unknown> }>;
  capture(fields: readonly string[]): Promise<Record<string, unknown>>;
};

const SCRIPT_KEYS = new Set([
  "fn",
  "script",
  "expression",
  "code",
  "eval",
  "evaluate",
  "function",
  "source",
  "javascript",
]);

/** Walk a model payload for script keys. SAR still rejects them when browser evaluate is on. */
export function findSarScriptKey(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 4) {
    return null;
  }
  const entries = Array.isArray(value)
    ? value.map((child, index) => [String(index), child] as const)
    : Object.entries(value as Record<string, unknown>);
  for (const [key, child] of entries) {
    if (!Array.isArray(value) && SCRIPT_KEYS.has(key)) {
      return key;
    }
    const nested = findSarScriptKey(child, depth + 1);
    if (nested) {
      return nested;
    }
  }
  return null;
}

const BYPASS_KEYS = new Set([
  "skipNavigationGuard",
  "bypassPolicy",
  "ssrfPolicy",
  "evaluateEnabled",
  "cdpUrl",
]);

const CONTEXT_NAMES = new Set(["session", "page", "search", "detail"]);

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,64}$/;

const ALLOWED_KEYS: Record<SarOpKind, readonly string[]> = {
  navigate: ["op", "url"],
  read_page: ["op", "fields"],
  request_context: ["op", "name"],
  capture_result: ["op", "fields"],
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as Record<string, unknown>;
}

function rejectScriptKey(key: string, productEvaluateEnabled?: boolean): SarDenial {
  return sarDeny(
    SAR_DENIAL_CODE.evaluate,
    `SAR rejects page script payload (${key}) even when browser evaluate is enabled`,
    { productEvaluateEnabled },
  );
}

export function compileSarOperation(
  raw: unknown,
  opts?: { productEvaluateEnabled?: boolean },
): { ok: true; operation: CompiledSarOperation } | SarDenial {
  const record = asRecord(raw);
  if (!record) {
    return sarDeny(SAR_DENIAL_CODE.opNotInSet, "operation must be an object");
  }
  const productEvaluateEnabled = opts?.productEvaluateEnabled;
  const forbiddenTarget = findForbiddenTargetKey(record);
  if (forbiddenTarget) {
    return denialForForbiddenTarget(forbiddenTarget);
  }
  for (const key of Object.keys(record)) {
    if (SCRIPT_KEYS.has(key)) {
      return rejectScriptKey(key, productEvaluateEnabled);
    }
    if (BYPASS_KEYS.has(key)) {
      return sarDeny(
        SAR_DENIAL_CODE.policyDenied,
        `adapters cannot set ${key} on a site operation`,
      );
    }
  }
  const op = record.op;
  if (op === "evaluate" || op === "eval" || op === "js") {
    return rejectScriptKey(String(op), productEvaluateEnabled);
  }
  if (
    op !== "navigate" &&
    op !== "read_page" &&
    op !== "request_context" &&
    op !== "capture_result"
  ) {
    return sarDeny(
      SAR_DENIAL_CODE.opNotInSet,
      `operation is outside the finite set: ${String(op)}`,
    );
  }
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS[op].includes(key)) {
      if (SCRIPT_KEYS.has(key)) {
        return rejectScriptKey(key, productEvaluateEnabled);
      }
      return sarDeny(SAR_DENIAL_CODE.opNotInSet, `unexpected field ${key} on ${op}`);
    }
  }
  if (op === "navigate") {
    if (typeof record.url !== "string" || record.url.trim().length === 0) {
      return sarDeny(SAR_DENIAL_CODE.opNotInSet, "navigate requires a url string");
    }
    return { ok: true, operation: { kind: "navigate", url: record.url.trim() } };
  }
  if (op === "request_context") {
    if (typeof record.name !== "string" || !CONTEXT_NAMES.has(record.name)) {
      return sarDeny(SAR_DENIAL_CODE.opNotInSet, "request_context name is not in the allowlist");
    }
    return { ok: true, operation: { kind: "request_context", name: record.name } };
  }
  const fields = record.fields;
  if (!Array.isArray(fields) || fields.length === 0 || fields.length > 32) {
    return sarDeny(SAR_DENIAL_CODE.opNotInSet, `${op} requires a bounded fields array`);
  }
  const names: string[] = [];
  for (const field of fields) {
    if (typeof field !== "string" || !FIELD_NAME.test(field)) {
      return rejectScriptKey("fields", productEvaluateEnabled);
    }
    names.push(field);
  }
  if (op === "read_page") {
    return { ok: true, operation: { kind: "read_page", fields: names } };
  }
  return { ok: true, operation: { kind: "capture_result", fields: names } };
}

export type TrustedOpValue =
  | { kind: "navigate"; finalUrl: string }
  | { kind: "read_page"; fields: Record<string, string | null> }
  | { kind: "request_context"; origin: string; data: Record<string, unknown> }
  | { kind: "capture_result"; data: Record<string, unknown> };

/**
 * Executes a compiled operation. The switch is closed: caller strings are
 * never interpolated into a function body or passed to a port evaluate hook.
 */
export async function executeTrustedOperation(
  operation: CompiledSarOperation,
  port: TrustedPagePort,
): Promise<TrustedOpValue> {
  switch (operation.kind) {
    case "navigate": {
      const result = await port.navigate(operation.url);
      return { kind: "navigate", finalUrl: result.finalUrl };
    }
    case "read_page": {
      const fields = await port.readFields(operation.fields);
      return { kind: "read_page", fields };
    }
    case "request_context": {
      const result = await port.requestContext(operation.name);
      return { kind: "request_context", origin: result.origin, data: result.data };
    }
    case "capture_result": {
      const data = await port.capture(operation.fields);
      return { kind: "capture_result", data };
    }
    default: {
      const _exhaustive: never = operation;
      return _exhaustive;
    }
  }
}
