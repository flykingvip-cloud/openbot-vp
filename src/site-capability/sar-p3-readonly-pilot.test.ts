import { afterEach, describe, expect, it } from "vitest";
import { createSiteCapabilityTools } from "../agents/tools/site-capability-tools.js";
import { parseSiteCapabilityManifest } from "./contract.js";
import { resetAccountBrowserCoordinatorForTests } from "./coordinator.js";
import { comparePilotRead } from "./pilot-comparison.js";
import {
  SAR_PILOT_BINDING_ID,
  SAR_PILOT_BULLETIN_ID,
  SAR_PILOT_BULLETIN_ONLY_PRINCIPAL,
  SAR_PILOT_FIXTURE_CREDENTIALS,
  SAR_PILOT_FOREIGN_BINDING_ID,
  SAR_PILOT_GROUND_TRUTH,
  SAR_PILOT_INBOX_ID,
  SAR_PILOT_OTHER_PRINCIPAL,
  SAR_PILOT_PRINCIPAL,
  SAR_PILOT_SPARE_BINDING_ID,
  SAR_PILOT_STATION_IDS,
  SAR_PILOT_STEP_MS,
  SAR_PILOT_UNGRAENTED_VERSION,
  SAR_PILOT_VERSION,
  attributePilotFailure,
  createReadonlyPilotHarness,
  pilotSourceDraft,
  recordPilotBusinessVerification,
  type PilotHarness,
} from "./readonly-pilot.js";
import { isEmptySuccess, type SiteRunResult } from "./result.js";
import {
  getDefaultSiteCapabilityRuntime,
  resetDefaultSiteCapabilityRuntimeForTests,
} from "./runtime.js";
import { ThinValidationRunner } from "./validation-record.js";

const harnesses: Array<{ dispose: () => void }> = [];

afterEach(() => {
  for (const harness of harnesses) {
    harness.dispose();
  }
  harnesses.length = 0;
  resetDefaultSiteCapabilityRuntimeForTests();
  resetAccountBrowserCoordinatorForTests();
});

function harness(): PilotHarness {
  const created = createReadonlyPilotHarness();
  harnesses.push(created);
  return created;
}

function asResult(details: unknown): SiteRunResult {
  return details as SiteRunResult;
}

function leaked(value: unknown): boolean {
  const text = JSON.stringify(value);
  return (
    text.includes(SAR_PILOT_FIXTURE_CREDENTIALS.password) ||
    text.includes(SAR_PILOT_FIXTURE_CREDENTIALS.username) ||
    text.includes("pilot-bulletin-pack") ||
    text.includes("pilot-inbox-pack") ||
    text.includes("cdpUrl") ||
    text.includes("user-data-dir") ||
    text.includes("cookie")
  );
}

