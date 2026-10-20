import { afterEach, describe, expect, it } from "vitest";
import { createSiteCapabilityTools } from "../agents/tools/site-capability-tools.js";
import { DEFAULT_BROWSER_EVALUATE_ENABLED } from "../browser/constants.js";
import { draftToSiteRecord } from "./draft-store.js";
import { classifySiteFailure } from "./failure-class.js";
import {
  SAR_ACCOUNT_QUERY_ID,
  SAR_FIXTURE_BINDING_ID,
  SAR_FIXTURE_PRINCIPAL,
  SAR_OTHER_PRINCIPAL,
  SAR_PUBLIC_QUERY_ID,
  SAR_PUBLIC_VERSION,
  SAR_UNGRANTED_BINDING_ID,
  createControllableSiteHarness,
} from "./fixture-runtime.js";
import { SiteLearningLoop } from "./learning-loop.js";
import { isEmptySuccess, isOrdinaryFailure, type SiteRunResult } from "./result.js";
import {
  SAR_FIXTURE_CREDENTIALS,
  SAR_FIXTURE_GROUND_TRUTH,
  SAR_FIXTURE_ORIGIN,
} from "./test-site.js";

const NOW = Date.parse("2026-10-17T00:00:00.000Z");
const LEARNED_ID = "fixture.sar.learned.notes";
const LEARNED_VERSION = "1.0.0";

const harnesses: Array<{ dispose: () => void }> = [];

afterEach(() => {
  for (const harness of harnesses) {
    harness.dispose();
  }
  harnesses.length = 0;
});

function setup() {
  const created = createControllableSiteHarness();
  harnesses.push(created);
  const loop = new SiteLearningLoop(created.runtime, { now: () => NOW });
  return { ...created, loop };
}

