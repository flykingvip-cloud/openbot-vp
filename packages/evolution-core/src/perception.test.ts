import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SurfaceAutonomyPolicy } from "./autonomy.js";
import type { EvolutionSurface } from "./contracts.js";
import {
  EVOLUTION_PERCEPTION_ACCESS,
  EVOLUTION_PERCEPTION_OPERATIONS,
  EvolutionNarrationGuardError,
  assertLearnedNarrationHasFactId,
  narrateDigitalHumanLearned,
  partitionEvolutionTimelineBuckets,
  projectAutomaticActions,
  projectPendingDecisions,
  projectWeeklyEvolutionDigest,
  queryEvolutionPerception,
  renderEvolutionNarration,
} from "./perception.js";
import { getEvolutionSurface } from "./surfaces.js";
import { projectEvolutionTimeline, type EvolutionTimelineListInput } from "./timeline-list.js";
import {
  EVOLUTION_TIMELINE_BUCKETS,
  emptyEvolutionTimelineBucketCounts,
  type EvolutionTimelineItem,
  type EvolutionTimelineLedgerFact,
  type EvolutionTimelineQueryResult,
} from "./timeline.js";
import type {
  DiagnosisProposalV1,
  EvolutionApplication,
  EvolutionProposal,
  EvolutionTarget,
  EvolutionVerification,
} from "./types.js";

const FROM = "2026-09-18T00:00:00.000Z";
const TO = "2026-09-25T00:00:00.000Z";
const WINDOW = { from: FROM, to: TO };

const agentTarget: EvolutionTarget = { domain: "agent", agentId: "bot-1" };
const knowledgeTarget: EvolutionTarget = { domain: "knowledge", assetId: "asset-1" };
const systemTarget: EvolutionTarget = { domain: "system", componentId: "runtime-binding" };

function fact(
  over: Partial<EvolutionTimelineLedgerFact> &
    Pick<EvolutionTimelineLedgerFact, "eventId" | "type">,
): EvolutionTimelineLedgerFact {
  return {
    timestamp: FROM,
    proposalId: "prop-1",
    surfaceId: "agent.working-dna",
    tenantScope: "tenant-a",
    evidenceRefs: ["ev-ledger"],
    target: agentTarget,
    ...over,
  };
}

function proposal(over: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: "prop-1",
    sourceEvidenceRefs: ["ev-proposal"],
    sourceMechanismRef: "mechanism:case-1",
    target: agentTarget,
    candidateRef: "cand-1",
    surfaceId: "agent.working-dna",
    expectedEffects: [],
    riskLevel: "low",
    confidentialityScope: "personal",
    tenantScope: "tenant-a",
    grantId: "grant-1",
    status: "VERIFIED",
    createdAt: FROM,
    expiresAt: "2026-10-25T00:00:00.000Z",
    ...over,
  };
}

function proposalV1(over: Partial<DiagnosisProposalV1> = {}): DiagnosisProposalV1 {
  return {
    schemaVersion: 1,
    proposalId: "prop-pending",
    sourceCaseId: "case-9",
    sourceFindingIds: ["finding-9"],
    sourceEvidenceRefs: [],
    sourceReportRef: "report-9",
    tenantScope: "tenant-a",
    targetDomain: "agent_working_dna",
    proposedChange: { summary: "tune working DNA" },
    expectedEffect: "raise task success",
    riskLevel: "low",
    confidentialityScope: "personal",
    status: "PENDING_APPROVAL",
    approvalRequired: true,
    approverScope: "personal",
    grantId: "grant-v1",
    createdAt: FROM,
    expiresAt: "2026-10-25T00:00:00.000Z",
    auditReceipt: "aud:prop-pending",
    ...over,
  };
}

function application(over: Partial<EvolutionApplication> = {}): EvolutionApplication {
  return {
    schemaVersion: 1,
    applicationId: "app-1",
    proposalId: "prop-1",
    experimentId: "exp-1",
    adapterId: "working-dna",
    idempotencyKey: "idem-1",
    targetVersionBefore: "v1",
    targetVersionAfter: "v2",
    rollbackRef: "rb-1",
    scope: "canary",
    status: "applied",
    appliedToRuntime: true,
    ...over,
  };
}

