import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EVOLUTION_PERCEPTION_P2_ACCESS,
  EVOLUTION_PERCEPTION_P2_OPERATIONS,
  EVOLUTION_PERCEPTION_TRIGGER_CATALOG,
  EVOLUTION_PERCEPTION_TRIGGER_KINDS,
  EVOLUTION_TRIGGER_SIGNAL_TTL_MS,
  EVOLUTION_TRIGGER_SUPPRESS_MS,
  classifyEvolutionDeliveryTier,
  classifyEvolutionTriggerSightings,
  measureEvolutionTriggerCatalog,
  projectEvolutionDelivery,
  projectObservationQueue,
  type EvolutionTriggerSighting,
} from "./perception-p2.js";
import { digitalHumanLearnedTimeline, projectEvolutionTimeline } from "./timeline-list.js";
import type { EvolutionTimelineListInput } from "./timeline-list.js";
import type { EvolutionTimelineItem, EvolutionTimelineLedgerFact } from "./timeline.js";
import type {
  DiagnosisProposalV1,
  EvolutionApplication,
  EvolutionProposal,
  EvolutionTarget,
  EvolutionVerification,
} from "./types.js";

const FROM = "2026-09-18T00:00:00.000Z";
const TO = "2026-09-25T00:00:00.000Z";

const agentTarget: EvolutionTarget = { domain: "agent", agentId: "bot-1" };
const otherAgentTarget: EvolutionTarget = { domain: "agent", agentId: "bot-2" };
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
    status: "ACTIVE",
    createdAt: FROM,
    expiresAt: "2026-10-25T00:00:00.000Z",
    ...over,
  };
}

function proposalV1(over: Partial<DiagnosisProposalV1> = {}): DiagnosisProposalV1 {
  return {
    schemaVersion: 1,
    proposalId: "prop-v1-obs",
    sourceCaseId: "case-v1",
    sourceFindingIds: ["finding-v1"],
    sourceEvidenceRefs: ["ev-v1"],
    sourceReportRef: "report-v1",
    tenantScope: "tenant-a",
    targetDomain: "agent_working_dna",
    proposedChange: { summary: "tune working DNA" },
    expectedEffect: "raise task success",
    riskLevel: "low",
    confidentialityScope: "personal",
    status: "APPLIED",
    approvalRequired: true,
    approverScope: "personal",
    grantId: "grant-v1",
    createdAt: FROM,
    expiresAt: "2026-10-25T00:00:00.000Z",
    auditReceipt: "aud:prop-v1-obs",
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
    primaryEffect: -0.2,
    guardrailResults: [],
    sampleSize: 20,
    confidence: 0.9,
    outcome: "regressed",
    evidenceRefs: ["ev-ver"],
    verifiedAt: "2026-09-21T02:00:00.000Z",
    ...over,
  };
}