function notesManifest(version = LEARNED_VERSION) {
  return {
    schemaVersion: "1" as const,
    id: LEARNED_ID,
    version,
    site: "fixture.sar.test",
    operation: "notes.read",
    description: "Read fixture notes by topic",
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

function notesInput() {
  return [{ name: "topic", required: true }];
}

function exploreNotes(loop: SiteLearningLoop, topic: string) {
  return loop.explore({
    principal: SAR_FIXTURE_PRINCIPAL,
    accountBindingId: SAR_FIXTURE_BINDING_ID,
    manifest: notesManifest(),
    inputFields: notesInput(),
    plan: notesPlan(),
    args: { topic },
  });
}

describe("P2 learning loop", () => {
  it("learns task A, passes held-out params B, then site_invoke succeeds", async () => {
    const { runtime, loop } = setup();
    expect(DEFAULT_BROWSER_EVALUATE_ENABLED).toBe(true);

    const explored = await exploreNotes(loop, SAR_FIXTURE_GROUND_TRUTH.notes.taskA.topic);
    expect(explored.ok).toBe(true);
    if (!explored.ok) {
      return;
    }
    expect(explored.result.repair).toBe("none");
    expect(explored.evidence.output).toEqual({
      topic: "alpha",
      notes: SAR_FIXTURE_GROUND_TRUTH.notes.taskA.notes,
    });

    const drafted = loop.draftFromEvidence(explored.evidence.evidenceRef);
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) {
      return;
    }
    const draft = drafted.draft;
    expect(draft.lifecycle).toBe("private");
    expect(draft.enabled).toBe(false);
    expect(draft.published).toBe(false);
    expect(draft.plan.map((step) => step.op)).toEqual(["navigate", "capture_result"]);
    expect(draft.generationParams).toEqual({ topic: "alpha" });

    const hidden = runtime.list(SAR_FIXTURE_PRINCIPAL);
    expect(hidden.ok).toBe(true);
    if (!hidden.ok) {
      return;
    }
    expect(hidden.items.map((item) => item.capabilityId)).not.toContain(LEARNED_ID);
    const blocked = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: LEARNED_ID,
      version: LEARNED_VERSION,
      args: { topic: "beta" },
    });
    expect(blocked.error?.code).toBe("NOT_AUTHORIZED");

    const seen = await loop.validate({
      draftId: draft.draftId,
      principal: SAR_FIXTURE_PRINCIPAL,
      args: { topic: "alpha" },
      reviewer: "fixture-reviewer",
      basis: {
        kind: "test_site_ground_truth",
        expected: {
          topic: "alpha",
          notes: SAR_FIXTURE_GROUND_TRUTH.notes.taskA.notes,
        },
      },
    });
    expect(seen.ok).toBe(true);
    if (!seen.ok) {
      return;
    }
    expect(seen.record.participatedInDraftGeneration).toBe(true);
    expect(seen.record.verdict).toBe("passed");
    const rejectedSeen = loop.accept({
      draftId: draft.draftId,
      validationRecordId: seen.record.recordId,
      reviewer: "human-reviewer",
    });
    expect(rejectedSeen.ok).toBe(false);
    expect(loop.readDraft(draft.draftId)?.lifecycle).toBe("private");

    const heldOut = await loop.validate({
      draftId: draft.draftId,
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
    expect(heldOut.record.participatedInDraftGeneration).toBe(false);
    expect(heldOut.record.verdict).toBe("passed");
    expect(heldOut.record.capabilityId).toBe(LEARNED_ID);
    expect(heldOut.record.version).toBe(LEARNED_VERSION);
    expect(heldOut.record.artifactDigest).toBe(draft.artifactDigest);
    expect(heldOut.record.basis.kind).toBe("test_site_ground_truth");
    expect(heldOut.record.runId).toMatch(/^sarun_/);
    expect(heldOut.record.output).toEqual({
      topic: "beta",
      notes: SAR_FIXTURE_GROUND_TRUTH.notes.heldOut.notes,
    });
    expect(heldOut.record.completeness).toBe("complete");
    expect(heldOut.record.reviewer).toBe("fixture-reviewer");
    expect(heldOut.record.reviewedAt).toBe("2026-10-17T00:00:00.000Z");
    expect(heldOut.record.reason).toBe("output matched test-site ground truth");
    expect(heldOut.record).not.toHaveProperty("score");
    expect(runtime.readEvidence(heldOut.record.evidenceRef)).toMatchObject({
      runId: heldOut.record.runId,
      artifactDigest: draft.artifactDigest,
      capabilityId: LEARNED_ID,
      version: LEARNED_VERSION,
    });
    expect(loop.readDraft(draft.draftId)?.enabled).toBe(false);
    const stillBlocked = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: LEARNED_ID,
      version: LEARNED_VERSION,
      args: { topic: "beta" },
    });
    expect(stillBlocked.error?.code).toBe("NOT_AUTHORIZED");

    const accepted = loop.accept({
      draftId: draft.draftId,
      validationRecordId: heldOut.record.recordId,
      reviewer: "human-reviewer",
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.acceptance.lifecycle).toBe("approved");
    expect(accepted.acceptance.enabled).toBe(true);
    expect(accepted.acceptance.published).toBe(false);
    expect(accepted.acceptance.reviewer).toBe("human-reviewer");
    expect(loop.readDraft(draft.draftId)?.published).toBe(false);
    expect(JSON.stringify(loop.readDraft(draft.draftId)?.plan)).toBe(JSON.stringify(draft.plan));

    const tools = createSiteCapabilityTools({
      runtime,
      tenantId: SAR_FIXTURE_PRINCIPAL.tenantId,
      gatewayClientPlatformUserId: SAR_FIXTURE_PRINCIPAL.userId,
    });
    const invoked = await tools[2]?.execute?.("invoke-b", {
      capabilityId: LEARNED_ID,
      version: LEARNED_VERSION,
      args: { topic: "beta" },
      tenantId: SAR_OTHER_PRINCIPAL.tenantId,
    });
    expect(invoked?.details).toMatchObject({
      status: "succeeded",
      verification: "not_performed",
      completeness: "complete",
      repair: "none",
      capabilityId: LEARNED_ID,
      version: LEARNED_VERSION,
      data: {
        topic: "beta",
        notes: SAR_FIXTURE_GROUND_TRUTH.notes.heldOut.notes,
      },
    });
    const again = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: LEARNED_ID,
      version: LEARNED_VERSION,
      args: { topic: "alpha" },
    });
    expect(again.status).toBe("succeeded");
    expect(again.data).toEqual({
      topic: "alpha",
      notes: SAR_FIXTURE_GROUND_TRUTH.notes.taskA.notes,
    });
    const other = runtime.list(SAR_OTHER_PRINCIPAL);
    expect(JSON.stringify(other)).not.toContain(LEARNED_ID);
    expect(JSON.stringify(invoked?.details)).not.toContain("private:");
    expect(JSON.stringify(invoked?.details)).not.toContain(SAR_FIXTURE_CREDENTIALS.password);
  });

  it("does not enable a private draft, even after a mistaken grant", async () => {
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
    const missing = loop.accept({
      draftId: drafted.draft.draftId,
      validationRecordId: "missing",
      reviewer: "human-reviewer",
    });
    expect(missing.ok).toBe(false);

    const failed = await loop.validate({
      draftId: drafted.draft.draftId,
      principal: SAR_FIXTURE_PRINCIPAL,
      args: { topic: "beta" },
      reviewer: "fixture-reviewer",
      basis: { kind: "test_site_ground_truth", expected: { topic: "beta", notes: [] } },
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) {
      return;
    }
    expect(failed.record.verdict).toBe("failed");
    expect(failed.record.participatedInDraftGeneration).toBe(false);
    const rejected = loop.accept({
      draftId: drafted.draft.draftId,
      validationRecordId: failed.record.recordId,
      reviewer: "human-reviewer",
    });
    expect(rejected.ok).toBe(false);
    expect(loop.readDraft(drafted.draft.draftId)?.lifecycle).toBe("private");

    const registered = runtime.register(draftToSiteRecord(drafted.draft, "passed"));
    expect(registered.ok).toBe(true);
    const granted = runtime.grant({
      tenantId: SAR_FIXTURE_PRINCIPAL.tenantId,
      userId: SAR_FIXTURE_PRINCIPAL.userId,
      capabilityId: LEARNED_ID,
      version: LEARNED_VERSION,
      artifactDigest: drafted.draft.artifactDigest,
      accountBindingIds: [SAR_FIXTURE_BINDING_ID],
    });
    expect(granted.ok).toBe(true);
    const invoked = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: LEARNED_ID,
      version: LEARNED_VERSION,
      args: { topic: "alpha" },
    });
    expect(invoked.error?.code).toBe("NOT_AUTHORIZED");
    expect(loop.readAcceptance(drafted.draft.draftId)).toBeUndefined();
  });

  it("keeps a human verdict as given and does not auto-score it", async () => {
    const { loop } = setup();
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
      basis: { kind: "human", statement: "Checked the beta note against the fixture ledger." },
      humanVerdict: "failed",
      humanReason: "reviewer rejected the captured title",
    });
    expect(human.ok).toBe(true);
    if (!human.ok) {
      return;
    }
    expect(human.record.verdict).toBe("failed");
    expect(human.record.reason).toBe("reviewer rejected the captured title");
    expect(human.record.output).toEqual({
      topic: "beta",
      notes: SAR_FIXTURE_GROUND_TRUTH.notes.heldOut.notes,
    });
    expect(human.record).not.toHaveProperty("score");
    expect(human.record).not.toHaveProperty("rule");
    expect(loop.readDraft(drafted.draft.draftId)?.enabled).toBe(false);
  });

  it("classifies failures without publishing, relaxing fixtures, or rewriting plans", async () => {
    const { site, runtime, loop } = setup();
    const truth = JSON.stringify(SAR_FIXTURE_GROUND_TRUTH);
    const faultsBefore = site.faultSnapshot();

    const empty = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "no-such-widget" },
    });
    expect(isEmptySuccess(empty)).toBe(true);
    const emptyRepair = loop.repair({
      result: empty,
      accountBindingId: SAR_FIXTURE_BINDING_ID,
    });
    expect(emptyRepair).toMatchObject({
      action: "none",
      failureClass: null,
      candidate: null,
      autoPublished: false,
      grantsExpanded: false,
      accountSwitched: false,
      fixtureRelaxed: false,
      codeRewritten: false,
    });
    expect(loop.draftCount()).toBe(0);
    const stillEmpty = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "no-such-widget" },
    });
    expect(stillEmpty.data).toEqual({ query: "no-such-widget", items: [] });
    const stillWidget = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "widget" },
    });
    expect(stillWidget.data).toEqual({
      query: "widget",
      items: SAR_FIXTURE_GROUND_TRUTH.publicQuery.items,
    });

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
    const planBefore = JSON.stringify(drafted.draft.plan);

    site.injectError("notes", "STRUCTURE_CHANGED");
    const broken = await exploreNotes(loop, "beta");
    expect(broken.ok).toBe(false);
    if (broken.ok || !broken.result) {
      return;
    }
    expect(classifySiteFailure(broken.result)).toBe("structure-change");
    expect(broken.result.repair).toBe("none");
    const structure = loop.repair({
      result: broken.result,
      sourceDraftId: drafted.draft.draftId,
      accountBindingId: SAR_FIXTURE_BINDING_ID,
    });
    expect(structure.action).toBe("candidate");
    expect(structure.failureClass).toBe("structure-change");
    expect(structure.autoPublished).toBe(false);
    expect(structure.grantsExpanded).toBe(false);
    expect(structure.accountSwitched).toBe(false);
    expect(structure.fixtureRelaxed).toBe(false);
    expect(structure.codeRewritten).toBe(false);
    expect(structure.accountBindingId).toBe(SAR_FIXTURE_BINDING_ID);
    expect(structure.candidate?.lifecycle).toBe("private");
    expect(structure.candidate?.enabled).toBe(false);
    expect(structure.candidate?.published).toBe(false);
    expect(structure.candidate?.version).toBe("1.0.1");
    expect(JSON.stringify(structure.candidate?.plan)).toBe(planBefore);
    expect(loop.readDraft(drafted.draft.draftId)?.version).toBe(LEARNED_VERSION);
    expect(loop.readDraft(drafted.draft.draftId)?.lifecycle).toBe("private");
    const candidateInvoke = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: LEARNED_ID,
      version: "1.0.1",
      args: { topic: "beta" },
    });
    expect(candidateInvoke.error?.code).toBe("NOT_AUTHORIZED");
    expect(site.faultSnapshot().notes).toBe("STRUCTURE_CHANGED");
    expect(site.session().authenticated).toBe(false);
    expect(JSON.stringify(SAR_FIXTURE_GROUND_TRUTH)).toBe(truth);

    const otherBinding = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      accountBindingId: SAR_UNGRANTED_BINDING_ID,
      args: { query: "widget" },
    });
    expect(otherBinding.error?.code).toBe("POLICY_DENIED");

    site.injectError("notes", null);
    const locked = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_ACCOUNT_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "order" },
    });
    expect(classifySiteFailure(locked)).toBe("auth");
    const authRepair = loop.repair({
      result: locked,
      accountBindingId: SAR_FIXTURE_BINDING_ID,
    });
    expect(authRepair.action).toBe("suggestion");
    expect(authRepair.candidate).toBeNull();
    expect(authRepair.autoPublished).toBe(false);
    expect(authRepair.accountBindingId).toBe(SAR_FIXTURE_BINDING_ID);
    expect(site.session().authenticated).toBe(false);

    site.injectError("public", "RESULT_UNKNOWN");
    const unknown = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      version: SAR_PUBLIC_VERSION,
      args: { query: "widget" },
    });
    expect(classifySiteFailure(unknown)).toBe("unknown");
    expect(isOrdinaryFailure(unknown)).toBe(false);
    const unknownRepair = loop.repair({
      result: unknown,
      accountBindingId: SAR_FIXTURE_BINDING_ID,
    });
    expect(unknownRepair.action).toBe("suggestion");
    expect(unknownRepair.candidate).toBeNull();
    expect(unknownRepair.autoPublished).toBe(false);

    const missingVersion = await runtime.invoke(SAR_FIXTURE_PRINCIPAL, {
      capabilityId: SAR_PUBLIC_QUERY_ID,
      args: { query: "widget" },
    });
    expect(classifySiteFailure(missingVersion)).toBe("params");
    const captcha = syntheticFailure("CAPTCHA", "CAPTCHA");
    expect(classifySiteFailure(captcha)).toBe("risk-control");
    const rate = syntheticFailure("RATE_LIMITED", "RATE_LIMITED");
    expect(classifySiteFailure(rate)).toBe("risk-control");
    const policy = syntheticFailure("POLICY_DENIED", "stopped");
    expect(classifySiteFailure(policy)).toBe("policy");
    const infra = syntheticFailure("BROWSER_UNAVAILABLE", "BROWSER_UNAVAILABLE");
    expect(classifySiteFailure(infra)).toBe("infrastructure");
    for (const sample of [captcha, rate, policy, infra, missingVersion]) {
      const proposal = loop.repair({
        result: sample,
        accountBindingId: SAR_FIXTURE_BINDING_ID,
      });
      expect(proposal.action).toBe("suggestion");
      expect(proposal.autoPublished).toBe(false);
      expect(proposal.candidate).toBeNull();
      expect(proposal.grantsExpanded).toBe(false);
      expect(proposal.accountSwitched).toBe(false);
    }

    expect(site.faultSnapshot().search).toBe(faultsBefore.search);
    expect(JSON.stringify(loop.readDraft(drafted.draft.draftId)?.plan)).toBe(planBefore);
    const listed = runtime.list(SAR_OTHER_PRINCIPAL);
    expect(JSON.stringify(listed)).not.toContain(LEARNED_ID);
  });

  it("rejects generated scripts and empty exploration before any draft exists", async () => {
    const { loop } = setup();
    const script = await loop.explore({
      principal: SAR_FIXTURE_PRINCIPAL,
      accountBindingId: SAR_FIXTURE_BINDING_ID,
      manifest: notesManifest(),
      inputFields: notesInput(),
      plan: [
        { op: "navigate", urlTemplate: `${SAR_FIXTURE_ORIGIN}/notes?topic={topic}`, script: "1" },
      ],
      args: { topic: "alpha" },
    });
    expect(script.ok).toBe(false);
    if (!script.ok) {
      expect(script.code).toBe("SAR_EVALUATE_REJECTED");
    }
    const empty = await exploreNotes(loop, "no-such-topic");
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.code).toBe("EMPTY_SUCCESS");
      expect(loop.draftFromEvidence("missing").ok).toBe(false);
    }
    expect(loop.draftCount()).toBe(0);
  });
});

function syntheticFailure(code: string, message: string): SiteRunResult {
  return {
    runId: "sarun_synthetic",
    capabilityId: SAR_PUBLIC_QUERY_ID,
    version: SAR_PUBLIC_VERSION,
    status: "failed",
    verification: "failed",
    data: null,
    completeness: "complete",
    error: { code, message, retry: "none", ordinaryFailure: true },
    evidenceRef: "ev_synthetic",
    durationMs: 0,
    repair: "none",
  };
}