function verification(over: Partial<EvolutionVerification> = {}): EvolutionVerification {
  return {
    schemaVersion: 1,
    verificationId: "ver-1",
    applicationId: "app-1",
    baselineWindowRef: "base",
    evaluationWindowRef: "eval",
    primaryEffect: 0.1,
    guardrailResults: [],
    sampleSize: 20,
    confidence: 0.95,
    outcome: "improved",
    evidenceRefs: ["ev-ver"],
    verifiedAt: "2026-09-20T00:20:00.000Z",
    ...over,
  };
}

function autoSurface(): EvolutionSurface {
  const base = getEvolutionSurface("agent.working-dna");
  if (!base) {
    throw new Error("agent.working-dna surface missing");
  }
  return { ...base, autoApply: true, riskLevel: "low" };
}

function autoPolicy(): SurfaceAutonomyPolicy {
  return {
    surfaceId: "agent.working-dna",
    mode: "auto",
    maxApplications: 3,
    usedApplications: 1,
    maxImpactScope: "active",
    expiresAt: "2026-10-25T00:00:00.000Z",
  };
}

function approvedTrio(
  proposalId: string,
  applicationId: string,
  verificationId: string,
  approvedAt: string,
  over: Partial<EvolutionTimelineLedgerFact> = {},
): EvolutionTimelineLedgerFact[] {
  const applyAt = new Date(Date.parse(approvedAt) + 60 * 60 * 1000).toISOString();
  const verifiedAt = new Date(Date.parse(approvedAt) + 2 * 60 * 60 * 1000).toISOString();
  return [
    fact({
      eventId: `evt-${proposalId}-ok`,
      type: "application.approved",
      timestamp: approvedAt,
      proposalId,
      applicationId,
      ...over,
    }),
    fact({
      eventId: `evt-${proposalId}-apply`,
      type: "application.applied",
      timestamp: applyAt,
      proposalId,
      applicationId,
      ...over,
    }),
    fact({
      eventId: `evt-${proposalId}-ver`,
      type: "verification.completed",
      timestamp: verifiedAt,
      proposalId,
      applicationId,
      verificationId,
      ...over,
    }),
  ];
}

