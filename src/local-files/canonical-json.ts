/**
 * Deterministic JSON serialization for capability tokens.
 *
 * Signatures and `capabilityDigest` values are computed over the serialized claim
 * bytes, so two parties must produce byte-identical output for the same logical
 * claims. `JSON.stringify` does not guarantee that: key order follows insertion
 * order, so a claim object rebuilt in a different field order would serialize
 * differently and fail verification.
 *
 * Rules:
 * - object keys sorted by UTF-16 code unit order
 * - `undefined` properties dropped (an absent claim and an explicitly-undefined
 *   claim must not produce different bytes)
 * - non-finite numbers rejected (`NaN`/`Infinity` are not representable in JSON
 *   and would silently become `null`)
 * - no cycles
 */

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

function encodeValue(value: unknown, seen: Set<object>, path: string): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(`non-finite number at ${path}`);
      }
      // Reject -0: it serializes as "0" but compares distinctly, which would let
      // two different in-memory claims share one digest.
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    }
    case "string":
      return JSON.stringify(value);
    case "bigint":
      throw new CanonicalJsonError(`bigint is not serializable at ${path}`);
    case "function":
    case "symbol":
      throw new CanonicalJsonError(`${typeof value} is not serializable at ${path}`);
    case "undefined":
      throw new CanonicalJsonError(`undefined is not serializable at ${path}`);
    default:
      break;
  }

  const obj = value as object;
  if (seen.has(obj)) {
    throw new CanonicalJsonError(`circular reference at ${path}`);
  }
  seen.add(obj);
  try {
    if (Array.isArray(value)) {
      const parts = value.map((entry, index) =>
        entry === undefined ? "null" : encodeValue(entry, seen, `${path}[${index}]`),
      );
      return `[${parts.join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .toSorted();
    const parts = keys.map(
      (key) => `${JSON.stringify(key)}:${encodeValue(record[key], seen, `${path}.${key}`)}`,
    );
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(obj);
  }
}

/** Serialize `value` to canonical JSON. Throws `CanonicalJsonError` on unsupported input. */
export function canonicalJsonStringify(value: unknown): string {
  return encodeValue(value, new Set<object>(), "$");
}
