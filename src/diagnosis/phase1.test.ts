import { describe, expect, it } from "vitest";
import {
  createRouteResolutionAdapterStub,
  createSkillInvocationPassthroughAdapter,
  passthroughSkillResolutions,
} from "./adapters.js";
import { passthroughAttributionResolution } from "./attribution-passthrough.js";
import {
  getEvidenceSourceManifest,
  isPhase1Collectable,
  listEvidenceSourceManifests,
} from "./catalog.js";
import { listDiagnoserManifests, PHASE1_DIAGNOSER_IDS } from "./diagnosers.js";
import { loadGoldenDiagnosticRunGraph as loadGraph } from "./fixture-graph.js";
import {
  assertSingleOpenPrimaryFinding,
  computeMergeKey,
  hasScene4MergePredicates,
  shouldOpenNewCase,
} from "./merge.js";
import { buildDiagnosisPlan, planMissingEvidence } from "./planner.js";
import { markInconclusive } from "./run-completion.js";
import { assertDiagnosisTsgoClean, diagnosisTsgoHits, isDiagnosisTsgoHit } from "./tsgo-gate.js";
import { EVIDENCE_SOURCE_IDS, validateDiagnosticRun } from "./types.js";
import type { TrustedTenantContext } from "./types.js";
import {
  attachGovernanceReceipt,
  createGovernanceReceiptRef,
  requireNoVerification,
} from "./verification.js";

const TRUSTED: TrustedTenantContext = { tenantId: "tenant-fixture-a" };