function weekSequence(): EvolutionTimelineListInput {
  return {
    events: [
      fact({
        eventId: "evt-auto-auth",
        type: "proposal.authorized",
        timestamp: "2026-09-20T00:00:00.000Z",
        proposalId: "prop-auto",
      }),
      fact({
        eventId: "evt-auto-apply",
        type: "application.applied",
        timestamp: "2026-09-20T00:10:00.000Z",
        proposalId: "prop-auto",
        applicationId: "app-auto",
      }),
      fact({
        eventId: "evt-auto-ver",
        type: "verification.completed",
        timestamp: "2026-09-20T00:20:00.000Z",
        proposalId: "prop-auto",
        applicationId: "app-auto",
        verificationId: "ver-auto",
      }),
      ...approvedTrio("prop-user", "app-user", "ver-user", "2026-09-12T00:00:00.000Z"),
      ...approvedTrio("prop-know", "app-know", "ver-know", "2026-09-22T00:00:00.000Z", {
        target: knowledgeTarget,
        surfaceId: "knowledge.experience-capsule",
      }),
      ...approvedTrio("prop-system", "app-system", "ver-system", "2026-09-24T00:00:00.000Z", {
        target: systemTarget,
        surfaceId: "system.runtime-binding-governance",
      }),
      ...approvedTrio("prop-future", "app-future", "ver-future", "2026-09-26T00:00:00.000Z"),
      fact({
        eventId: "evt-pending",
        type: "application.approval_pending",
        timestamp: FROM,
        proposalId: "prop-pending",
        evidenceRefs: [],
      }),
      fact({
        eventId: "evt-pending-end",
        type: "application.approval_pending",
        timestamp: TO,
        proposalId: "prop-pending-end",
        evidenceRefs: [],
      }),
      fact({
        eventId: "evt-prior-pending",
        type: "application.approval_pending",
        timestamp: "2026-09-13T00:00:00.000Z",
        proposalId: "prop-prior-pending",
        evidenceRefs: [],
      }),
      fact({
        eventId: "evt-ancient",
        type: "application.approval_pending",
        timestamp: "2026-09-10T00:00:00.000Z",
        proposalId: "prop-ancient",
        evidenceRefs: [],
      }),
      fact({
        eventId: "evt-other-tenant",
        type: "application.approval_pending",
        timestamp: "2026-09-21T00:00:00.000Z",
        proposalId: "prop-other-tenant",
        tenantScope: "tenant-b",
        evidenceRefs: [],
      }),
      fact({
        eventId: "evt-obs-apply",
        type: "application.applied",
        timestamp: "2026-09-21T00:00:00.000Z",
        proposalId: "prop-obs",
        applicationId: "app-obs",
      }),
      fact({
        eventId: "evt-rb-apply",
        type: "application.applied",
        timestamp: "2026-09-14T00:00:00.000Z",
        proposalId: "prop-rb",
        applicationId: "app-rb",
      }),
      fact({
        eventId: "evt-rb-done",
        type: "rollback.completed",
        timestamp: "2026-09-20T01:00:00.000Z",
        proposalId: "prop-rb",
        applicationId: "app-rb",
      }),
      fact({
        eventId: "evt-ghost",
        type: "proposal.created",
        timestamp: "2026-09-20T03:00:00.000Z",
        proposalId: "prop-ghost",
        target: undefined,
      }),
      fact({
        eventId: "   ",
        type: "proposal.created",
        timestamp: "2026-09-20T04:00:00.000Z",
        proposalId: "prop-blank",
      }),
    ],
    proposals: [
      proposal({ proposalId: "prop-auto", status: "VERIFIED" }),
      proposal({ proposalId: "prop-user", status: "VERIFIED" }),
      proposal({
        proposalId: "prop-know",
        status: "VERIFIED",
        target: knowledgeTarget,
        surfaceId: "knowledge.experience-capsule",
      }),
      proposal({
        proposalId: "prop-system",
        status: "VERIFIED",
        target: systemTarget,
        surfaceId: "system.runtime-binding-governance",
        confidentialityScope: "platform",
      }),
      proposal({ proposalId: "prop-future", status: "VERIFIED" }),
      proposal({ proposalId: "prop-prior-pending", status: "PENDING_AUTHORITY" }),
      proposal({ proposalId: "prop-ancient", status: "PENDING_AUTHORITY" }),
      proposal({
        proposalId: "prop-other-tenant",
        status: "PENDING_AUTHORITY",
        tenantScope: "tenant-b",
      }),
      proposal({ proposalId: "prop-obs", status: "ACTIVE" }),
      proposal({ proposalId: "prop-rb", status: "ROLLED_BACK" }),
      proposal({ proposalId: "prop-ghost", status: "SUGGESTED" }),
    ],
    proposalsV1: [
      proposalV1(),
      proposalV1({
        proposalId: "prop-pending-end",
        auditReceipt: "aud:prop-pending-end",
      }),
    ],
    applications: [
      application({
        applicationId: "app-auto",
        proposalId: "prop-auto",
        idempotencyKey: "idem-auto",
      }),
      application({
        applicationId: "app-user",
        proposalId: "prop-user",
        idempotencyKey: "idem-user",
      }),
      application({
        applicationId: "app-know",
        proposalId: "prop-know",
        idempotencyKey: "idem-know",
      }),
      application({
        applicationId: "app-system",
        proposalId: "prop-system",
        idempotencyKey: "idem-system",
        targetVersionBefore: "gov-1",
        targetVersionAfter: "gov-2",
      }),
      application({
        applicationId: "app-future",
        proposalId: "prop-future",
        idempotencyKey: "idem-future",
      }),
      application({
        applicationId: "app-obs",
        proposalId: "prop-obs",
        idempotencyKey: "idem-obs",
      }),
      application({
        applicationId: "app-rb",
        proposalId: "prop-rb",
        idempotencyKey: "idem-rb",
        status: "rolled_back",
      }),
    ],
    verifications: [
      verification({ verificationId: "ver-auto", applicationId: "app-auto" }),
      verification({ verificationId: "ver-user", applicationId: "app-user" }),
      verification({ verificationId: "ver-know", applicationId: "app-know" }),
      verification({ verificationId: "ver-system", applicationId: "app-system" }),
      verification({ verificationId: "ver-future", applicationId: "app-future" }),
    ],
    surfaces: [autoSurface()],
    autonomyBySurfaceId: {
      "agent.working-dna": { policy: autoPolicy(), killSwitch: false },
    },
  };
}

function ids(items: readonly { factIds: { ledgerEventId: string } }[]): string[] {
  return items.map((item) => item.factIds.ledgerEventId);
}