function mixedInput(): EvolutionTimelineListInput {
  return {
    events: [
      fact({
        eventId: "evt-obs",
        type: "application.applied",
        timestamp: "2026-09-20T00:00:00.000Z",
        proposalId: "prop-obs",
        applicationId: "app-obs",
      }),
      fact({
        eventId: "evt-obs-late",
        type: "application.applied",
        timestamp: "2026-09-26T00:00:00.000Z",
        proposalId: "prop-obs-late",
        applicationId: "app-obs-late",
        target: otherAgentTarget,
      }),
      fact({
        eventId: "evt-obs-knowledge",
        type: "experiment.held",
        timestamp: "2026-09-21T00:00:00.000Z",
        proposalId: "prop-obs-knowledge",
        target: knowledgeTarget,
        surfaceId: "knowledge.experience-capsule",
      }),
      fact({
        eventId: "evt-obs-system",
        type: "application.applied",
        timestamp: "2026-09-22T00:00:00.000Z",
        proposalId: "prop-obs-system",
        applicationId: "app-obs-system",
        target: systemTarget,
        surfaceId: "system.runtime-binding-governance",
      }),
      fact({
        eventId: "evt-v1-obs",
        type: "application.applied",
        timestamp: "2026-09-19T00:00:00.000Z",
        proposalId: "prop-v1-obs",
        applicationId: "app-v1-obs",
      }),
      fact({
        eventId: "evt-obs-partial",
        type: "application.applied",
        timestamp: "2026-09-19T06:00:00.000Z",
        proposalId: "prop-obs-partial",
        applicationId: "app-obs-partial",
      }),
      fact({
        eventId: "evt-obs-other",
        type: "application.applied",
        timestamp: "2026-09-21T03:00:00.000Z",
        proposalId: "prop-obs-other",
        applicationId: "app-obs-other",
        tenantScope: "tenant-b",
      }),
      fact({
        eventId: "evt-pending",
        type: "application.approval_pending",
        timestamp: "2026-09-20T01:00:00.000Z",
        proposalId: "prop-pending",
      }),
      fact({
        eventId: "evt-auto-auth",
        type: "proposal.authorized",
        timestamp: "2026-09-20T02:00:00.000Z",
        proposalId: "prop-auto",
      }),
      fact({
        eventId: "evt-auto-apply",
        type: "application.applied",
        timestamp: "2026-09-20T02:10:00.000Z",
        proposalId: "prop-auto",
        applicationId: "app-auto",
      }),
      fact({
        eventId: "evt-auto-ver",
        type: "verification.completed",
        timestamp: "2026-09-20T02:20:00.000Z",
        proposalId: "prop-auto",
        applicationId: "app-auto",
        verificationId: "ver-auto",
      }),
      fact({
        eventId: "evt-user-ok",
        type: "application.approved",
        timestamp: "2026-09-18T01:00:00.000Z",
        proposalId: "prop-user",
        applicationId: "app-user",
      }),
      fact({
        eventId: "evt-user-apply",
        type: "application.applied",
        timestamp: "2026-09-18T02:00:00.000Z",
        proposalId: "prop-user",
        applicationId: "app-user",
      }),
      fact({
        eventId: "evt-user-ver",
        type: "verification.completed",
        timestamp: "2026-09-18T03:00:00.000Z",
        proposalId: "prop-user",
        applicationId: "app-user",
        verificationId: "ver-user",
      }),
      fact({
        eventId: "evt-bad-apply",
        type: "application.applied",
        timestamp: "2026-09-21T01:00:00.000Z",
        proposalId: "prop-bad",
        applicationId: "app-bad",
      }),
      fact({
        eventId: "evt-bad-ver",
        type: "verification.completed",
        timestamp: "2026-09-21T02:00:00.000Z",
        proposalId: "prop-bad",
        applicationId: "app-bad",
        verificationId: "ver-bad",
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
        timestamp: "2026-09-20T04:00:00.000Z",
        proposalId: "prop-rb",
        applicationId: "app-rb",
      }),
      fact({
        eventId: "evt-release",
        type: "promotion.completed",
        timestamp: "2026-09-23T00:00:00.000Z",
        proposalId: "prop-release",
        target: systemTarget,
        surfaceId: "system.runtime-binding-governance",
      }),
      fact({
        eventId: "evt-release-obs",
        type: "application.applied",
        timestamp: "2026-09-23T01:00:00.000Z",
        proposalId: "prop-release-obs",
        applicationId: "app-release-obs",
        target: systemTarget,
        surfaceId: "system.runtime-binding-governance",
      }),
      fact({
        eventId: "evt-ghost",
        type: "proposal.created",
        timestamp: "2026-09-20T05:00:00.000Z",
        proposalId: "prop-ghost",
        target: undefined,
      }),
    ],
    proposals: [
      proposal({ proposalId: "prop-obs", status: "ACTIVE" }),
      proposal({ proposalId: "prop-obs-late", status: "ACTIVE", target: otherAgentTarget }),
      proposal({
        proposalId: "prop-obs-knowledge",
        status: "HELD",
        target: knowledgeTarget,
        surfaceId: "knowledge.experience-capsule",
      }),
      proposal({
        proposalId: "prop-obs-system",
        status: "ACTIVE",
        target: systemTarget,
        surfaceId: "system.runtime-binding-governance",
        confidentialityScope: "platform",
      }),
      proposal({ proposalId: "prop-obs-partial", status: "ACTIVE" }),
      proposal({
        proposalId: "prop-obs-other",
        status: "ACTIVE",
        tenantScope: "tenant-b",
      }),
      proposal({ proposalId: "prop-pending", status: "PENDING_AUTHORITY" }),
      proposal({ proposalId: "prop-auto", status: "VERIFIED" }),
      proposal({ proposalId: "prop-user", status: "VERIFIED" }),
      proposal({ proposalId: "prop-bad", status: "ACTIVE" }),
      proposal({ proposalId: "prop-rb", status: "ROLLED_BACK" }),
      proposal({
        proposalId: "prop-release",
        status: "PROMOTED",
        target: systemTarget,
        surfaceId: "system.runtime-binding-governance",
        confidentialityScope: "platform",
      }),
      proposal({
        proposalId: "prop-release-obs",
        status: "ACTIVE",
        target: systemTarget,
        surfaceId: "system.runtime-binding-governance",
        confidentialityScope: "platform",
      }),
    ],
    proposalsV1: [proposalV1()],
    applications: [
      application({ applicationId: "app-obs", proposalId: "prop-obs", idempotencyKey: "idem-obs" }),
      application({
        applicationId: "app-obs-late",
        proposalId: "prop-obs-late",
        idempotencyKey: "idem-obs-late",
      }),
      application({
        applicationId: "app-obs-system",
        proposalId: "prop-obs-system",
        idempotencyKey: "idem-obs-system",
      }),
      application({
        applicationId: "app-v1-obs",
        proposalId: "prop-v1-obs",
        idempotencyKey: "idem-v1-obs",
      }),
      application({
        applicationId: "app-obs-partial",
        proposalId: "prop-obs-partial",
        idempotencyKey: "idem-obs-partial",
        targetVersionBefore: "",
        targetVersionAfter: "",
      }),
      application({
        applicationId: "app-obs-other",
        proposalId: "prop-obs-other",
        idempotencyKey: "idem-obs-other",
      }),
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
        applicationId: "app-bad",
        proposalId: "prop-bad",
        idempotencyKey: "idem-bad",
      }),
      application({ applicationId: "app-rb", proposalId: "prop-rb", idempotencyKey: "idem-rb" }),
      application({
        applicationId: "app-release-obs",
        proposalId: "prop-release-obs",
        idempotencyKey: "idem-release-obs",
      }),
    ],
    verifications: [
      verification({
        verificationId: "ver-auto",
        applicationId: "app-auto",
        outcome: "improved",
        primaryEffect: 0.2,
      }),
      verification({
        verificationId: "ver-user",
        applicationId: "app-user",
        outcome: "improved",
        primaryEffect: 0.1,
      }),
      verification({ verificationId: "ver-bad", applicationId: "app-bad" }),
    ],
    platformReleaseEventIds: ["evt-release", "evt-release-obs"],
  };
}

