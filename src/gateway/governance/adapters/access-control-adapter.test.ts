// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { appendGovernanceShadowDecisionMock } = vi.hoisted(() => ({
  appendGovernanceShadowDecisionMock: vi.fn(),
}));

vi.mock("../shadow-sink.js", () => ({
  appendGovernanceShadowDecision: appendGovernanceShadowDecisionMock,
}));

import {
  ACCESS_CONTROL_SHADOW_ENV,
  adaptAccessControlDecision,
  isAccessControlShadowEnabled,
  recordAccessControlShadow,
  toGovernanceModeFromAccessControl,
} from "./access-control-adapter.js";

const TS = "2026-09-28T06:00:00.000Z";
const UUID = "cccccccc-dddd-4eee-8fff-000000000000";

beforeEach(() => {
  appendGovernanceShadowDecisionMock.mockReset();
  appendGovernanceShadowDecisionMock.mockResolvedValue(true);
});

describe("AccessControlAdapter mapping", () => {
  it("maps allowed → allow with a fresh gd- id; mode from access-control shadow", () => {
    const decision = adaptAccessControlDecision({
      decision: {
        allowed: true,
        mode: "shadow",
        resourceType: "agent_asset",
        resourceId: "asset-1",
        permission: "agent.execute",
        enterpriseId: "ent-a",
        subjectType: "seat",
        subjectId: "seat-1",
        requestId: "req-1",
        matchedPolicyId: "pol-1",
        callerAllowed: true,
      },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "allow",
      mode: "shadow",
      source: "access-control",
      decisionId: `gd-${UUID}`,
      requestId: "req-1",
      tenantId: "ent-a",
      actorId: "seat:seat-1",
      matchedRules: ["pol-1"],
      subject: { kind: "agent", id: "asset-1" },
      shadow: {
        existing: { effect: "allow", source: "access-control", reason: "not-enforced" },
        divergence: "D0",
      },
      ts: TS,
    });
    expect(decision.reason).toBeUndefined();
    expect(decision.decisionId).toMatch(/^gd-/);
  });

  it("maps !allowed → deny with D1 when access-control mode is shadow (caller still allowed)", () => {
    const decision = adaptAccessControlDecision({
      decision: {
        allowed: false,
        reason: "no-matching-policy",
        mode: "shadow",
        resourceType: "agent_asset",
        resourceId: "asset-2",
        callerAllowed: true,
      },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "deny",
      mode: "shadow",
      source: "access-control",
      reason: "no-matching-policy",
      decisionId: `gd-${UUID}`,
      subject: { kind: "agent", id: "asset-2" },
      shadow: {
        existing: { effect: "allow", source: "access-control", reason: "not-enforced" },
        divergence: "D1",
      },
    });
  });

  it("maps enforce mode onto governance enforced and D0 when caller matches", () => {
    const decision = adaptAccessControlDecision({
      decision: {
        allowed: false,
        reason: "explicit-deny",
        mode: "enforce",
        resourceId: "asset-3",
        callerAllowed: false,
      },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: "deny",
      mode: "enforced",
      reason: "explicit-deny",
      shadow: {
        existing: { effect: "deny", source: "access-control" },
        divergence: "D0",
      },
    });
    expect(decision.shadow?.existing).not.toHaveProperty("reason");
  });

  it("toGovernanceModeFromAccessControl maps shadow|enforce without inventing defaults", () => {
    expect(toGovernanceModeFromAccessControl("shadow")).toBe("shadow");
    expect(toGovernanceModeFromAccessControl("enforce")).toBe("enforced");
  });

  it("does not put auth logic or policy reads in the adapter source", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "access-control-adapter.ts"),
      "utf8",
    );
    // Ban call/import symbols (comments may name the plane conceptually).
    expect(source).not.toMatch(
      /authorizeAgentAssetAccess|evaluateAgentAssetAccess|resolveAccessControlMode|loadAccessPolicyStore|listTenantPolicies/,
    );
    expect(source).not.toMatch(/from ["'].*policy-store|from ["'].*policy-v2-evaluator/);
    expect(source).not.toMatch(
      /authorizeAgentInvocation|auditManagementDecision|resolveSecurityProfile|authorizeNodeGovernance/,
    );
    expect(source).not.toMatch(/fabric|constitutional-contracts|aor-core/i);
    expect(source).not.toMatch(/OPENBOT_ACCESS_CONTROL_MODE|OPENCLAW_ACCESS_CONTROL_MODE/);
    expect(source).toContain(ACCESS_CONTROL_SHADOW_ENV);
  });
});