function proposalIds(items: readonly EvolutionTimelineItem[]): string[] {
  return items.map((item) => item.factIds.proposalId ?? "");
}

function answer(
  intent: string,
  over: { agentId?: string; tenantScope?: string } = {},
): EvolutionTimelineQueryResult {
  const result = queryEvolutionPerception(weekSequence(), {
    tenantScope: over.tenantScope ?? "tenant-a",
    window: WINDOW,
    intent,
    ...(over.agentId ? { agentId: over.agentId } : {}),
  });
  if ("denied" in result) {
    throw new Error(`expected an answer for ${intent}`);
  }
  return result;
}

describe("phase P1 weekly digest", () => {
  it("keeps a traceable fact id on every windowed item and drops untargeted rows", () => {
    const input = weekSequence();
    const digest = projectWeeklyEvolutionDigest(input, {
      window: WINDOW,
      tenantScope: "tenant-a",
    });
    const known = new Set(input.events.map((event) => event.eventId));
    const rows = [
      ...digest.items,
      ...digest.priorItems,
      ...digest.verifiedOrChanged,
      ...digest.platformItems,
      ...digest.deltas.map((delta) => delta.item),
    ];

    expect(rows.length).toBeGreaterThan(0);
    for (const item of rows) {
      expect(item.factIds.ledgerEventId.trim().length).toBeGreaterThan(0);
      expect(known.has(item.factIds.ledgerEventId)).toBe(true);
      expect(item.changeObject.target).toBeTruthy();
      expect(item.proposalSchema === 1 || item.proposalSchema === 2).toBe(true);
    }
    expect(proposalIds(digest.items)).not.toContain("prop-ghost");
    expect(proposalIds(digest.items)).not.toContain("prop-blank");
    expect(proposalIds(digest.items)).not.toContain("prop-future");
    expect(proposalIds(digest.items)).not.toContain("prop-ancient");
    expect(proposalIds(digest.items)).not.toContain("prop-other-tenant");
    expect(proposalIds(digest.priorItems)).not.toContain("prop-ancient");
    expect(ids(digest.verifiedOrChanged)).not.toContain("evt-prop-future-ok");
    expect(new Set(ids(digest.verifiedOrChanged))).toEqual(new Set(ids(digest.items)));
    expect(ids(digest.verifiedOrChanged).some((id) => ids(digest.priorItems).includes(id))).toBe(
      false,
    );
  });

  it("diffs the current window against the previous window of equal length", () => {
    const digest = projectWeeklyEvolutionDigest(weekSequence(), {
      window: WINDOW,
      tenantScope: "tenant-a",
    });

    expect(digest.access).toBe("read-only");
    expect(digest.priorWindow).toEqual({
      from: "2026-09-11T00:00:00.000Z",
      to: FROM,
    });
    expect(proposalIds(digest.items)).toEqual([
      "prop-pending",
      "prop-auto",
      "prop-rb",
      "prop-obs",
      "prop-know",
      "prop-system",
      "prop-pending-end",
    ]);
    expect(proposalIds(digest.priorItems)).toEqual(["prop-user", "prop-prior-pending"]);
    expect(
      digest.deltas.find((delta) => delta.item.factIds.proposalId === "prop-auto")?.relation,
    ).toBe("entered");
    expect(
      digest.deltas.find((delta) => delta.item.factIds.proposalId === "prop-rb")?.relation,
    ).toBe("advanced");
    expect(
      digest.deltas.find((delta) => delta.item.factIds.proposalId === "prop-user")?.relation,
    ).toBe("prior_only");
    expect(digest.platformItems.map((item) => item.factIds.proposalId)).toEqual(["prop-system"]);
    expect(
      digest.items
        .filter((item) => item.audience === "digital_human")
        .map((item) => item.factIds.proposalId),
    ).not.toContain("prop-system");
    expect(digest.completeness).toBe("partial");
    const counted = Object.values(digest.bucketCounts).reduce((sum, count) => sum + count, 0);
    expect(counted).toBe(digest.items.filter((item) => item.bucket).length);
  });

  it("returns an empty digest for an inverted window and does not invent items", () => {
    const digest = projectWeeklyEvolutionDigest(weekSequence(), {
      window: { from: TO, to: FROM },
      tenantScope: "tenant-a",
    });
    expect(digest.completeness).toBe("empty");
    expect(digest.items).toEqual([]);
    expect(digest.priorItems).toEqual([]);
    expect(digest.verifiedOrChanged).toEqual([]);
    expect(digest.platformItems).toEqual([]);
  });
});

