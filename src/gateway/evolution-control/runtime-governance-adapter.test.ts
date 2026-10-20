import {
  requiredGuardrails,
  runtimeGovernanceMetricSet,
  type EvolutionContext,
  type EvolutionProposal,
} from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import {
  createMemoryRuntimeGovernancePort,
  createRuntimeGovernanceAdapter,
  runtimeSkillInvocationInWindow,
  surfaceAllowsRuntimeApply,
  type RuntimeAgentView,
  type RuntimeGovernanceCandidate,
} from "./adapters/runtime-governance.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { TEST_ALLOWED_ACTIONS, testObservation } from "./test-support.js";

const TENANT_A = "tenant-fixture-a";
const AGENT_ID = "bot-runtime";

function inspector(): EvolutionAuthorizationInspector {
  return {
    inspect: () => ({
      grantId: "grant-1",
      status: "APPROVED",
      tenantScope: TENANT_A,
      allowedEvidence: ["ev-a"],
      allowedActions: [...TEST_ALLOWED_ACTIONS],
      confidentialityCeiling: "enterprise",
    }),
  };
}

function agentView(): RuntimeAgentView {
  return {
    runtimeAgentId: AGENT_ID,
    version: "seed",
    bindings: [
      { bindingId: "bind-keep-off", state: "disabled" },
      { bindingId: "bind-active", state: "active" },
    ],
  };
}

function proposal(over: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: "evo:runtime-1",
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "case-runtime",
    target: { domain: "system", componentId: AGENT_ID },
    candidateRef: "cand:runtime-1",
    surfaceId: "system.runtime-binding-governance",
    expectedEffects: [
      {
        metricId: "governance_human_intervention_rate",
        improveWhen: "decrease",
        minimumEffect: 0.02,
      },
    ],
    riskLevel: "critical",
    confidentialityScope: "enterprise",
    tenantScope: TENANT_A,
    grantId: "grant-1",
    status: "APPROVED_FOR_EXPERIMENT",
    createdAt: "2026-09-06T10:00:00.000Z",
    expiresAt: "2026-09-06T12:00:00.000Z",
    ...over,
  };
}

const freeze = {
  baselineVersion: "runtime:bot-runtime:bind-keep-off:disabled,bind-active:active",
  candidateVersion: "cand:runtime-1",
  codeSha: "sha-fixture",
  modelRef: "model-fixture",
  providerVersion: "provider-fixture",
  configSnapshotRef: "cfg-fixture",
  datasetOrCohortRef: "cohort-a",
  tenantScope: TENANT_A,
  confidentialityScope: "enterprise" as const,
  expiresAt: "2026-09-07T00:00:00.000Z",
  maxResourceBudget: 1,
};

function runtimeCandidate(): RuntimeGovernanceCandidate {
  return {
    kind: "runtime-action",
    runtimeAgentId: AGENT_ID,
    action: "pause",
    candidateVersion: "cand:runtime-1",
  };
}

function planeWith(
  seed: {
    mode?: "off" | "assist" | "auto";
    killSwitch?: boolean;
    agents?: RuntimeAgentView[];
  } = {},
) {
  const port = createMemoryRuntimeGovernancePort({
    mode: seed.mode ?? "assist",
    killSwitch: seed.killSwitch ?? false,
    agents: seed.agents ?? [agentView()],
  });
  const adapter = createRuntimeGovernanceAdapter(port);
  return {
    port,
    adapter,
    plane: createEvolutionControlPlane({
      inspector: inspector(),
      workingDnaAdapter: createWorkingDnaAdapter({} as OpenBotConfig),
      runtimeGovernanceAdapter: adapter,
      observationProvider: testObservation(),
      now: () => "2026-09-06T11:00:00.000Z",
    }),
  };
}

