import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTrustedExecutionContextForTest } from "../../enterprise-data/enterprise-data-seat-context.js";
import type { EnterpriseDataStore } from "../../enterprise-data/types.js";
import {
  CAPABILITY_INVOKE_ADAPTER_MAPPING,
  type CapabilityInvokeSourceResult,
} from "../execution-entry-registry.js";

const { appendGovernanceShadowDecisionMock, auditManagementDecisionMock } = vi.hoisted(() => ({
  appendGovernanceShadowDecisionMock: vi.fn(),
  auditManagementDecisionMock: vi.fn(),
}));

vi.mock("../shadow-sink.js", () => ({
  appendGovernanceShadowDecision: appendGovernanceShadowDecisionMock,
}));

vi.mock("../../management-governance-audit.js", () => ({
  auditManagementDecision: auditManagementDecisionMock,
}));

import { invokeDataCapabilityWithContext } from "../../enterprise-data/capability-agent-invoke-runtime.js";
import { invokeKnowledgeCapability } from "../../knowledge/capability-invoke-runtime.js";
import {
  adaptCapabilityInvokeOutcome,
  CAPABILITY_INVOKE_SHADOW_ENV,
  isCapabilityInvokeShadowEnabled,
  recordCapabilityInvokeShadow,
} from "./capability-invoke-adapter.js";

const TS = "2026-09-28T02:00:00.000Z";
const UUID = "11111111-1111-4111-8111-111111111111";

function outcomeFor(source: CapabilityInvokeSourceResult) {
  return source === "ok"
    ? {
        ok: true,
        capabilityId: "cap-1",
        tenantId: "tenant-1",
        seatId: "seat-1",
        auditId: "audit-1",
        requestId: "req-1",
        runId: "run-1",
      }
    : {
        ok: false,
        reason: source,
        capabilityId: "cap-1",
        tenantId: "tenant-1",
        seatId: "seat-1",
        auditId: "audit-1",
        requestId: "req-1",
        runId: "run-1",
      };
}

