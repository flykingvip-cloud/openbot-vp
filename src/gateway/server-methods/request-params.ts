/**
 * Shared readers for gateway RPC `params`.
 *
 * Handlers that previously copied these helpers drifted in small ways
 * (array rejection, blank-string handling, error text). This module is the
 * single implementation for the common case: trim non-blank strings, reject
 * arrays as records, and answer `${key} is required`.
 *
 * Call sites with a different error string or a non-trimming enum check keep
 * their own logic. Object and trimmed-string readers live in `src/gateway/records.ts`.
 */
import { ErrorCodes, errorShape } from "../protocol/index.js";
import {
  exactMember,
  isRecord,
  looseRecordOrEmpty,
  recordOrEmpty,
  numberValue,
  recordOrNull,
  stringValue,
} from "../records.js";
import type { RespondFn } from "./types.js";

export {
  exactMember,
  isRecord,
  looseRecordOrEmpty,
  numberValue,
  recordOrEmpty,
  recordOrNull,
  stringValue,
};

export function optionalString(params: Record<string, unknown>, key: string): string | null {
  return stringValue(params[key]);
}

/**
 * Read a required trimmed string. On failure, respond INVALID_REQUEST
 * (`${key} is required`) and return null so the handler can return.
 */
export function requiredString(
  params: Record<string, unknown>,
  key: string,
  respond: RespondFn,
): string | null {
  const value = optionalString(params, key);
  if (!value) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `${key} is required`));
    return null;
  }
  return value;
}

/** Keep trimmed non-empty strings. Non-strings and blanks are dropped. */
export function nonemptyStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: string[] = [];
  for (const entry of value) {
    const text = stringValue(entry);
    if (text) {
      items.push(text);
    }
  }
  return items;
}

/** Trim, then accept only an exact member of `allowed`. */
export function oneOf<const T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const text = stringValue(value);
  if (!text) {
    return null;
  }
  for (const option of allowed) {
    if (text === option) {
      return option;
    }
  }
  return null;
}

export function respondInvalid(respond: RespondFn, message: string): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

export function respondUnavailable(respond: RespondFn, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
}
