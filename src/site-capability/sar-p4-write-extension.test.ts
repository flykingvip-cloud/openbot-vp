import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_BROWSER_EVALUATE_ENABLED } from "../browser/constants.js";
import { parseSiteCapabilityManifest } from "./contract.js";
import { resetAccountBrowserCoordinatorForTests } from "./coordinator.js";
import { SarExecutionAuthority, memoryEpochStore } from "./execution-authority.js";
import { proposeRepair } from "./failure-class.js";
import { SiteLearningLoop } from "./learning-loop.js";
import { compileSarOperation, type TrustedPagePort } from "./operations.js";
import { isOrdinaryFailure, type SiteRunResult } from "./result.js";
import {
  getDefaultSiteCapabilityRuntime,
  resetDefaultSiteCapabilityRuntimeForTests,
  SiteCapabilityRuntime,
} from "./runtime.js";
import {
  SAR_DRAFT_NOTE_CREATE,
  SAR_DRAFT_NOTE_CREATE_ID,
  SAR_DRAFT_NOTE_UPDATE,
  SAR_DRAFT_NOTE_UPDATE_ID,
  SAR_WRITE_FIXTURE_ORIGIN,
  SAR_WRITE_VERSION,
  parseWriteCapabilityManifest,
} from "./write-effect.js";
import { ControllableDraftNoteSite } from "./write-fixture.js";
import { priorWriteMayBeReplayed } from "./write-recheck-store.js";
import { proposeWriteRepair } from "./write-repair.js";
import { WriteExtensionRuntime } from "./write-runtime.js";

const PRINCIPAL = { tenantId: "tenant-write", userId: "user-write" };
const OTHER = { tenantId: "tenant-write", userId: "user-other" };
const BINDING = "bind-draft";
const SPARE_BINDING = "bind-draft-spare";
const FOREIGN_BINDING = "bind-foreign";

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers) {
    dispose();
  }
  disposers.length = 0;
  resetDefaultSiteCapabilityRuntimeForTests();
  resetAccountBrowserCoordinatorForTests();
});

function must<T extends { ok: boolean }>(value: T): asserts value is T & { ok: true } {
  expect(value.ok).toBe(true);
}

function harness(concurrency: "reject" | "queue" = "reject") {
  const authority = new SarExecutionAuthority(memoryEpochStore());
  authority.boot();
  disposers.push(() => authority.dispose());
  const site = new ControllableDraftNoteSite();
  const runtime = new WriteExtensionRuntime({ authority, site, concurrency });
  must(
    runtime.registerBinding({
      bindingId: BINDING,
      tenantId: PRINCIPAL.tenantId,
      userId: PRINCIPAL.userId,
    }),
  );
  must(
    runtime.registerBinding({
      bindingId: SPARE_BINDING,
      tenantId: PRINCIPAL.tenantId,
      userId: PRINCIPAL.userId,
    }),
  );
  must(
    runtime.registerBinding({
      bindingId: FOREIGN_BINDING,
      tenantId: OTHER.tenantId,
      userId: OTHER.userId,
    }),
  );
  const created = runtime.register({
    manifest: SAR_DRAFT_NOTE_CREATE,
    lifecycle: "approved",
    verification: "passed",
    enabled: true,
  });
  must(created);
  const updated = runtime.register({
    manifest: SAR_DRAFT_NOTE_UPDATE,
    lifecycle: "approved",
    verification: "passed",
    enabled: true,
  });
  must(updated);
  must(
    runtime.grant({
      tenantId: PRINCIPAL.tenantId,
      userId: PRINCIPAL.userId,
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      artifactDigest: created.record.artifactDigest,
      effect: "create",
      accountBindingIds: [BINDING],
    }),
  );
  return {
    authority,
    site,
    runtime,
    createRecord: created.record,
    updateRecord: updated.record,
  };
}

function createArgs(idempotencyKey: string, title = "Draft title", body = "Draft body") {
  return { idempotencyKey, title, body };
}