describe("Phase 1 increment 1 — registry, planner, merge, verification", () => {
  it("catalogs every frozen Evidence Source and keeps route_resolution reserved", () => {
    const ids = listEvidenceSourceManifests().map((entry) => entry.id);
    expect(ids.toSorted()).toEqual([...EVIDENCE_SOURCE_IDS].toSorted());
    expect(getEvidenceSourceManifest("route_resolution").phase1Safe).toBe(false);
    expect(isPhase1Collectable("route_resolution")).toBe(false);
    expect(isPhase1Collectable("skill_invocation")).toBe(true);
    expect(isPhase1Collectable("doctor_check")).toBe(false);
  });

  it("registers the four slice Diagnosers with mutation none and zero model calls", () => {
    const ids = listDiagnoserManifests().map((entry) => entry.id);
    expect(ids).toEqual([...PHASE1_DIAGNOSER_IDS]);
    for (const manifest of listDiagnoserManifests()) {
      expect(manifest.mutation).toBe("none");
      expect(manifest.cost.modelCalls).toBe(0);
    }
  });

  it("builds QUICK and TARGETED plans without claiming route evidence exists", () => {
    const quick = buildDiagnosisPlan({ runId: "diag-run-quick", mode: "QUICK" });
    expect(quick.steps.map((step) => step.stepId)).toEqual([
      "step-q1",
      "step-q2",
      "step-q3",
      "step-q5",
    ]);
    const targeted = buildDiagnosisPlan({
      runId: "diag-run-targeted",
      mode: "TARGETED",
      toolTargetSpecified: true,
    });
    expect(targeted.steps.map((step) => step.stepId)).toContain("step-q4");
    expect(targeted.steps.map((step) => step.stepId)).toContain("step-t1");
    expect(planMissingEvidence(quick).every((req) => req.source === "route_resolution")).toBe(true);
  });

  it("returns empty + missing from the reserved route adapter", async () => {
    const adapter = createRouteResolutionAdapterStub();
    expect(adapter.phase1Safe).toBe(false);
    const result = await adapter.collect(
      {
        schemaVersion: 1,
        evidenceType: "event",
        source: "route_resolution",
        targetType: "session",
        fields: ["matchedBy"],
        sensitivity: "internal",
        cost: "low",
        required: true,
      },
      TRUSTED,
    );
    expect(result.evidences).toEqual([]);
    expect(result.missing[0]?.source).toBe("route_resolution");
  });

  it("passes through skill attributionResolution and never defaults to identity_tool_name", () => {
    expect(passthroughAttributionResolution(undefined)).toBe("unknown");
    expect(passthroughAttributionResolution("")).toBe("unknown");
    expect(passthroughAttributionResolution("unique_owner")).toBe("unique_owner");
    expect(
      passthroughSkillResolutions([{}, { attributionResolution: "prompt_named_use" }]),
    ).toEqual(["unknown", "prompt_named_use"]);
    expect(createSkillInvocationPassthroughAdapter().phase1Safe).toBe(true);
  });

  it("merges scene 4 timeout + agent failure + user retry on one mergeKey", () => {
    const graph = loadGraph("tool-timeout-user-retry.json");
    const caseRow = graph.case;
    const finding = graph.findings[0];
    expect(finding).toBeDefined();
    const mergeKey = computeMergeKey({
      tenantId: "tenant-fixture-a",
      sessionKeyHash: "sha256:fixture-session-key-a0000000000000000000000000000004",
      fingerprint: "skill_tool|tool_timeout|tool:tool-fixture-web-fetch",
    });
    expect(mergeKey).toBe(caseRow.mergeKey);
    expect(hasScene4MergePredicates(caseRow.mergedObservationPredicates ?? [])).toBe(true);
    assertSingleOpenPrimaryFinding(graph.findings);
    expect(
      shouldOpenNewCase({
        existingMergeKey: mergeKey,
        candidateMergeKey: mergeKey,
        sameSessionKeyHash: true,
      }),
    ).toBe(false);
    expect(
      shouldOpenNewCase({
        existingMergeKey: mergeKey,
        candidateMergeKey: computeMergeKey({
          tenantId: "tenant-fixture-a",
          sessionKeyHash: "sha256:fixture-session-key-a0000000000000000000000000000002",
          fingerprint: "skill_tool|skill_not_triggered|skill:skill-fixture-lookup",
        }),
        sameSessionKeyHash: false,
      }),
    ).toBe(true);
  });

  it("treats INCONCLUSIVE as a completed run with null verification", () => {
    const graph = loadGraph("inconclusive-missing-route-evidence.json");
    const run = validateDiagnosticRun(graph.run, TRUSTED);
    expect(run.status).toBe("completed");
    expect(run.completion).toBe("INCONCLUSIVE");
    expect(graph.verification).toBeNull();
    expect(requireNoVerification("INCONCLUSIVE")).toBeNull();
    const marked = markInconclusive(
      { ...run, status: "running", completion: undefined, completedAt: undefined },
      TRUSTED,
      run.missingEvidence,
      run.completedAt,
    );
    expect(marked.status).toBe("completed");
    expect(marked.completion).toBe("INCONCLUSIVE");
  });

  it("writes verification through a governance receipt ref only", () => {
    const graph = loadGraph("tool-timeout-user-retry.json");
    const verification = graph.verification;
    expect(verification).not.toBeNull();
    if (!verification) {
      throw new Error("scene 4 fixture must include verification");
    }
    const receipt = createGovernanceReceiptRef("gov-effect-fixture-4");
    const next = attachGovernanceReceipt(verification, receipt);
    expect(next.measuredOutcome?.authorityRecordId).toBe("gov-effect-fixture-4");
    expect(next.measuredOutcome?.store).toBe("evolution_governance");
    expect(next.measuredOutcome?.baselineSeries).toBeUndefined();
  });

  it("scopes the tsgo merge gate to src/diagnosis and ignores parallel-task errors", () => {
    const sample = [
      "src/wecom/foo.ts(1,1): error TS2322: leftover from another task",
      "src/diagnosis/types.ts(10,3): error TS2345: would fail this gate",
      "ui/src/ui/ports/employee/render-model.ts(8,2): error TS2339: leftover",
    ].join("\n");
    expect(isDiagnosisTsgoHit(sample.split("\n")[0] ?? "")).toBe(false);
    expect(diagnosisTsgoHits(sample)).toEqual([
      "src/diagnosis/types.ts(10,3): error TS2345: would fail this gate",
    ]);
    expect(() => assertDiagnosisTsgoClean(sample)).toThrow(/diagnosis-scoped tsgo failed/);
    expect(() =>
      assertDiagnosisTsgoClean("src/wecom/foo.ts(1,1): error TS2322: leftover"),
    ).not.toThrow();
  });
});
