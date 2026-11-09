/**
 * Policy identity primitives shared by the P1-A2 composition root
 * (resolve-effective-policy.ts) and the P0.0b round snapshot
 * (round-policy-snapshot.ts). Extracted so the two modules do not import each
 * other. Behaviour is byte-identical to the P0.0b originals (re-exported from
 * round-policy-snapshot.ts for existing callers).
 */
import { createHash } from "node:crypto";
import type { EffectiveCollaborationPolicy, PolicyClamp } from "./effective-policy.js";

/** Compiler implementation revision. Not folded into policyHash (§2.4). */
export const POLICY_COMPILER_REVISION = "1.3.0" as const;

export type DeepReadonly<T> = T extends (...args: infer _A) => infer _R
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type FrozenEffectivePolicy = DeepReadonly<EffectiveCollaborationPolicy>;

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value === null || typeof value !== "object") {
    return value as DeepReadonly<T>;
  }
  if (Object.isFrozen(value)) {
    return value as DeepReadonly<T>;
  }
  for (const child of Object.values(value as object)) {
    deepFreeze(child);
  }
  return Object.freeze(value) as DeepReadonly<T>;
}

export function hashProvenanceAndClamps(params: {
  provenance: EffectiveCollaborationPolicy["provenance"];
  clamps: readonly PolicyClamp[];
}): string {
  const stable = {
    provenance: params.provenance,
    clamps: params.clamps,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
