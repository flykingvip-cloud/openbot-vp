/**
 * Python json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=False)
 * compatible canonical JSON, then UTF-8 bytes (no BOM, no trailing newline).
 * Used so TypeScript and Team A Python produce byte-identical SHA-256 digests.
 * Do not use this helper to re-serialize embed float vectors for comparison;
 * prefer the fixture's vectors_canonical_json to avoid cross-language float drift.
 */
import { createHash } from "node:crypto";

export function canonicalJsonText(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === true) {
    return "true";
  }
  if (value === false) {
    return "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonical JSON does not allow non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonText(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).toSorted();
    const parts = keys
      .map((key) => {
        const child = (value as Record<string, unknown>)[key];
        if (child === undefined) {
          return "";
        }
        return `${JSON.stringify(key)}:${canonicalJsonText(child)}`;
      })
      .filter((part) => part.length > 0);
    return `{${parts.join(",")}}`;
  }
  throw new TypeError(`canonical JSON cannot encode ${typeof value}`);
}

export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJsonText(value), "utf8");
}

export function canonicalSha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalJsonBytes(value)).digest("hex");
}
