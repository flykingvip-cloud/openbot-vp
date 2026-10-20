import { afterEach, describe, expect, it } from "vitest";
import { decideAcceptance } from "./approval.js";
import type { SiteCapabilityManifest } from "./contract.js";
import {
  SAR_BUDGET_QUERY_ID,
  SAR_FIXTURE_BINDING_ID,
  SAR_FIXTURE_PRINCIPAL,
  SAR_PUBLIC_QUERY_ID,
  SAR_PUBLIC_VERSION,
  createControllableSiteHarness,
} from "./fixture-runtime.js";
import { SiteLearningLoop } from "./learning-loop.js";
import { SAR_FIXTURE_GROUND_TRUTH, SAR_FIXTURE_ORIGIN } from "./test-site.js";
import { ThinValidationRunner } from "./validation-record.js";
import { resolveRunVerification, type SiteBusinessVerifier } from "./verification-gate.js";

const NOW = Date.parse("2026-10-18T00:00:00.000Z");
const LEARNED_ID = "fixture.sar.r1.notes";
const LEARNED_VERSION = "1.0.0";

const harnesses: Array<{ dispose: () => void }> = [];

afterEach(() => {
  for (const harness of harnesses) {
    harness.dispose();
  }
  harnesses.length = 0;
});

function setup(options?: { verifier?: SiteBusinessVerifier }) {
  const created = createControllableSiteHarness(options);
  harnesses.push(created);
  const loop = new SiteLearningLoop(created.runtime, { now: () => NOW });
  return { ...created, loop };
}

function notesManifest(): SiteCapabilityManifest {
  return {
    schemaVersion: "1",
    id: LEARNED_ID,
    version: LEARNED_VERSION,
    site: "fixture.sar.test",
    operation: "notes.read",
    description: "Read fixture notes by topic",
    effect: "read",
    authMode: "none",
    executionMode: "browser_dom",
    allowedOrigins: [SAR_FIXTURE_ORIGIN],
    permissions: ["navigate", "capture_result"],
  };
}

function exploreNotes(loop: SiteLearningLoop, topic: string) {
  return loop.explore({
    principal: SAR_FIXTURE_PRINCIPAL,
    accountBindingId: SAR_FIXTURE_BINDING_ID,
    manifest: notesManifest(),
    inputFields: [{ name: "topic", required: true }],
    plan: [
      { op: "navigate", urlTemplate: `${SAR_FIXTURE_ORIGIN}/notes?topic={topic}` },
      { op: "capture_result", fields: ["topic", "notes"] },
    ],
    args: { topic },
  });
}

