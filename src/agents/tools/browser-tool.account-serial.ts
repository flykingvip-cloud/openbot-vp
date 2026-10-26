/**
 * Shared account-browser desk claim for generic browser tool actions.
 *
 * plan_once / act(steps[]) already claim via browser-plan-once-wire — excluded
 * here so we do not double-claim. When SAR holds the desk or HUMAN_TAKEOVER is
 * active, the same lock rejects these actions (AccountBrowserSerialDenied).
 */

import { randomUUID } from "node:crypto";
import { ensureAccountBrowserCoordinator } from "../../site-capability/coordinator.js";
import {
  AccountBrowserSerialDenied,
  claimActiveBrowserDispatch,
  releaseActiveBrowserDispatch,
} from "../../site-capability/desk.js";
import { releaseStaleHumanTakeoverForAgent } from "../sandbox/account-computer-stream.js";

/** Mutating / page-driving actions that must share the account-browser desk. */
const SERIAL_ACTIONS = new Set([
  "open",
  "focus",
  "close",
  "navigate",
  "snapshot",
  "screenshot",
  "act",
  "pdf",
  "console",
]);

export function shouldSerializeAccountBrowserAction(
  action: string,
  params: Record<string, unknown>,
): boolean {
  if (action === "plan_once") {
    return false;
  }
  // Shape B act(steps[]) is plan_once on the shared path.
  if (action === "act" && Array.isArray(params.steps) && params.steps.length > 0) {
    return false;
  }
  return SERIAL_ACTIONS.has(action);
}

export async function runWithAccountBrowserSerial<T>(opts: {
  accountBrowserScopeKey?: string;
  action: string;
  params: Record<string, unknown>;
  runId?: string;
  run: () => Promise<T>;
}): Promise<T> {
  const scopeKey = opts.accountBrowserScopeKey?.trim();
  if (!scopeKey || !shouldSerializeAccountBrowserAction(opts.action, opts.params)) {
    return await opts.run();
  }
  // After gateway restart (or before any plan_once / product takeover), the
  // process-wide desk may be unset. Install it before claiming so snapshot /
  // navigate do not fail closed with COORDINATOR_REQUIRED while the agent
  // already holds product control.
  ensureAccountBrowserCoordinator();
  const runId = opts.runId?.trim() || `browser_${randomUUID()}`;
  let claim = claimActiveBrowserDispatch(scopeKey, runId);
  if (!claim.ok && claim.code === "HUMAN_TAKEOVER") {
    // Stale human hold (电脑 tab / incomplete handoff without await_return) must
    // not block agent navigate. Active auth handoff waiters keep the hold.
    if (releaseStaleHumanTakeoverForAgent(scopeKey)) {
      claim = claimActiveBrowserDispatch(scopeKey, runId);
    }
  }
  if (!claim.ok) {
    throw new AccountBrowserSerialDenied(claim.code, claim.message);
  }
  try {
    return await opts.run();
  } finally {
    releaseActiveBrowserDispatch(scopeKey, "browser", runId);
  }
}
