/**
 * CogniWeave object bag. Not the gateway reader.
 *
 * Contract: any non-null object, including arrays
 * (`Boolean(value) && typeof value === "object"`).
 *
 * Gateway `isRecord` in #1248 (`src/gateway/records.ts`) rejects arrays.
 * Gateway `looseRecordOrEmpty` keeps them. This helper matches the older
 * CogniWeave inline checks and that loose bag, not gateway `isRecord`.
 *
 * Do not swap in the gateway predicate. Array `quality` and array
 * `provenance` are read as field bags; rejecting arrays changes those paths.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}
