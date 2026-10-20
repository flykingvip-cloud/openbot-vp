export const JSON_CANVAS_VALIDATOR_ID = "json-canvas-structure";
export const JSON_CANVAS_VALIDATOR_VERSION = "1";
/** Sync check bound. Larger input is rejected before JSON.parse. */
export const JSON_CANVAS_MAX_BYTES = 512 * 1024;

const NODE_TYPES = new Set(["text", "file", "link", "group"]);

export type CanvasValidationReason =
  | "invalid_json"
  | "schema"
  | "timeout"
  | "too_large"
  | "exception";

export type CanvasValidation =
  | { result: "passed" }
  | { result: "failed"; reason: CanvasValidationReason };

/**
 * Structural check only. The result never includes file bytes or text.
 *
 * Budget is a byte cap plus a deadline read before parse and again after the
 * synchronous check. It does not interrupt a JSON.parse that is already running.
 * `clock` defaults to Date.now so elapsed parse time is visible; `now` is only
 * the pre-check timestamp.
 */
export function validateJsonCanvasBytes(
  bytes: Buffer | string,
  now = Date.now(),
  deadlineMs?: number,
  clock: () => number = Date.now,
): CanvasValidation {
  if (pastDeadline(now, deadlineMs)) {
    return { result: "failed", reason: "timeout" };
  }
  const size = typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength;
  if (size > JSON_CANVAS_MAX_BYTES) {
    return { result: "failed", reason: "too_large" };
  }
  let judged: CanvasValidation;
  try {
    const text = typeof bytes === "string" ? bytes : bytes.toString("utf8");
    const parsed: unknown = JSON.parse(text);
    judged = canvasShapeOk(parsed) ? { result: "passed" } : { result: "failed", reason: "schema" };
  } catch (error) {
    judged =
      error instanceof SyntaxError
        ? { result: "failed", reason: "invalid_json" }
        : { result: "failed", reason: "exception" };
  }
  if (pastDeadline(clock(), deadlineMs)) {
    return { result: "failed", reason: "timeout" };
  }
  return judged;
}

function pastDeadline(at: number, deadlineMs?: number): boolean {
  return deadlineMs !== undefined && at >= deadlineMs;
}

function canvasShapeOk(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) {
    return false;
  }
  const ids = new Set<string>();
  for (const node of record.nodes) {
    if (!nodeRecordOk(node, ids)) {
      return false;
    }
  }
  for (const edge of record.edges) {
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
      return false;
    }
    const item = edge as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id || ids.has(item.id)) {
      return false;
    }
    if (typeof item.fromNode !== "string" || typeof item.toNode !== "string") {
      return false;
    }
    if (!ids.has(item.fromNode) || !ids.has(item.toNode)) {
      return false;
    }
    ids.add(item.id);
  }
  return true;
}

function nodeRecordOk(node: unknown, ids: Set<string>): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return false;
  }
  const item = node as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id || ids.has(item.id)) {
    return false;
  }
  if (typeof item.type !== "string" || !NODE_TYPES.has(item.type)) {
    return false;
  }
  if (
    !Number.isFinite(item.x) ||
    !Number.isFinite(item.y) ||
    !Number.isFinite(item.width) ||
    !Number.isFinite(item.height)
  ) {
    return false;
  }
  ids.add(item.id);
  return true;
}