describe("CapabilityInvokeAdapter mapping", () => {
  it.each(CAPABILITY_INVOKE_ADAPTER_MAPPING)("maps $source to $effect with a new gd- id", (row) => {
    const decision = adaptCapabilityInvokeOutcome({
      outcome: outcomeFor(row.source),
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision).toMatchObject({
      effect: row.effect,
      source: "capability",
      mode: "shadow",
      decisionId: `gd-${UUID}`,
      tenantId: "tenant-1",
      actorId: "seat:seat-1",
      requestId: "req-1",
      runId: "run-1",
      subject: { kind: "capability", id: "cap-1" },
      ts: TS,
    });
    expect(decision.decisionId).not.toBe("audit-1");
    if (row.reason === "empty") {
      expect(decision.reason).toBeUndefined();
      expect(row.countsTowardAllowCoverage).toBe(true);
    } else {
      expect(decision.reason).toBe(row.source);
      expect(row.countsTowardAllowCoverage).toBe(false);
    }
    expect(decision.effect === "allow").toBe(row.countsTowardAllowCoverage);
  });

  it("treats ok as the only allow, even when a deny reason is also present", () => {
    const decision = adaptCapabilityInvokeOutcome({
      outcome: { ok: true, reason: "not-authorized", capabilityId: "cap-1" },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision.effect).toBe("allow");
    expect(decision.reason).toBeUndefined();
    expect(decision.source).toBe("capability");
  });

  it("keeps handler-error outside allow coverage", () => {
    const decision = adaptCapabilityInvokeOutcome({
      outcome: { ok: false, reason: "handler-error" },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision.effect).toBe("skipped");
    expect(decision.reason).toBe("handler-error");
    expect(decision.effect).not.toBe("allow");
  });

  it("denies knowledge-object-only", () => {
    const decision = adaptCapabilityInvokeOutcome({
      outcome: { ok: false, reason: "knowledge-object-only" },
      ts: TS,
      uuid: () => UUID,
    });
    expect(decision.effect).toBe("deny");
    expect(decision.reason).toBe("knowledge-object-only");
  });

  it("does not record an unmapped failure as allow", () => {
    const missing = adaptCapabilityInvokeOutcome({
      outcome: { ok: false },
      ts: TS,
      uuid: () => UUID,
    });
    const fakeOk = adaptCapabilityInvokeOutcome({
      outcome: { ok: false, reason: "ok" },
      ts: TS,
      uuid: () => UUID,
    });
    const unknown = adaptCapabilityInvokeOutcome({
      outcome: { ok: false, reason: "policy-missing" },
      ts: TS,
      uuid: () => UUID,
    });
    for (const decision of [missing, fakeOk, unknown]) {
      expect(decision.effect).toBe("skipped");
      expect(decision.source).toBe("capability");
      expect(decision.decisionId.startsWith("gd-")).toBe(true);
    }
    expect(missing.reason).toBe("unmapped-capability-outcome");
    expect(fakeOk.reason).toBe("unmapped-capability-outcome");
    expect(unknown.reason).toBe("policy-missing");
  });

  it("mints a fresh gd- id per call and does not mutate the outcome", () => {
    const outcome = { ok: false, reason: "no-seat" as const, capabilityId: "cap-1" };
    const snapshot = { ...outcome };
    const first = adaptCapabilityInvokeOutcome({ outcome, ts: TS });
    const second = adaptCapabilityInvokeOutcome({ outcome, ts: TS });
    expect(first.decisionId.startsWith("gd-")).toBe(true);
    expect(second.decisionId.startsWith("gd-")).toBe(true);
    expect(first.decisionId).not.toBe(second.decisionId);
    expect(outcome).toEqual(snapshot);
  });

  it("copies the caller's entry (E11 / E12) and stamps none without it", () => {
    const outcome = outcomeFor("not-authorized");
    expect(
      adaptCapabilityInvokeOutcome({ outcome: { ...outcome, entry: "E11" }, ts: TS }),
    ).toMatchObject({ source: "capability", entry: "E11" });
    expect(
      adaptCapabilityInvokeOutcome({ outcome: { ...outcome, entry: "E12" }, ts: TS }),
    ).toMatchObject({ source: "capability", entry: "E12" });
    // Unstamped: the offline reports fall back to the capability → E8 source mapping.
    expect(adaptCapabilityInvokeOutcome({ outcome, ts: TS })).not.toHaveProperty("entry");
  });
});

describe("capability invoke shadow flag", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));

  beforeEach(() => {
    appendGovernanceShadowDecisionMock.mockReset();
    appendGovernanceShadowDecisionMock.mockResolvedValue(true);
    auditManagementDecisionMock.mockReset();
    delete process.env[CAPABILITY_INVOKE_SHADOW_ENV];
  });

  it("stays off unless the opt-in flag is truthy, and does not call management audit", () => {
    const source = fs.readFileSync(path.join(dir, "capability-invoke-adapter.ts"), "utf8");
    const imports = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line))
      .join("\n");
    expect(imports).not.toMatch(/management-governance-audit|auditManagementDecision/);
    expect(imports).not.toMatch(/fabric|constitutional-contracts|aor-core/i);
    expect(source).not.toContain("auditManagementDecision");
    expect(isCapabilityInvokeShadowEnabled({})).toBe(false);
    expect(isCapabilityInvokeShadowEnabled({ [CAPABILITY_INVOKE_SHADOW_ENV]: "0" })).toBe(false);
    expect(isCapabilityInvokeShadowEnabled({ [CAPABILITY_INVOKE_SHADOW_ENV]: "1" })).toBe(true);
    expect(auditManagementDecisionMock).not.toHaveBeenCalled();
  });

  it("does no sink I/O when the flag is off", async () => {
    const outcome = { ok: false, reason: "quota-exceeded" as const, capabilityId: "cap-1" };
    const result = recordCapabilityInvokeShadow({ outcome, env: {} });
    expect(result).toBeUndefined();
    await Promise.resolve();
    expect(appendGovernanceShadowDecisionMock).not.toHaveBeenCalled();
    expect(auditManagementDecisionMock).not.toHaveBeenCalled();
  });

  it("appends the mapped envelope when the flag is on and still skips handler-error", async () => {
    await recordCapabilityInvokeShadow({
      outcome: {
        ok: false,
        reason: "handler-error",
        capabilityId: "cap-1",
        tenantId: "tenant-1",
        actorId: "agent:agent-1",
      },
      env: { [CAPABILITY_INVOKE_SHADOW_ENV]: "1" },
    });
    const envelope = appendGovernanceShadowDecisionMock.mock.calls[0]?.[0];
    expect(envelope).toMatchObject({
      effect: "skipped",
      source: "capability",
      mode: "shadow",
      reason: "handler-error",
      tenantId: "tenant-1",
      actorId: "agent:agent-1",
      subject: { kind: "capability", id: "cap-1" },
      shadow: {
        existing: { effect: "skipped", source: "capability", reason: "handler-error" },
        divergence: "D5",
      },
    });
    expect(String(envelope.decisionId).startsWith("gd-")).toBe(true);
    expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[1]?.env).not.toHaveProperty(
      "OPENBOT_GOVERNANCE_SHADOW_LOG",
    );
    expect(auditManagementDecisionMock).not.toHaveBeenCalled();
  });

  it("appends deny for a frozen deny reason and allow for ok", async () => {
    await recordCapabilityInvokeShadow({
      outcome: { ok: false, reason: "not-authorized", capabilityId: "cap-1" },
      env: { [CAPABILITY_INVOKE_SHADOW_ENV]: "on" },
    });
    await recordCapabilityInvokeShadow({
      outcome: { ok: true, capabilityId: "cap-2" },
      env: { [CAPABILITY_INVOKE_SHADOW_ENV]: "on" },
    });
    expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[0]).toMatchObject({
      effect: "deny",
      reason: "not-authorized",
      shadow: { divergence: "D0" },
    });
    expect(appendGovernanceShadowDecisionMock.mock.calls[1]?.[0]).toMatchObject({
      effect: "allow",
      source: "capability",
      shadow: { existing: { effect: "allow", source: "capability" }, divergence: "D0" },
    });
    expect(appendGovernanceShadowDecisionMock.mock.calls[1]?.[0].reason).toBeUndefined();
    expect(auditManagementDecisionMock).not.toHaveBeenCalled();
  });

  it("swallows sink failures", async () => {
    appendGovernanceShadowDecisionMock.mockRejectedValue(new Error("disk"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      recordCapabilityInvokeShadow({
        outcome: { ok: false, reason: "disabled" },
        env: { [CAPABILITY_INVOKE_SHADOW_ENV]: "yes" },
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("E11/E12 opt-in shadow does not change invoke results", () => {
  beforeEach(() => {
    appendGovernanceShadowDecisionMock.mockReset();
    appendGovernanceShadowDecisionMock.mockResolvedValue(false);
    auditManagementDecisionMock.mockReset();
    delete process.env[CAPABILITY_INVOKE_SHADOW_ENV];
  });

  it("E11 flag off performs no shadow sink call and returns the original outcome", async () => {
    const outcome = await invokeDataCapabilityWithContext({
      store: {} as EnterpriseDataStore,
      context: createTrustedExecutionContextForTest({
        tenantId: "",
        seatId: "",
        employeeId: "emp-1",
        userId: "user-1",
      }),
      capabilityId: "cap-1",
      nowIso: TS,
    });
    expect(outcome).toEqual({
      ok: false,
      capabilityId: "cap-1",
      accessState: "unknown",
      reason: "no-tenant",
    });
    await Promise.resolve();
    expect(appendGovernanceShadowDecisionMock).not.toHaveBeenCalled();
    expect(auditManagementDecisionMock).not.toHaveBeenCalled();
  });

  it("E11 flag on appends deny and returns the same outcome", async () => {
    process.env[CAPABILITY_INVOKE_SHADOW_ENV] = "1";
    try {
      const outcome = await invokeDataCapabilityWithContext({
        store: {} as EnterpriseDataStore,
        context: createTrustedExecutionContextForTest({
          tenantId: "",
          seatId: "",
          employeeId: "emp-1",
          userId: "user-1",
        }),
        capabilityId: "cap-1",
        nowIso: TS,
      });
      expect(outcome).toEqual({
        ok: false,
        capabilityId: "cap-1",
        accessState: "unknown",
        reason: "no-tenant",
      });
      expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[0]).toMatchObject({
        effect: "deny",
        source: "capability",
        entry: "E11",
        reason: "no-tenant",
        subject: { kind: "capability", id: "cap-1" },
      });
      expect(auditManagementDecisionMock).not.toHaveBeenCalled();
    } finally {
      delete process.env[CAPABILITY_INVOKE_SHADOW_ENV];
    }
  });

  it("E12 flag off performs no shadow sink call and returns the original outcome", async () => {
    const outcome = await invokeKnowledgeCapability({
      capabilityId: "cap-1",
      context: {
        tenantId: null,
        seatId: null,
        userId: null,
        hasEnterpriseScope: false,
      },
    });
    expect(outcome).toEqual({
      ok: false,
      capabilityId: "cap-1",
      accessState: "unknown",
      reason: "no-tenant",
    });
    await Promise.resolve();
    expect(appendGovernanceShadowDecisionMock).not.toHaveBeenCalled();
    expect(auditManagementDecisionMock).not.toHaveBeenCalled();
  });

  it("E12 flag on appends deny and returns the same outcome", async () => {
    process.env[CAPABILITY_INVOKE_SHADOW_ENV] = "true";
    try {
      const outcome = await invokeKnowledgeCapability({
        capabilityId: "cap-1",
        context: {
          tenantId: null,
          seatId: "seat-1",
          userId: null,
          hasEnterpriseScope: false,
        },
      });
      expect(outcome).toEqual({
        ok: false,
        capabilityId: "cap-1",
        accessState: "unknown",
        reason: "no-tenant",
      });
      expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[0]).toMatchObject({
        effect: "deny",
        reason: "no-tenant",
        source: "capability",
        entry: "E12",
        actorId: "seat:seat-1",
      });
      expect(auditManagementDecisionMock).not.toHaveBeenCalled();
    } finally {
      delete process.env[CAPABILITY_INVOKE_SHADOW_ENV];
    }
  });
});