async function runExperiment(
  plane: ReturnType<typeof planeWith>["plane"],
  registered: EvolutionProposal,
  commandPrefix: string,
) {
  plane.registerProposal(registered, runtimeCandidate());
  const experiment = await plane.startExperiment({
    commandId: `${commandPrefix}-exp`,
    proposalId: registered.proposalId,
    freeze,
    now: "2026-09-06T11:00:00.000Z",
  });
  const evaluated = await plane.evaluateExperiment(experiment.experimentId);
  return { experiment, evaluated };
}

function contextFor(portMode: "assist" | "auto" = "assist"): {
  port: ReturnType<typeof createMemoryRuntimeGovernancePort>;
  adapter: ReturnType<typeof createRuntimeGovernanceAdapter>;
  context: EvolutionContext;
} {
  const { port, adapter } = planeWith({ mode: portMode });
  const registered = proposal();
  const context: EvolutionContext = {
    proposal: registered,
    experiment: {
      schemaVersion: 1,
      experimentId: "exp:runtime",
      proposalId: registered.proposalId,
      surfaceId: registered.surfaceId,
      target: registered.target,
      tenantScope: registered.tenantScope,
      baselineRef: freeze.baselineVersion,
      candidateRef: freeze.candidateVersion,
      configRef: freeze.configSnapshotRef,
      assignment: {
        strategy: "canary",
        treatmentRefs: ["t1"],
        controlRefs: ["c1"],
      },
      primaryMetric: runtimeGovernanceMetricSet().primary,
      guardrailMetrics: requiredGuardrails(),
      minimumSampleSize: 20,
      requiredConfidence: 0.9,
      expiresAt: freeze.expiresAt,
      result: "pending",
      frozen: freeze,
    },
    grantId: "grant-1",
    tenantScope: TENANT_A,
    surfaceId: "system.runtime-binding-governance",
    commandId: "cmd-runtime",
  };
  return { port, adapter, context };
}

