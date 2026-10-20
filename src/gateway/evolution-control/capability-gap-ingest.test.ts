import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  configureCapabilityGapConsumer,
  resetCapabilityGapConsumerConfigForTests,
  runCapabilityGapConsumerTick,
} from "./capability-gap-consumer.js";
import { ensureCapabilityGapSystemGrant } from "./capability-gap-grant.js";
import {
  listCapabilityGapBacklog,
  recordCapabilityGapEvent,
  resetCapabilityGapDedupForTests,
  resolveCapabilityGapAfterVerifiedUsage,
  resolveCapabilityGapsForSuccessfulRun,
  tryResolveCapabilityGapsFromUsage,
  getEmptyReplyGapCounterForTests,
} from "./capability-gap-ingest.js";
import {
  getSharedDiagnosisDelegationMachine,
  resetSharedDiagnosisDelegationForTests,
} from "./delegation-service.js";
import { resetEvolutionLoopLogsForTests } from "./evolution-loop-log.js";
import { createGatewayEvolutionControlPlane } from "./gateway-plane.js";

const tempDirs: string[] = [];

afterEach(async () => {
  resetEvolutionLoopLogsForTests();
  resetCapabilityGapDedupForTests();
  resetCapabilityGapConsumerConfigForTests();
  resetSharedDiagnosisDelegationForTests();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function planeAt(persistDir: string, tenantId = "tenant-gap") {
  resetSharedDiagnosisDelegationForTests();
  const machine = getSharedDiagnosisDelegationMachine(persistDir);
  ensureCapabilityGapSystemGrant({ machine, tenantId });
  return createGatewayEvolutionControlPlane({
    persistDir,
    cfg: { agents: { list: [] } } as unknown as OpenBotConfig,
  });
}

describe("capability-gap → evolution control plane (e2e loop)", () => {
  it("marker → DISCOVERED → consumer tick → SUGGESTED + draft skill → verified usage closes via legal transition", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-cap-gap-e2e-"));
    tempDirs.push(root);
    const persistDir = path.join(root, "control");
    const plane = await planeAt(persistDir);

    const first = recordCapabilityGapEvent({
      plane,
      persistDir,
      runId: "run-marker-1",
      agentId: "bot-gap",
      tenantId: "tenant-gap",
      sessionKey: "agent:bot-gap:main",
      chatType: "direct",
      category: "skill",
      reason: "pdf_ocr",
      detail: "pdf_ocr",
      explicitMarker: true,
      sourceKind: "marker",
      ownerUserId: "user-gap",
      userLanguageSummary: "缺少 PDF OCR 技能",
      dedupWindowMs: 0,
    });
    expect(first.recorded).toBe(true);
    expect(first.metricOnly).toBe(false);
    expect(first.proposal?.status).toBe("DISCOVERED");
    expect(first.proposal?.sourceEvidenceRefs.includes("ev-a")).toBe(false);
    expect(first.proposal?.grantId).toBe("grant:capability-gap:system:tenant-gap");

    configureCapabilityGapConsumer({ explicitMarkerThreshold: 1, occurrenceThreshold: 2 });
    const tick = runCapabilityGapConsumerTick({ plane, persistDir });
    expect(tick.acted).toBeGreaterThanOrEqual(1);
    expect(tick.suggested).toBeGreaterThanOrEqual(1);

    const suggested = plane.getProposal(first.proposalId!);
    expect(suggested?.status).toBe("SUGGESTED");
    const ledgerSuggested = plane.ledger
      .list({ proposalId: first.proposalId! })
      .some((e) => e.type === "proposal.suggested");
    expect(ledgerSuggested).toBe(true);

    const payload = plane.getCandidate(suggested!.candidateRef)?.payload as {
      draftSkillId?: string;
      lifecycle?: string;
      ownerUserId?: string;
    };
    expect(payload.draftSkillId).toBeTruthy();
    expect(payload.ownerUserId).toBe("user-gap");

    const noop = resolveCapabilityGapsForSuccessfulRun({
      plane,
      sessionKey: "agent:bot-gap:main",
      agentId: "bot-gap",
    });
    expect(noop.closed).toEqual([]);
    expect(plane.getProposal(first.proposalId!)?.status).toBe("SUGGESTED");

    // linkedVerified:true is the explicit test override (production uses skill review).
    const closed = resolveCapabilityGapAfterVerifiedUsage({
      proposalId: first.proposalId!,
      plane,
      trustedTenantId: "tenant-gap",
      usedToolOrSkillIds: [payload.draftSkillId!, "pdf_ocr"],
      runId: "run-used-1",
      linkedVerified: true,
    });
    expect(closed.closed).toBe(true);
    expect(plane.getProposal(first.proposalId!)?.status).not.toBe("REJECTED");
    const after = listCapabilityGapBacklog(plane).find((r) => r.proposalId === first.proposalId);
    expect(after?.lifecycle).toBe("resolved");
    const ledgerVerify = plane.ledger
      .list({ proposalId: first.proposalId! })
      .some((e) => e.type === "verification.completed");
    expect(ledgerVerify).toBe(true);
  });

  it("plain empty-reply is metric-only (no proposal per session)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-cap-gap-metric-"));
    tempDirs.push(root);
    const plane = await planeAt(path.join(root, "control"));
    const row = recordCapabilityGapEvent({
      plane,
      persistDir: path.join(root, "control"),
      runId: "run-empty",
      agentId: "bot-gap",
      tenantId: "tenant-gap",
      sessionKey: "agent:bot-gap:main",
      category: "perception",
      reason: "direct_chat_silent_or_empty_reply",
      sourceKind: "empty_reply",
    });
    expect(row.metricOnly).toBe(true);
    expect(row.proposalId).toBeNull();
    expect(plane.listProposals()).toHaveLength(0);
    expect(getEmptyReplyGapCounterForTests()).toBeGreaterThanOrEqual(1);
  });

  it("unrelated successful reply does not close a gap (negative)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-cap-gap-neg-"));
    tempDirs.push(root);
    const persistDir = path.join(root, "control");
    const plane = await planeAt(persistDir);
    const first = recordCapabilityGapEvent({
      plane,
      persistDir,
      runId: "run-1",
      agentId: "bot-gap",
      tenantId: "tenant-gap",
      sessionKey: "agent:bot-gap:main",
      category: "tool",
      reason: "browser",
      detail: "browser",
      explicitMarker: true,
      sourceKind: "marker",
      dedupWindowMs: 0,
    });
    const closed = resolveCapabilityGapsForSuccessfulRun({
      plane,
      sessionKey: "agent:bot-gap:main",
      agentId: "bot-gap",
    });
    expect(closed.closed).toEqual([]);
    expect(plane.getProposal(first.proposalId!)?.status).toBe("DISCOVERED");

    const usageMiss = tryResolveCapabilityGapsFromUsage({
      plane,
      tenantId: "tenant-gap",
      agentId: "bot-gap",
      usedToolOrSkillIds: ["unrelated_tool"],
      runId: "run-ok",
    });
    expect(usageMiss.closed).toEqual([]);
  });

  it("does not treat tool category gaps as skill surface", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-cap-gap-tool-"));
    tempDirs.push(root);
    const persistDir = path.join(root, "control");
    const plane = await planeAt(persistDir);
    const row = recordCapabilityGapEvent({
      plane,
      persistDir,
      runId: "run-tool",
      agentId: "bot-t",
      tenantId: "tenant-gap",
      category: "tool",
      reason: "browser_unavailable",
      detail: "tool unavailable: browser",
      explicitMarker: true,
      sourceKind: "marker",
      dedupWindowMs: 0,
    });
    expect(row.proposal?.surfaceId).toBe("capability.skill-installation");
    expect(row.proposal?.sourceMechanismRef).toBe("capability-gap:tool");
  });

  it("skips infra/rate-limit/auth as tool gaps", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-cap-gap-infra-"));
    tempDirs.push(root);
    const persistDir = path.join(root, "control");
    const plane = await planeAt(persistDir);
    const row = recordCapabilityGapEvent({
      plane,
      persistDir,
      runId: "run-rl",
      agentId: "bot-t",
      tenantId: "tenant-gap",
      category: "tool",
      reason: "unresolved_run_error",
      detail: "429 rate limit exceeded",
      sourceKind: "run_error",
    });
    expect(row.recorded).toBe(false);
    expect(row.metricOnly).toBe(true);
    expect(plane.listProposals()).toHaveLength(0);
  });

  it("tenant scoping: gaps without tenant do not match globally on usage resolve", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-cap-gap-tenant-"));
    tempDirs.push(root);
    const persistDir = path.join(root, "control");
    // Platform-scoped grant for null tenant
    resetSharedDiagnosisDelegationForTests();
    const machine = getSharedDiagnosisDelegationMachine(persistDir);
    ensureCapabilityGapSystemGrant({ machine, tenantId: null });
    const plane = createGatewayEvolutionControlPlane({
      persistDir,
      cfg: { agents: { list: [] } } as unknown as OpenBotConfig,
    });
    recordCapabilityGapEvent({
      plane,
      persistDir,
      runId: "run-no-tenant",
      agentId: "bot-gap",
      tenantId: null,
      sessionKey: null,
      category: "skill",
      reason: "web-search",
      explicitMarker: true,
      sourceKind: "marker",
      dedupWindowMs: 0,
    });
    const closed = tryResolveCapabilityGapsFromUsage({
      plane,
      tenantId: null,
      agentId: "bot-gap",
      usedToolOrSkillIds: ["web-search"],
      runId: "run-x",
    });
    expect(closed.closed).toEqual([]);
  });
});
