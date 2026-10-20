/**
 * ConversationTask Runtime — fail-closed access control (P2, per p2-design-freeze.md
 * A3 and p2-security-review.md S1/S2).
 *
 * The three required scope checks (tenant, conversation, employee/workbench) are
 * enforced here as pure, fail-closed guards over an injected `AccessContext`. P2
 * does NOT modify `chat.send` or the gateway server methods — the gateway supplies
 * the authenticated scope and this module refuses anything outside it. `ownerId`
 * is task ownership within a tenant, never an external authorization subject
 * (CT1); a Candidate never widens conversation visibility.
 *
 * Detection input must be re-checked against the conversation scope (defense in
 * depth): even if an upstream leaks a message from another conversation, the
 * secondary check refuses it before it can influence a decision.
 */

import { canonicalTenantId } from "./canonical.js";
import { ConversationTaskAccessError } from "./errors.js";

/**
 * Authenticated access context, supplied by the gateway (never self-derived).
 * `authorizedConversationIds` is the set of conversations the requester may read
 * or write within the tenant; `employeeScopeAllowed` gates employee/workbench.
 */
export type ConversationTaskAccess = {
  tenantId: string;
  conversationId: string;
  requesterId: string;
  authorizedConversationIds: ReadonlySet<string>;
  employeeScopeAllowed: boolean;
};

function isTrusted(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Fail-closed guard for a ConversationTask operation. Rejects unless the tenant
 * and requester are trusted, the conversation is within the requester's
 * authorized set, and the employee/workbench scope allows it.
 */
export function assertConversationTaskAccess(access: ConversationTaskAccess): void {
  if (!isTrusted(access.tenantId)) {
    throw new ConversationTaskAccessError("tenant_scope", "a trusted tenantId is required");
  }
  if (!isTrusted(access.requesterId)) {
    throw new ConversationTaskAccessError("requester_scope", "a trusted requesterId is required");
  }
  if (!isTrusted(access.conversationId)) {
    throw new ConversationTaskAccessError(
      "conversation_scope",
      "a trusted conversationId is required",
    );
  }
  if (!access.authorizedConversationIds.has(access.conversationId)) {
    throw new ConversationTaskAccessError(
      "conversation_scope",
      "conversation is outside the requester's authorized scope",
    );
  }
  if (!access.employeeScopeAllowed) {
    throw new ConversationTaskAccessError("employee_scope", "employee/workbench scope denied");
  }
}

/**
 * Bind the access context's tenant to the opened store's tenant. Without this a
 * context authenticated for tenant B could write into tenant A's store. Compares
 * canonical forms and fails closed on any mismatch. Callers pass the store's
 * already-canonical `tenantId`.
 */
export function assertTenantStoreBinding(accessTenantId: string, storeTenantId: string): void {
  if (!isTrusted(accessTenantId) || !isTrusted(storeTenantId)) {
    throw new ConversationTaskAccessError(
      "tenant_binding",
      "tenant identity is required on both sides",
    );
  }
  if (canonicalTenantId(accessTenantId) !== storeTenantId) {
    throw new ConversationTaskAccessError(
      "tenant_binding",
      "access tenant does not match the opened store tenant",
    );
  }
}

/**
 * Secondary scope check for detection input. Every message fed to detection must
 * belong to the bound conversation and be within the authorized set; anything
 * else is refused (fail-closed) so cross-conversation text cannot leak into a
 * decision.
 */
export function assertDetectionScope(
  access: ConversationTaskAccess,
  messageConversationId: string,
): void {
  if (messageConversationId !== access.conversationId) {
    throw new ConversationTaskAccessError(
      "detection_scope",
      "detection input is not from the bound conversation",
    );
  }
  if (!access.authorizedConversationIds.has(messageConversationId)) {
    throw new ConversationTaskAccessError(
      "detection_scope",
      "detection input conversation is outside authorized scope",
    );
  }
}