describe("OPENBOT_GOVERNANCE_ACCESS_CONTROL_SHADOW flag", () => {
  it("defaults off and ignores access-control mode env", () => {
    expect(isAccessControlShadowEnabled({})).toBe(false);
    expect(
      isAccessControlShadowEnabled({
        OPENBOT_ACCESS_CONTROL_MODE: "enforce",
        OPENCLAW_ACCESS_CONTROL_MODE: "enforce",
      }),
    ).toBe(false);
    expect(isAccessControlShadowEnabled({ [ACCESS_CONTROL_SHADOW_ENV]: "1" })).toBe(true);
    expect(isAccessControlShadowEnabled({ [ACCESS_CONTROL_SHADOW_ENV]: "true" })).toBe(true);
    expect(isAccessControlShadowEnabled({ [ACCESS_CONTROL_SHADOW_ENV]: "0" })).toBe(false);
  });

  it("recordAccessControlShadow is a no-op when flag is off", async () => {
    const result = recordAccessControlShadow({
      decision: {
        allowed: false,
        reason: "no-matching-policy",
        mode: "shadow",
        resourceId: "asset-x",
      },
      env: {},
    });
    expect(result).toBeUndefined();
    expect(appendGovernanceShadowDecisionMock).not.toHaveBeenCalled();
  });

  it("recordAccessControlShadow writes when flag is on", async () => {
    await recordAccessControlShadow({
      decision: {
        allowed: true,
        mode: "shadow",
        resourceId: "asset-y",
        callerAllowed: true,
      },
      env: { [ACCESS_CONTROL_SHADOW_ENV]: "1" },
    });
    expect(appendGovernanceShadowDecisionMock).toHaveBeenCalledTimes(1);
    const envelope = appendGovernanceShadowDecisionMock.mock.calls[0]?.[0];
    expect(envelope).toMatchObject({
      effect: "allow",
      source: "access-control",
      mode: "shadow",
    });
    expect(envelope.decisionId).toMatch(/^gd-/);
  });
});

describe("AccessControlAdapter properties", () => {
  it("source allow→allow, deny→deny; never skipped→allow", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.constantFrom("shadow", "enforce"),
        fc.option(fc.constantFrom("no-matching-policy", "explicit-deny", "asset-missing"), {
          nil: undefined,
        }),
        fc.string({ minLength: 1, maxLength: 24 }),
        (allowed, mode, reason, resourceId) => {
          const decision = adaptAccessControlDecision({
            decision: {
              allowed,
              ...(allowed ? {} : { reason: reason ?? "no-matching-policy" }),
              mode,
              resourceType: "agent_asset",
              resourceId,
              callerAllowed: mode === "shadow" ? true : allowed,
            },
            ts: TS,
            uuid: () => UUID,
          });
          if (allowed) {
            expect(decision.effect).toBe("allow");
          } else {
            expect(decision.effect).toBe("deny");
          }
          expect(decision.effect).not.toBe("skipped");
          expect(decision.source).toBe("access-control");
          expect(decision.mode).toBe(mode === "enforce" ? "enforced" : "shadow");
          expect(decision.decisionId).toMatch(/^gd-/);
          if (mode === "shadow" && !allowed) {
            expect(decision.shadow?.divergence).toBe("D1");
          }
          if (mode === "shadow" && allowed) {
            expect(decision.shadow?.divergence).toBe("D0");
          }
          if (mode === "enforce") {
            expect(decision.shadow?.divergence).toBe("D0");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