function timelineObserving(
  input: EvolutionTimelineListInput,
  scope?: { tenantScope?: string; agentId?: string; window?: { from: string; to: string } },
): EvolutionTimelineItem[] {
  const span = scope?.window
    ? { fromMs: Date.parse(scope.window.from), toMs: Date.parse(scope.window.to) }
    : null;
  if (
    span &&
    (!Number.isFinite(span.fromMs) || !Number.isFinite(span.toMs) || span.toMs <= span.fromMs)
  ) {
    return [];
  }
  return projectEvolutionTimeline(input).items.filter((item) => {
    if (item.bucket !== "observing") {
      return false;
    }
    if (scope?.tenantScope && item.impactScope.tenantScope !== scope.tenantScope) {
      return false;
    }
    if (scope?.agentId) {
      const target = item.changeObject.target;
      if (target.domain !== "agent" || target.agentId !== scope.agentId) {
        return false;
      }
    }
    if (!span) {
      return true;
    }
    const event = input.events.find(
      (candidate) => candidate.eventId === item.factIds.ledgerEventId,
    );
    const at = event ? Date.parse(event.timestamp) : Number.NaN;
    return Number.isFinite(at) && at >= span.fromMs && at <= span.toMs;
  });
}

function sighting(over: Partial<EvolutionTriggerSighting> = {}): EvolutionTriggerSighting {
  return {
    kind: "event",
    tenantScope: "tenant-a",
    targetKey: "agent:bot-1",
    reasonCode: "event:task_failed",
    observedAt: "2026-09-20T00:00:00.000Z",
    factId: "sig-1",
    ...over,
  };
}

