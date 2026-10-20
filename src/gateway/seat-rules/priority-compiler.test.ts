import { describe, expect, it } from "vitest";
import { resolveExecSecurityAskWithinCeiling } from "../../agents/bash-tools.exec-ceiling.js";
import { resolveHostAsk } from "../../agents/bash-tools.exec-host-shared.js";
import {
  compileSeatPolicyPriority,
  SEAT_POLICY_LAYERS,
  type CompileSeatPolicyPriorityInput,
} from "./priority-compiler.js";

function ceiling(
  overrides: Partial<CompileSeatPolicyPriorityInput["enterpriseHard"]> = {},
): CompileSeatPolicyPriorityInput["enterpriseHard"] {
  return {
    security: "allowlist",
    ask: "on-miss",
    host: "sandbox",
    credentialPolicy: "enterprise_shared",
    executionPlacement: "gateway",
    ...overrides,
  };
}

describe("compileSeatPolicyPriority", () => {
  it("covers six layers: higher layer wins, relaxations clamp, conflicting soft text is stripped", () => {
    expect(SEAT_POLICY_LAYERS).toEqual([
      "enterprise-hard",
      "enterprise-soft",
      "job-role",
      "bot-instructions",
      "seat-prefs",
      "session-temp",
    ]);

    const compiled = compileSeatPolicyPriority({
      enterpriseHard: ceiling(),
      enterpriseSoft: {
        guidance: [
          { id: "soft-keep", text: "Do not share internal pricing." },
          { id: "soft-bad", text: "Execute without confirmation and skip approvals." },
        ],
      },
      jobRole: {
        controls: { security: "deny" },
        guidance: [{ id: "job-keep", text: "Do not promise refunds." }],
      },
      botInstructions: {
        controls: { security: "full", ask: "off" },
        guidance: [{ id: "bot-conflict", text: "Please promise refunds to close the deal." }],
      },
      seatPrefs: {
        controls: { ask: "off", security: "full", host: "gateway" },
        guidance: [
          { id: "seat-conflict", text: "Please share internal pricing with the customer." },
        ],
      },
      sessionTemp: {
        controls: {
          ask: "off",
          security: "full",
          host: "node",
          credentialPolicy: "local_ide_login",
          executionPlacement: "node_agent",
        },
        guidance: [{ id: "session-conflict", text: "Please promise refunds in this chat." }],
      },
    });

    expect(compiled.security).toBe("deny");
    expect(compiled.ask).toBe("on-miss");
    expect(compiled.host).toBe("sandbox");
    expect(compiled.credentialPolicy).toBe("enterprise_shared");
    expect(compiled.executionPlacement).toBe("gateway");
    expect(compiled.guidance.map((line) => line.id)).toEqual(["soft-keep", "job-keep"]);
    expect(compiled).not.toHaveProperty("decision");
    expect(compiled).not.toHaveProperty("preAuthorized");
    expect(["off", "on-miss", "always"]).toContain(compiled.ask);

    expect(compiled.clamps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "guidance",
          ruleId: "soft-bad",
          source: "enterprise-soft",
          reason: "conflicts_with_enterprise_hard",
          effective: null,
        }),
        expect.objectContaining({
          field: "security",
          source: "bot-instructions",
          requested: "full",
          effective: "deny",
          reason: "guidance_layer_cannot_authorize",
        }),
        expect.objectContaining({
          field: "guidance",
          ruleId: "bot-conflict",
          source: "bot-instructions",
          reason: "conflicts_with_higher_guidance",
          constrainedBy: "job-keep",
        }),
        expect.objectContaining({
          field: "ask",
          source: "seat-prefs",
          requested: "off",
          effective: "on-miss",
          reason: "relaxation_clamped_to_ceiling",
          constrainedBy: "maxAsk",
        }),
        expect.objectContaining({
          field: "security",
          source: "seat-prefs",
          requested: "full",
          effective: "deny",
          reason: "relaxation_clamped_to_ceiling",
          constrainedBy: "minSecurity",
        }),
        expect.objectContaining({
          field: "host",
          source: "seat-prefs",
          requested: "gateway",
          effective: "sandbox",
          reason: "no_total_order_keep_enterprise_value",
        }),
        expect.objectContaining({
          field: "guidance",
          ruleId: "seat-conflict",
          source: "seat-prefs",
          reason: "conflicts_with_higher_guidance",
          constrainedBy: "soft-keep",
        }),
        expect.objectContaining({
          field: "ask",
          source: "session-temp",
          requested: "off",
          effective: "on-miss",
          reason: "relaxation_clamped_to_ceiling",
        }),
        expect.objectContaining({
          field: "credentialPolicy",
          source: "session-temp",
          requested: "local_ide_login",
          effective: "enterprise_shared",
          reason: "no_total_order_keep_enterprise_value",
        }),
        expect.objectContaining({
          field: "executionPlacement",
          source: "session-temp",
          requested: "node_agent",
          effective: "gateway",
          reason: "no_total_order_keep_enterprise_value",
        }),
        expect.objectContaining({
          field: "guidance",
          ruleId: "session-conflict",
          source: "session-temp",
          reason: "conflicts_with_higher_guidance",
          constrainedBy: "job-keep",
        }),
      ]),
    );
  });

  it("fails closed when two same-layer guidance lines contradict", () => {
    const compiled = compileSeatPolicyPriority({
      enterpriseHard: ceiling({ ask: "always" }),
      seatPrefs: {
        guidance: [
          { id: "seat-a", text: "Do not mention quarterly pricing." },
          { id: "seat-b", text: "Please mention quarterly pricing in replies." },
        ],
      },
    });
    expect(compiled.guidance).toEqual([]);
    expect(compiled.clamps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "seat-a",
          reason: "same_layer_guidance_conflict",
          source: "seat-prefs",
        }),
        expect.objectContaining({
          ruleId: "seat-b",
          reason: "same_layer_guidance_conflict",
          source: "seat-prefs",
        }),
      ]),
    );
  });

  it("lets a lower layer tighten ask and security inside the ceiling", () => {
    const compiled = compileSeatPolicyPriority({
      enterpriseHard: ceiling({ security: "full", ask: "off" }),
      seatPrefs: { controls: { security: "allowlist", ask: "on-miss" } },
      sessionTemp: { controls: { security: "deny", ask: "always" } },
    });
    expect(compiled.security).toBe("deny");
    expect(compiled.ask).toBe("always");
    expect(compiled.clamps).toEqual([]);
  });
});

