import type { ErrorShape } from "./protocol/index.js";

export type DedupeEntry = {
  ts: number;
  ok: boolean;
  payload?: unknown;
  error?: ErrorShape;
  /**
   * Hash of the request that owns this key. Side-effecting handlers compare it
   * and reject a reused key whose payload differs. Wait-only entries may omit it.
   */
  payloadFingerprint?: string;
};