function exportedStringArray(source: string, name: string): string[] {
  const match = source.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`));
  if (!match?.[1]) {
    throw new Error(`missing ${name}`);
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((found) => found[1] ?? "");
}

describe("phase P2 observation queue", () => {
  it("matches the timeline observing bucket, including scope and window", () => {
    const input = mixedInput();
    const scopes = [
      undefined,
      { tenantScope: "tenant-a" },
      { tenantScope: "tenant-b" },
      { agentId: "bot-1" },
      { tenantScope: "tenant-a", agentId: "bot-1", window: { from: FROM, to: TO } },
      { window: { from: TO, to: FROM } },
      { window: { from: "not-a-date", to: TO } },
    ] as const;
    for (const scope of scopes) {
      expect(projectObservationQueue(input, scope).items).toEqual(timelineObserving(input, scope));
    }
    const queue = projectObservationQueue(input);
    expect(queue.items.length).toBeGreaterThan(0);
    expect(queue.items.every((item) => item.bucket === "observing")).toBe(true);
    expect(queue.items.map((item) => item.factIds.proposalId)).not.toEqual(
      expect.arrayContaining(["prop-pending", "prop-rb", "prop-auto", "prop-user", "prop-bad"]),
    );
    expect(queue.items.map((item) => item.factIds.ledgerEventId)).not.toContain("evt-ghost");
  });

  it("keeps v1 legacy marks and splits system items off the digital-human side", () => {
    const input = mixedInput();
    const queue = projectObservationQueue(input, { tenantScope: "tenant-a" });
    const legacy = queue.items.find((item) => item.factIds.proposalId === "prop-v1-obs");
    expect(legacy?.proposalSchema).toBe(1);
    expect(legacy?.legacy).toBe(true);
    expect(legacy?.factIds.ledgerEventId).toBe("evt-v1-obs");

    const partial = queue.items.find((item) => item.factIds.proposalId === "prop-obs-partial");
    expect(partial?.completeness).toBe("partial");
    expect(queue.completeness).toBe("partial");

    expect(queue.digitalHumanItems).toEqual(
      queue.items.filter((item) => item.audience === "digital_human"),
    );
    expect(queue.platformItems).toEqual(queue.items.filter((item) => item.audience === "platform"));
    expect(queue.platformItems.map((item) => item.changeObject.domain)).toEqual([
      "system",
      "system",
    ]);
    const learnedIds = new Set(
      digitalHumanLearnedTimeline(input).map((item) => item.factIds.ledgerEventId),
    );
    for (const item of queue.platformItems) {
      expect(learnedIds.has(item.factIds.ledgerEventId)).toBe(false);
      expect(JSON.stringify(item)).not.toContain("学会了");
    }
  });
});

describe("phase P2 trigger catalog", () => {
  it("measures the five inspection trigger kinds", () => {
    const inspection = readFileSync(
      fileURLToPath(new URL("../../../src/diagnosis/inspection.ts", import.meta.url)),
      "utf8",
    );
    const signal = readFileSync(
      fileURLToPath(new URL("../../../src/diagnosis/signal.ts", import.meta.url)),
      "utf8",
    );
    expect(exportedStringArray(inspection, "INSPECTION_TRIGGER_KINDS")).toEqual([
      ...EVOLUTION_PERCEPTION_TRIGGER_KINDS,
    ]);
    expect(exportedStringArray(signal, "DIAGNOSTIC_SIGNAL_KINDS")).toEqual([
      ...EVOLUTION_PERCEPTION_TRIGGER_KINDS,
    ]);
    expect(signal).toContain("export const DIAGNOSTIC_SIGNAL_TTL_MS = 60 * 60 * 1000;");
    expect(signal).toContain("export const DIAGNOSTIC_SIGNAL_SUPPRESS_MS = 15 * 60 * 1000;");
    expect(EVOLUTION_TRIGGER_SIGNAL_TTL_MS).toBe(60 * 60 * 1000);
    expect(EVOLUTION_TRIGGER_SUPPRESS_MS).toBe(15 * 60 * 1000);

    const measured = measureEvolutionTriggerCatalog();
    expect(measured.kindCount).toBe(5);
    expect(measured.kinds).toEqual([...EVOLUTION_PERCEPTION_TRIGGER_KINDS]);
    expect(
      EVOLUTION_PERCEPTION_TRIGGER_CATALOG.map((entry) => entry.inspectionTriggerKind),
    ).toEqual([...EVOLUTION_PERCEPTION_TRIGGER_KINDS]);
    expect(EVOLUTION_PERCEPTION_TRIGGER_CATALOG.map((entry) => entry.cooldown.mode)).toEqual([
      "interval",
      "suppress",
      "suppress",
      "suppress",
      "suppress",
    ]);
    expect(measured.dedupeKeyParts).toEqual(["kind", "tenantScope", "targetKey", "reasonCode"]);
  });

  it("dedupes a fingerprint inside the TTL window and emits again after it", () => {
    const first = sighting({ factId: "sig-1", observedAt: "2026-09-20T00:00:00.000Z" });
    const repeat = sighting({ factId: "sig-2", observedAt: "2026-09-20T00:30:00.000Z" });
    const otherTenant = sighting({
      factId: "sig-3",
      tenantScope: "tenant-b",
      observedAt: "2026-09-20T00:10:00.000Z",
    });
    const nextWindow = sighting({
      factId: "sig-4",
      observedAt: new Date(
        Date.parse(first.observedAt) + EVOLUTION_TRIGGER_SIGNAL_TTL_MS,
      ).toISOString(),
    });
    const reversed = [nextWindow, repeat, otherTenant, first];
    const classified = classifyEvolutionTriggerSightings(reversed);
    expect(classified.counts).toEqual({ emit: 3, deduped: 1, cooled: 0, omitted: 0 });
    expect(classified.rows.map((row) => [row.factId, row.disposition, row.anchorFactId])).toEqual([
      ["sig-1", "emit", "sig-1"],
      ["sig-3", "emit", "sig-3"],
      ["sig-2", "deduped", "sig-1"],
      ["sig-4", "emit", "sig-4"],
    ]);
    expect(classified.rows.reduce((sum, row) => sum + 1, 0)).toBe(reversed.length);
  });

  it("cools scheduled ticks inside everyMs and suppressed sightings", () => {
    const everyMs = 15 * 60 * 1000;
    const start = "2026-09-20T00:00:00.000Z";
    const scheduled = [
      sighting({
        kind: "scheduled",
        reasonCode: "inspection_scheduled",
        factId: "sch-1",
        observedAt: start,
        everyMs,
      }),
      sighting({
        kind: "scheduled",
        reasonCode: "inspection_scheduled",
        factId: "sch-2",
        observedAt: new Date(Date.parse(start) + everyMs - 1).toISOString(),
        everyMs,
      }),
      sighting({
        kind: "scheduled",
        reasonCode: "inspection_scheduled",
        factId: "sch-3",
        observedAt: new Date(Date.parse(start) + everyMs).toISOString(),
        everyMs,
      }),
    ];
    const cooled = classifyEvolutionTriggerSightings(scheduled);
    expect(cooled.rows.map((row) => row.disposition)).toEqual(["emit", "cooled", "deduped"]);
    expect(cooled.rows[1]?.coolReason).toBe("scheduled_interval");
    expect(cooled.rows[2]?.disposition).toBe("deduped");

    const suppressed = classifyEvolutionTriggerSightings([
      sighting({
        kind: "threshold",
        reasonCode: "threshold:error_rate",
        factId: "thr-1",
        observedAt: start,
        suppressedUntil: new Date(Date.parse(start) + EVOLUTION_TRIGGER_SUPPRESS_MS).toISOString(),
      }),
      sighting({
        kind: "threshold",
        reasonCode: "threshold:error_rate",
        factId: "thr-2",
        observedAt: new Date(Date.parse(start) + EVOLUTION_TRIGGER_SUPPRESS_MS).toISOString(),
      }),
    ]);
    expect(suppressed.rows.map((row) => [row.disposition, row.coolReason])).toEqual([
      ["cooled", "suppressed"],
      ["emit", null],
    ]);
  });

  it("omits unknown kinds and sightings with no fact id", () => {
    const classified = classifyEvolutionTriggerSightings([
      sighting({ kind: "invented", factId: "sig-x" }),
      sighting({ factId: "   " }),
      sighting({ kind: "scheduled", factId: "sch-x", everyMs: 0 }),
      sighting({ targetKey: " ", factId: "sig-y" }),
      sighting({ proposalSchema: 3 as 1, factId: "sig-z" }),
      sighting({ factId: "sig-ok", proposalSchema: 1, legacy: true }),
      sighting({ factId: "sig-bad-suppress", suppressedUntil: "not-a-time" }),
    ]);
    const omitByFactId = new Map(classified.rows.map((row) => [row.factId, row.omitReason]));
    expect(omitByFactId.get("sig-x")).toBe("unknown_kind");
    expect(omitByFactId.get(null)).toBe("missing_fact_id");
    expect(omitByFactId.get("sch-x")).toBe("missing_interval");
    expect(omitByFactId.get("sig-y")).toBe("missing_identity");
    expect(omitByFactId.get("sig-z")).toBe("invalid_schema");
    expect(omitByFactId.get("sig-bad-suppress")).toBe("invalid_time");
    const kept = classified.rows.find((row) => row.factId === "sig-ok");
    expect(kept?.disposition).toBe("emit");
    expect(kept?.proposalSchema).toBe(1);
    expect(kept?.legacy).toBe(true);
    expect(classified.counts.omitted).toBe(6);
    expect(classified.counts.emit).toBe(1);
  });
});

describe("phase P2 delivery tiers", () => {
  it("sends major changes immediately and ordinary changes to the weekly queue", () => {
    const input = mixedInput();
    const items = projectEvolutionTimeline(input).items;
    const byProposal = (proposalId: string) => {
      const item = items.find((candidate) => candidate.factIds.proposalId === proposalId);
      if (!item) {
        throw new Error(`missing ${proposalId}`);
      }
      return item;
    };
    expect(classifyEvolutionDeliveryTier(byProposal("prop-rb"))).toEqual({
      tier: "immediate",
      reason: "rolled_back",
    });
    expect(classifyEvolutionDeliveryTier(byProposal("prop-bad"))).toEqual({
      tier: "immediate",
      reason: "ineffective",
    });
    expect(classifyEvolutionDeliveryTier(byProposal("prop-pending"))).toEqual({
      tier: "immediate",
      reason: "pending_decision",
    });
    expect(classifyEvolutionDeliveryTier(byProposal("prop-release"))).toEqual({
      tier: "immediate",
      reason: "platform_release",
    });
    expect(byProposal("prop-release").executionMode).toBe("platform_release");
    expect(byProposal("prop-release").audience).toBe("platform");
    expect(classifyEvolutionDeliveryTier(byProposal("prop-release-obs"))).toEqual({
      tier: "immediate",
      reason: "platform_release",
    });
    expect(byProposal("prop-release-obs").bucket).toBe("observing");
    expect(classifyEvolutionDeliveryTier(byProposal("prop-obs"))).toEqual({
      tier: "weekly",
      reason: "observing",
    });
    expect(classifyEvolutionDeliveryTier(byProposal("prop-auto"))).toEqual({
      tier: "weekly",
      reason: "ordinary_change",
    });
    expect(classifyEvolutionDeliveryTier(byProposal("prop-user"))).toEqual({
      tier: "weekly",
      reason: "ordinary_change",
    });

    const delivery = projectEvolutionDelivery(items);
    const immediateIds = delivery.immediate.map((row) => row.item.factIds.proposalId);
    const weeklyIds = delivery.weekly.map((row) => row.item.factIds.proposalId);
    expect(immediateIds).toEqual(
      expect.arrayContaining([
        "prop-pending",
        "prop-bad",
        "prop-rb",
        "prop-release",
        "prop-release-obs",
      ]),
    );
    expect(weeklyIds).toEqual(
      expect.arrayContaining([
        "prop-obs",
        "prop-v1-obs",
        "prop-auto",
        "prop-user",
        "prop-obs-system",
      ]),
    );
    expect(immediateIds.filter((id) => weeklyIds.includes(id))).toEqual([]);
    for (const row of [...delivery.immediate, ...delivery.weekly]) {
      expect(row.deliveryId).toBe(`dlv:${row.item.factIds.ledgerEventId}:${row.tier}`);
      expect(row.status).toBe("queued");
      expect(row.item.proposalSchema === 1 || row.item.proposalSchema === 2).toBe(true);
    }
    const legacy = delivery.weekly.find((row) => row.item.factIds.proposalId === "prop-v1-obs");
    expect(legacy?.item.proposalSchema).toBe(1);
    expect(legacy?.item.legacy).toBe(true);
    expect(JSON.stringify(delivery)).not.toContain("学会了");

    const queueIds = new Set(
      projectObservationQueue(input).items.map((item) => item.factIds.ledgerEventId),
    );
    for (const row of delivery.weekly) {
      if (row.reason === "observing") {
        expect(queueIds.has(row.item.factIds.ledgerEventId)).toBe(true);
      }
    }
    for (const item of projectObservationQueue(input).items) {
      const tier = classifyEvolutionDeliveryTier(item).tier;
      const lane = tier === "immediate" ? delivery.immediate : delivery.weekly;
      expect(
        lane.some((row) => row.item.factIds.ledgerEventId === item.factIds.ledgerEventId),
      ).toBe(true);
    }
  });

  it("dedupes a repeated delivery id and drops a blank fact id", () => {
    const input = mixedInput();
    const item = projectEvolutionTimeline(input).items.find(
      (candidate) => candidate.factIds.proposalId === "prop-obs",
    );
    if (!item) {
      throw new Error("missing observing item");
    }
    const blank: EvolutionTimelineItem = {
      ...item,
      factIds: { ...item.factIds, ledgerEventId: "   " },
    };
    const delivery = projectEvolutionDelivery([item, item, blank]);
    expect(delivery.weekly).toHaveLength(1);
    expect(delivery.weekly[0]?.deliveryId).toBe(`dlv:${item.factIds.ledgerEventId}:weekly`);
    expect(delivery.dedupedDeliveryIds).toEqual([delivery.weekly[0]?.deliveryId]);
    expect(delivery.omitted).toEqual([{ ledgerEventId: "   ", reason: "missing_fact_id" }]);
    expect(delivery.immediate).toEqual([]);
  });
});

describe("phase P2 hard constraints", () => {
  it("is read-only and does not open a write path", () => {
    const input = mixedInput();
    const before = structuredClone(input);
    freezeDeep(input);
    const sightings = [
      sighting(),
      sighting({ factId: "sig-2", observedAt: "2026-09-20T00:05:00.000Z" }),
    ];
    freezeDeep(sightings);
    const queue = projectObservationQueue(input);
    const triggers = classifyEvolutionTriggerSightings(sightings);
    const delivery = projectEvolutionDelivery(projectEvolutionTimeline(input).items);
    expect(input).toEqual(before);
    expect(queue.access).toBe("read-only");
    expect(triggers.access).toBe("read-only");
    expect(delivery.access).toBe("read-only");
    expect(EVOLUTION_PERCEPTION_P2_ACCESS).toBe("read-only");
    expect(JSON.stringify(queue)).toBe(JSON.stringify(projectObservationQueue(input)));
    expect(JSON.stringify(triggers)).toBe(
      JSON.stringify(classifyEvolutionTriggerSightings(sightings)),
    );

    const source = readFileSync(
      fileURLToPath(new URL("./perception-p2.ts", import.meta.url)),
      "utf8",
    );
    const imports = [...source.matchAll(/from ["']([^"']+)["']/g)].map((match) => match[1]);
    expect(imports).toEqual(["./timeline-list.js", "./timeline.js"]);
    expect(source).not.toMatch(
      /\b(writeFile|appendFile|mkdirSync|unlinkSync|createWriteStream|readFileSync|node:fs|node:child_process|ORCHESTRATION_LIVE_INVOKE|evaluateSurfaceAutonomy)\b/,
    );
    expect(source).not.toMatch(/from ["'][^"']*diagnosis/);
    expect(source).not.toMatch(/constitutional-contracts|Meta-Schema|FABRIC_DEFAULT/);
    for (const name of EVOLUTION_PERCEPTION_P2_OPERATIONS) {
      expect(name).not.toMatch(/write|save|commit|mutate|apply|delete|insert|update/i);
      expect(source).toContain(`export function ${name}`);
    }
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
