/**
 * Host recheck of the original subject/account/target before a recovered send.
 * Intent is a locator, not a permanent grant. Missing a verifiable locator is blocked.
 * Reuses existing outbound-scope and (when present) current account-enabled state.
 * Does not invent a new authorization framework.
 */
import { resolveChannelAccountOutboundScopeFacts } from "../agent-runtime/command/accepted-artifact-delivery.js";
import {
  evaluateChannelAccountOutboundScope,
  normalizeDeliveryTarget,
} from "../agent-runtime/policy/accepted-artifact-delivery.js";
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

export function recheckCurrentOutboundAuthorization(params: {
  cfg: OpenBotConfig;
  pending: AwaitingDeliveryRegistration;
}): { allow: boolean; reason: string } {
  const locator = params.pending.authorization;
  if (!isVerifiableAuthorizationLocator(locator)) {
    return { allow: false, reason: "authorization_locator_missing" };
  }
  const target = normalizeDeliveryTarget({
    channel: params.pending.target?.channel || locator.channel || "",
    to: params.pending.target?.to || locator.to || "",
    accountId: params.pending.target?.accountId ?? locator.accountId,
  });
  if (!target) {
    return { allow: false, reason: "authorization_locator_missing" };
  }
  const facts = resolveChannelAccountOutboundScopeFacts({ cfg: params.cfg, target });
  if (facts && !facts.accountEnabled) {
    return { allow: false, reason: "channel_account_disabled" };
  }
  const scope = evaluateChannelAccountOutboundScope({ target, facts });
  if (scope.outcome === "deny") {
    return { allow: false, reason: scope.reason };
  }
  // authorization_pending: no configured destination list. Personal / internal
  // Webchat often has no outbound-scope backend. The locator still pins the
  // original target; a disabled account is already denied above. This is not
  // an implicit allow-all of other destinations, and it does not retarget
  // another channel.
  return {
    allow: true,
    reason: scope.outcome === "allow" ? scope.reason : "locator_current_unrevoked",
  };
}
