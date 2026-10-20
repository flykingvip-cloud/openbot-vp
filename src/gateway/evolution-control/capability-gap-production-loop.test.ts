/**
 * Fixture-free production loop proof:
 * real bootstrap grant + real delegation inspector + real stores (temp dir).
 * Marker → governance tick → SUGGESTED; skill review approve → usage → closed.
 * Negatives: no approval → not closed; unrelated reply → not closed.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpRoot = path.join(os.tmpdir(), `openbot-cap-gap-prod-${Date.now()}-${process.pid}`);
await fs.mkdir(tmpRoot, { recursive: true });
vi.mock("../../utils.js", () => ({ CONFIG_DIR: tmpRoot }));

const { createDelegationEvolutionInspector } =
  await import("../../diagnosis/evolution-proposal.js");
const {
  finalizeDraftSkill,
  getPersonalSkillAssetDetail,
  publishSkillReview,
  submitSkillForReview,
} = await import("../skill-lifecycle-store.js");
const { resetEvolutionControlPlaneForTests } = await import("./bootstrap.js");
const {
  configureCapabilityGapConsumer,
  resetCapabilityGapConsumerConfigForTests,
  runCapabilityGapConsumerTick,
} = await import("./capability-gap-consumer.js");
const { ensureCapabilityGapSystemGrant } = await import("./capability-gap-grant.js");
const {
  listCapabilityGapBacklog,
  recordCapabilityGapEvent,
  resetCapabilityGapDedupForTests,
  tryResolveCapabilityGapsFromUsage,
} = await import("./capability-gap-ingest.js");
const { getSharedDiagnosisDelegationMachine, resetSharedDiagnosisDelegationForTests } =
  await import("./delegation-service.js");
const { resetEvolutionLoopLogsForTests } = await import("./evolution-loop-log.js");
const { createGatewayEvolutionControlPlane } = await import("./gateway-plane.js");

const TENANT = "tenant-prod-loop";
const AGENT = "bot-prod-loop";
const OWNER = "user-owner-prod";

describe("capability-gap production loop (no fixture inspector)", () => {
  let persistDir = "";

  beforeEach(async () => {
    resetEvolutionLoopLogsForTests();
    resetCapabilityGapDedupForTests();
    resetCapabilityGapConsumerConfigForTests();
    resetSharedDiagnosisDelegationForTests();
    resetEvolutionControlPlaneForTests();
    persistDir = path.join(tmpRoot, `control-${Date.now()}`);
    await fs.mkdir(persistDir, { recursive: true });
  });

  afterEach(async () => {
    resetSharedDiagnosisDelegationForTests();
    resetEvolutionControlPlaneForTests();
    resetCapabilityGapConsumerConfigForTests();
    resetCapabilityGapDedupForTests();
  });

  function bootPlane() {
    const machine = getSharedDiagnosisDelegationMachine(persistDir);
    const ensured = ensureCapabilityGapSystemGrant({ machine, tenantId: TENANT });
    expect(ensured.grant.status).toBe("APPROVED");
    expect(ensured.grant.allowedActions).toEqual(["suggest", "expire"]);
    // Real inspector via gateway plane — no runtimePlatformInspector fixture
    const plane = createGatewayEvolutionControlPlane({
      persistDir,
      cfg: { agents: { list: [] } } as never,
    });
    const inspector = createDelegationEvolutionInspector(machine);
    expect(inspector.inspect(ensured.grantId).status).toBe("APPROVED");
    return { plane, machine };
  }

  it("marker → real grant suggest → SUGGESTED; review+usage closes; negatives hold", async () => {
    const { plane } = bootPlane();
    configureCapabilityGapConsumer({ explicitMarkerThreshold: 1, occurrenceThreshold: 2 });

    const recorded = recordCapabilityGapEvent({
      plane,
      persistDir,
      runId: "run-prod-1",
      agentId: AGENT,
      tenantId: TENANT,
      sessionKey: `agent:${AGENT}:main`,
      chatType: "direct",
      category: "skill",
      reason: "pdf_ocr_prod",
      detail: "pdf_ocr_prod",
      explicitMarker: true,
      sourceKind: "marker",
      ownerUserId: OWNER,
      userLanguageSummary: "缺少 PDF OCR",
      dedupWindowMs: 0,
    });
    expect(recorded.recorded).toBe(true);
    expect(recorded.proposal?.status).toBe("DISCOVERED");
    expect(
      recorded.proposal?.sourceEvidenceRefs.some((id) => id.startsWith("evidence:capability-gap:")),
    ).toBe(true);
    expect(recorded.proposal?.sourceEvidenceRefs.includes("ev-a")).toBe(false);
    expect(recorded.proposal?.grantId).toBe(`grant:capability-gap:system:${TENANT}`);

    const tick = runCapabilityGapConsumerTick({ plane, persistDir });
    expect(tick.acted).toBeGreaterThanOrEqual(1);
    expect(tick.suggested).toBeGreaterThanOrEqual(1);

    const suggested = plane.getProposal(recorded.proposalId!);
    expect(suggested?.status).toBe("SUGGESTED");
    const payload = plane.getCandidate(suggested!.candidateRef)?.payload as {
      draftSkillId?: string;
      ownerUserId?: string;
      lifecycle?: string;
    };
    expect(payload.draftSkillId).toBeTruthy();
    expect(payload.ownerUserId).toBe(OWNER);

    const draftId = payload.draftSkillId!;
    const detail = getPersonalSkillAssetDetail(draftId);
    expect(detail.ownerUserId).toBe(OWNER);
    expect(detail.lifecycle).toBe("draft");

    // Negative: usage without review approval must NOT close
    const noApproval = tryResolveCapabilityGapsFromUsage({
      plane,
      tenantId: TENANT,
      agentId: AGENT,
      runId: "run-use-no-approve",
      usedToolOrSkillIds: [draftId],
    });
    expect(noApproval.closed).toEqual([]);
    expect(plane.getCandidate(suggested!.candidateRef)?.payload).toMatchObject({
      lifecycle: expect.not.stringMatching(/^resolved$/),
    });

    // Negative: unrelated reply / unrelated tool must NOT close
    const unrelated = tryResolveCapabilityGapsFromUsage({
      plane,
      tenantId: TENANT,
      agentId: AGENT,
      runId: "run-unrelated",
      usedToolOrSkillIds: ["totally-unrelated-tool"],
    });
    expect(unrelated.closed).toEqual([]);

    // Real skill review flow: draft → private → reviewing → published
    finalizeDraftSkill(draftId);
    submitSkillForReview({ skillId: draftId, scope: { kind: "enterprise" } });
    publishSkillReview({ skillId: draftId, scope: { kind: "enterprise" } });
    expect(getPersonalSkillAssetDetail(draftId).lifecycle).toBe("published");

    const closed = tryResolveCapabilityGapsFromUsage({
      plane,
      tenantId: TENANT,
      agentId: AGENT,
      runId: "run-use-after-approve",
      usedToolOrSkillIds: [draftId],
    });
    expect(closed.closed).toContain(recorded.proposalId!);
    const after = plane.getCandidate(suggested!.candidateRef)?.payload as {
      lifecycle?: string;
      verificationEventId?: string;
    };
    expect(after.lifecycle).toBe("resolved");
    expect(after.verificationEventId).toMatch(/skill-review:/);
    // Proposal is not forced to VERIFIED (no experiment grant); ledger carries verification.
    expect(plane.getProposal(recorded.proposalId!)?.status).toBe("SUGGESTED");
    const ledgerHit = plane.ledger
      .list({ proposalId: recorded.proposalId! })
      .some((e) => e.type === "verification.completed");
    expect(ledgerHit).toBe(true);

    const backlog = listCapabilityGapBacklog(plane);
    expect(backlog.some((row) => row.proposalId === recorded.proposalId)).toBe(true);
  });

  it("perception triage is listed with triageTag on backlog", async () => {
    const { plane } = bootPlane();
    configureCapabilityGapConsumer({ explicitMarkerThreshold: 1 });
    const recorded = recordCapabilityGapEvent({
      plane,
      persistDir,
      agentId: AGENT,
      tenantId: TENANT,
      category: "perception",
      reason: "silent_private",
      explicitMarker: true,
      sourceKind: "marker",
      ownerUserId: OWNER,
      dedupWindowMs: 0,
    });
    runCapabilityGapConsumerTick({ plane, persistDir });
    const row = listCapabilityGapBacklog(plane).find((r) => r.proposalId === recorded.proposalId);
    expect(row?.triageTag).toBe("perception-triage");
    expect(row?.category).toBe("perception");
  });
});