describe("P3 read-only pilot", () => {
  it("lists, describes, and invokes two fixed-version stations on the original binding", async () => {
    const created = harness();
    expect([...SAR_PILOT_STATION_IDS]).toEqual([SAR_PILOT_BULLETIN_ID, SAR_PILOT_INBOX_ID]);
    expect(SAR_PILOT_STATION_IDS.join(" ")).not.toMatch(/xiaohongshu|xhslink|rednote/i);

    const tools = createSiteCapabilityTools({
      runtime: created.runtime,
      tenantId: created.principal.tenantId,
      gatewayClientPlatformUserId: created.principal.userId,
    });
    const listed = await tools[0]?.execute?.("list", {
      tenantId: SAR_PILOT_OTHER_PRINCIPAL.tenantId,
      userId: SAR_PILOT_OTHER_PRINCIPAL.userId,
    });
    expect(listed?.details).toMatchObject({ ok: true });
    const page = listed?.details as { items: Array<{ capabilityId: string; version: string }> };
    const items = page.items;
    expect(items.map((item) => item.capabilityId).toSorted()).toEqual([
      SAR_PILOT_BULLETIN_ID,
      SAR_PILOT_INBOX_ID,
    ]);
    expect(items.every((item) => item.version === SAR_PILOT_VERSION)).toBe(true);
    expect(leaked(listed?.details)).toBe(false);

    const bulletin = await tools[1]?.execute?.("describe", {
      capabilityId: SAR_PILOT_BULLETIN_ID,
      version: SAR_PILOT_VERSION,
    });
    expect(bulletin?.details).toMatchObject({
      ok: true,
      capability: {
        capabilityId: SAR_PILOT_BULLETIN_ID,
        version: SAR_PILOT_VERSION,
        effect: "read",
        accountRequirements: { authMode: "none", bindingRequired: false },
        availability: "available",
        verification: "passed",
      },
    });
    const inbox = await tools[1]?.execute?.("describe", {
      capabilityId: SAR_PILOT_INBOX_ID,
      version: SAR_PILOT_VERSION,
    });
    expect(inbox?.details).toMatchObject({
      ok: true,
      capability: {
        effect: "read",
        accountRequirements: { authMode: "browser_session", bindingRequired: true },
      },
    });
    expect(leaked(bulletin?.details)).toBe(false);
    expect(leaked(inbox?.details)).toBe(false);

    const publicRead = await tools[2]?.execute?.("invoke", {
      capabilityId: SAR_PILOT_BULLETIN_ID,
      version: SAR_PILOT_VERSION,
      args: { desk: SAR_PILOT_GROUND_TRUTH.bulletin.desk },
      accountBindingId: SAR_PILOT_BINDING_ID,
    });
    expect(asResult(publicRead?.details)).toMatchObject({
      capabilityId: SAR_PILOT_BULLETIN_ID,
      version: SAR_PILOT_VERSION,
      status: "succeeded",
      verification: "not_performed",
      completeness: "complete",
      repair: "none",
      data: SAR_PILOT_GROUND_TRUTH.bulletin,
    });
    expect(asResult(publicRead?.details).runId).toMatch(/^sarun_/);
    expect(leaked(publicRead?.details)).toBe(false);

    const locked = await tools[2]?.execute?.("invoke", {
      capabilityId: SAR_PILOT_INBOX_ID,
      version: SAR_PILOT_VERSION,
      args: { mailbox: SAR_PILOT_GROUND_TRUTH.inbox.mailbox },
      accountBindingId: SAR_PILOT_BINDING_ID,
    });
    expect(asResult(locked?.details).error?.code).toBe("AUTH_REQUIRED");

    expect(
      created.site.establishFixtureSession("wrong-user", SAR_PILOT_FIXTURE_CREDENTIALS.password),
    ).toBe(false);
    const stillLocked = await created.runtime.invoke(created.principal, {
      capabilityId: SAR_PILOT_INBOX_ID,
      version: SAR_PILOT_VERSION,
      args: { mailbox: SAR_PILOT_GROUND_TRUTH.inbox.mailbox },
      accountBindingId: SAR_PILOT_BINDING_ID,
    });
    expect(stillLocked.error?.code).toBe("AUTH_REQUIRED");

    expect(
      created.site.establishFixtureSession(
        SAR_PILOT_FIXTURE_CREDENTIALS.username,
        SAR_PILOT_FIXTURE_CREDENTIALS.password,
      ),
    ).toBe(true);
    const signedIn = await tools[2]?.execute?.("invoke", {
      capabilityId: SAR_PILOT_INBOX_ID,
      version: SAR_PILOT_VERSION,
      args: { mailbox: SAR_PILOT_GROUND_TRUTH.inbox.mailbox },
      accountBindingId: SAR_PILOT_BINDING_ID,
    });
    expect(asResult(signedIn?.details)).toMatchObject({
      status: "succeeded",
      version: SAR_PILOT_VERSION,
      data: SAR_PILOT_GROUND_TRUTH.inbox,
      repair: "none",
    });
    expect(leaked(signedIn?.details)).toBe(false);
    expect(created.site.authenticatedSession()).toBe(true);
  });

  it("keeps per-capability grants, the fixed version, and the original binding", async () => {
    const created = harness();
    const tools = createSiteCapabilityTools({
      runtime: created.runtime,
      tenantId: SAR_PILOT_BULLETIN_ONLY_PRINCIPAL.tenantId,
      gatewayClientPlatformUserId: SAR_PILOT_BULLETIN_ONLY_PRINCIPAL.userId,
    });
    const listed = await tools[0]?.execute?.("list", {});
    const page = listed?.details as { items: Array<{ capabilityId: string }> };
    const ids = page.items.map((item) => item.capabilityId);
    expect(ids).toEqual([SAR_PILOT_BULLETIN_ID]);

    const deniedInbox = await tools[2]?.execute?.("invoke", {
      capabilityId: SAR_PILOT_INBOX_ID,
      version: SAR_PILOT_VERSION,
      args: { mailbox: "primary" },
    });
    expect(asResult(deniedInbox?.details).error?.code).toBe("NOT_AUTHORIZED");
    expect(created.site.currentPage()).toBe("home");

    const hidden = createSiteCapabilityTools({
      runtime: created.runtime,
      tenantId: SAR_PILOT_OTHER_PRINCIPAL.tenantId,
      gatewayClientPlatformUserId: SAR_PILOT_OTHER_PRINCIPAL.userId,
    });
    const otherList = await hidden[0]?.execute?.("list", {});
    expect(otherList?.details).toMatchObject({ ok: true, items: [] });
    expect(JSON.stringify(otherList?.details)).not.toContain(SAR_PILOT_INBOX_ID);

    const ownerTools = createSiteCapabilityTools({
      runtime: created.runtime,
      tenantId: created.principal.tenantId,
      gatewayClientPlatformUserId: created.principal.userId,
    });
    const floating = await ownerTools[2]?.execute?.("invoke", {
      capabilityId: SAR_PILOT_BULLETIN_ID,
      args: { desk: "ops" },
    });
    expect(asResult(floating?.details).error?.code).toBe("VERSION_REQUIRED");
    const wrongVersion = await ownerTools[2]?.execute?.("invoke", {
      capabilityId: SAR_PILOT_BULLETIN_ID,
      version: SAR_PILOT_UNGRAENTED_VERSION,
      args: { desk: "ops" },
    });
    expect(asResult(wrongVersion?.details).error?.code).toBe("NOT_AUTHORIZED");
    expect(JSON.stringify(wrongVersion?.details)).not.toContain("WRONG");
    expect(created.site.currentPage()).toBe("home");

    const spare = await ownerTools[2]?.execute?.("invoke", {
      capabilityId: SAR_PILOT_BULLETIN_ID,
      version: SAR_PILOT_VERSION,
      args: { desk: "ops" },
      accountBindingId: SAR_PILOT_SPARE_BINDING_ID,
    });
    expect(asResult(spare?.details).error?.code).toBe("POLICY_DENIED");
    const foreign = await ownerTools[2]?.execute?.("invoke", {
      capabilityId: SAR_PILOT_BULLETIN_ID,
      version: SAR_PILOT_VERSION,
      args: { desk: "ops" },
      accountBindingId: SAR_PILOT_FOREIGN_BINDING_ID,
    });
    expect(asResult(foreign?.details).error?.code).toBe("POLICY_DENIED");

    const script = await ownerTools[2]?.execute?.("invoke", {
      capabilityId: SAR_PILOT_BULLETIN_ID,
      version: SAR_PILOT_VERSION,
      args: { desk: "ops", script: "document.cookie" },
    });
    expect(asResult(script?.details).error?.code).toBe("SAR_EVALUATE_REJECTED");
    expect(created.site.currentPage()).toBe("home");

    const write = parseSiteCapabilityManifest({
      ...created.stations.bulletin.manifest,
      effect: "publish",
    });
    expect(write.ok).toBe(false);

    const catalog = getDefaultSiteCapabilityRuntime();
    expect(catalog.list(SAR_PILOT_PRINCIPAL)).toMatchObject({ ok: true, items: [] });
    expect(catalog).not.toBe(created.runtime);
  });

  it("records ground truth and human verification without a second score", async () => {
    const created = harness();
    const bulletin = await created.runtime.invoke(created.principal, {
      capabilityId: SAR_PILOT_BULLETIN_ID,
      version: SAR_PILOT_VERSION,
      args: { desk: SAR_PILOT_GROUND_TRUTH.bulletin.desk },
      accountBindingId: SAR_PILOT_BINDING_ID,
    });
    const bulletinEvidence = created.runtime.readEvidence(bulletin.evidenceRef);
    expect(bulletinEvidence).toBeDefined();
    if (!bulletinEvidence) {
      return;
    }
    const runner = new ThinValidationRunner(() => "val_pilot_bulletin");
    const truth = recordPilotBusinessVerification({
      runner,
      capabilityId: created.stations.bulletin.capabilityId,
      version: created.stations.bulletin.version,
      artifactDigest: created.stations.bulletin.artifactDigest,
      args: { desk: SAR_PILOT_GROUND_TRUTH.bulletin.desk },
      generationParams: {},
      run: bulletin,
      evidence: bulletinEvidence,
      reviewer: "pilot-reviewer",
      reviewedAt: "2026-10-17T12:00:00.000Z",
      basis: { kind: "test_site_ground_truth", expected: SAR_PILOT_GROUND_TRUTH.bulletin },
    });
    expect(truth.ok).toBe(true);
    if (!truth.ok) {
      return;
    }
    expect(truth.record).toMatchObject({
      capabilityId: SAR_PILOT_BULLETIN_ID,
      version: SAR_PILOT_VERSION,
      artifactDigest: created.stations.bulletin.artifactDigest,
      participatedInDraftGeneration: false,
      runId: bulletin.runId,
      evidenceRef: bulletin.evidenceRef,
      output: SAR_PILOT_GROUND_TRUTH.bulletin,
      completeness: "complete",
      verdict: "passed",
      reviewer: "pilot-reviewer",
      reason: "output matched test-site ground truth",
    });
    expect(truth.record.basis).toEqual({
      kind: "test_site_ground_truth",
      expected: SAR_PILOT_GROUND_TRUTH.bulletin,
    });

    created.site.establishFixtureSession(
      SAR_PILOT_FIXTURE_CREDENTIALS.username,
      SAR_PILOT_FIXTURE_CREDENTIALS.password,
    );
    const inbox = await created.runtime.invoke(created.principal, {
      capabilityId: SAR_PILOT_INBOX_ID,
      version: SAR_PILOT_VERSION,
      args: { mailbox: SAR_PILOT_GROUND_TRUTH.inbox.mailbox },
      accountBindingId: SAR_PILOT_BINDING_ID,
    });
    const inboxEvidence = created.runtime.readEvidence(inbox.evidenceRef);
    expect(inboxEvidence).toBeDefined();
    if (!inboxEvidence) {
      return;
    }
    const humanRunner = new ThinValidationRunner(() => "val_pilot_inbox");
    const human = recordPilotBusinessVerification({
      runner: humanRunner,
      capabilityId: SAR_PILOT_INBOX_ID,
      version: SAR_PILOT_VERSION,
      artifactDigest: created.stations.inbox.artifactDigest,
      args: { mailbox: "primary" },
      generationParams: {},
      run: inbox,
      evidence: inboxEvidence,
      reviewer: "pilot-reviewer",
      reviewedAt: "2026-10-17T12:05:00.000Z",
      basis: {
        kind: "human",
        statement: "Inbox summary matches the bound mailbox on the fixture session.",
      },
      humanVerdict: "passed",
      humanReason: "Reviewer compared the run output with the fixture mailbox.",
    });
    expect(human.ok).toBe(true);
    if (!human.ok) {
      return;
    }
    expect(human.record.verdict).toBe("passed");
    expect(human.record.runId).toBe(inbox.runId);
    expect(human.record.output).toEqual(SAR_PILOT_GROUND_TRUTH.inbox);
    expect(human.record.completeness).toBe("complete");
    expect(human.record.participatedInDraftGeneration).toBe(false);
    expect(human.record.basis).toMatchObject({ kind: "human" });
  });

  it("matches generic browser correctness and spends fewer dispatches", async () => {
    const created = harness();
    const bulletin = await comparePilotRead({
      harness: created,
      principal: created.principal,
      bindingId: created.bindingId,
      station: created.stations.bulletin,
      args: { desk: SAR_PILOT_GROUND_TRUTH.bulletin.desk },
      expected: SAR_PILOT_GROUND_TRUTH.bulletin,
    });
    expect(bulletin.sar.correct).toBe(true);
    expect(bulletin.genericBrowser.correct).toBe(true);
    expect(bulletin.correctnessAtLeastGenericBrowser).toBe(true);
    expect(bulletin.sar.dispatchCount).toBe(created.stations.bulletin.plan.length);
    expect(bulletin.genericBrowser.dispatchCount).toBe(4);
    expect(bulletin.sar.durationMs).toBe(bulletin.sar.dispatchCount * SAR_PILOT_STEP_MS);
    expect(bulletin.genericBrowser.durationMs).toBe(4 * SAR_PILOT_STEP_MS);
    expect(bulletin.cost.dispatchCountImproved).toBe(true);
    expect(bulletin.cost.durationImproved).toBe(true);
    expect(bulletin.cost.note).toContain("not a live network RTT");
    expect(bulletin.conclusion).toContain("Correctness is equal and meets the fixture bar");
    expect(bulletin.conclusion).toContain("Not an R5 live-session claim");
    expect(bulletin.evidenceKind).toBe("protocol_fixture");
    expect(bulletin.r5LiveSessionClaim).toBe(false);
    expect(bulletin.fixtureRelaxed).toBe(false);
    expect(bulletin.cost.clock).toBe("harness_step_clock");
    expect(bulletin.conclusion).toContain("not a live network RTT");
    expect(bulletin.sar.runId).toMatch(/^sarun_/);

    created.site.establishFixtureSession(
      SAR_PILOT_FIXTURE_CREDENTIALS.username,
      SAR_PILOT_FIXTURE_CREDENTIALS.password,
    );
    const inbox = await comparePilotRead({
      harness: created,
      principal: created.principal,
      bindingId: created.bindingId,
      station: created.stations.inbox,
      args: { mailbox: SAR_PILOT_GROUND_TRUTH.inbox.mailbox },
      expected: SAR_PILOT_GROUND_TRUTH.inbox,
    });
    expect(inbox.correctnessAtLeastGenericBrowser).toBe(true);
    expect(inbox.genericBrowser.correct).toBe(true);
    expect(inbox.cost.dispatchCountImproved).toBe(true);
    expect(inbox.sar.output).toEqual(SAR_PILOT_GROUND_TRUTH.inbox);
    expect(inbox.genericBrowser.output).toEqual(SAR_PILOT_GROUND_TRUTH.inbox);
  });

  it("attributes faults with the P2 classifier and does not publish or switch accounts", async () => {
    const created = harness();
    const source = pilotSourceDraft(created.stations.inbox, created.principal, created.bindingId);
    const before = created.site.faultSnapshot();

    const empty = await created.runtime.invoke(created.principal, {
      capabilityId: SAR_PILOT_BULLETIN_ID,
      version: SAR_PILOT_VERSION,
      args: { desk: "quiet" },
      accountBindingId: created.bindingId,
    });
    expect(empty.data).toEqual({ desk: "quiet", bulletins: [] });
    expect(isEmptySuccess(empty)).toBe(true);
    const emptyRepair = attributePilotFailure({
      result: empty,
      source: pilotSourceDraft(created.stations.bulletin, created.principal, created.bindingId),
    });
    expect(emptyRepair).toMatchObject({
      action: "none",
      failureClass: null,
      autoPublished: false,
      grantsExpanded: false,
      accountSwitched: false,
      fixtureRelaxed: false,
    });

    const auth = await created.runtime.invoke(created.principal, {
      capabilityId: SAR_PILOT_INBOX_ID,
      version: SAR_PILOT_VERSION,
      args: { mailbox: "primary" },
      accountBindingId: created.bindingId,
    });
    const authRepair = attributePilotFailure({ result: auth, source });
    expect(authRepair).toMatchObject({
      action: "suggestion",
      failureClass: "auth",
      candidate: null,
      autoPublished: false,
      grantsExpanded: false,
      accountSwitched: false,
      accountBindingId: created.bindingId,
    });
    expect(authRepair.suggestion).toContain("Do not switch accounts");

    created.site.injectError("bulletin", "STRUCTURE_CHANGED");
    const structure = await created.runtime.invoke(created.principal, {
      capabilityId: SAR_PILOT_BULLETIN_ID,
      version: SAR_PILOT_VERSION,
      args: { desk: "ops" },
      accountBindingId: created.bindingId,
    });
    const structureRepair = attributePilotFailure({
      result: structure,
      source: pilotSourceDraft(created.stations.bulletin, created.principal, created.bindingId),
    });
    expect(structureRepair.failureClass).toBe("structure-change");
    expect(structureRepair.action).toBe("candidate");
    expect(structureRepair.autoPublished).toBe(false);
    expect(structureRepair.candidate?.published).toBe(false);
    expect(structureRepair.candidate?.enabled).toBe(false);
    expect(structureRepair.candidate?.lifecycle).toBe("private");
    expect(structureRepair.candidate?.version).toBe("2026.10.18");
    expect(structureRepair.candidate?.plan).toEqual(created.stations.bulletin.plan);
    expect(structureRepair.accountBindingId).toBe(created.bindingId);
    const listed = created.runtime.list(created.principal);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.items.map((item) => item.version)).not.toContain("2026.10.18");
    }
    const candidateInvoke = await created.runtime.invoke(created.principal, {
      capabilityId: SAR_PILOT_BULLETIN_ID,
      version: "2026.10.18",
      args: { desk: "ops" },
      accountBindingId: created.bindingId,
    });
    expect(candidateInvoke.error?.code).toBe("NOT_AUTHORIZED");

    created.site.injectError("inbox", "CAPTCHA");
    const risk = await created.runtime.invoke(created.principal, {
      capabilityId: SAR_PILOT_INBOX_ID,
      version: SAR_PILOT_VERSION,
      args: { mailbox: "primary" },
      accountBindingId: created.bindingId,
    });
    const riskRepair = attributePilotFailure({ result: risk, source });
    expect(riskRepair).toMatchObject({
      action: "suggestion",
      failureClass: "risk-control",
      candidate: null,
      autoPublished: false,
      accountSwitched: false,
      grantsExpanded: false,
    });

    const validationRepair = attributePilotFailure({ validationFailed: true, source });
    expect(validationRepair.failureClass).toBe("validation-failed");
    expect(validationRepair.candidate?.published).toBe(false);
    expect(validationRepair.autoPublished).toBe(false);
    expect(created.site.faultSnapshot()).toEqual({
      ...before,
      bulletin: "STRUCTURE_CHANGED",
      inbox: "CAPTCHA",
    });

    created.site.injectError("bulletin", null);
    const again = await created.runtime.invoke(created.principal, {
      capabilityId: SAR_PILOT_BULLETIN_ID,
      version: SAR_PILOT_VERSION,
      args: { desk: "ops" },
      accountBindingId: created.bindingId,
    });
    expect(again.status).toBe("succeeded");
    expect(again.repair).toBe("none");
  });
});
