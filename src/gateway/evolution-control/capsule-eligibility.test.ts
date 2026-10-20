import type { GroupMemoryCapsule } from "@openbot/collaboration-core";
import {
  capsuleEligibilityFromStoredFields,
  projectCapsuleObservationView,
} from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import {
  capsuleObservationEligibility,
  createCapsuleAdapter,
  createCapsuleEligibilityReader,
  createMemoryCapsuleStore,
  deriveCapsuleClusterRecurrences,
} from "./adapters/capsule.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane } from "./control-plane.js";
import { TEST_ALLOWED_ACTIONS, testObservation } from "./test-support.js";

const GROUP_ID = "group-elig";

function capsule(
  over: Partial<GroupMemoryCapsule> & Pick<GroupMemoryCapsule, "capsuleId">,
): GroupMemoryCapsule {
  return {
    groupId: GROUP_ID,
    capsuleType: "lesson",
    status: "candidate",
    reusability: "group_only",
    sensitivity: "internal",
    createdBy: "bot",
    createdAt: 1,
    updatedAt: 1,
    summary: "retry timeouts before escalating",
    ...over,
  };
}

describe("capsule legacy observation eligibility", () => {
  it("excludes legacy capsules from the statistical denominator", () => {
    const legacy = capsule({ capsuleId: "legacy" });
    const native = capsule({
      capsuleId: "native",
      createdAt: 2,
      metadata: {
        failureClusterRef: "failure:collaboration:timeout:v1",
        clusterProvenance: "native",
      },
    });
    const laterNative = capsule({
      capsuleId: "later-native",
      createdAt: 3,
      capsuleType: "anti_pattern",
      metadata: {
        failureClusterRef: "failure:collaboration:timeout:v1",
        clusterProvenance: "native",
      },
    });
    expect(deriveCapsuleClusterRecurrences([legacy, native, laterNative], "legacy")).toEqual([]);
    expect(deriveCapsuleClusterRecurrences([legacy, native, laterNative], "native")).toHaveLength(
      1,
    );
  });

  it("does not let identical sourceIds stand in for failureClusterRef", () => {
    const original = capsule({
      capsuleId: "src-a",
      sourceIds: ["finding-1"],
    });
    const later = capsule({
      capsuleId: "src-b",
      createdAt: 2,
      sourceIds: ["finding-1"],
      capsuleType: "anti_pattern",
    });
    expect(deriveCapsuleClusterRecurrences([original, later], "src-a")).toEqual([]);
    expect(capsuleObservationEligibility(original).eligible).toBe(false);
  });

  it("does not infer clusters from embeddings or generic tool_error buckets", () => {
    const inferred = capsule({
      capsuleId: "embed",
      metadata: {
        failureClusterRef: "failure:collaboration:timeout:v1",
        clusterProvenance: "native",
        inferredFromEmbedding: true,
      },
    });
    expect(capsuleObservationEligibility(inferred).eligible).toBe(false);
    const generic = capsule({
      capsuleId: "tool-error",
      metadata: {
        failureClusterRef: "failure:skill-invocation:tool_error:v1",
        clusterProvenance: "native",
      },
    });
    expect(capsuleObservationEligibility(generic)).toEqual({
      eligible: false,
      reason: "untrusted_cluster_reference",
    });
    const runFailed = capsule({
      capsuleId: "run-failed",
      metadata: {
        failureClusterRef: "failure:skill-invocation:run_failed:v1",
        clusterProvenance: "native",
      },
    });
    expect(capsuleObservationEligibility(runFailed).eligible).toBe(false);
  });

  it("does not auto-cluster from similar titles or bodies", () => {
    const original = capsule({
      capsuleId: "text-a",
      summary: "retry timeouts before escalating",
    });
    const later = capsule({
      capsuleId: "text-b",
      createdAt: 2,
      summary: "retry timeouts before escalating",
      capsuleType: "anti_pattern",
    });
    expect(deriveCapsuleClusterRecurrences([original, later], "text-a")).toEqual([]);
  });

  it("lets a native cluster participate and ignores mixed legacy rows", () => {
    const legacy = capsule({ capsuleId: "mix-legacy", createdAt: 1 });
    const native = capsule({
      capsuleId: "mix-native",
      createdAt: 2,
      metadata: {
        failureClusterRef: "failure:collaboration:timeout:v1",
        clusterProvenance: "native",
      },
    });
    const laterLegacySameText = capsule({
      capsuleId: "mix-later-legacy",
      createdAt: 3,
      summary: native.summary,
      sourceIds: ["finding-1"],
      capsuleType: "anti_pattern",
    });
    const laterNative = capsule({
      capsuleId: "mix-later-native",
      createdAt: 4,
      capsuleType: "anti_pattern",
      metadata: {
        failureClusterRef: "failure:collaboration:timeout:v1",
        clusterProvenance: "native",
      },
    });
    const recurrences = deriveCapsuleClusterRecurrences(
      [legacy, native, laterLegacySameText, laterNative],
      "mix-native",
    );
    expect(recurrences).toHaveLength(1);
    expect(recurrences[0]?.clusterRef).toBe("failure:collaboration:timeout:v1");
  });

  it("does not map unavailable to improved or 0% recurrence", () => {
    const eligibility = capsuleEligibilityFromStoredFields({ metadata: {} });
    const view = projectCapsuleObservationView({
      eligibility,
      nativeRecurrenceRate: 0,
    });
    expect(view.availability).toBe("unavailable");
    expect(view.recurrenceRate).toBeNull();
    expect(view.label).not.toMatch(/0%/);
  });

  it("does not treat a task instance id as a native failure cluster", () => {
    const stored = capsule({
      capsuleId: "task-instance",
      metadata: {
        failureClusterRef: "task:group-elig:r1",
        clusterProvenance: "native",
      },
    });
    expect(capsuleObservationEligibility(stored)).toEqual({
      eligible: false,
      reason: "untrusted_cluster_reference",
    });
    expect(deriveCapsuleClusterRecurrences([stored], "task-instance")).toEqual([]);
  });

  it("does not treat a cluster ref without native provenance as eligible", () => {
    const stored = capsule({
      capsuleId: "no-prov",
      metadata: { failureClusterRef: "failure:collaboration:timeout:v1" },
    });
    expect(capsuleObservationEligibility(stored)).toEqual({
      eligible: false,
      reason: "insufficient_lineage",
    });
    expect(deriveCapsuleClusterRecurrences([stored], "no-prov")).toEqual([]);
  });

  it("keeps eligibility stable across a store reload without rewriting history", async () => {
    const stored = capsule({
      capsuleId: "reload",
      metadata: { failureClusterRef: "task:g:reload" },
    });
    const first = createMemoryCapsuleStore([stored]);
    const before = await first.readCapsules(GROUP_ID);
    expect(before[0]).toEqual(stored);
    const reader = createCapsuleEligibilityReader(first);
    const firstDecision = await reader(`${GROUP_ID}/reload`);
    const reloaded = createMemoryCapsuleStore(JSON.parse(JSON.stringify(before)));
    const after = await reloaded.readCapsules(GROUP_ID);
    expect(after[0]).toEqual(stored);
    expect(await createCapsuleEligibilityReader(reloaded)(`${GROUP_ID}/reload`)).toEqual(
      firstDecision,
    );
  });

  it("records an exclusion reason without forging a cluster", async () => {
    const legacy = capsule({ capsuleId: "led-legacy" });
    const store = createMemoryCapsuleStore([legacy]);
    const inspector: EvolutionAuthorizationInspector = {
      inspect: () => ({
        grantId: "grant-1",
        status: "APPROVED",
        tenantScope: "tenant-a",
        allowedEvidence: ["ev-a"],
        allowedActions: [...TEST_ALLOWED_ACTIONS],
        confidentialityCeiling: "enterprise",
      }),
    };
    const plane = createEvolutionControlPlane({
      inspector,
      workingDnaAdapter: createWorkingDnaAdapter({} as never),
      capsuleAdapter: createCapsuleAdapter(store),
      observationProvider: testObservation(),
      readCapsuleEligibility: createCapsuleEligibilityReader(store),
    });
    plane.ingestV1(
      {
        schemaVersion: 1,
        proposalId: "evo:led-legacy",
        sourceFindingIds: ["f-1"],
        sourceEvidenceRefs: ["ev-a"],
        tenantScope: "tenant-a",
        targetDomain: "collaboration_capsule",
        proposedChange: { summary: "legacy capsule" },
        expectedEffect: "reduce recurrence",
        riskLevel: "low",
        confidentialityScope: "enterprise",
        status: "APPROVED",
        approvalRequired: true,
        approverScope: "enterprise",
        grantId: "grant-1",
        createdAt: "2026-09-06T10:00:00.000Z",
        expiresAt: "2026-09-06T12:00:00.000Z",
        auditReceipt: "aud:evo:led-legacy",
        candidateRef: "cand:led-legacy",
      },
      { assetId: `${GROUP_ID}/led-legacy` },
    );
    await plane.startExperiment({
      commandId: "exp-led-legacy",
      proposalId: "evo:led-legacy",
      now: "2026-09-06T11:00:00.000Z",
      freeze: {
        baselineVersion: "missing",
        candidateVersion: "cand:led-legacy",
        codeSha: "sha",
        modelRef: "m",
        providerVersion: "p",
        configSnapshotRef: "c",
        datasetOrCohortRef: "co",
        tenantScope: "tenant-a",
        confidentialityScope: "enterprise",
        expiresAt: "2026-09-07T00:00:00.000Z",
        maxResourceBudget: 1,
      },
    });
    const excluded = plane.ledger
      .list({ proposalId: "evo:led-legacy" })
      .filter((row) => row.type === "observation.excluded");
    expect(excluded).toHaveLength(1);
    expect(excluded[0]?.exclusionReason).toBe("legacy_missing_failure_cluster");
    expect(JSON.stringify(excluded[0])).not.toMatch(/failureClusterRef":"[^"]+"/);
  });
});
