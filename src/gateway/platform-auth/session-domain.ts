/**
 * Session domain isolation for platform auth.
 *
 * Every issued session record carries a `domain` pinning it to one product
 * surface. RPC methods may declare a `requiredDomain`; the guard rejects a
 * request whose session domain does not match. Un-annotated methods default to
 * "any" (tightened incrementally in follow-up work).
 *
 * Live webchat/control-ui sockets keep the cookie session's domain, then
 * project it onto an authoritative personal surface (`www` / `gw` → employee,
 * `biz` → enterprise). A platform-ranked cookie must not stay platform on
 * those hosts: that made `agents.list` return the install roster. The
 * platform console is not rewritten. A legacy shared cookie is read only
 * when its stored domain matches the request surface.
 *
 * Spec: platform-admin-login-isolation Task 1 (Requirements 5.1, 5.2, 5.3, 5.4).
 */

import type { PlatformAuthSessionContext } from "./store-types.js";

export type SessionDomain = "platform" | "enterprise" | "employee";

export type RequiredDomain = SessionDomain | "any" | readonly SessionDomain[];

/**
 * Owner-scoped surfaces that any authenticated platform user may use for their
 * OWN records (resolution is by trusted `user.id`, never request params). These
 * are available from the personal workbench regardless of whether the signed-in
 * user is a member employee, an enterprise admin, or a platform admin — each
 * only ever sees/manages their own identities.
 */
const SELF_SCOPED_IDENTITY_DOMAINS: readonly SessionDomain[] = [
  "employee",
  "enterprise",
  "platform",
];

/**
 * Derives the session domain from a resolved session context's sessionKind.
 * Used both at issuance time and as a fallback for legacy session records that
 * predate the `domain` field (Requirement 5.4).
 */
export function deriveSessionDomain(
  context: Pick<PlatformAuthSessionContext, "sessionKind">,
): SessionDomain {
  switch (context.sessionKind) {
    case "platform-super-admin":
    case "platform-admin":
      return "platform";
    case "enterprise-admin":
      return "enterprise";
    default:
      return "employee";
  }
}

/**
 * Pure guard: returns true when a session of `sessionDomain` may invoke a method
 * declaring `requiredDomain`. "any" accepts all domains.
 */
export function isSessionDomainAllowed(
  requiredDomain: RequiredDomain,
  sessionDomain: SessionDomain,
): boolean {
  if (requiredDomain === "any") {
    return true;
  }
  if (Array.isArray(requiredDomain)) {
    return requiredDomain.includes(sessionDomain);
  }
  return requiredDomain === sessionDomain;
}

/**
 * Per-method required-domain registry. Methods absent from this map default to
 * "any". Populate incrementally as methods are hardened; the startup audit lists
 * every "any" method so future PRs can tighten one-by-one.
 */