describe("R1 verification semantics", () => {
  it("keeps completeness and verification independent when no verifier ran", async () => {
    const { runtime } = setup();
    const complete = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: SAR_FIXTURE_GROUND_TRUTH.publicQuery.query },
    });
    expect(complete.status).toBe("succeeded");
    expect(complete.completeness).toBe("complete");
    expect(complete.verification).toBe("not_performed");
    expect(complete.verification).not.toBe("passed");
    expect(runtime.readEvidence(complete.evidenceRef)?.verification).toBe("not_performed");

    const partial = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_BUDGET_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "widget" },
    });
    expect(partial.completeness).toBe("partial");
    expect(partial.verification).toBe("not_performed");

    expect(
      resolveRunVerification({
        status: "succeeded",
        completeness: "complete",
        capabilityId: SAR_PUBLIC_QUERY_ID,
        version: SAR_PUBLIC_VERSION,
        artifactDigest: "sha256:fixture",
        data: complete.data,
      }),
    ).toBe("not_performed");
    expect(
      resolveRunVerification({
        status: "unknown",
        completeness: "complete",
        verifier: () => "passed",
        capabilityId: SAR_PUBLIC_QUERY_ID,
        version: SAR_PUBLIC_VERSION,
        artifactDigest: "sha256:fixture",
        data: null,
      }),
    ).toBe("not_performed");
    expect(
      resolveRunVerification({
        status: "failed",
        completeness: "complete",
        verifier: () => "passed",
        capabilityId: SAR_PUBLIC_QUERY_ID,
        version: SAR_PUBLIC_VERSION,
        artifactDigest: "sha256:fixture",
        data: null,
      }),
    ).toBe("failed");
  });

  it("does not mark failed or unknown runs as passed", async () => {
    const { site, runtime } = setup();
    site.injectError("public", "RESULT_UNKNOWN");
    const unknown = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "widget" },
    });
    expect(unknown.status).toBe("unknown");
    expect(unknown.verification).not.toBe("passed");

    site.injectError("public", "STRUCTURE_CHANGED");
    const failed = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "widget" },
    });
    expect(failed.status).toBe("failed");
    expect(failed.verification).not.toBe("passed");
  });

  it("passes verification only after the verifier returns passed", async () => {
    const passed = setup({
      verifier: () => "passed",
    });
    const partial = await passed.runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_BUDGET_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "widget" },
    });
    expect(partial.status).toBe("succeeded");
    expect(partial.completeness).toBe("partial");
    expect(partial.verification).toBe("passed");

    const rejected = setup({
      verifier: () => "failed",
    });
    const complete = await rejected.runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "widget" },
    });
    expect(complete.completeness).toBe("complete");
    expect(complete.verification).toBe("failed");
    expect(complete.verification).not.toBe("passed");
  });

  it("does not let an unverified complete read or a wrong result become callable", async () => {
    const { runtime, loop } = setup();
    const explored = await exploreNotes(loop, SAR_FIXTURE_GROUND_TRUTH.notes.taskA.topic);
    expect(explored.ok).toBe(true);
    if (!explored.ok) {
      return;
    }
    expect(explored.result.completeness).toBe("complete");
    expect(explored.result.verification).toBe("not_performed");
    expect(explored.evidence.verification).toBe("not_performed");
    const drafted = loop.draftFromEvidence(explored.evidence.evidenceRef);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) {
      return;
    }
    expect(drafted.draft.enabled).toBe(false);
    const missing = loop.accept({
      draftId: drafted.draft.draftId,
      validationRecordId: "missing",
      reviewer: "human-reviewer",
    });
    expect(missing.ok).toBe(false);

    const wrong = await loop.validate({
      draftId: drafted.draft.draftId,
      principal: SAR_FIXTURE_PRINCIPAL,
      args: { topic: "beta" },
      reviewer: "fixture-reviewer",
      basis: { kind: "test_site_ground_truth", expected: { topic: "beta", notes: [] } },
    });
    expect(wrong.ok).toBe(true);
    if (!wrong.ok) {
      return;
    }
    expect(wrong.record.verdict).toBe("failed");
    expect(wrong.record.promotable).toBe(false);
    const rejected = loop.accept({
      draftId: drafted.draft.draftId,
      validationRecordId: wrong.record.recordId,
      reviewer: "human-reviewer",
    });
    expect(rejected.ok).toBe(false);
    expect(loop.readDraft(drafted.draft.draftId)?.lifecycle).toBe("private");
    const invoked = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: LEARNED_ID,
      version: LEARNED_VERSION,
      args: { topic: "beta" },
    });
    expect(invoked.error?.code).toBe("NOT_AUTHORIZED");
    expect(invoked.verification).not.toBe("passed");
  });

  it("rejects a human pass on a failed or unknown run unless independent evidence is stored", async () => {
    const { site, runtime, loop } = setup();
    const explored = await exploreNotes(loop, "alpha");
    expect(explored.ok).toBe(true);
    if (!explored.ok) {
      return;
    }
    const drafted = loop.draftFromEvidence(explored.evidence.evidenceRef);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) {
      return;
    }

    site.injectError("notes", "RESULT_UNKNOWN");
    const unknown = await loop.validate({
      draftId: drafted.draft.draftId,
      principal: SAR_FIXTURE_PRINCIPAL,
      args: { topic: "beta" },
      reviewer: "fixture-reviewer",
      basis: { kind: "human", statement: "Tried to accept an unknown capture." },
      humanVerdict: "passed",
      humanReason: "The reviewer only wrote a pass.",
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.message).toContain("independent review evidence");
    }

    site.injectError("notes", "STRUCTURE_CHANGED");
    const failed = await loop.validate({
      draftId: drafted.draft.draftId,
      principal: SAR_FIXTURE_PRINCIPAL,
      args: { topic: "beta" },
      reviewer: "fixture-reviewer",
      basis: { kind: "human", statement: "Tried to accept a failed capture." },
      humanVerdict: "passed",
      humanReason: "humanVerdict alone",
    });
    expect(failed.ok).toBe(false);

    const sameEvidence = runtime.readEvidence(explored.result.evidenceRef);
    expect(sameEvidence).toBeDefined();
    if (!sameEvidence) {
      return;
    }
    const reused = new ThinValidationRunner(() => "val_reused").assess({
      capabilityId: LEARNED_ID,
      version: LEARNED_VERSION,
      artifactDigest: drafted.draft.artifactDigest,
      args: { topic: "beta" },
      generationParams: { topic: "alpha" },
      run: {
        ...explored.result,
        status: "failed",
        verification: "failed",
      },
      evidence: {
        ...sameEvidence,
        status: "failed",
        verification: "failed",
      },
      reviewer: "fixture-reviewer",
      reviewedAt: "2026-10-18T00:00:00.000Z",
      basis: { kind: "human", statement: "Reuse the run evidence ref." },
      humanVerdict: "passed",
      humanReason: "same evidence",
      independentReviewEvidence: {
        evidenceRef: explored.result.evidenceRef,
        statement: "This is still the run evidence.",
        artifactDigest: drafted.draft.artifactDigest,
      },
    });
    expect(reused.ok).toBe(false);

    const kept = await loop.validate({
      draftId: drafted.draft.draftId,
      principal: SAR_FIXTURE_PRINCIPAL,
      args: { topic: "beta" },
      reviewer: "fixture-reviewer",
      basis: { kind: "human", statement: "Failed run kept for audit." },
      humanVerdict: "passed",
      humanReason: "Reviewer recorded a separate ledger check.",
      independentReviewEvidence: {
        evidenceRef: "review-ev-r1",
        statement: "Ledger row checked outside the failed run.",
        artifactDigest: drafted.draft.artifactDigest,
      },
    });
    expect(kept.ok).toBe(true);
    if (!kept.ok) {
      return;
    }
    expect(kept.record.verdict).toBe("passed");
    expect(kept.record.promotable).toBe(false);
    expect(kept.record.runStatus).toBe("failed");
    expect(kept.record.independentReviewEvidence).toMatchObject({
      evidenceRef: "review-ev-r1",
      artifactDigest: drafted.draft.artifactDigest,
    });
    expect(kept.record.independentReviewEvidence?.evidenceRef).not.toBe(kept.record.evidenceRef);
    const accepted = loop.accept({
      draftId: drafted.draft.draftId,
      validationRecordId: kept.record.recordId,
      reviewer: "human-reviewer",
    });
    expect(accepted.ok).toBe(false);
    expect(loop.readDraft(drafted.draft.draftId)?.enabled).toBe(false);
    const invoked = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: LEARNED_ID,
      version: LEARNED_VERSION,
      args: { topic: "beta" },
    });
    expect(invoked.error?.code).toBe("NOT_AUTHORIZED");
  });

  it("promotes a held-out human pass only when the run itself succeeded", async () => {
    const { runtime, loop } = setup();
    const explored = await exploreNotes(loop, "alpha");
    expect(explored.ok).toBe(true);
    if (!explored.ok) {
      return;
    }
    const drafted = loop.draftFromEvidence(explored.evidence.evidenceRef);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) {
      return;
    }
    const human = await loop.validate({
      draftId: drafted.draft.draftId,
      principal: SAR_FIXTURE_PRINCIPAL,
      args: { topic: "beta" },
      reviewer: "fixture-reviewer",
      basis: { kind: "human", statement: "Beta note matches the fixture ledger." },
      humanVerdict: "passed",
      humanReason: "Reviewer compared the succeeded output.",
    });
    expect(human.ok).toBe(true);
    if (!human.ok) {
      return;
    }
    expect(human.record.runStatus).toBe("succeeded");
    expect(human.record.runVerification).toBe("not_performed");
    expect(human.record.promotable).toBe(true);
    expect(human.record.independentReviewEvidence).toBeUndefined();
    const accepted = loop.accept({
      draftId: drafted.draft.draftId,
      validationRecordId: human.record.recordId,
      reviewer: "human-reviewer",
    });
    expect(accepted.ok).toBe(true);
    const described = runtime.describe(SAR_FIXTURE_PRINCIPAL, LEARNED_ID, LEARNED_VERSION);
    expect(described.ok).toBe(true);
    if (!described.ok) {
      return;
    }
    expect(described.capability.verification).toBe("passed");
    expect(described.capability.availability).toBe("available");
    const invoked = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: LEARNED_ID,
      version: LEARNED_VERSION,
      args: { topic: "beta" },
    });
    expect(invoked.status).toBe("succeeded");
    expect(invoked.completeness).toBe("complete");
    expect(invoked.verification).toBe("not_performed");
  });

  it("does not accept a non-promotable record through decideAcceptance", () => {
    const decided = decideAcceptance({
      draft: {
        draftId: "draft-r1",
        capabilityId: LEARNED_ID,
        version: LEARNED_VERSION,
        lifecycle: "private",
        enabled: false,
        published: false,
        manifest: notesManifest(),
        plan: [],
        inputFields: [],
        artifactDigest: "sha256:r1",
        sourceEvidenceRef: "ev-source",
        generationParams: {},
        accountBindingIds: [SAR_FIXTURE_BINDING_ID],
        tenantId: SAR_FIXTURE_PRINCIPAL.tenantId,
        userId: SAR_FIXTURE_PRINCIPAL.userId,
        packageId: "private:r1",
        createdAt: "2026-10-18T00:00:00.000Z",
      },
      validation: {
        recordId: "val-r1",
        capabilityId: LEARNED_ID,
        version: LEARNED_VERSION,
        artifactDigest: "sha256:r1",
        input: { topic: "beta" },
        participatedInDraftGeneration: false,
        basis: { kind: "human", statement: "exception" },
        runId: "sarun_failed",
        evidenceRef: "ev-run",
        output: null,
        completeness: "complete",
        verdict: "passed",
        reviewer: "fixture-reviewer",
        reviewedAt: "2026-10-18T00:00:00.000Z",
        reason: "separate ledger",
        runStatus: "unknown",
        runVerification: "not_performed",
        promotable: false,
        independentReviewEvidence: {
          evidenceRef: "review-ev-r1",
          statement: "outside the unknown run",
          artifactDigest: "sha256:r1",
        },
      },
      reviewer: "human-reviewer",
      acceptedAt: "2026-10-18T00:00:00.000Z",
    });
    expect(decided.ok).toBe(false);
  });
});
