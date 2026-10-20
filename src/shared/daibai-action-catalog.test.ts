import { describe, expect, it } from "vitest";
import type { DaibaiActionDescriptor } from "./daibai-action-catalog.js";

describe("DaibaiActionDescriptor type contract", () => {
  it("accepts a read descriptor delegating to a service", () => {
    const descriptor: DaibaiActionDescriptor = {
      actionId: "support.case.create",
      title: "升级给平台技术支持",
      kind: "write",
      requiredScope: "operator.write",
      delegateTarget: { mode: "service", ref: "createSupportCase" },
      requiresUserConfirmation: false,
      buildParams: (ctx) => ({ userId: ctx.userId }),
    };
    expect(descriptor.requiredScope).toBe("operator.write");
    expect(descriptor.buildParams({ userId: "u1", payload: {} })).toEqual({ userId: "u1" });
  });

  it("supports ownership + experimental + secondary-permission metadata", () => {
    const descriptor: DaibaiActionDescriptor = {
      actionId: "robot-skills.toggle",
      title: "启停技能",
      kind: "write",
      requiredScope: "operator.write",
      delegateTarget: { mode: "internal-dispatch", ref: "robot-skills.toggle" },
      secondaryPermission: "usage:budget",
      maturity: "experimental",
      requiresOwnershipCheck: true,
      requiresUserConfirmation: true,
      buildParams: (ctx) => ({ agentId: ctx.resolvedAgentId }),
    };
    expect(descriptor.requiresOwnershipCheck).toBe(true);
    expect(descriptor.maturity).toBe("experimental");
  });

  it("rejects ADMIN scope at the type level (compile-time guard)", () => {
    const descriptor: DaibaiActionDescriptor = {
      actionId: "agents.delete",
      title: "should not compile",
      kind: "write",
      // @ts-expect-error operator.admin is intentionally excluded from DaibaiActionScope.
      requiredScope: "operator.admin",
      delegateTarget: { mode: "service", ref: "x" },
      requiresUserConfirmation: true,
      buildParams: () => ({}),
    };
    // Runtime assertion keeps the descriptor referenced; the guard is the @ts-expect-error above.
    expect(descriptor.actionId).toBe("agents.delete");
  });
});