describe("phase P1 buckets, pending decisions, and automatic actions", () => {
  it("places each change in exactly one of the five buckets", () => {
    const input = weekSequence();
    const projected = projectEvolutionTimeline(input);
    const partitions = partitionEvolutionTimelineBuckets(projected.items);
    const seen = new Map<string, string>();

    for (const bucket of EVOLUTION_TIMELINE_BUCKETS) {
      for (const item of partitions[bucket]) {
        const key = item.factIds.proposalId ?? item.factIds.ledgerEventId;
        expect(seen.has(key)).toBe(false);
        seen.set(key, bucket);
      }
    }
    expect(seen.get("prop-auto")).toBe("automatic");
    expect(seen.get("prop-user")).toBe("user_approved");
    expect(seen.get("prop-pending")).toBe("pending");
    expect(seen.get("prop-obs")).toBe("observing");
    expect(seen.get("prop-rb")).toBe("rolled_back");
    expect(partitions.automatic).toHaveLength(1);
    expect(Object.values(partitions).flat()).toHaveLength(projected.items.length);

    const automaticIds = new Set(
      projectAutomaticActions(input).map((action) => action.item.factIds.ledgerEventId),
    );
    const pendingIds = new Set(
      projectPendingDecisions(input).items.map((item) => item.factIds.ledgerEventId),
    );
    for (const id of automaticIds) {
      expect(pendingIds.has(id)).toBe(false);
    }

    const byIntent = new Map(
      EVOLUTION_TIMELINE_BUCKETS.map(
        (bucket) => [bucket, new Set(ids(answer(bucket).items))] as const,
      ),
    );
    for (const left of EVOLUTION_TIMELINE_BUCKETS) {
      for (const right of EVOLUTION_TIMELINE_BUCKETS) {
        if (left === right) {
          continue;
        }
        for (const id of byIntent.get(left) ?? []) {
          expect(byIntent.get(right)?.has(id)).toBe(false);
        }
      }
    }
  });

  it("unifies v1 and v2 pending items and keeps the v1 legacy mark", () => {
    const input = weekSequence();
    const all = projectPendingDecisions(input, { tenantScope: "tenant-a" });
    const windowed = projectPendingDecisions(input, {
      tenantScope: "tenant-a",
      window: WINDOW,
    });
    const legacy = all.items.find((item) => item.factIds.proposalId === "prop-pending");
    const current = all.items.find((item) => item.factIds.proposalId === "prop-prior-pending");

    expect(proposalIds(all.items)).toEqual([
      "prop-ancient",
      "prop-prior-pending",
      "prop-pending",
      "prop-pending-end",
    ]);
    expect(legacy?.proposalSchema).toBe(1);
    expect(legacy?.legacy).toBe(true);
    expect(legacy?.bucket).toBe("pending");
    expect(current?.proposalSchema).toBe(2);
    expect(current?.legacy).toBe(false);
    expect(proposalIds(windowed.items)).toEqual(["prop-pending", "prop-pending-end"]);
    expect(all.items.every((item) => item.bucket === "pending")).toBe(true);
    expect(windowed.items.some((item) => item.changeObject.domain === "system")).toBe(false);
  });

  it("shows autonomy budget from the input snapshot and does not widen it", () => {
    const input = weekSequence();
    const before = structuredClone(input.autonomyBySurfaceId);
    const actions = projectAutomaticActions(input, { tenantScope: "tenant-a" });

    expect(actions).toHaveLength(1);
    expect(actions[0]?.item.factIds.ledgerEventId).toBe("evt-auto-auth");
    expect(actions[0]?.item.bucket).toBe("automatic");
    expect(actions[0]?.budget).toEqual({
      available: true,
      surfaceId: "agent.working-dna",
      mode: "auto",
      maxApplications: 3,
      usedApplications: 1,
      remainingApplications: 2,
      expiresAt: "2026-10-25T00:00:00.000Z",
      killSwitch: false,
    });
    expect(input.autonomyBySurfaceId).toEqual(before);

    const stripped = projectAutomaticActions({
      ...input,
      autonomyBySurfaceId: {},
      surfaces: [],
    });
    expect(stripped).toEqual([]);

    const killed = projectAutomaticActions({
      ...input,
      autonomyBySurfaceId: {
        "agent.working-dna": { policy: autoPolicy(), killSwitch: true },
      },
    });
    expect(killed).toEqual([]);
    expect(input.autonomyBySurfaceId?.["agent.working-dna"]?.policy?.usedApplications).toBe(1);
    expect(input.autonomyBySurfaceId?.["agent.working-dna"]?.policy?.maxApplications).toBe(3);
  });
});

