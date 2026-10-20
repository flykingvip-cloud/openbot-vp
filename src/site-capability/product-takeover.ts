/**
 * Product-facing human takeover / hand-back for the account browser desk.
 *
 * Only this module (and the Account Computer preview success path that calls
 * it) may bump SarExecutionAuthority human ownership. Tests and product code
 * must not call authority.humanTakeover / handBack directly to simulate UI
 * takeover — that would bypass the product event.
 */

import { ensureAccountBrowserCoordinator } from "./coordinator.js";
import { deriveAccountBrowserScopeKey } from "./session-handle.js";

export type ProductTakeoverResult =
  | { ok: true; scopeKey: string; epoch: string; generation: number }
  | { ok: false; reason: string };

export type ProductHandBackResult = { ok: true; scopeKey: string } | { ok: false; reason: string };

function resolveScopeKey(input: {
  tenantId: string;
  userId: string;
  scopeKey?: string;
}): string | undefined {
  const explicit = input.scopeKey?.trim();
  if (explicit) {
    return explicit;
  }
  return deriveAccountBrowserScopeKey(input.tenantId, input.userId);
}

/**
 * Product takeControl succeeded: bump fencing generation, hold the desk as
 * human, invalidate old SAR runs on this account-browser scope.
 */
export function applyProductHumanTakeover(input: {
  tenantId: string;
  userId: string;
  humanSessionKey: string;
  scopeKey?: string;
}): ProductTakeoverResult {
  const scopeKey = resolveScopeKey(input);
  if (!scopeKey) {
    return { ok: false, reason: "account browser scope could not be derived" };
  }
  const session = input.humanSessionKey.trim();
  if (!session) {
    return { ok: false, reason: "humanSessionKey is required" };
  }
  const fencing = ensureAccountBrowserCoordinator().humanTakeover(scopeKey, session);
  return { ok: true, scopeKey, epoch: fencing.epoch, generation: fencing.generation };
}

/**
 * Product releaseControl succeeded: drop the human desk hold so SAR / browser
 * may claim again. Does not rewind the fencing generation.
 */
export function applyProductHandBack(input: {
  tenantId: string;
  userId: string;
  scopeKey?: string;
}): ProductHandBackResult {
  const scopeKey = resolveScopeKey(input);
  if (!scopeKey) {
    return { ok: false, reason: "account browser scope could not be derived" };
  }
  ensureAccountBrowserCoordinator().handBack(scopeKey);
  return { ok: true, scopeKey };
}