const METHOD_REQUIRED_DOMAIN: Record<string, RequiredDomain> = {
  // Platform-only management surfaces (illustrative seed; expand incrementally).
  "platform-plans.create": "platform",
  "platform-plans.update": "platform",
  "platform-pricing.set": "platform",
  "platform-pricing.create-version": "platform",
  "platform-pricing.activate": "platform",
  "platform-pricing.deprecate": "platform",
  // model-entitlement-chain P2: platform maintains plan→model bindings.
  "platform-model-binding.set": "platform",
  "platform-model-binding.get": "platform",
  "platform-model-binding.list": "platform",
  // model-entitlement-chain P6: platform plan⇄model unified overview.
  "platform-model-binding.overview": "platform",
  "platform-plan-bundle.overview": "platform",
  "platform-plan-bundle.get": "platform",
  "platform-plan-bundle.list": "platform",
  "platform-plan-bundle.diff": "platform",
  "platform-plan-bundle.consistency": "platform",
  "platform-plan-bundle.preview-allocation": "platform",
  "platform-plan-bundle.create": "platform",
  "platform-plan-bundle.update": "platform",
  "platform-plan-bundle.create-version": "platform",
  "platform-plan-bundle.activate": "platform",
  "platform-plan-bundle.deprecate": "platform",
  "platform-plan-bundle.delete-version": "platform",
  "platform-plan-bundle.set-marketing-tags": "platform",
  "platform-plan-bundle.set-matching-profile": "platform",
  "platform-resource-catalog.overview": "platform",
  "platform-resource-catalog.tiers.list": "platform",
  "platform-resource-catalog.tiers.upsert": "platform",
  "platform-resource-catalog.models.list": "platform",
  "platform-resource-catalog.models.upsert": "platform",
  "platform-resource-catalog.models.seed-from-config": "platform",
  "platform-resource-catalog.credit-weights.list": "platform",
  "platform-resource-catalog.credit-weights.upsert": "platform",
  "platform-resource-catalog.failover-rules.list": "platform",
  "platform-resource-catalog.failover-rules.upsert": "platform",
  "platform-resource-catalog.resolve-tiers": "platform",
  "platform-policy.overview": "platform",
  "platform-policy.list": "platform",
  "platform-policy.get": "platform",
  "platform-cost-version.overview": "platform",
  "platform-cost-version.list": "platform",
  "platform-cost-version.get": "platform",
  "platform-cost-version.create-from-catalog": "platform",
  "platform-cost-version.activate": "platform",
  "platform-economics.overview": "platform",
  "platform-economics.ledger": "platform",
  "platform-allocation.preview-plan": "platform",
  "doctor.memory.health": "platform",
  // Platform diagnosis approvals. The enterprise sibling is a separate method.
  "platform.diagnosis.approval.decide": "platform",
  // Tenant pause/resume: same platform-domain gate as platform.tenant.provision.
  "platform.tenant.provision": "platform",
  "platform.tenant.import.preflight": "platform",
  "platform.tenant.import.start": "platform",
  "platform.tenant.import.status": "platform",
  "platform.tenant.pause": "platform",
  "platform.tenant.resume": "platform",
  // model-entitlement-chain P2: enterprise admins manage seat/employee grants.
  "enterprise-model-grant.grant": "enterprise",
  "enterprise-model-grant.revoke": "enterprise",
  "enterprise-model-grant.list": "enterprise",
  "enterprise-allocation.overview": "enterprise",
  "enterprise-allocation.apply-profile": "enterprise",
  "enterprise-allocation.sync-all-seats": "enterprise",
  "enterprise-memory.governance.overview": "enterprise",
  "enterprise-memory.governance.retention.get": "enterprise",
  "enterprise-memory.governance.retention.update": "enterprise",
  "subscriptions.get": "enterprise",
  "subscriptions.history": "enterprise",
  "subscriptions.preview-plan-allocation": "enterprise",
  // model-entitlement-chain P2: personal "AI 模型" settings read-only summary.
  // Owner-scoped via trusted seat context (no client-injected tenant/seat ids), so
  // it must be reachable from the personal workbench for employee / enterprise /
  // platform sessions — same pattern as workbench.* self-scoped surfaces. A hard
  // "employee" pin caused domain_mismatch for enterprise-admin personal settings
  // and blanked both「我的可用模型」and「模型消费量」panels.
  "employee-model-access.summary": SELF_SCOPED_IDENTITY_DOMAINS,
  // ops-decommission 2.8b: exec approvals are platform-ops-only control-plane infra.
  "exec.approvals.get": "platform",
  "exec.approvals.set": "platform",
  "exec.approvals.node.get": "platform",
  "exec.approvals.node.set": "platform",
  // operational-identity-governance P2 (R8 / Task 2.3): "我的运营身份" is a
  // personal self-service surface. Resolution is owner-scoped by trusted user.id,
  // so it is safe for any authenticated user (member / enterprise admin / platform
  // admin) to manage their OWN identities from the personal workbench — hence the
  // multi-domain allowlist rather than a single `employee` pin. The cross-user
  // monitoring aggregator `user-operational-identity.governance.overview` stays at
  // the default "any" (D5) and is authorized in-handler via resolveQueryScope.
  "user-operational-identity.list": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.providers.catalog": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.history.list": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.access.list-for-agent": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.access.resolve": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.binding-request.get": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.binding-request.list-pending": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.continuation.get": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.continuation.list-pending": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.create": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.revoke": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.reauthorize": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.grants.upsert": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.grants.revoke": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.execute": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.binding-request.create": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.binding-request.cancel": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.binding-request.complete": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.continuation.create": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.continuation.complete-oauth": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.continuation.resume": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.continuation.cancel": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.oauth.start": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.oauth.status": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.oauth.simulate-complete": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.oauth.cancel": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.feishu-employee.refresh": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.feishu-employee.use": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.wechat-personal.status": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.wechat-personal.bind-existing": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.wechat-personal.qr.start": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.wechat-personal.qr.wait": SELF_SCOPED_IDENTITY_DOMAINS,
  // Employee-domain enterprise-identity enrollment (bounded by enterprise policy
  // server-side); usable from both employee and enterprise-admin personal views.
  // Employee MCP discovery projection. Enterprise admins may call it for their
  // own seat; the admin full-tenant panel stays on enterprise-data.mcp-discovery.
  "enterprise-data.mcp-discovery.for-seat": ["employee", "enterprise"],
  "enterprise-operational-identity.access.list-for-seat-agent": SELF_SCOPED_IDENTITY_DOMAINS,
  "enterprise-operational-identity.employee.enrollments": SELF_SCOPED_IDENTITY_DOMAINS,
  "enterprise-operational-identity.employee.authorize": SELF_SCOPED_IDENTITY_DOMAINS,
  "enterprise-operational-identity.employee.revoke": SELF_SCOPED_IDENTITY_DOMAINS,
  // employee-schedule-meeting-lifecycle (A0/A1/B/C): the employee home workbench
  // (four cards + schedule/meeting/task) is an owner-scoped PERSONAL surface —
  // every handler resolves the actor via resolveEmployeeWorkbenchActor() by trusted
  // user.id, never request params. Like the personal identity surfaces above it is
  // usable from any authenticated user's personal view (member / enterprise admin /
  // platform admin manage only their OWN workbench), so it takes the tri-domain
  // self-scoped allowlist rather than a single "employee" pin (which would lock an
  // enterprise/platform admin out of their own home).
  "workbench.my-tasks.list": SELF_SCOPED_IDENTITY_DOMAINS,
  "workbench.pending-tasks.list": SELF_SCOPED_IDENTITY_DOMAINS,
  "tasks.list": SELF_SCOPED_IDENTITY_DOMAINS,
  "tasks.getSummary": SELF_SCOPED_IDENTITY_DOMAINS,
  "tasks.create": SELF_SCOPED_IDENTITY_DOMAINS,
  "tasks.update": SELF_SCOPED_IDENTITY_DOMAINS,
  "tasks.bindSession": SELF_SCOPED_IDENTITY_DOMAINS,
  "data.memory.list": SELF_SCOPED_IDENTITY_DOMAINS,
  "data.memory.forget": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-modeling.get-profile": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-modeling.reset-profile": SELF_SCOPED_IDENTITY_DOMAINS,
  "seat-rules.get-exec-preference": SELF_SCOPED_IDENTITY_DOMAINS,
  "seat-rules.set-exec-preference": SELF_SCOPED_IDENTITY_DOMAINS,
  "seat-rules.get": SELF_SCOPED_IDENTITY_DOMAINS,
  "seat-rules.set": SELF_SCOPED_IDENTITY_DOMAINS,
  "seat-rules.drill": SELF_SCOPED_IDENTITY_DOMAINS,
  "progress-ledger.admin.list": ["platform", "enterprise"],
  "conversation-task.active.get": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-modeling.admin.get-profile": ["enterprise", "employee"],
  "user-modeling.admin.reset-profile": ["enterprise", "employee"],
  "workbench.notices.list": SELF_SCOPED_IDENTITY_DOMAINS,
  "workbench.upcoming-collaboration.list": SELF_SCOPED_IDENTITY_DOMAINS,
  "workbench.schedule.list": SELF_SCOPED_IDENTITY_DOMAINS,
  "workbench.steward-suggestion.get": SELF_SCOPED_IDENTITY_DOMAINS,
  "schedule.entry.upsert": SELF_SCOPED_IDENTITY_DOMAINS,
  "schedule.entry.cancel": SELF_SCOPED_IDENTITY_DOMAINS,
  "meeting.create": SELF_SCOPED_IDENTITY_DOMAINS,
  "meeting.submit": SELF_SCOPED_IDENTITY_DOMAINS,
  "meeting.approve": SELF_SCOPED_IDENTITY_DOMAINS,
  "meeting.start": SELF_SCOPED_IDENTITY_DOMAINS,
  "meeting.minute": SELF_SCOPED_IDENTITY_DOMAINS,
  "meeting.distribute": SELF_SCOPED_IDENTITY_DOMAINS,
  "meeting.cancel": SELF_SCOPED_IDENTITY_DOMAINS,
  "meeting.list": SELF_SCOPED_IDENTITY_DOMAINS,
  "meeting.ack": SELF_SCOPED_IDENTITY_DOMAINS,
  "meeting.decline": SELF_SCOPED_IDENTITY_DOMAINS,
  "meeting.replay-schedule": SELF_SCOPED_IDENTITY_DOMAINS,
  "meeting.retry-delivery": SELF_SCOPED_IDENTITY_DOMAINS,
  "collab.dispatch.create": SELF_SCOPED_IDENTITY_DOMAINS,
  "collab.dispatch.submit": SELF_SCOPED_IDENTITY_DOMAINS,
  "collab.dispatch.approve": SELF_SCOPED_IDENTITY_DOMAINS,
  "collab.dispatch.cancel": SELF_SCOPED_IDENTITY_DOMAINS,
  "collab.dispatch.list": SELF_SCOPED_IDENTITY_DOMAINS,
  "collab.dispatch.ack": SELF_SCOPED_IDENTITY_DOMAINS,
  "collab.dispatch.decline": SELF_SCOPED_IDENTITY_DOMAINS,
  "collab.dispatch.retry-delivery": SELF_SCOPED_IDENTITY_DOMAINS,
  "task.accept": SELF_SCOPED_IDENTITY_DOMAINS,
  "task.complete": SELF_SCOPED_IDENTITY_DOMAINS,
  "task.list": SELF_SCOPED_IDENTITY_DOMAINS,
  "supervisor.task.list": SELF_SCOPED_IDENTITY_DOMAINS,
  "supervisor.task.create": SELF_SCOPED_IDENTITY_DOMAINS,
  "supervisor.task.get": SELF_SCOPED_IDENTITY_DOMAINS,
  "supervisor.task.abort": SELF_SCOPED_IDENTITY_DOMAINS,
  "supervisor.task.subscribe": SELF_SCOPED_IDENTITY_DOMAINS,
  "supervisor.task.audit": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.credentials.bind": SELF_SCOPED_IDENTITY_DOMAINS,
  "user-operational-identity.credentials.verify": SELF_SCOPED_IDENTITY_DOMAINS,

  "meeting.draft-invite": SELF_SCOPED_IDENTITY_DOMAINS,
  "meeting.generate-minutes": SELF_SCOPED_IDENTITY_DOMAINS,
  "schedule.extract": SELF_SCOPED_IDENTITY_DOMAINS,
};

export function getRequiredDomain(method: string): RequiredDomain {
  return METHOD_REQUIRED_DOMAIN[method] ?? "any";
}

export type SessionDomainGuardResult =
  | { allowed: true }
  | { allowed: false; code: "domain_mismatch"; requiredDomain: RequiredDomain };

/**
 * Guards a method invocation. When the session domain is unknown (no session
 * record / unauthenticated), the guard defers to the existing role/scope auth
 * by allowing (the caller still passes through standard authorization).
 */
export function guardSessionDomain(
  method: string,
  sessionDomain: SessionDomain | null | undefined,
): SessionDomainGuardResult {
  const requiredDomain = getRequiredDomain(method);
  if (requiredDomain === "any" || sessionDomain == null) {
    return { allowed: true };
  }
  if (isSessionDomainAllowed(requiredDomain, sessionDomain)) {
    return { allowed: true };
  }
  return { allowed: false, code: "domain_mismatch", requiredDomain };
}

/** Lists methods still defaulting to "any" for the startup tightening notice. */
export function listUnscopedDomainMethods(allMethods: readonly string[]): string[] {
  return allMethods.filter((method) => getRequiredDomain(method) === "any");
}