describe("phase P1 Da Bai structured answers", () => {
  it("keeps system domain out of learned items and learned sentences", () => {
    const learned = answer("learned_this_week");
    const narration = renderEvolutionNarration(learned, "learned_this_week");

    expect(proposalIds(learned.items)).toEqual(["prop-auto", "prop-know"]);
    expect(learned.items.every((item) => item.audience === "digital_human")).toBe(true);
    expect(learned.items.every((item) => item.changeObject.domain !== "system")).toBe(true);
    expect(learned.items.every((item) => item.result === "verified_effective")).toBe(true);
    expect(proposalIds(learned.platformItems)).toEqual(["prop-system"]);
    expect(learned.platformItems.every((item) => item.changeObject.domain === "system")).toBe(true);
    expect(learned.unresolvedIntents).toEqual([]);
    expect(narration.learned).toEqual([
      "数字人学会了可追溯变化 evt-auto-auth（数字人，已验证有效）。",
      "数字人学会了可追溯变化 evt-prop-know-ok（知识，已验证有效）。",
    ]);
    expect(narration.learned.join("\n")).not.toContain("evt-prop-system-ok");
    expect(narration.platform).toEqual(["平台可追溯变化 evt-prop-system-ok（平台，已验证有效）。"]);
    expect(narration.platform.every((sentence) => !sentence.includes("学会了"))).toBe(true);

    const scoped = answer("learned_this_week", { agentId: "bot-1" });
    expect(proposalIds(scoped.items)).toEqual(["prop-auto"]);
    expect(proposalIds(scoped.platformItems)).toEqual(["prop-system"]);

    const upgrades = answer("platform_upgrades_this_week");
    const upgradeNarration = renderEvolutionNarration(upgrades, "platform_upgrades_this_week");
    expect(upgrades.items).toEqual([]);
    expect(proposalIds(upgrades.platformItems)).toEqual(["prop-system"]);
    expect(upgrades.bucketCounts.user_approved).toBe(1);
    expect(upgradeNarration.learned).toEqual([]);
    expect(upgradeNarration.other).toEqual([]);
    expect(upgradeNarration.platform).toEqual([
      "平台可追溯变化 evt-prop-system-ok（平台，已验证有效）。",
    ]);
    expect(upgradeNarration.platform.every((sentence) => !sentence.includes("学会了"))).toBe(true);
  });

  it("binds the remaining intents to windowed items with fact ids", () => {
    const diff = answer("diff_from_last_week");
    expect(proposalIds(diff.items)).toEqual([
      "prop-pending",
      "prop-auto",
      "prop-rb",
      "prop-obs",
      "prop-know",
      "prop-pending-end",
    ]);
    expect(proposalIds(diff.platformItems)).toEqual(["prop-system"]);
    expect(diff.items.some((item) => item.changeObject.domain === "system")).toBe(false);

    expect(proposalIds(answer("automatic").items)).toEqual(["prop-auto"]);
    expect(proposalIds(answer("user_approved").items)).toEqual(["prop-know"]);
    expect(proposalIds(answer("user_approved").platformItems)).toEqual(["prop-system"]);
    expect(proposalIds(answer("observing").items)).toEqual(["prop-obs"]);
    expect(proposalIds(answer("rolled_back").items)).toEqual(["prop-rb"]);

    const diffNarration = renderEvolutionNarration(diff, "diff_from_last_week");
    expect(diffNarration.learned).toEqual([]);
    expect(diffNarration.other.every((sentence) => sentence.includes("evt-"))).toBe(true);
    expect(diffNarration.other.every((sentence) => !sentence.includes("学会了"))).toBe(true);
  });

  it("fails learned narration that has no fact id", () => {
    const learned = answer("learned_this_week");
    const item = learned.items[0];
    if (!item) {
      throw new Error("expected a learned item");
    }
    const blank: EvolutionTimelineItem = {
      ...item,
      factIds: { ...item.factIds, ledgerEventId: " " },
    };
    const system = learned.platformItems[0];
    if (!system) {
      throw new Error("expected a platform item");
    }

    expect(() => narrateDigitalHumanLearned(blank)).toThrow(EvolutionNarrationGuardError);
    expect(() => narrateDigitalHumanLearned(blank)).toThrowError(
      expect.objectContaining({ code: "missing_fact_id" }),
    );
    expect(() => assertLearnedNarrationHasFactId("本周学会了更稳地回复客户。", [])).toThrowError(
      expect.objectContaining({ code: "missing_fact_id" }),
    );
    expect(() => assertLearnedNarrationHasFactId("本周学会了更稳地回复客户。", [item])).toThrow(
      EvolutionNarrationGuardError,
    );
    expect(() =>
      renderEvolutionNarration(
        {
          items: [blank],
          platformItems: [],
          bucketCounts: emptyEvolutionTimelineBucketCounts(),
          unresolvedIntents: [],
          completeness: "complete",
        },
        "learned_this_week",
      ),
    ).toThrow(EvolutionNarrationGuardError);
    expect(() => narrateDigitalHumanLearned(system)).toThrowError(
      expect.objectContaining({ code: "system_domain" }),
    );
    expect(() =>
      renderEvolutionNarration(
        {
          ...learned,
          items: [system],
        },
        "learned_this_week",
      ),
    ).toThrow(EvolutionNarrationGuardError);

    const cited = narrateDigitalHumanLearned(item);
    expect(cited).toContain(item.factIds.ledgerEventId);
    expect(() => assertLearnedNarrationHasFactId(cited, [item])).not.toThrow();
  });

  it("denies an unauthorized query and records an unknown intent without inventing items", () => {
    const input = weekSequence();
    expect(
      queryEvolutionPerception(input, {
        tenantScope: "tenant-a",
        window: WINDOW,
        intent: "learned_this_week",
        permitted: false,
      }),
    ).toEqual({ denied: true, reason: "permission_denied" });
    expect(
      queryEvolutionPerception(input, {
        tenantScope: " ",
        window: WINDOW,
        intent: "learned_this_week",
      }),
    ).toEqual({ denied: true, reason: "permission_denied" });
    expect(
      queryEvolutionPerception(input, {
        tenantScope: "tenant-a",
        window: WINDOW,
        intent: "free-form-story",
      }),
    ).toEqual({
      items: [],
      bucketCounts: emptyEvolutionTimelineBucketCounts(),
      platformItems: [],
      unresolvedIntents: ["free-form-story"],
      completeness: "empty",
    });
  });

  it("is read-only and the learned template cannot omit the fact id", () => {
    const input = weekSequence();
    const before = structuredClone(input);
    freezeDeep(input);
    const first = projectWeeklyEvolutionDigest(input, { window: WINDOW, tenantScope: "tenant-a" });
    const second = projectWeeklyEvolutionDigest(input, { window: WINDOW, tenantScope: "tenant-a" });
    expect(input).toEqual(before);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(EVOLUTION_PERCEPTION_ACCESS).toBe("read-only");

    const source = readFileSync(fileURLToPath(new URL("./perception.ts", import.meta.url)), "utf8");
    const imports = [...source.matchAll(/from ["']([^"']+)["']/g)].map((match) => match[1]);
    expect(imports).toEqual(["./timeline-list.js", "./timeline.js", "./types.js"]);
    expect(source).not.toMatch(
      /\b(writeFile|appendFile|mkdirSync|unlinkSync|createWriteStream|readFileSync|node:fs|node:child_process|ORCHESTRATION_LIVE_INVOKE)\b/,
    );
    expect(source).not.toMatch(/from ["'][^"']*diagnosis/);
    for (const name of EVOLUTION_PERCEPTION_OPERATIONS) {
      expect(name).not.toMatch(/write|save|commit|mutate|apply|delete|insert|update/i);
      expect(source).toContain(`export function ${name}`);
    }

    const learnedLines = source
      .split("\n")
      .filter((line) => line.includes("学会了") && !line.trim().startsWith("*"));
    expect(learnedLines).toEqual([
      "const LEARNED_CLAIM = /学会了/;",
      "  const sentence = `数字人学会了可追溯变化 ${id}（${item.changeObject.domainDisplayName}，${evolutionTimelineResultLabel(item.result)}）。`;",
    ]);
  });
});

function freezeDeep(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    freezeDeep(child);
  }
}