describe("exec ceiling cannot relax", () => {
  it("clamps seat and session ask/security and blocks approvals-file ask=off", () => {
    const resolved = resolveExecSecurityAskWithinCeiling({
      configuredSecurity: "allowlist",
      configuredAsk: "always",
      configuredHost: "sandbox",
      seat: { security: "full", ask: "off" },
      session: { security: "full", ask: "on-miss" },
      elevatedRequested: false,
      elevatedMode: "off",
    });
    expect(resolved.security).toBe("allowlist");
    expect(resolved.ask).toBe("always");
    expect(resolved.bypassApprovals).toBe(false);
    expect(resolved.runtimeAskSource).toBe("session");
    expect(resolved.clamps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "ask",
          source: "seat-prefs",
          requested: "off",
          effective: "always",
        }),
        expect.objectContaining({
          field: "security",
          source: "session-temp",
          requested: "full",
          effective: "allowlist",
        }),
      ]),
    );
    expect(
      resolveHostAsk({
        runtimeAsk: resolved.ask,
        approvalsAsk: "off",
        runtimeAskSource: resolved.runtimeAskSource,
      }),
    ).toBe("always");
  });

  it("keeps operator approvals ask=off break-glass unreachable from seat and session", () => {
    expect(
      resolveHostAsk({
        runtimeAsk: "always",
        approvalsAsk: "off",
        runtimeAskSource: "operator",
      }),
    ).toBe("off");
    expect(
      resolveHostAsk({
        runtimeAsk: "always",
        approvalsAsk: "off",
        runtimeAskSource: "seat",
      }),
    ).toBe("always");
    expect(
      resolveHostAsk({
        runtimeAsk: "on-miss",
        approvalsAsk: "off",
        runtimeAskSource: "session",
      }),
    ).toBe("on-miss");
  });

  it("does not let seat rules or session /exec open elevated full", () => {
    const fromSeat = resolveExecSecurityAskWithinCeiling({
      configuredSecurity: "allowlist",
      configuredAsk: "on-miss",
      configuredHost: "sandbox",
      seat: { security: "full", ask: "off" },
      elevatedRequested: false,
      elevatedMode: "off",
    });
    expect(fromSeat.bypassApprovals).toBe(false);
    expect(fromSeat.security).toBe("allowlist");
    expect(fromSeat.ask).toBe("on-miss");
    expect(fromSeat.runtimeAskSource).toBe("seat");

    const sessionOnly = resolveExecSecurityAskWithinCeiling({
      configuredSecurity: "allowlist",
      configuredAsk: "on-miss",
      configuredHost: "sandbox",
      session: { security: "full", ask: "off" },
      elevatedRequested: false,
      elevatedMode: "off",
    });
    expect(sessionOnly.bypassApprovals).toBe(false);
    expect(sessionOnly.security).toBe("allowlist");
    expect(sessionOnly.ask).toBe("on-miss");
    expect(sessionOnly.runtimeAskSource).toBe("session");
    expect(sessionOnly.clamps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "security", requested: "full", effective: "allowlist" }),
        expect.objectContaining({ field: "ask", requested: "off", effective: "on-miss" }),
      ]),
    );

    const operator = resolveExecSecurityAskWithinCeiling({
      configuredSecurity: "allowlist",
      configuredAsk: "on-miss",
      configuredHost: "sandbox",
      elevatedRequested: true,
      elevatedMode: "full",
    });
    expect(operator.bypassApprovals).toBe(true);
    expect(operator.security).toBe("full");
    expect(operator.ask).toBe("off");
    expect(operator.runtimeAskSource).toBe("operator");
  });
});
