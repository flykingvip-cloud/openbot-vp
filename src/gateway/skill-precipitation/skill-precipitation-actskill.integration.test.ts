/**
 * Integration: capability-gap-consumer.actSkill ↔ skill-precipitation.
 *
 * Unit tests cover detect/persist in isolation; the production-loop test covers
 * gap → draft → review → close. This suite exercises the real consumer wiring:
 * rich trajectory → precipitation recipe draft; insufficient → partial stub;
 * fail-closed (no "learned" claim, draft + no auto-install).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSkillAutoEvolutionEnabled } from "../evolution-governance/skill-auto-evolution.js";
import { renderSkillMarkdown } from "../skill-execution-binding/materialize.js";

const { CONFIG_DIR } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require("node:os") as typeof import("node:os");
  return {
    CONFIG_DIR: nodePath.join(
      nodeOs.tmpdir(),
      `openbot-actskill-precip-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ),
  };
});

vi.mock("../../utils.js", () => ({ CONFIG_DIR }));

const {
  getPersonalSkillAssetDetail,
  getSkillRuntimeDefinitionForBinding,
  listRobotSkillAssets,
  resetSkillHealthWindowsCacheForTests,
} = await import("../skill-lifecycle-store.js");
const { resetEvolutionControlPlaneForTests } = await import("../evolution-control/bootstrap.js");
const {
  configureCapabilityGapConsumer,
  resetCapabilityGapConsumerConfigForTests,
  runCapabilityGapConsumerTick,
} = await import("../evolution-control/capability-gap-consumer.js");
const { ensureCapabilityGapSystemGrant } =
  await import("../evolution-control/capability-gap-grant.js");
const { recordCapabilityGapEvent, resetCapabilityGapDedupForTests } =
  await import("../evolution-control/capability-gap-ingest.js");
const { getSharedDiagnosisDelegationMachine, resetSharedDiagnosisDelegationForTests } =
  await import("../evolution-control/delegation-service.js");
const { resetEvolutionLoopLogsForTests } =
  await import("../evolution-control/evolution-loop-log.js");
const { createGatewayEvolutionControlPlane } =
  await import("../evolution-control/gateway-plane.js");

const TENANT = "tenant-actskill-precip";
const AGENT = "bot-actskill-precip";
const OWNER = "user-owner-actskill-precip";

type PrecipitationHints = {
  precipitation?: {
    completeness?: string;
    completenessReason?: string;
    confidence?: number;
    sourceEvidenceRefs?: string[];
  };
};

describe("actSkill ↔ skill-precipitation integration", () => {
  let persistDir = "";

  beforeEach(async () => {
    resetEvolutionLoopLogsForTests();
    resetCapabilityGapDedupForTests();
    resetCapabilityGapConsumerConfigForTests();
    resetSharedDiagnosisDelegationForTests();
    resetEvolutionControlPlaneForTests();
    resetSkillHealthWindowsCacheForTests();
    await fs.rm(CONFIG_DIR, { recursive: true, force: true });
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    persistDir = path.join(
      CONFIG_DIR,
      `control-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    await fs.mkdir(persistDir, { recursive: true });
  });

  afterEach(async () => {
    resetSharedDiagnosisDelegationForTests();
    resetEvolutionControlPlaneForTests();
    resetCapabilityGapConsumerConfigForTests();
    resetCapabilityGapDedupForTests();
    resetSkillHealthWindowsCacheForTests();
    await fs.rm(CONFIG_DIR, { recursive: true, force: true });
  });

  function bootPlane() {
    const machine = getSharedDiagnosisDelegationMachine(persistDir);
    const ensured = ensureCapabilityGapSystemGrant({ machine, tenantId: TENANT });
    expect(ensured.grant.status).toBe("APPROVED");
    const plane = createGatewayEvolutionControlPlane({
      persistDir,
      cfg: { agents: { list: [] } } as never,
    });
    return { plane };
  }

  function assertDraftNotLearned(skillId: string) {
    const detail = getPersonalSkillAssetDetail(skillId);
    expect(detail.lifecycle).toBe("draft");
    expect(["approved", "published", "private", "reviewing"]).not.toContain(detail.lifecycle);
    // Consumer always passes autoInstallEnabled=false — robot must not gain the skill.
    expect(listRobotSkillAssets(AGENT).some((row) => row.id === skillId)).toBe(false);
    const blob = JSON.stringify(detail).toLowerCase();
    expect(blob).not.toMatch(/\blearned\b|\b已学会\b/);
  }

  it("rich multi-step success trajectory through actSkill yields recipe draft (When/Red lines/Pipeline)", () => {
    const { plane } = bootPlane();
    configureCapabilityGapConsumer({ explicitMarkerThreshold: 1, occurrenceThreshold: 2 });

    const recorded = recordCapabilityGapEvent({
      plane,
      persistDir,
      runId: "run-rich-precip-1",
      agentId: AGENT,
      tenantId: TENANT,
      sessionKey: `agent:${AGENT}:main`,
      chatType: "direct",
      category: "skill",
      reason: "dual_track_path_b_cutover",
      detail: "dual_track_path_b_cutover",
      explicitMarker: true,
      sourceKind: "marker",
      ownerUserId: OWNER,
      userLanguageSummary: "缺少可复用的 Path B 切换配方",
      dedupWindowMs: 0,
    });
    expect(recorded.recorded).toBe(true);
    expect(recorded.proposal?.status).toBe("DISCOVERED");

    const proposal = plane.getProposal(recorded.proposalId!);
    expect(proposal).toBeTruthy();
    const prev = (plane.getCandidate(proposal!.candidateRef)?.payload ?? {}) as Record<
      string,
      unknown
    >;
    plane.registerCandidate(proposal!.candidateRef, {
      ...prev,
      trajectory: {
        whenToUse: "Use when cutting over dual-track Path B after PRODUCTION_GO DIGEST",
        nameHint: "Path B cutover recipe",
        steps: [
          { instruction: "Pin tip SHA and update oneshot templates", tools: ["shell"] },
          { instruction: "Build amd64 image and recreate LIVE Path B", tools: ["docker", "ssh"] },
          { instruction: "Verify sandbox exec.host and health endpoints", tools: ["ssh"] },
          {
            instruction:
              "Write ledger entry in OHBE (https://github.com/flykingvip-cloud/harness-Benchmark-Engine) before merge",
            tools: ["gh"],
          },
        ],
        redLines: [
          "No self-merge without OHBE PASS (https://github.com/flykingvip-cloud/harness-Benchmark-Engine)",
          "Do not enable auto failover",
        ],
        acceptance: ["LIVE healthz OK", "ledger seq+1"],
        failureModes: ["gateway crash-loop if exec.host=node"],
        toolsUsed: ["shell", "docker", "ssh", "gh"],
        succeeded: true,
        knownEphemeralParams: ["tipSha", "evidenceDir"],
      },
    });

    const tick = runCapabilityGapConsumerTick({ plane, persistDir });
    expect(tick.acted).toBeGreaterThanOrEqual(1);

    const suggested = plane.getProposal(recorded.proposalId!);
    expect(suggested?.status).toBe("SUGGESTED");
    const payload = plane.getCandidate(suggested!.candidateRef)?.payload as {
      draftSkillId?: string;
    };
    expect(payload.draftSkillId).toBeTruthy();
    const draftId = payload.draftSkillId!;

    assertDraftNotLearned(draftId);
    const detail = getPersonalSkillAssetDetail(draftId);
    expect(detail.ownerUserId).toBe(OWNER);
    expect(detail.profile.tags).toEqual(expect.arrayContaining(["precipitation"]));

    const binding = getSkillRuntimeDefinitionForBinding(draftId);
    expect(binding.lifecycle).toBe("draft");
    const prompts = binding.runtimeDefinition.prompts.join("\n");
    expect(prompts).toMatch(/## When/);
    expect(prompts).toMatch(/## Red lines/i);
    expect(prompts).toMatch(/## Pipeline/);
    expect(prompts).toMatch(/Pin tip SHA|Build amd64|Verify sandbox|Write ledger/i);
    expect(prompts).toMatch(/No self-merge|OHBE PASS/i);

    const hints = binding.runtimeDefinition.routingHints as PrecipitationHints;
    expect(hints.precipitation?.completeness).toBe("full");
    expect(hints.precipitation?.confidence).toBeGreaterThanOrEqual(0.7);
    expect(hints.precipitation?.sourceEvidenceRefs?.length).toBeGreaterThanOrEqual(1);

    const md = renderSkillMarkdown({
      skillId: draftId,
      installedVersion: binding.version,
      profile: binding.profile,
      runtimeDefinition: binding.runtimeDefinition,
    });
    expect(md).toMatch(/Pin tip SHA|Build amd64|Verify sandbox|Write ledger/i);
    expect(md).toMatch(/Red lines|No self-merge/i);
  });

  it("insufficient trajectory through actSkill writes partial stub without claiming learned", () => {
    const { plane } = bootPlane();
    configureCapabilityGapConsumer({ explicitMarkerThreshold: 1, occurrenceThreshold: 2 });

    // Marker opens the gap; then attach a deliberately weak trajectory (short whenToUse,
    // no steps, not succeeded). actSkill still injects fallback evidence, but confidence
    // stays below persist threshold → legacy draft stub with routingHints.partial.
    const recorded = recordCapabilityGapEvent({
      plane,
      persistDir,
      runId: "run-sparse-1",
      agentId: AGENT,
      tenantId: TENANT,
      sessionKey: `agent:${AGENT}:sparse`,
      chatType: "direct",
      category: "skill",
      reason: "pdf_ocr_sparse",
      detail: "x",
      explicitMarker: true,
      sourceKind: "marker",
      ownerUserId: OWNER,
      userLanguageSummary: "gap",
      dedupWindowMs: 0,
    });
    expect(recorded.recorded).toBe(true);

    const proposal = plane.getProposal(recorded.proposalId!);
    expect(proposal).toBeTruthy();
    const prev = (plane.getCandidate(proposal!.candidateRef)?.payload ?? {}) as Record<
      string,
      unknown
    >;
    plane.registerCandidate(proposal!.candidateRef, {
      ...prev,
      trajectory: {
        whenToUse: "gap",
        nameHint: "gap",
        steps: [],
        detail: "x",
        succeeded: false,
        sourceEvidenceRefs: [],
      },
    });

    const tick = runCapabilityGapConsumerTick({ plane, persistDir });
    expect(tick.acted).toBeGreaterThanOrEqual(1);

    const suggested = plane.getProposal(recorded.proposalId!);
    expect(suggested?.status).toBe("SUGGESTED");
    const payload = plane.getCandidate(suggested!.candidateRef)?.payload as {
      draftSkillId?: string;
    };
    expect(payload.draftSkillId).toBeTruthy();
    const draftId = payload.draftSkillId!;

    assertDraftNotLearned(draftId);
    const detail = getPersonalSkillAssetDetail(draftId);
    expect(detail.ownerUserId).toBe(OWNER);
    // Legacy stub profile tags, not precipitation recipe tags.
    expect(detail.profile.tags).toEqual(expect.arrayContaining(["capability-gap"]));
    expect(detail.profile.tags).not.toContain("precipitation");

    const binding = getSkillRuntimeDefinitionForBinding(draftId);
    const hints = binding.runtimeDefinition.routingHints as PrecipitationHints;
    expect(hints.precipitation?.completeness).toBe("partial");
    expect(hints.precipitation?.completenessReason).toMatch(/confidence|insufficient|missing/i);
    // Stub prompts are not a When/Pipeline recipe body.
    const prompts = binding.runtimeDefinition.prompts.join("\n");
    expect(prompts).not.toMatch(/## Pipeline/);
    expect(prompts).not.toMatch(/## Red lines/i);
  });

  it("fail-closed: low-confidence actSkill path stays draft; auto-evolution remains off", () => {
    const { plane } = bootPlane();
    configureCapabilityGapConsumer({ explicitMarkerThreshold: 1, occurrenceThreshold: 2 });

    const recorded = recordCapabilityGapEvent({
      plane,
      persistDir,
      runId: "run-lowconf-1",
      agentId: AGENT,
      tenantId: TENANT,
      sessionKey: `agent:${AGENT}:lowconf`,
      chatType: "direct",
      category: "skill",
      reason: "vague_gap_lowconf",
      detail: "vague",
      explicitMarker: true,
      sourceKind: "marker",
      ownerUserId: OWNER,
      userLanguageSummary: "vague",
      dedupWindowMs: 0,
    });
    expect(recorded.recorded).toBe(true);

    const proposal = plane.getProposal(recorded.proposalId!);
    const prev = (plane.getCandidate(proposal!.candidateRef)?.payload ?? {}) as Record<
      string,
      unknown
    >;
    // Explicit low-quality trajectory: no steps, not succeeded → confidence skip → stub.
    // Note: actSkill always injects fallbackEvidenceId, so the missing-evidence gate is soft
    // on the consumer path; low confidence is the fail-closed signal exercised here.
    plane.registerCandidate(proposal!.candidateRef, {
      ...prev,
      trajectory: {
        whenToUse: "vague",
        steps: [],
        succeeded: false,
        sourceEvidenceRefs: [],
      },
    });

    const tick = runCapabilityGapConsumerTick({ plane, persistDir });
    expect(tick.acted).toBeGreaterThanOrEqual(1);

    const suggested = plane.getProposal(recorded.proposalId!);
    const payload = plane.getCandidate(suggested!.candidateRef)?.payload as {
      draftSkillId?: string;
    };
    expect(payload.draftSkillId).toBeTruthy();
    const draftId = payload.draftSkillId!;

    assertDraftNotLearned(draftId);
    const binding = getSkillRuntimeDefinitionForBinding(draftId);
    const hints = binding.runtimeDefinition.routingHints as PrecipitationHints;
    expect(hints.precipitation?.completeness).toBe("partial");
    expect(typeof hints.precipitation?.confidence).toBe("number");
    expect(hints.precipitation!.confidence!).toBeLessThan(0.4);

    const prevEnv = process.env.OPENBOT_SKILL_AUTO_EVOLUTION;
    delete process.env.OPENBOT_SKILL_AUTO_EVOLUTION;
    try {
      expect(isSkillAutoEvolutionEnabled()).toBe(false);
    } finally {
      if (prevEnv === undefined) {
        delete process.env.OPENBOT_SKILL_AUTO_EVOLUTION;
      } else {
        process.env.OPENBOT_SKILL_AUTO_EVOLUTION = prevEnv;
      }
    }
  });
});