describe("runtime governance adapter", () => {
  it("keeps apply closed on the current surface and assist mode", async () => {
    expect(surfaceAllowsRuntimeApply()).toBe(true);
    const { adapter, context } = contextFor("assist");
    const denied = await adapter.validate(
      {
        kind: "runtime-action",
        runtimeAgentId: AGENT_ID,
        action: "pause",
        candidateVersion: "cand:runtime-1",
      },
      context,
    );
    expect(denied).toEqual({
      ok: false,
      code: "assist_zero_mutation",
      reason: "assist mode cannot mutate runtime through evolution",
    });
    const snapshot = await adapter.inspect({ domain: "system", componentId: AGENT_ID });
    expect(snapshot.sourceOfTruth).toBe("src/gateway/evolution-governance/runtime-actions.ts");
  });

  it("refuses kill-switch changes and any mutation while the switch is on", async () => {
    const { adapter, context } = contextFor("auto");
    const disable = await adapter.validate(
      { kind: "set-kill-switch", active: false, candidateVersion: "cand:ks" },
      context,
    );
    expect(disable.ok).toBe(false);
    if (disable.ok) {
      throw new Error("expected kill switch change to be refused");
    }
    expect(disable.reason).toMatch(/cannot change the governance kill switch/);

    const armed = planeWith({ mode: "auto", killSwitch: true });
    const blocked = await armed.adapter.validate(
      {
        kind: "runtime-action",
        runtimeAgentId: AGENT_ID,
        action: "pause",
        candidateVersion: "cand:runtime-1",
      },
      context,
    );
    expect(blocked).toEqual({
      ok: false,
      code: "kill_switch_active",
      reason: "kill switch blocks runtime mutation",
    });
  });

  it("compare-and-restore only reverts bindings this action changed", () => {
    const port = createMemoryRuntimeGovernancePort({
      mode: "auto",
      agents: [agentView()],
    });
    const snapshot = port.applyAction({ runtimeAgentId: AGENT_ID, action: "pause" });
    expect(snapshot.changedBindingIds).toEqual(["bind-active"]);
    expect(port.inspect(AGENT_ID)?.bindings).toEqual([
      { bindingId: "bind-keep-off", state: "disabled" },
      { bindingId: "bind-active", state: "disabled" },
    ]);
    port.restore(snapshot);
    expect(port.inspect(AGENT_ID)?.bindings).toEqual([
      { bindingId: "bind-keep-off", state: "disabled" },
      { bindingId: "bind-active", state: "active" },
    ]);
  });

  it("control plane can experiment but ordinary proposals cannot apply runtime actions", async () => {
    const { plane } = planeWith({ mode: "auto" });
    const { experiment } = await runExperiment(plane, proposal(), "runtime");
    expect(experiment.primaryMetric.metricId).toBe("governance_human_intervention_rate");
    await expect(
      plane.applyRuntimeGovernance({
        commandId: "apply-pause",
        proposalId: "evo:runtime-1",
        experimentId: experiment.experimentId,
        principalRef: "ent-admin",
        trustedTenantId: TENANT_A,
        scope: "canary",
      }),
    ).rejects.toThrow(/platform approval/);
    expect(plane.getProposal("evo:runtime-1")?.status).toBe("EXPERIMENTING");
  });

  it("observeTarget emits real P95 and measured criticals, not average latency", async () => {
    const adapter = createRuntimeGovernanceAdapter(
      createMemoryRuntimeGovernancePort({
        mode: "assist",
        agents: [agentView()],
        effectsByAgent: {
          [AGENT_ID]: {
            humanInterventionRate: 0.25,
            sampleSize: 20,
            skillSuccessRate: 0.8,
            p95LatencyMs: 90,
            securityViolations: 0,
            crossTenantContamination: 0,
          },
        },
      }),
    );
    const measured = await adapter.observeTarget?.(
      { domain: "system", componentId: AGENT_ID },
      "w",
      {
        windowId: "w",
        experimentId: "e",
        phase: "baseline",
        startedAt: "2026-09-06T11:05:00.000Z",
        endedAt: "2026-09-06T11:10:00.000Z",
        tenantScope: TENANT_A,
        targetKey: `system:${AGENT_ID}`,
        modelRevision: "m",
        configRevision: "c",
        cohortRef: "co",
      },
    );
    expect(measured).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricId: "governance_human_intervention_rate",
          value: 0.25,
          sampleSize: 20,
        }),
        expect.objectContaining({ metricId: "p95_latency", value: 90, sampleSize: 20 }),
        expect.objectContaining({ metricId: "security_violations", value: 0, sampleSize: 20 }),
        expect.objectContaining({
          metricId: "cross_tenant_contamination",
          value: 0,
          sampleSize: 20,
        }),
      ]),
    );
    expect(measured?.find((row) => row.metricId === "p95_latency")?.value).not.toBe(45);
  });

  it("excludes unlabeled skill events from treatment and keeps matching experiment IDs", () => {
    const unlabeled = {
      type: "skill_invocation_completed",
      completedAt: Date.parse("2026-09-06T11:06:00.000Z"),
      outcome: "success",
    };
    const labeled = {
      ...unlabeled,
      experimentId: "exp-runtime",
    };
    const other = {
      ...unlabeled,
      experimentId: "exp-other",
    };
    const window = {
      startedAt: Date.parse("2026-09-06T11:05:00.000Z"),
      endedAt: Date.parse("2026-09-06T11:10:00.000Z"),
      experimentId: "exp-runtime",
    };
    expect(runtimeSkillInvocationInWindow(unlabeled, { ...window, phase: "treatment" })).toBe(
      false,
    );
    expect(runtimeSkillInvocationInWindow(labeled, { ...window, phase: "treatment" })).toBe(true);
    expect(runtimeSkillInvocationInWindow(other, { ...window, phase: "treatment" })).toBe(false);
    expect(runtimeSkillInvocationInWindow(unlabeled, { ...window, phase: "baseline" })).toBe(true);
    expect(runtimeSkillInvocationInWindow(labeled, { ...window, phase: "baseline" })).toBe(true);
    expect(runtimeSkillInvocationInWindow(other, { ...window, phase: "baseline" })).toBe(false);
  });
});
