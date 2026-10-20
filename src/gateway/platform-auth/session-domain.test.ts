import { describe, expect, it } from "vitest";
import {
  deriveSessionDomain,
  getRequiredDomain,
  guardSessionDomain,
  isSessionDomainAllowed,
  listUnscopedDomainMethods,
  type SessionDomain,
} from "./session-domain.js";

describe("session-domain", () => {
  it("derives domain from session kind", () => {
    expect(deriveSessionDomain({ sessionKind: "platform-super-admin" })).toBe("platform");
    expect(deriveSessionDomain({ sessionKind: "platform-admin" })).toBe("platform");
    expect(deriveSessionDomain({ sessionKind: "enterprise-admin" })).toBe("enterprise");
    expect(deriveSessionDomain({ sessionKind: "member" })).toBe("employee");
  });

  it("isSessionDomainAllowed matrix", () => {
    const domains: SessionDomain[] = ["platform", "enterprise", "employee"];
    for (const session of domains) {
      expect(isSessionDomainAllowed("any", session)).toBe(true);
      for (const required of domains) {
        expect(isSessionDomainAllowed(required, session)).toBe(required === session);
      }
    }
  });

  it("guard allows when method is unscoped (any)", () => {
    expect(guardSessionDomain("some.unlisted.method", "employee")).toEqual({ allowed: true });
  });

  it("guard allows when session domain unknown (defers to role/scope auth)", () => {
    expect(guardSessionDomain("platform-plans.create", null)).toEqual({ allowed: true });
    expect(guardSessionDomain("platform-plans.create", undefined)).toEqual({ allowed: true });
  });

  it("guard rejects mismatched domain on a platform-scoped method", () => {
    expect(guardSessionDomain("platform-plans.create", "enterprise")).toEqual({
      allowed: false,
      code: "domain_mismatch",
      requiredDomain: "platform",
    });
    expect(guardSessionDomain("platform-plans.create", "platform")).toEqual({ allowed: true });
  });

  it("allows employee sessions to read their own conversation-task progress", () => {
    expect(getRequiredDomain("conversation-task.active.get")).toEqual([
      "employee",
      "enterprise",
      "platform",
    ]);
    expect(guardSessionDomain("conversation-task.active.get", "employee")).toEqual({
      allowed: true,
    });
  });

  it("pins progress-ledger admin list to platform and enterprise", () => {
    expect(getRequiredDomain("progress-ledger.admin.list")).toEqual(["platform", "enterprise"]);
    expect(guardSessionDomain("progress-ledger.admin.list", "employee")).toEqual({
      allowed: false,
      code: "domain_mismatch",
      requiredDomain: ["platform", "enterprise"],
    });
    expect(guardSessionDomain("progress-ledger.admin.list", "platform")).toEqual({ allowed: true });
  });

  it("getRequiredDomain returns any for unlisted methods", () => {
    expect(getRequiredDomain("chat.send")).toBe("any");
    expect(getRequiredDomain("platform-pricing.activate")).toBe("platform");
  });

  it("model-entitlement methods are pinned to their domains (governance boundary)", () => {
    expect(getRequiredDomain("platform-model-binding.set")).toBe("platform");
    expect(getRequiredDomain("platform-model-binding.get")).toBe("platform");
    expect(getRequiredDomain("platform-model-binding.list")).toBe("platform");
    expect(getRequiredDomain("enterprise-model-grant.grant")).toBe("enterprise");
    expect(getRequiredDomain("enterprise-model-grant.revoke")).toBe("enterprise");
    expect(getRequiredDomain("enterprise-model-grant.list")).toBe("enterprise");
    // Personal AI-models settings: self-scoped across authenticated domains.
    expect(getRequiredDomain("employee-model-access.summary")).toEqual([
      "employee",
      "enterprise",
      "platform",
    ]);
    for (const domain of ["employee", "enterprise", "platform"] as const) {
      expect(guardSessionDomain("employee-model-access.summary", domain)).toEqual({
        allowed: true,
      });
    }
  });

  it("personal workbench surfaces (schedule/meeting/task) are domain-declared, usable by all admin domains", () => {
    const personalWorkbenchMethods = [
      "workbench.pending-tasks.list",
      "workbench.my-tasks.list",
      "workbench.notices.list",
      "workbench.upcoming-collaboration.list",
      "workbench.schedule.list",
      "workbench.steward-suggestion.get",
      "schedule.entry.upsert",
      "schedule.entry.cancel",
      "meeting.create",
      "meeting.submit",
      "meeting.approve",
      "meeting.start",
      "meeting.minute",
      "meeting.distribute",
      "meeting.generate-minutes",
      "meeting.cancel",
      "meeting.list",
      "meeting.ack",
      "meeting.decline",
      "meeting.replay-schedule",
      "meeting.retry-delivery",
      "collab.dispatch.create",
      "collab.dispatch.submit",
      "collab.dispatch.approve",
      "collab.dispatch.cancel",
      "collab.dispatch.list",
      "collab.dispatch.ack",
      "collab.dispatch.decline",
      "collab.dispatch.retry-delivery",
      "task.accept",
      "task.complete",
      "task.list",
      "supervisor.task.list",
      "supervisor.task.create",
      "supervisor.task.get",
      "supervisor.task.abort",
      "supervisor.task.subscribe",
      "supervisor.task.audit",
    ];
    // None default to "any" anymore (the acceptance gap the review flagged).
    expect(listUnscopedDomainMethods(personalWorkbenchMethods)).toEqual([]);
    // Owner-scoped personal surface: each user only ever sees/manages their OWN
    // workbench, so member / enterprise admin / platform admin sessions are all allowed.
    for (const method of personalWorkbenchMethods) {
      expect(guardSessionDomain(method, "employee")).toEqual({ allowed: true });
      expect(guardSessionDomain(method, "enterprise")).toEqual({ allowed: true });
      expect(guardSessionDomain(method, "platform")).toEqual({ allowed: true });
    }
  });

  it("employee session cannot invoke enterprise grant mutations (domain guard)", () => {
    expect(guardSessionDomain("enterprise-model-grant.grant", "employee")).toEqual({
      allowed: false,
      code: "domain_mismatch",
      requiredDomain: "enterprise",
    });
    expect(guardSessionDomain("enterprise-model-grant.grant", "enterprise")).toEqual({
      allowed: true,
    });
  });

  it("declares domains for memory, user-modeling, and credential identity methods", () => {
    const selfScoped = [
      "data.memory.list",
      "data.memory.forget",
      "user-modeling.get-profile",
      "user-modeling.reset-profile",
      "seat-rules.get-exec-preference",
      "seat-rules.set-exec-preference",
      "seat-rules.get",
      "seat-rules.set",
      "seat-rules.drill",
      "user-operational-identity.credentials.bind",
      "user-operational-identity.credentials.verify",
    ];
    expect(listUnscopedDomainMethods(selfScoped)).toEqual([]);
    for (const method of selfScoped) {
      expect(guardSessionDomain(method, "employee")).toEqual({ allowed: true });
      expect(guardSessionDomain(method, "enterprise")).toEqual({ allowed: true });
      expect(guardSessionDomain(method, "platform")).toEqual({ allowed: true });
    }

    for (const method of [
      "enterprise-memory.governance.overview",
      "enterprise-memory.governance.retention.get",
      "enterprise-memory.governance.retention.update",
    ]) {
      expect(getRequiredDomain(method)).toBe("enterprise");
      expect(guardSessionDomain(method, "employee")).toEqual({
        allowed: false,
        code: "domain_mismatch",
        requiredDomain: "enterprise",
      });
      expect(guardSessionDomain(method, "enterprise")).toEqual({ allowed: true });
    }

    for (const method of ["user-modeling.admin.get-profile", "user-modeling.admin.reset-profile"]) {
      expect(guardSessionDomain(method, "platform")).toEqual({
        allowed: false,
        code: "domain_mismatch",
        requiredDomain: ["enterprise", "employee"],
      });
      expect(guardSessionDomain(method, "enterprise")).toEqual({ allowed: true });
      expect(guardSessionDomain(method, "employee")).toEqual({ allowed: true });
    }
  });

  it("exec.approvals.* are pinned to platform domain (ops-decommission 2.8b)", () => {
    for (const method of [
      "exec.approvals.get",
      "exec.approvals.set",
      "exec.approvals.node.get",
      "exec.approvals.node.set",
    ]) {
      expect(getRequiredDomain(method)).toBe("platform");
    }
  });

  it("non-platform sessions cannot reach exec approvals (domain guard)", () => {
    for (const domain of ["enterprise", "employee"] as const) {
      expect(guardSessionDomain("exec.approvals.set", domain)).toEqual({
        allowed: false,
        code: "domain_mismatch",
        requiredDomain: "platform",
      });
    }
    expect(guardSessionDomain("exec.approvals.set", "platform")).toEqual({ allowed: true });
  });

  it("listUnscopedDomainMethods returns only methods defaulting to any", () => {
    const methods = ["chat.send", "platform-plans.create", "skills.status"];
    expect(listUnscopedDomainMethods(methods)).toEqual(["chat.send", "skills.status"]);
  });

  it("allows owner-scoped operational-identity methods from any authenticated domain", () => {
    for (const domain of ["employee", "enterprise", "platform"] as const) {
      expect(guardSessionDomain("user-operational-identity.list", domain)).toEqual({
        allowed: true,
      });
      expect(
        guardSessionDomain("enterprise-operational-identity.employee.authorize", domain),
      ).toEqual({ allowed: true });
    }
    // Still not flagged as an un-scoped "any" method (it carries an explicit allowlist).
    expect(listUnscopedDomainMethods(["user-operational-identity.list"])).toEqual([]);
  });
});
