/**
 * Merge gateway method packs into the legacy registration surfaces.
 */

import type { OperatorScope } from "../method-scopes.js";
import {
  PACK_OPERATOR_SCOPES,
  type GatewayMethodPack,
  type PackOperatorScope,
} from "./pack-types.js";
import type { GatewayRequestHandlers } from "./types.js";

const PACK_SCOPE_TO_OPERATOR: Record<PackOperatorScope, OperatorScope> = {
  "operator.admin": "operator.admin",
  "operator.read": "operator.read",
  "operator.write": "operator.write",
  "operator.approvals": "operator.approvals",
  "operator.pairing": "operator.pairing",
};

export function mergePackMethodNames(packs: readonly GatewayMethodPack[]): string[] {
  return packs.flatMap((pack) => [...pack.methods]);
}

export function mergePackHandlers(packs: readonly GatewayMethodPack[]): GatewayRequestHandlers {
  const local = packs.filter((pack) => !pack.externalHandlers);
  return Object.assign({}, ...local.map((pack) => pack.handlers)) as GatewayRequestHandlers;
}

/** Append pack scope entries into the base METHOD_SCOPE_GROUPS (immutable-safe copy). */
export function mergePackMethodsIntoScopeGroups(
  base: Record<OperatorScope, readonly string[]>,
  packs: readonly GatewayMethodPack[],
): Record<OperatorScope, readonly string[]> {
  const next: Record<OperatorScope, string[]> = {
    "operator.platform": [...(base["operator.platform"] ?? [])],
    "operator.admin": [...base["operator.admin"]],
    "operator.read": [...base["operator.read"]],
    "operator.write": [...base["operator.write"]],
    "operator.approvals": [...base["operator.approvals"]],
    "operator.pairing": [...base["operator.pairing"]],
  };
  for (const pack of packs) {
    for (const scopeKey of PACK_OPERATOR_SCOPES) {
      const methods = pack.scopes[scopeKey];
      if (!methods?.length) {
        continue;
      }
      const bucket = PACK_SCOPE_TO_OPERATOR[scopeKey];
      next[bucket].push(...methods);
    }
  }
  return next;
}

export function validateGatewayMethodPacks(packs: readonly GatewayMethodPack[]): string[] {
  const errors: string[] = [];
  const seenMethods = new Map<string, string>();

  for (const pack of packs) {
    const methodSet = new Set(pack.methods);
    const handlerKeys = pack.externalHandlers ? [] : Object.keys(pack.handlers);

    for (const method of pack.methods) {
      const prev = seenMethods.get(method);
      if (prev) {
        errors.push(`duplicate pack method ${method}: ${prev} and ${pack.id}`);
      } else {
        seenMethods.set(method, pack.id);
      }
    }

    if (!pack.externalHandlers) {
      for (const key of handlerKeys) {
        if (!methodSet.has(key)) {
          errors.push(`pack ${pack.id}: handler key ${key} not listed in methods[]`);
        }
      }

      for (const method of pack.methods) {
        if (!(method in pack.handlers)) {
          errors.push(`pack ${pack.id}: missing handler for ${method}`);
        }
      }
    }

    const scoped = new Set<string>();
    for (const scopeKey of PACK_OPERATOR_SCOPES) {
      for (const method of pack.scopes[scopeKey] ?? []) {
        if (!methodSet.has(method)) {
          errors.push(`pack ${pack.id}: scope ${scopeKey} lists unknown method ${method}`);
        }
        if (scoped.has(method)) {
          errors.push(`pack ${pack.id}: method ${method} listed in multiple scope buckets`);
        }
        scoped.add(method);
      }
    }

    for (const method of pack.methods) {
      if (!scoped.has(method)) {
        errors.push(`pack ${pack.id}: method ${method} missing from scopes`);
      }
    }
  }

  return errors;
}
