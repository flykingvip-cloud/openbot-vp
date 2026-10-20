/**
 * Object and enum readers shared by gateway handlers and nearby stores.
 *
 * `isRecord` matches `src/utils.ts`: a non-null object that is not an array.
 * `looseRecordOrEmpty` is a separate contract — arrays stay, because some RPC
 * handlers already index array params as records.
 * `stringValue` trims; `exactMember` does not.
 */

/** Non-null object that is not an array. Same predicate as `isRecord` in src/utils.ts. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Non-array object, or null. */
export function recordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/** Non-array object, or {}. Arrays and primitives become {}. */
export function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/**
 * Object or array as a record, or {}.
 * Arrays are objects, so they are kept. Do not use this where an array must
 * be rejected.
 */
export function looseRecordOrEmpty(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

/** Trimmed non-blank string, or null. Non-strings and blank strings are null. */
export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Finite number, or null. Numeric strings are null. */
export function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Exact string member. Does not trim.
 * Same result as `allowed.includes(value as T) ? (value as T) : null`.
 */
export function exactMember<const T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  if (typeof value !== "string") {
    return null;
  }
  for (const option of allowed) {
    if (value === option) {
      return option;
    }
  }
  return null;
}
