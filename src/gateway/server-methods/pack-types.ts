/**
 * Gateway method pack types — colocated RPC registration for multi-agent land safety.
 *
 * New gateway methods MUST be added via a `*.pack.ts` beside their handler module.
 * The pack owns method names, scope classification, and handler spread — not
 * `server-methods-list.ts` / `method-scopes.ts` / `server-methods.ts` directly.
 *
 * See `scripts/check-gateway-method-packs.ts` and `.kiro/specs/gateway-method-pack/`.
 */

import type { GatewayRequestHandlers } from "./types.js";

/** Scope keys mirror `OperatorScope` in `method-scopes.ts` (stringly to avoid cycles). */
export const PACK_OPERATOR_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing",
] as const;

export type PackOperatorScope = (typeof PACK_OPERATOR_SCOPES)[number];

export type GatewayMethodPackScopes = Partial<Record<PackOperatorScope, readonly string[]>>;

/** One feature-owned registration unit (handler + list + scopes). */
export interface GatewayMethodPack {
  /** Stable id, usually `<feature>` matching the handler file stem. */
  id: string;
  /** Public RPC method names this pack owns exclusively. */
  methods: readonly string[];
  /** Scope bucket per method; every `methods` entry must appear exactly once. */
  scopes: GatewayMethodPackScopes;
  handlers: GatewayRequestHandlers;
  /**
   * When true, handler bodies live in a legacy module (e.g. `chat.ts`); this pack
   * only owns list + scope registration until the handler is extracted.
   */
  externalHandlers?: boolean;
}

export function defineGatewayMethodPack(pack: GatewayMethodPack): GatewayMethodPack {
  return pack;
}
