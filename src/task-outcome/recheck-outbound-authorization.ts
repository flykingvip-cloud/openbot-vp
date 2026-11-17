/**
 * Host recheck of the original subject/account/target before a recovered send.
 * Intent is a locator, not a permanent grant. Missing a verifiable locator is blocked.
 * Current authorization facts come from the original host ports
 * `resolveChannelAccountOutboundScopeFacts` and `evaluateChannelAccountOutboundScope`.
 * A persisted locator, an enabled account, or a non-empty session string is not a grant.
 * Does not invent a new authorization framework.
 */
import { resolveChannelAccountOutboundScopeFacts } from "../agent-runtime/command/index.js";
import {
  evaluateChannelAccountOutboundScope,
  normalizeDeliveryTarget,
  type NormalizedDeliveryTarget,
} from "../agent-runtime/policy/index.js";
import type { OpenBotConfig } from "../config/config.js";
import type {
  AwaitingDeliveryRegistration,
  PendingVisibleAuthorizationLocator,
} from "./pending-delivery.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function isVerifiableAuthorizationLocator(
  locator: PendingVisibleAuthorizationLocator | undefined,
): locator is PendingVisibleAuthorizationLocator {
  if (!locator) {
    return false;
  }
  const subject =
    compact(locator.subjectRef) ||
    compact(locator.sessionKey) ||
    compact(locator.operatorId) ||
    compact(locator.tenantId);
  return Boolean(subject && compact(locator.channel) && compact(locator.to));
}

function normalizeLocatorOrPendingTarget(input: {
  channel?: string | null;
  to?: string | null;
  accountId?: string | null;
}): NormalizedDeliveryTarget | null {
  return normalizeDeliveryTarget({
    channel: input.channel || "",
    to: input.to || "",
    accountId: input.accountId,
  });
}

function sameNormalizedTarget(
  left: NormalizedDeliveryTarget,
  right: NormalizedDeliveryTarget,
): boolean {
  return (
    left.channel === right.channel && left.accountId === right.accountId && left.to === right.to
  );
}

export function recheckCurrentOutboundAuthorization(params: {
  cfg: OpenBotConfig;
  pending: AwaitingDeliveryRegistration;
}): { allow: boolean; reason: string } {
  const locator = params.pending.authorization;
  if (!isVerifiableAuthorizationLocator(locator)) {
    return { allow: false, reason: "authorization_locator_missing" };
  }
  const locatorTarget = normalizeLocatorOrPendingTarget(locator);
  const actualTarget = params.pending.target
    ? normalizeLocatorOrPendingTarget(params.pending.target)
    : null;
  if (!locatorTarget || !actualTarget) {
    return { allow: false, reason: "authorization_locator_missing" };
  }
  if (!sameNormalizedTarget(locatorTarget, actualTarget)) {
    return { allow: false, reason: "authorization_locator_target_mismatch" };
  }

  let facts;
  try {
    facts = resolveChannelAccountOutboundScopeFacts({
      cfg: params.cfg,
      target: actualTarget,
    });
  } catch {
    return { allow: false, reason: "outbound_scope_basis_missing" };
  }

  // The fact resolver omits destinations when the account is disabled, which
  // the original policy would otherwise classify as pending. Keep deny.
  if (facts && !facts.accountEnabled) {
    return { allow: false, reason: "channel_account_disabled" };
  }

  const scope = evaluateChannelAccountOutboundScope({
    target: actualTarget,
    facts,
  });
  if (scope.outcome === "allow") {
    return { allow: true, reason: scope.reason };
  }
  return { allow: false, reason: scope.reason };
}
