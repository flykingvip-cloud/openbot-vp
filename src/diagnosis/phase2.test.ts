import { describe, expect, it } from "vitest";
import {
  PHASE2_DIAGNOSER_IDS,
  PHASE2_FORBIDDEN_OPS,
  assertDoctorCheckNotRepair,
  createChannelHealthReadAdapter,
  createDoctorCheckContractAdapter,
  createDoctorCheckReadAdapter,
  createRuntimeHealthReadAdapter,
  evaluateChannelHealthReadOnly,
  isPhase2Diagnoser,
  isPhase2Readable,
  listPhase2DiagnoserManifests,
  listPhase2Diagnosers,
} from "./phase2.js";
import { buildDiagnosisPlan } from "./planner.js";
import type { DiagnoserContext, TrustedTenantContext } from "./types.js";

const TRUSTED: TrustedTenantContext = { tenantId: "tenant-fixture-a" };

describe("Phase 2 increment 1 — Runtime / Channel / Doctor read-only", () => {
  it("registers the three Phase 2 Diagnosers off the QUICK path", () => {
    expect(listPhase2DiagnoserManifests().map((manifest) => manifest.id)).toEqual([
      ...PHASE2_DIAGNOSER_IDS,
    ]);
    for (const manifest of listPhase2DiagnoserManifests()) {
      expect(manifest.mutation).toBe("none");
      expect(manifest.cost.modelCalls).toBe(0);
      expect(manifest.modes.includes("QUICK")).toBe(false);
      expect(isPhase2Diagnoser(manifest.id)).toBe(true);
    }
    const quick = buildDiagnosisPlan({ runId: "diag-run-quick", mode: "QUICK" });
    const targeted = buildDiagnosisPlan({
      runId: "diag-run-targeted",
      mode: "TARGETED",
      toolTargetSpecified: true,
    });
    const full = buildDiagnosisPlan({
      runId: "diag-run-full",
      mode: "FULL",
      toolTargetSpecified: true,
    });
    expect(quick.steps.some((step) => isPhase2Diagnoser(step.diagnoserId ?? ""))).toBe(false);
    expect(targeted.steps.some((step) => isPhase2Diagnoser(step.diagnoserId ?? ""))).toBe(false);
    expect(full.steps.map((step) => step.diagnoserId)).toEqual(
      expect.arrayContaining([...PHASE2_DIAGNOSER_IDS]),
    );
    expect(full.steps.map((step) => step.stepId)).toEqual(
      expect.arrayContaining(["step-f1", "step-f2", "step-f3"]),
    );
    for (const manifest of listPhase2DiagnoserManifests()) {
      expect(manifest.modes).toEqual(["TARGETED", "FULL"]);
    }
  });

  it("exposes Phase 2 diagnose() without repair or restart fields", async () => {
    const context = {
      schemaVersion: 1,
      run: { runId: "diag-run-phase2" },
      targets: [],
      evidence: [],
      trusted: TRUSTED,
    } as unknown as DiagnoserContext;
    for (const diagnoser of listPhase2Diagnosers()) {
      const result = await diagnoser.diagnose(context);
      expect(result.findingDrafts).toEqual([]);
      expect(result.nextEvidenceRequests.length).toBeGreaterThan(0);
      expect(result).not.toHaveProperty("doctorFix");
      expect(result).not.toHaveProperty("remediationExecute");
    }
  });

  it("reads runtime health through the Phase 2 adapter without treating L1 as RCA", async () => {
    const result = await createRuntimeHealthReadAdapter({
      agentId: "agent-fixture-main",
      modelConfigured: false,
      boundChannels: [],
    }).collect(
      {
        schemaVersion: 1,
        evidenceType: "snapshot",
        source: "agent_runtime_health",
        targetType: "agent",
        fields: ["health"],
        sensitivity: "internal",
        cost: "low",
        required: true,
      },
      TRUSTED,
    );
    expect(result.evidences[0]?.summary.notPerRunRca).toBe(true);
    expect(result.evidences[0]?.source).toBe("agent_runtime_health");
  });

  it("collects Doctor rows only through runDoctorChecks", async () => {
    const result = await createDoctorCheckContractAdapter({
      config: { gateway: { mode: "local" } },
      env: {},
    }).collect(
      {
        schemaVersion: 1,
        evidenceType: "config_check",
        source: "doctor_check",
        targetType: "gateway",
        fields: ["checkId", "verdict"],
        sensitivity: "restricted",
        cost: "medium",
        required: true,
      },
      TRUSTED,
    );
    expect(result.evidences.some((evidence) => evidence.summary.checkId === "gateway-mode")).toBe(
      true,
    );
    expect(() =>
      createDoctorCheckContractAdapter({ config: {}, env: {} }, { repair: true }),
    ).toThrow(/refuses repair/);
  });

  it("reads channel health via evaluateChannelHealth and never restart ops", async () => {
    expect(PHASE2_FORBIDDEN_OPS).toContain("startChannel");
    expect(PHASE2_FORBIDDEN_OPS).toContain("stopChannel");
    const input = {
      channelId: "telegram",
      accountId: "acct-fixture",
      snapshot: { running: false, enabled: true, configured: true },
      policy: {
        channelId: "telegram",
        now: Date.parse("2026-09-02T00:00:00.000Z"),
        staleEventThresholdMs: 30 * 60_000,
        channelConnectGraceMs: 120_000,
      },
    };
    expect(evaluateChannelHealthReadOnly(input)).toEqual({
      healthy: false,
      reason: "not-running",
    });
    const result = await createChannelHealthReadAdapter(input).collect(
      {
        schemaVersion: 1,
        evidenceType: "snapshot",
        source: "channel_health",
        targetType: "channel",
        fields: ["healthy", "reason"],
        sensitivity: "internal",
        cost: "low",
        required: true,
      },
      TRUSTED,
    );
    expect(result.evidences[0]?.summary.reason).toBe("not-running");
    expect(result.evidences[0]?.summary.healthy).toBe(false);
    expect(isPhase2Readable("channel_health")).toBe(true);
  });

  it("accepts injected doctor check rows and refuses repair/fix flags", async () => {
    expect(() => assertDoctorCheckNotRepair({ repair: true })).toThrow(/refuses repair/);
    expect(() => assertDoctorCheckNotRepair({ fix: true })).toThrow(/refuses repair/);
    expect(() => assertDoctorCheckNotRepair({})).not.toThrow();
    const result = await createDoctorCheckReadAdapter([
      { checkId: "gateway-bind", verdict: "pass", pathLabel: "gateway.bind" },
    ]).collect(
      {
        schemaVersion: 1,
        evidenceType: "config_check",
        source: "doctor_check",
        targetType: "gateway",
        fields: ["checkId", "verdict"],
        sensitivity: "restricted",
        cost: "medium",
        required: true,
      },
      TRUSTED,
    );
    expect(result.evidences[0]?.summary.verdict).toBe("pass");
    expect(result.evidences[0]?.source).toBe("doctor_check");
  });
});