function asNote(result: SiteRunResult): {
  noteId: string;
  revision: number;
  contentDigest: string;
} {
  return result.data as { noteId: string; revision: number; contentDigest: string };
}

const closedPort: TrustedPagePort = {
  navigate: async () => ({ finalUrl: SAR_WRITE_FIXTURE_ORIGIN }),
  readFields: async () => ({}),
  requestContext: async () => ({ origin: SAR_WRITE_FIXTURE_ORIGIN, data: {} }),
  capture: async () => ({}),
};

describe("P4 write extension", () => {
  it("keeps write effects out of the read contract and the read operation set", () => {
    expect(parseSiteCapabilityManifest(SAR_DRAFT_NOTE_CREATE).ok).toBe(false);
    expect(parseWriteCapabilityManifest({ ...SAR_DRAFT_NOTE_CREATE, effect: "read" }).ok).toBe(
      false,
    );
    expect(parseWriteCapabilityManifest({ ...SAR_DRAFT_NOTE_CREATE, effect: "publish" }).ok).toBe(
      false,
    );
    expect(parseWriteCapabilityManifest({ ...SAR_DRAFT_NOTE_CREATE, effect: "delete" }).ok).toBe(
      false,
    );
    expect(parseWriteCapabilityManifest(SAR_DRAFT_NOTE_CREATE).ok).toBe(true);
    expect(parseWriteCapabilityManifest(SAR_DRAFT_NOTE_UPDATE).ok).toBe(true);
    expect(compileSarOperation({ op: "apply_draft" }).ok).toBe(false);
    expect(DEFAULT_BROWSER_EVALUATE_ENABLED).toBe(true);

    const { authority } = harness();
    expect(authority.registerCapability(SAR_DRAFT_NOTE_CREATE).ok).toBe(false);
  });

  it("rejects unauthorized, wrong version, wrong binding, and read effect before dispatch", async () => {
    const { runtime, site, createRecord } = harness();
    must(
      runtime.grant({
        tenantId: PRINCIPAL.tenantId,
        userId: PRINCIPAL.userId,
        capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
        version: SAR_WRITE_VERSION,
        artifactDigest: createRecord.artifactDigest,
        effect: "create",
        accountBindingIds: [BINDING, FOREIGN_BINDING],
      }),
    );

    const readGrant = runtime.grant({
      tenantId: PRINCIPAL.tenantId,
      userId: PRINCIPAL.userId,
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      artifactDigest: createRecord.artifactDigest,
      effect: "read",
      accountBindingIds: [BINDING],
    });
    expect(readGrant).toMatchObject({
      ok: false,
      code: "POLICY_DENIED",
      message: "read effect does not authorize a write",
    });

    const cases = [
      runtime.invoke(OTHER, {
        capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
        version: SAR_WRITE_VERSION,
        args: createArgs("auth-key-other"),
        accountBindingId: FOREIGN_BINDING,
      }),
      runtime.invoke(PRINCIPAL, {
        capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
        version: "9.9.9",
        args: createArgs("auth-key-version"),
        accountBindingId: BINDING,
      }),
      runtime.invoke(PRINCIPAL, {
        capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
        version: SAR_WRITE_VERSION,
        args: createArgs("auth-key-spare"),
        accountBindingId: SPARE_BINDING,
      }),
      runtime.invoke(PRINCIPAL, {
        capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
        version: SAR_WRITE_VERSION,
        args: createArgs("auth-key-cross"),
        accountBindingId: FOREIGN_BINDING,
      }),
      runtime.invoke(PRINCIPAL, {
        capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
        version: SAR_WRITE_VERSION,
        args: { ...createArgs("auth-key-oi"), oiGrant: "true" },
        accountBindingId: BINDING,
      }),
      runtime.invoke(PRINCIPAL, {
        capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
        version: SAR_WRITE_VERSION,
        args: { ...createArgs("auth-key-script"), script: "document.cookie" },
        accountBindingId: BINDING,
      }),
      runtime.invoke(PRINCIPAL, {
        capabilityId: SAR_DRAFT_NOTE_UPDATE_ID,
        version: SAR_WRITE_VERSION,
        args: {
          idempotencyKey: "auth-key-update",
          noteId: "note_0123456789ab",
          title: "Nope",
          body: "Nope",
        },
        accountBindingId: BINDING,
      }),
    ];
    const results = await Promise.all(cases);
    expect(results.map((result) => result.error?.code)).toEqual([
      "NOT_AUTHORIZED",
      "NOT_AUTHORIZED",
      "POLICY_DENIED",
      "CROSS_ACCOUNT_REJECTED",
      "POLICY_DENIED",
      "SAR_EVALUATE_REJECTED",
      "NOT_AUTHORIZED",
    ]);
    expect(site.applyCount).toBe(0);

    const created = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      args: createArgs("auth-key-ok"),
      accountBindingId: BINDING,
    });
    expect(created.status).toBe("succeeded");
    expect(created.repair).toBe("none");
    expect(site.applyCount).toBe(1);
  });

  it("separates create and update effects on the same fixture", async () => {
    const { runtime, site, updateRecord } = harness();
    const created = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      args: createArgs("effect-key-create"),
      accountBindingId: BINDING,
    });
    expect(created.status).toBe("succeeded");
    const noteId = asNote(created).noteId;

    const denied = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_UPDATE_ID,
      version: SAR_WRITE_VERSION,
      args: { idempotencyKey: "effect-key-update", noteId, title: "Retitled", body: "Next body" },
      accountBindingId: BINDING,
    });
    expect(denied.error?.code).toBe("NOT_AUTHORIZED");
    expect(site.applyCount).toBe(1);

    must(
      runtime.grant({
        tenantId: PRINCIPAL.tenantId,
        userId: PRINCIPAL.userId,
        capabilityId: SAR_DRAFT_NOTE_UPDATE_ID,
        version: SAR_WRITE_VERSION,
        artifactDigest: updateRecord.artifactDigest,
        effect: "update",
        accountBindingIds: [BINDING],
      }),
    );
    const updated = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_UPDATE_ID,
      version: SAR_WRITE_VERSION,
      args: { idempotencyKey: "effect-key-update", noteId, title: "Retitled", body: "Next body" },
      accountBindingId: BINDING,
    });
    expect(updated.status).toBe("succeeded");
    expect(updated.repair).toBe("none");
    expect(asNote(updated).revision).toBe(2);
    expect(site.applyCount).toBe(2);
    expect(site.readNote(BINDING, noteId)?.title).toBe("Retitled");
  });

  it("rechecks a confirmed write by runId and artifact digest and does not replay it", async () => {
    const { runtime, site, createRecord } = harness();
    const first = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      args: createArgs("idem-key-create"),
      accountBindingId: BINDING,
    });
    expect(first.status).toBe("succeeded");
    expect(site.applyCount).toBe(1);

    const again = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      args: createArgs("idem-key-create"),
      accountBindingId: BINDING,
    });
    expect(again.status).toBe("succeeded");
    expect(again.data).toMatchObject({
      replayed: false,
      idempotent: true,
      confirmedFromRunId: first.runId,
      noteId: asNote(first).noteId,
    });
    expect(site.applyCount).toBe(1);

    const checked = runtime.recheck(PRINCIPAL, {
      runId: first.runId,
      artifactDigest: createRecord.artifactDigest,
    });
    expect(checked).toMatchObject({
      ok: true,
      status: "confirmed",
      replayed: false,
      runId: first.runId,
      artifactDigest: createRecord.artifactDigest,
      contentDigest: asNote(first).contentDigest,
    });
    expect(site.applyCount).toBe(1);

    const mismatch = runtime.recheck(PRINCIPAL, {
      runId: first.runId,
      artifactDigest: "sha256:not-the-recorded-artifact",
    });
    expect(mismatch).toMatchObject({ ok: true, status: "digest_mismatch", replayed: false });
    expect(site.applyCount).toBe(1);

    const conflict = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      args: createArgs("idem-key-create", "Different title"),
      accountBindingId: BINDING,
    });
    expect(conflict.status).toBe("failed");
    expect(conflict.error?.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(conflict.repair).toBe("none");
    expect(site.applyCount).toBe(1);

    const hidden = runtime.recheck(OTHER, {
      runId: first.runId,
      artifactDigest: createRecord.artifactDigest,
    });
    expect(hidden).toMatchObject({ ok: false, code: "NOT_AUTHORIZED" });
  });

  it("rejects a parallel write while the account browser is held", async () => {
    const { runtime, site } = harness("reject");
    let release: () => void = () => undefined;
    site.holdNextApply(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      args: createArgs("serial-key-first"),
      accountBindingId: BINDING,
    });
    await site.waitUntilApplying();
    const second = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      args: createArgs("serial-key-second"),
      accountBindingId: BINDING,
    });
    expect(second.status).toBe("failed");
    expect(second.error?.code).toBe("SERIAL_CONFLICT");
    expect(second.repair).toBe("none");
    expect(site.applyCount).toBe(1);
    expect(site.maxConcurrent).toBe(1);
    release();
    const created = await first;
    expect(created.status).toBe("succeeded");
    expect(site.applyCount).toBe(1);
    expect(site.maxConcurrent).toBe(1);
  });

  it("queues a second write until the account browser lock is released", async () => {
    const { runtime, site } = harness("queue");
    let release: () => void = () => undefined;
    site.holdNextApply(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      args: createArgs("queue-key-first"),
      accountBindingId: BINDING,
    });
    let secondDone = false;
    const second = runtime
      .invoke(PRINCIPAL, {
        capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
        version: SAR_WRITE_VERSION,
        args: createArgs("queue-key-second"),
        accountBindingId: BINDING,
      })
      .then((result) => {
        secondDone = true;
        return result;
      });
    await site.waitUntilApplying();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondDone).toBe(false);
    expect(site.applyCount).toBe(1);
    expect(site.maxConcurrent).toBe(1);
    release();
    const created = await first;
    const queued = await second;
    expect(created.status).toBe("succeeded");
    expect(queued.status).toBe("succeeded");
    expect(queued.data).toMatchObject({ noteId: expect.stringMatching(/^note_/), replayed: false });
    expect(asNote(created).noteId).not.toBe(asNote(queued).noteId);
    expect(site.applyCount).toBe(2);
    expect(site.maxConcurrent).toBe(1);
  });

  it("keeps an unknown write unknown and does not blind-replay it", async () => {
    const { runtime, site, createRecord } = harness();
    site.failNext({ kind: "RESULT_UNKNOWN", landed: false });
    const unknown = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      args: createArgs("unknown-key-one"),
      accountBindingId: BINDING,
    });
    expect(unknown.status).toBe("unknown");
    expect(unknown.repair).toBe("none");
    expect(unknown.verification).toBe("not_performed");
    expect(unknown.error).toMatchObject({
      code: "RESULT_UNKNOWN",
      retry: "not_ordinary",
      ordinaryFailure: false,
    });
    expect(isOrdinaryFailure(unknown)).toBe(false);
    expect(priorWriteMayBeReplayed(unknown)).toBe(false);
    expect(site.applyCount).toBe(1);
    expect(site.observe(BINDING, "unknown-key-one")).toBeNull();

    const again = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      args: createArgs("unknown-key-one"),
      accountBindingId: BINDING,
    });
    expect(again.status).toBe("unknown");
    expect(again.repair).toBe("none");
    expect(again.data).toMatchObject({ replayed: false, confirmedFromRunId: unknown.runId });
    expect(site.applyCount).toBe(1);

    const checked = runtime.recheck(PRINCIPAL, {
      runId: unknown.runId,
      artifactDigest: createRecord.artifactDigest,
    });
    expect(checked).toMatchObject({
      ok: true,
      status: "unknown",
      replayed: false,
      runId: unknown.runId,
    });
    expect(site.applyCount).toBe(1);

    site.failNext({ kind: "TIMEOUT", landed: false });
    const timedOut = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      args: createArgs("unknown-key-timeout"),
      accountBindingId: BINDING,
    });
    expect(timedOut.status).toBe("unknown");
    expect(timedOut.error?.code).toBe("TIMEOUT");
    expect(timedOut.repair).toBe("none");
    expect(isOrdinaryFailure(timedOut)).toBe(false);
    const retried = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      args: createArgs("unknown-key-timeout"),
      accountBindingId: BINDING,
    });
    expect(retried.status).toBe("unknown");
    expect(site.applyCount).toBe(2);
  });

  it("confirms a landed unknown write by receipt and does not apply again", async () => {
    const { runtime, site, createRecord } = harness();
    site.failNext({ kind: "TIMEOUT", landed: true });
    const unknown = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      args: createArgs("landed-key-one"),
      accountBindingId: BINDING,
    });
    expect(unknown.status).toBe("unknown");
    expect(unknown.repair).toBe("none");
    expect(site.applyCount).toBe(1);
    expect(site.observe(BINDING, "landed-key-one")?.title).toBe("Draft title");

    const checked = runtime.recheck(PRINCIPAL, {
      runId: unknown.runId,
      artifactDigest: createRecord.artifactDigest,
    });
    expect(checked).toMatchObject({
      ok: true,
      status: "confirmed",
      replayed: false,
      runId: unknown.runId,
    });
    expect(site.applyCount).toBe(1);

    const again = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      args: createArgs("landed-key-one"),
      accountBindingId: BINDING,
    });
    expect(again.status).toBe("succeeded");
    expect(again.data).toMatchObject({
      replayed: false,
      idempotent: true,
      confirmedFromRunId: unknown.runId,
    });
    expect(site.applyCount).toBe(1);
  });

  it("does not auto-publish, auto-enable, or relax the fixture", async () => {
    const { runtime, site, createRecord } = harness();
    const published = runtime.register({
      manifest: { ...SAR_DRAFT_NOTE_CREATE, id: "fixture.sar.draft-note.publish-attempt" },
      lifecycle: "published",
      published: true,
      verification: "passed",
      enabled: true,
    });
    expect(published.ok).toBe(false);

    const external = runtime.register({
      manifest: {
        ...SAR_DRAFT_NOTE_CREATE,
        id: "fixture.sar.external",
        allowedOrigins: ["https://www.xiaohongshu.com"],
      },
      lifecycle: "approved",
      verification: "passed",
      enabled: true,
    });
    expect(external.ok).toBe(false);

    const privateRecord = runtime.register({
      manifest: {
        ...SAR_DRAFT_NOTE_CREATE,
        id: "fixture.sar.draft-note.private",
        version: "2026.10.18",
      },
      lifecycle: "private",
      verification: "passed",
      enabled: true,
    });
    must(privateRecord);
    expect(privateRecord.record.enabled).toBe(false);
    expect(privateRecord.record.published).toBe(false);
    expect(
      runtime.grant({
        tenantId: PRINCIPAL.tenantId,
        userId: PRINCIPAL.userId,
        capabilityId: privateRecord.record.manifest.id,
        version: privateRecord.record.manifest.version,
        artifactDigest: privateRecord.record.artifactDigest,
        effect: "create",
        accountBindingIds: [BINDING],
      }).ok,
    ).toBe(false);

    site.failNext({ kind: "RESULT_UNKNOWN", landed: false });
    const unknown = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: SAR_WRITE_VERSION,
      args: createArgs("repair-key-unknown"),
      accountBindingId: BINDING,
    });
    expect(unknown.repair).toBe("none");
    expect(site.applyCount).toBe(1);
    site.failNext({ kind: "TIMEOUT", landed: true });
    expect(site.currentFault()).toEqual({ kind: "TIMEOUT", landed: true });

    const readAuthority = new SarExecutionAuthority(memoryEpochStore());
    readAuthority.boot();
    disposers.push(() => readAuthority.dispose());
    const readRuntime = new SiteCapabilityRuntime({
      authority: readAuthority,
      portForScope: () => closedPort,
    });
    const loop = new SiteLearningLoop(readRuntime, { mintDraftId: () => "draft-write-1" });
    const suggestion = proposeWriteRepair({
      result: unknown,
      source: { manifest: createRecord.manifest, version: createRecord.manifest.version },
      accountBindingId: BINDING,
      mintDraftId: () => "draft-write-1",
    });
    expect(suggestion).toMatchObject({
      action: "suggestion",
      failureClass: "unknown",
      candidate: null,
      autoPublished: false,
      writeEnabled: false,
      fixtureRelaxed: false,
      grantsExpanded: false,
    });
    const readRepair = loop.repair({
      result: unknown,
      accountBindingId: BINDING,
    });
    expect(readRepair).toMatchObject({
      action: "suggestion",
      candidate: null,
      autoPublished: false,
      fixtureRelaxed: false,
    });
    expect(site.currentFault()).toEqual({ kind: "TIMEOUT", landed: true });
    expect(loop.draftCount()).toBe(0);

    const shared = proposeRepair({
      result: unknown,
      now: "2026-10-17T00:00:00.000Z",
      mintDraftId: () => "draft-shared-1",
    });
    expect(shared.action).toBe("suggestion");
    expect(shared.autoPublished).toBe(false);
    expect(shared.fixtureRelaxed).toBe(false);
    expect(shared.candidate).toBeNull();

    const structure: SiteRunResult = {
      ...unknown,
      status: "failed",
      error: {
        code: "STRUCTURE_CHANGED",
        message: "STRUCTURE_CHANGED",
        retry: "none",
        ordinaryFailure: true,
      },
      repair: "none",
    };
    const candidate = proposeWriteRepair({
      result: structure,
      source: { manifest: SAR_DRAFT_NOTE_CREATE, version: SAR_WRITE_VERSION },
      accountBindingId: BINDING,
      mintDraftId: () => "draft-write-2",
    });
    expect(candidate.action).toBe("candidate");
    expect(candidate.autoPublished).toBe(false);
    expect(candidate.writeEnabled).toBe(false);
    expect(candidate.fixtureRelaxed).toBe(false);
    expect(candidate.candidate).toMatchObject({
      lifecycle: "private",
      enabled: false,
      published: false,
      effect: "create",
    });
    const invoked = await runtime.invoke(PRINCIPAL, {
      capabilityId: SAR_DRAFT_NOTE_CREATE_ID,
      version: candidate.candidate?.version ?? "missing",
      args: createArgs("repair-key-candidate"),
      accountBindingId: BINDING,
    });
    expect(invoked.error?.code).toBe("NOT_AUTHORIZED");
    expect(site.applyCount).toBe(1);
    expect(site.currentFault()).toEqual({ kind: "TIMEOUT", landed: true });

    const explored = await loop.explore({
      principal: PRINCIPAL,
      accountBindingId: BINDING,
      manifest: SAR_DRAFT_NOTE_CREATE,
      inputFields: [{ name: "title", required: true }],
      plan: [{ op: "apply_draft" }],
      args: { title: "nope" },
    });
    expect(explored.ok).toBe(false);
    expect(loop.draftCount()).toBe(0);

    const catalog = getDefaultSiteCapabilityRuntime();
    expect(catalog.list(PRINCIPAL)).toMatchObject({ ok: true, items: [] });
    expect(catalog).not.toBe(runtime);
    expect(site.applyCount).toBe(1);
    expect(privateRecord.record.published).toBe(false);
    expect(createRecord.published).toBe(false);
  });
});
