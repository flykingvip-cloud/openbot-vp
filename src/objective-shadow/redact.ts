import { createHmac } from "node:crypto";
import type { ShadowCandidate, ShadowObserveInput } from "./types.js";

const HMAC_HEX_LEN = 16;

export function hmacHash16(value: string, key: string): string {
  return createHmac("sha256", key).update(value, "utf8").digest("hex").slice(0, HMAC_HEX_LEN);
}

export function looksSensitive(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes("@")) {
    return true;
  }
  if (/^(?:\/|~\/|[A-Za-z]:[\\/])/.test(trimmed)) {
    return true;
  }
  if (/^(?:sk-|ghp_|gho_|xox[baprs]-)/.test(trimmed)) {
    return true;
  }
  if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) {
    return true;
  }
  const digits = trimmed.replace(/[\s-]/g, "");
  if (/^\+?\d{10,}$/.test(digits)) {
    return true;
  }
  return false;
}

export type RedactResult = {
  tenantHash: string;
  groupHash?: string;
  candidates: ShadowCandidate[];
  redactionDropped: boolean;
};

const CANDIDATE_KEYS = new Set(["source", "objectiveId", "revision"]);

export function redactObserveInput(input: ShadowObserveInput, hmacKey: string): RedactResult {
  let redactionDropped = false;
  const candidates: ShadowCandidate[] = input.candidates.map((raw) => {
    const extraKeys = Object.keys(raw).filter((key) => !CANDIDATE_KEYS.has(key));
    if (extraKeys.length > 0) {
      redactionDropped = true;
    }
    const next: ShadowCandidate = { source: raw.source };
    if (typeof raw.objectiveId === "string" && raw.objectiveId.length > 0) {
      if (looksSensitive(raw.objectiveId)) {
        redactionDropped = true;
      } else {
        next.objectiveId = raw.objectiveId;
      }
    }
    if (typeof raw.revision === "number" && Number.isFinite(raw.revision)) {
      next.revision = raw.revision;
    }
    return next;
  });

  return {
    tenantHash: hmacHash16(input.tenantId, hmacKey),
    groupHash: input.groupId ? hmacHash16(input.groupId, hmacKey) : undefined,
    candidates,
    redactionDropped,
  };
}

export function assertNoPlaintextSecrets(
  serialized: string,
  secrets: readonly string[],
): string | null {
  for (const secret of secrets) {
    if (secret && serialized.includes(secret)) {
      return secret;
    }
  }
  return null;
}
