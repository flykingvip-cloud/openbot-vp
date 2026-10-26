/**
 * R3: learning asset persistence + skill-lifecycle mirror.
 *
 * Honesty boundary (repeated in assertions):
 * - Fixture runtime / temp-dir JSON persistence ≠ verified enterprise external site
 * - This suite is not R5 real-job pilot evidence
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPersonalSkillAssetDetail,
  getSkillRuntimeDefinitionForBinding,
} from "../gateway/skill-lifecycle-store.js";
import { decideAcceptance } from "./approval.js";
import {
  SAR_FIXTURE_BINDING_ID,
  SAR_FIXTURE_PRINCIPAL,
  createControllableSiteHarness,
} from "./fixture-runtime.js";
import { SiteLearningLoop } from "./learning-loop.js";
import {
  createLearningAssetStore,
  createSkillLifecycleBridge,
  loadLearningSnapshot,
  sarLifecycleSkillId,
  type SarSkillLifecycleBridge,
} from "./learning-persistence.js";
import { SAR_FIXTURE_GROUND_TRUTH, SAR_FIXTURE_ORIGIN } from "./test-site.js";
import { ThinValidationRunner } from "./validation-record.js";

const { skillTmp } = vi.hoisted(() => ({
  skillTmp: `/tmp/openbot-sar-r3-skills-${process.pid}-${Date.now()}`,
}));

vi.mock("../utils.js", () => ({ CONFIG_DIR: skillTmp }));

const NOW = Date.parse("2026-10-18T01:00:00.000Z");
const LEARNED_ID = "fixture.sar.r3.notes";
const LEARNED_VERSION = "1.0.0";

const harnesses: Array<{ dispose: () => void }> = [];
const tempRoots: string[] = [];

afterEach(() => {
  for (const harness of harnesses) {
    harness.dispose();
  }
  harnesses.length = 0;
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

beforeEach(() => {
  fs.rmSync(path.join(skillTmp, "skill-assets"), { recursive: true, force: true });
  fs.mkdirSync(skillTmp, { recursive: true });
});

afterEach(() => {
  fs.rmSync(skillTmp, { recursive: true, force: true });
});

function tempStoreRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sar-r3-learn-"));
  tempRoots.push(root);
  return root;
}

function setup(options?: {
  storeRoot?: string;
  lifecycleBridge?: SarSkillLifecycleBridge | null;
  mintDraftId?: () => string;
  mintRecordId?: () => string;
}) {
  const created = createControllableSiteHarness();
  harnesses.push(created);
  const loop = new SiteLearningLoop(created.runtime, {
    now: () => NOW,
    storeRoot: options?.storeRoot,
    lifecycleBridge: options?.lifecycleBridge === undefined ? null : options.lifecycleBridge,
    mintDraftId: options?.mintDraftId,
    mintRecordId: options?.mintRecordId,
  });
  return { ...created, loop };
}

function notesManifest(version = LEARNED_VERSION) {
  return {
    schemaVersion: "1" as const,
    id: LEARNED_ID,
    version,
    site: "fixture.sar.test",
    operation: "notes.read",
    description: "R3 fixture notes by topic",
    effect: "read" as const,
    authMode: "none" as const,
    executionMode: "browser_dom" as const,
    allowedOrigins: [SAR_FIXTURE_ORIGIN],
    permissions: ["navigate", "capture_result"] as const,
  };
}

function notesPlan() {
  return [
    { op: "navigate", urlTemplate: `${SAR_FIXTURE_ORIGIN}/notes?topic={topic}` },
    { op: "capture_result", fields: ["topic", "notes"] },
  ];
}

function exploreNotes(loop: SiteLearningLoop, topic: string) {
  return loop.explore({
    principal: SAR_FIXTURE_PRINCIPAL,
    accountBindingId: SAR_FIXTURE_BINDING_ID,
    manifest: notesManifest(),
    inputFields: [{ name: "topic", required: true }],
    plan: notesPlan(),
    args: { topic },
  });
}

function recordingBridge(): SarSkillLifecycleBridge & {
  privateCalls: string[];
  approvedCalls: string[];
} {
  const privateCalls: string[] = [];
  const approvedCalls: string[] = [];
  const states = new Map<string, "private" | "approved">();
  return {
    privateCalls,
    approvedCalls,
    ensurePrivate(draft) {
      const skillId = sarLifecycleSkillId(draft.draftId);
      privateCalls.push(skillId);
      if (!states.has(skillId)) {
        states.set(skillId, "private");
      }
      return { skillId };
    },
    markApproved(skillId) {
      approvedCalls.push(skillId);
      states.set(skillId, "approved");
      return { skillId, lifecycle: "approved" };
    },
    readLifecycle(skillId) {
      return states.get(skillId) ?? null;
    },
  };
}

describe("R3 learning asset persistence", () => {
  it("survives process restart: write disk → new loop instance still has assets", async () => {
    const storeRoot = tempStoreRoot();
    const bridge = recordingBridge();
    const first = setup({
      storeRoot,
      lifecycleBridge: bridge,
      mintDraftId: () => "draft_r3_restart",
      mintRecordId: () => "val_r3_restart",
    });

    const explored = await exploreNotes(first.loop, SAR_FIXTURE_GROUND_TRUTH.notes.taskA.topic);
    expect(explored.ok).toBe(true);
    if (!explored.ok) {
      return;
    }
    const drafted = first.loop.draftFromEvidence(explored.evidence.evidenceRef);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) {
      return;
    }

    const heldOut = await first.loop.validate({
      draftId: drafted.draft.draftId,
      principal: SAR_FIXTURE_PRINCIPAL,
      args: { topic: SAR_FIXTURE_GROUND_TRUTH.notes.heldOut.topic },
      reviewer: "fixture-reviewer",
      basis: {
        kind: "test_site_ground_truth",
        expected: {
          topic: "beta",
          notes: SAR_FIXTURE_GROUND_TRUTH.notes.heldOut.notes,
        },
      },
    });
    expect(heldOut.ok).toBe(true);
    if (!heldOut.ok) {
      return;
    }

    const accepted = first.loop.accept({
      draftId: drafted.draft.draftId,
      validationRecordId: heldOut.record.recordId,
      reviewer: "human-reviewer",
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }

    const onDisk = loadLearningSnapshot(storeRoot);
    expect(onDisk.drafts).toHaveLength(1);
    expect(onDisk.drafts[0]?.lifecycle).toBe("approved");
    expect(onDisk.evidence).toHaveLength(1);
    expect(onDisk.validations).toHaveLength(1);
    expect(onDisk.acceptances).toHaveLength(1);
    expect(onDisk.lifecycleSkillIds["draft_r3_restart"]).toBe(
      sarLifecycleSkillId("draft_r3_restart"),
    );
    expect(fs.existsSync(path.join(storeRoot, "learning-assets.json"))).toBe(true);

    // Simulate process restart: dispose first runtime, new harness + new loop on same root.
    first.dispose();
    harnesses.length = 0;
    const second = setup({
      storeRoot,
      lifecycleBridge: null,
    });

    expect(second.loop.draftCount()).toBe(1);
    const recoveredDraft = second.loop.readDraft("draft_r3_restart");
    expect(recoveredDraft?.lifecycle).toBe("approved");
    expect(recoveredDraft?.enabled).toBe(true);
    expect(recoveredDraft?.sourceEvidenceRef).toBe(explored.evidence.evidenceRef);
    expect(second.loop.readEvidence(explored.evidence.evidenceRef)?.runId).toBe(
      explored.evidence.runId,
    );
    expect(second.loop.readValidation("val_r3_restart")?.verdict).toBe("passed");
    expect(second.loop.readAcceptance("draft_r3_restart")?.reviewer).toBe("human-reviewer");
    expect(second.loop.readLifecycleSkillId("draft_r3_restart")).toBe(
      sarLifecycleSkillId("draft_r3_restart"),
    );

    // Honesty: temp-dir fixture persistence is not enterprise/R5.
    expect(storeRoot).toContain("sar-r3-learn-");
    expect(LEARNED_ID).toMatch(/^fixture\./);
  });

  it("real execution evidence produces a new draft entry (fixture runtime, honestly labeled)", async () => {
    const storeRoot = tempStoreRoot();
    const { loop, runtime } = setup({
      storeRoot,
      lifecycleBridge: null,
      mintDraftId: () => "draft_r3_evidence",
    });

    const explored = await exploreNotes(loop, SAR_FIXTURE_GROUND_TRUTH.notes.taskA.topic);
    expect(explored.ok).toBe(true);
    if (!explored.ok) {
      return;
    }
    // Evidence comes from the controllable fixture port — not an external enterprise site.
    expect(runtime.readEvidence(explored.evidence.evidenceRef)?.runId).toBe(explored.result.runId);
    expect(explored.result.status).toBe("succeeded");
    expect(explored.evidence.completeness).toBe("complete");

    const drafted = loop.draftFromEvidence(explored.evidence.evidenceRef);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) {
      return;
    }
    expect(drafted.draft.lifecycle).toBe("private");
    expect(drafted.draft.enabled).toBe(false);
    expect(drafted.draft.sourceEvidenceRef).toBe(explored.evidence.evidenceRef);
    expect(drafted.draft.generationParams).toEqual({
      topic: SAR_FIXTURE_GROUND_TRUTH.notes.taskA.topic,
    });

    // After "restart", evidence still yields the same draft identity already stored;
    // a second explore can mint another draft from fresh evidence.
    const restarted = new SiteLearningLoop(runtime, {
      now: () => NOW,
      storeRoot,
      lifecycleBridge: null,
      mintDraftId: () => "draft_r3_evidence_b",
    });
    const again = await exploreNotes(restarted, SAR_FIXTURE_GROUND_TRUTH.notes.heldOut.topic);
    expect(again.ok).toBe(true);
    if (!again.ok) {
      return;
    }
    const secondDraft = restarted.draftFromEvidence(again.evidence.evidenceRef);
    expect(secondDraft.ok).toBe(true);
    if (!secondDraft.ok) {
      return;
    }
    expect(secondDraft.draft.draftId).toBe("draft_r3_evidence_b");
    expect(restarted.draftCount()).toBe(2);
    expect(
      loadLearningSnapshot(storeRoot)
        .drafts.map((d) => d.draftId)
        .toSorted(),
    ).toEqual(["draft_r3_evidence", "draft_r3_evidence_b"]);
  });

  it("rejects empty / whitespace reviewer on validate and accept (no empty-string bypass)", async () => {
    const { loop } = setup({ lifecycleBridge: null });
    const explored = await exploreNotes(loop, SAR_FIXTURE_GROUND_TRUTH.notes.taskA.topic);
    expect(explored.ok).toBe(true);
    if (!explored.ok) {
      return;
    }
    const drafted = loop.draftFromEvidence(explored.evidence.evidenceRef);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) {
      return;
    }

    const emptyValidate = await loop.validate({
      draftId: drafted.draft.draftId,
      principal: SAR_FIXTURE_PRINCIPAL,
      args: { topic: "beta" },
      reviewer: "",
      basis: {
        kind: "test_site_ground_truth",
        expected: {
          topic: "beta",
          notes: SAR_FIXTURE_GROUND_TRUTH.notes.heldOut.notes,
        },
      },
    });
    expect(emptyValidate.ok).toBe(false);
    if (emptyValidate.ok) {
      return;
    }
    expect(emptyValidate.message).toMatch(/reviewer/i);

    const wsValidate = await loop.validate({
      draftId: drafted.draft.draftId,
      principal: SAR_FIXTURE_PRINCIPAL,
      args: { topic: "beta" },
      reviewer: "   \t  ",
      basis: {
        kind: "test_site_ground_truth",
        expected: {
          topic: "beta",
          notes: SAR_FIXTURE_GROUND_TRUTH.notes.heldOut.notes,
        },
      },
    });
    expect(wsValidate.ok).toBe(false);

    const runner = new ThinValidationRunner(() => "val_crafted");
    // Craft a held-out passed record then strip reviewer to prove accept still denies.
    const heldOut = await loop.validate({
      draftId: drafted.draft.draftId,
      principal: SAR_FIXTURE_PRINCIPAL,
      args: { topic: SAR_FIXTURE_GROUND_TRUTH.notes.heldOut.topic },
      reviewer: "fixture-reviewer",
      basis: {
        kind: "test_site_ground_truth",
        expected: {
          topic: "beta",
          notes: SAR_FIXTURE_GROUND_TRUTH.notes.heldOut.notes,
        },
      },
    });
    expect(heldOut.ok).toBe(true);
    if (!heldOut.ok) {
      return;
    }

    const emptyAccept = loop.accept({
      draftId: drafted.draft.draftId,
      validationRecordId: heldOut.record.recordId,
      reviewer: "",
    });
    expect(emptyAccept.ok).toBe(false);
    if (emptyAccept.ok) {
      return;
    }
    expect(emptyAccept.message).toMatch(/reviewer/i);

    const wsAccept = loop.accept({
      draftId: drafted.draft.draftId,
      validationRecordId: heldOut.record.recordId,
      reviewer: "  ",
    });
    expect(wsAccept.ok).toBe(false);

    // decideAcceptance also rejects a validation whose stored reviewer was emptied.
    const bypassed = decideAcceptance({
      draft: drafted.draft,
      validation: { ...heldOut.record, reviewer: "   " },
      reviewer: "human-reviewer",
      acceptedAt: "2026-10-18T01:00:00.000Z",
    });
    expect(bypassed.ok).toBe(false);
    if (bypassed.ok) {
      return;
    }
    expect(bypassed.message).toMatch(/reviewer|time|reason/i);

    // ThinValidationRunner itself rejects empty reviewer before storing.
    const direct = runner.assess({
      capabilityId: LEARNED_ID,
      version: LEARNED_VERSION,
      artifactDigest: drafted.draft.artifactDigest,
      args: { topic: "beta" },
      generationParams: { topic: "alpha" },
      run: {
        runId: "sarun_x",
        capabilityId: LEARNED_ID,
        version: LEARNED_VERSION,
        status: "succeeded",
        verification: "not_performed",
        completeness: "complete",
        repair: "none",
        data: { topic: "beta", notes: "n" },
        evidenceRef: "ev_x",
        durationMs: 1,
      },
      evidence: {
        evidenceRef: "ev_x",
        runId: "sarun_x",
        capabilityId: LEARNED_ID,
        version: LEARNED_VERSION,
        artifactDigest: drafted.draft.artifactDigest,
        status: "succeeded",
        verification: "not_performed",
        completeness: "complete",
      },
      reviewer: "",
      reviewedAt: "2026-10-18T01:00:00.000Z",
      basis: { kind: "human", statement: "looks fine" },
      humanVerdict: "passed",
      humanReason: "ok",
    });
    expect(direct.ok).toBe(false);
  });

  it("mirrors private→approved into skill-lifecycle-store without embedding SAR plan", async () => {
    const storeRoot = tempStoreRoot();
    const bridge = createSkillLifecycleBridge();
    const { loop } = setup({
      storeRoot,
      lifecycleBridge: bridge,
      mintDraftId: () => "draft_r3_lifecycle",
      mintRecordId: () => "val_r3_lifecycle",
    });

    const explored = await exploreNotes(loop, SAR_FIXTURE_GROUND_TRUTH.notes.taskA.topic);
    expect(explored.ok).toBe(true);
    if (!explored.ok) {
      return;
    }
    const drafted = loop.draftFromEvidence(explored.evidence.evidenceRef);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) {
      return;
    }

    const skillId = sarLifecycleSkillId("draft_r3_lifecycle");
    expect(loop.readLifecycleSkillId("draft_r3_lifecycle")).toBe(skillId);
    const privateDetail = getPersonalSkillAssetDetail(skillId);
    expect(privateDetail.lifecycle).toBe("private");
    expect(privateDetail.profile.tags).toContain("sar-site-capability");
    // Site plan must not be stuffed into skill runtime / profile as a substitute contract.
    expect(JSON.stringify(privateDetail)).not.toContain("urlTemplate");
    expect(JSON.stringify(privateDetail)).not.toContain("capture_result");
    const bindingRuntime = getSkillRuntimeDefinitionForBinding(skillId);
    expect(JSON.stringify(bindingRuntime)).not.toContain("urlTemplate");
    expect(JSON.stringify(bindingRuntime)).not.toContain("capture_result");
    expect(JSON.stringify(bindingRuntime.runtimeDefinition)).not.toContain(LEARNED_ID);
    expect(JSON.stringify(bindingRuntime.runtimeDefinition)).not.toContain("notes?topic");

    const heldOut = await loop.validate({
      draftId: drafted.draft.draftId,
      principal: SAR_FIXTURE_PRINCIPAL,
      args: { topic: SAR_FIXTURE_GROUND_TRUTH.notes.heldOut.topic },
      reviewer: "fixture-reviewer",
      basis: {
        kind: "test_site_ground_truth",
        expected: {
          topic: "beta",
          notes: SAR_FIXTURE_GROUND_TRUTH.notes.heldOut.notes,
        },
      },
    });
    expect(heldOut.ok).toBe(true);
    if (!heldOut.ok) {
      return;
    }
    const accepted = loop.accept({
      draftId: drafted.draft.draftId,
      validationRecordId: heldOut.record.recordId,
      reviewer: "human-reviewer",
    });
    expect(accepted.ok).toBe(true);
    expect(getPersonalSkillAssetDetail(skillId).lifecycle).toBe("approved");
    expect(loadLearningSnapshot(storeRoot).lifecycleSkillIds["draft_r3_lifecycle"]).toBe(skillId);
  });

  it("createLearningAssetStore round-trips an empty then non-empty snapshot", () => {
    const root = tempStoreRoot();
    const store = createLearningAssetStore(root);
    expect(store.load().drafts).toEqual([]);
    store.save({
      schemaVersion: 1,
      drafts: [],
      evidence: [],
      validations: [],
      acceptances: [],
      lifecycleSkillIds: { draft_x: "sar_lc_draft_x" },
    });
    expect(store.load().lifecycleSkillIds).toEqual({ draft_x: "sar_lc_draft_x" });
  });
});
