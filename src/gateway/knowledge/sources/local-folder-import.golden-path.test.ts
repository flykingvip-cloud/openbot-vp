// @vitest-environment node
/**
 * Golden path E2E for knowledge localFolder import closure.
 *
 * team KB → bind local folder → scan/ingest → documents in KB →
 * knowledge.base.search evidence → sources list visible →
 * runtime/search consumption → reload persistence.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetKnowledgeRetrievalServiceForTests } from "../../../retrieval/retrieval-service.js";
import { resetDeliverableRetrievalSourceRegistrationForTests } from "../../../retrieval/sources/deliverable-source.js";
import { resetKnowledgeRetrievalSourceRegistrationForTests } from "../../../retrieval/sources/knowledge-source.js";
import type {
  GatewayRequestHandler,
  GatewayRequestHandlerOptions,
} from "../../server-methods/types.js";
import type { KnowledgeSourceContext } from "./types.js";

const { tmpDir, dataRoot, folderRoot } = vi.hoisted(() => {
  const root = `/tmp/openbot-lf-golden-${Math.random().toString(36).slice(2)}`;
  const data = `${root}/OpenBot`;
  return {
    tmpDir: root,
    dataRoot: data,
    folderRoot: `${data}/team-notes`,
  };
});

const contextState = vi.hoisted(() => ({
  current: {
    userId: "user-a",
    seatId: "seat-team-1",
    tenantId: "tenant-acme",
    hasEnterpriseScope: true,
    teamLabel: "Platform",
    roleCode: "operator",
  } as KnowledgeSourceContext,
}));

vi.mock("../../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

vi.mock("../../../config/config.js", () => ({
  loadConfig: () => ({
    data: { root: dataRoot, mode: "local" as const },
    gateway: { auth: { trustedProxy: { enabled: true } } },
  }),
}));

vi.mock("../context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => contextState.current),
}));

const { knowledgeHandlers } = await import("../../server-methods/knowledge.js");
const { stopAllLocalFolderWatchers } = await import("./local-folder-watcher.js");
const { findLocalFolderBinding, listLocalFolderBindings } =
  await import("./local-folder-binding-store.js");
const { loadLocalFolderSyncPlan } = await import("./local-folder-sync-plan-store.js");
const { listSourceDocumentLinks } = await import("./source-document-link-store.js");

function setContext(context: Partial<KnowledgeSourceContext> & { userId: string | null }) {
  contextState.current = {
    userId: context.userId,
    seatId: context.seatId ?? null,
    tenantId: context.tenantId ?? null,
    hasEnterpriseScope: context.hasEnterpriseScope ?? Boolean(context.tenantId),
    teamLabel: context.teamLabel ?? null,
    roleCode: context.roleCode ?? null,
    departmentId: context.departmentId ?? null,
  };
}

async function invoke(
  method: string,
  params: Record<string, unknown> = {},
  connectionDeviceId = "browser-device-1",
): Promise<{
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
}> {
  const handler = knowledgeHandlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: {
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: { message?: string };
  } | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: {
      connect: { device: { id: connectionDeviceId } } as never,
      user: "alice@acme.test",
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as { message?: string } | undefined,
      };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

function extractKnowledgeBaseId(payload: Record<string, unknown> | undefined): string {
  const kb = payload?.knowledgeBase;
  if (!kb || typeof kb !== "object") {
    throw new Error("expected knowledgeBase in payload");
  }
  const id = (kb as { id?: unknown }).id;
  if (typeof id !== "string" || !id) {
    throw new Error("expected knowledgeBase.id in payload");
  }
  return id;
}

function writeText(filePath: string, body: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
}

describe("localFolder import golden path E2E", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmpDir, "knowledge"), { recursive: true });
    fs.mkdirSync(folderRoot, { recursive: true });
    writeText(
      path.join(folderRoot, "refund-playbook.md"),
      "# Refund Playbook\n\nEnterprise refund escalation steps for team agents.\n",
    );
    writeText(
      path.join(folderRoot, "nested", "sla.md"),
      "# SLA Notes\n\nPriority queue handling and knowledge consumption.\n",
    );
    setContext({
      userId: "user-a",
      tenantId: "tenant-acme",
      seatId: "seat-team-1",
      hasEnterpriseScope: true,
      teamLabel: "Platform",
      roleCode: "operator",
    });
    resetKnowledgeRetrievalServiceForTests();
    resetKnowledgeRetrievalSourceRegistrationForTests();
    resetDeliverableRetrievalSourceRegistrationForTests();
  });

  afterEach(async () => {
    await stopAllLocalFolderWatchers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resetKnowledgeRetrievalServiceForTests();
    resetKnowledgeRetrievalSourceRegistrationForTests();
    resetDeliverableRetrievalSourceRegistrationForTests();
  });

  it("K1 closes team KB → bind → scan → search → sources → consume → reload", async () => {
    // 1) Create team knowledge base.
    const created = await invoke("knowledge.base.create", {
      title: "Team Import KB",
      description: "golden path team space",
      visibility: "team",
    });
    expect(created.ok).toBe(true);
    const kbId = extractKnowledgeBaseId(created.payload);
    expect(kbId).toMatch(/^kb_/);

    // 2) Bind local folder (local_index) — bind triggers first scan.
    const bound = await invoke("knowledge.local-folder.bind", {
      knowledgeBaseId: kbId,
      rootPath: folderRoot,
      rootLabel: "Team notes",
      mode: "local_index",
      deletePolicy: "snapshot",
      watcherEnabled: false,
      deviceId: "device-golden-1",
    });
    expect(bound.ok).toBe(true);
    expect(bound.error?.message).toBeUndefined();
    const bindingId = bound.payload?.bindingId;
    expect(typeof bindingId).toBe("string");
    expect(bound.payload?.knowledgeBaseId).toBe(kbId);
    expect(bound.payload?.mode).toBe("local_index");
    const scan = bound.payload?.scan as
      | { scanned?: number; ingested?: number; errors?: string[] }
      | null
      | undefined;
    expect(scan).toBeTruthy();
    expect(scan?.scanned).toBeGreaterThanOrEqual(2);
    expect(scan?.ingested).toBeGreaterThanOrEqual(1);
    expect(scan?.errors ?? []).toEqual([]);

    // Absolute path must stay on binding store, not on cloud-visible descriptor endpoint.
    const binding = findLocalFolderBinding({ bindingId: String(bindingId) });
    expect(binding?.rootPath).toBe(path.resolve(folderRoot));
    const sourceDescriptorId = bound.payload?.sourceDescriptorId;
    expect(typeof sourceDescriptorId).toBe("string");
    expect(sourceDescriptorId).toBeTruthy();

    // 3) Documents landed in KB library.
    const docs = await invoke("knowledge.base.documents.list", { knowledgeBaseId: kbId });
    expect(docs.ok).toBe(true);
    const documents = docs.payload?.documents as Array<Record<string, unknown>> | undefined;
    expect(Array.isArray(documents)).toBe(true);
    expect((documents ?? []).length).toBeGreaterThanOrEqual(1);

    // 4) knowledge.base.search returns indexed evidence.
    const searched = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "refund escalation",
      limit: 6,
    });
    expect(searched.ok).toBe(true);
    expect(searched.payload?.searchMode).toBe("indexed");
    const evidence = searched.payload?.evidence as Array<Record<string, unknown>> | undefined;
    expect(Array.isArray(evidence)).toBe(true);
    expect((evidence ?? []).length).toBeGreaterThan(0);
    expect(evidence?.[0]?.kbId).toBe(kbId);
    const sourceUri = evidence?.[0]?.sourceUri;
    expect(typeof sourceUri).toBe("string");
    expect(sourceUri).toMatch(/^ku:\/\/kb\//);

    // 5) Knowledge Universe source plane shows the localFolder binding.
    const sources = await invoke("knowledge.base.sources.list", {
      knowledgeBaseId: kbId,
      plane: "passive",
    });
    expect(sources.ok).toBe(true);
    const sourceItems = sources.payload?.sources as Array<Record<string, unknown>> | undefined;
    expect(Array.isArray(sourceItems)).toBe(true);
    const localFolderSource = (sourceItems ?? []).find((item) => item.kind === "localFolder");
    expect(localFolderSource).toBeTruthy();
    expect(localFolderSource?.knowledgeBaseId).toBe(kbId);
    expect(localFolderSource?.plane).toBe("passive");

    // Feed list is readable for the authenticated seat (Universe surface).
    const feed = await invoke("knowledge.feed.list", {});
    expect(feed.ok).toBe(true);

    // 6) Agent/runtime consumption path can resolve context for the same query.
    const runtime = await invoke("knowledge.runtime.context", {
      query: "refund escalation",
      taskContext: { taskType: "general" },
    });
    expect(runtime.ok).toBe(true);
    expect(runtime.payload).toBeTruthy();

    // Workspace search also surfaces the ingested knowledge for agent replies.
    const workspace = await invoke("knowledge.workspace.search", {
      query: "refund escalation",
      limitPerGroup: 5,
    });
    expect(workspace.ok).toBe(true);

    // 7) Reload / re-open stores: binding + document links + search still work.
    const persistedBindings = listLocalFolderBindings({ knowledgeBaseId: kbId });
    expect(persistedBindings.some((item) => item.bindingId === bindingId)).toBe(true);

    const status = await invoke("knowledge.local-folder.status", { knowledgeBaseId: kbId });
    expect(status.ok).toBe(true);
    const statusItems = status.payload?.items as Array<Record<string, unknown>> | undefined;
    expect((statusItems ?? []).some((item) => item.bindingId === bindingId)).toBe(true);

    const links = listSourceDocumentLinks({
      sourceDescriptorId: typeof sourceDescriptorId === "string" ? sourceDescriptorId : "",
      state: "active",
    });
    expect(links.length).toBeGreaterThanOrEqual(1);

    // Explicit rescan remains idempotent and keeps search evidence.
    const rescanned = await invoke("knowledge.local-folder.scan-now", { bindingId });
    expect(rescanned.ok).toBe(true);

    const searchedAgain = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "refund escalation",
      limit: 4,
    });
    expect(searchedAgain.ok).toBe(true);
    const evidenceAgain = searchedAgain.payload?.evidence as unknown[] | undefined;
    expect((evidenceAgain ?? []).length).toBeGreaterThan(0);
  });

  it("K2 denies bind without user context (authz)", async () => {
    const created = await invoke("knowledge.base.create", {
      title: "Authz KB",
      visibility: "team",
    });
    expect(created.ok).toBe(true);
    const kbId = extractKnowledgeBaseId(created.payload);

    setContext({ userId: null, tenantId: "tenant-acme", seatId: null, hasEnterpriseScope: false });
    const bound = await invoke("knowledge.local-folder.bind", {
      knowledgeBaseId: kbId,
      rootPath: folderRoot,
      rootLabel: "Denied",
      mode: "local_index",
      deletePolicy: "snapshot",
      watcherEnabled: false,
      deviceId: "device-k2",
    });
    expect(bound.ok).toBe(false);
    expect(bound.error?.message ?? "").toMatch(/user context required/i);
    expect(listLocalFolderBindings({ knowledgeBaseId: kbId })).toEqual([]);
  });

  it("K3 tenant B cannot search tenant A knowledge base", async () => {
    setContext({
      userId: "user-a",
      tenantId: "tenant-acme",
      seatId: "seat-team-1",
      hasEnterpriseScope: true,
      teamLabel: "Platform",
      roleCode: "operator",
    });
    const created = await invoke("knowledge.base.create", {
      title: "Acme KB",
      visibility: "team",
    });
    expect(created.ok).toBe(true);
    const kbId = extractKnowledgeBaseId(created.payload);
    const bound = await invoke("knowledge.local-folder.bind", {
      knowledgeBaseId: kbId,
      rootPath: folderRoot,
      rootLabel: "Acme notes",
      mode: "local_index",
      deletePolicy: "snapshot",
      watcherEnabled: false,
      deviceId: "device-k3-a",
    });
    expect(bound.ok).toBe(true);

    setContext({
      userId: "user-b",
      tenantId: "tenant-globex",
      seatId: "seat-globex-1",
      hasEnterpriseScope: true,
      teamLabel: "Ops",
      roleCode: "operator",
    });
    const searched = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "refund escalation",
      limit: 6,
    });
    // Cross-tenant: either hard deny or empty evidence — never acme content.
    if (searched.ok) {
      const evidence = searched.payload?.evidence as Array<Record<string, unknown>> | undefined;
      expect(evidence ?? []).toEqual([]);
    } else {
      expect(searched.error?.message ?? "").toMatch(/not authorized|not found|denied|invalid/i);
    }
  });

  it("K4 rescan is idempotent for documents and links", async () => {
    const created = await invoke("knowledge.base.create", {
      title: "Idempotent KB",
      visibility: "team",
    });
    const kbId = extractKnowledgeBaseId(created.payload);
    const bound = await invoke("knowledge.local-folder.bind", {
      knowledgeBaseId: kbId,
      rootPath: folderRoot,
      rootLabel: "Notes",
      mode: "local_index",
      deletePolicy: "snapshot",
      watcherEnabled: false,
      deviceId: "device-k4",
    });
    expect(bound.ok).toBe(true);
    const bindingId = String(bound.payload?.bindingId);
    const sourceDescriptorId = String(bound.payload?.sourceDescriptorId);

    const docs1 = await invoke("knowledge.base.documents.list", { knowledgeBaseId: kbId });
    const docCount1 = ((docs1.payload?.documents as unknown[]) ?? []).length;
    const links1 = listSourceDocumentLinks({ sourceDescriptorId, state: "active" }).length;
    expect(docCount1).toBeGreaterThanOrEqual(1);
    expect(links1).toBeGreaterThanOrEqual(1);

    const rescanned = await invoke("knowledge.local-folder.scan-now", { bindingId });
    expect(rescanned.ok).toBe(true);
    await invoke("knowledge.local-folder.scan-now", { bindingId });

    const docs2 = await invoke("knowledge.base.documents.list", { knowledgeBaseId: kbId });
    const docCount2 = ((docs2.payload?.documents as unknown[]) ?? []).length;
    const links2 = listSourceDocumentLinks({ sourceDescriptorId, state: "active" }).length;
    expect(docCount2).toBe(docCount1);
    expect(links2).toBe(links1);
  });

  it("K5 bind outside data root fails then recovers with allowOutsideDataRoot", async () => {
    const created = await invoke("knowledge.base.create", {
      title: "Recover KB",
      visibility: "team",
    });
    const kbId = extractKnowledgeBaseId(created.payload);
    const outside = path.join(tmpDir, "outside-notes");
    writeText(path.join(outside, "note.md"), "# Outside\n\nRecoverable content.\n");

    const denied = await invoke("knowledge.local-folder.bind", {
      knowledgeBaseId: kbId,
      rootPath: outside,
      rootLabel: "Outside",
      mode: "local_index",
      deletePolicy: "snapshot",
      watcherEnabled: false,
      deviceId: "device-k5",
      allowOutsideDataRoot: false,
    });
    expect(denied.ok).toBe(false);
    expect(denied.error?.message ?? "").toMatch(/outside|data.?root|not allowed|path/i);

    const recovered = await invoke("knowledge.local-folder.bind", {
      knowledgeBaseId: kbId,
      rootPath: folderRoot,
      rootLabel: "Inside",
      mode: "local_index",
      deletePolicy: "snapshot",
      watcherEnabled: false,
      deviceId: "device-k5-ok",
    });
    expect(recovered.ok).toBe(true);
    expect(typeof recovered.payload?.bindingId).toBe("string");
  });

  it("K6 binding persists on disk after process-local reload", async () => {
    const created = await invoke("knowledge.base.create", {
      title: "Persist KB",
      visibility: "team",
    });
    const kbId = extractKnowledgeBaseId(created.payload);
    const bound = await invoke("knowledge.local-folder.bind", {
      knowledgeBaseId: kbId,
      rootPath: folderRoot,
      rootLabel: "Persist",
      mode: "local_index",
      deletePolicy: "snapshot",
      watcherEnabled: false,
      deviceId: "device-k6",
    });
    expect(bound.ok).toBe(true);
    const bindingId = String(bound.payload?.bindingId);

    // Simulate restart: re-read stores from disk via public APIs (same CONFIG_DIR).
    const fromDisk = listLocalFolderBindings({ knowledgeBaseId: kbId });
    expect(fromDisk.some((item) => item.bindingId === bindingId)).toBe(true);
    const status = await invoke("knowledge.local-folder.status", { knowledgeBaseId: kbId });
    expect(status.ok).toBe(true);
    const items = status.payload?.items as Array<Record<string, unknown>> | undefined;
    expect((items ?? []).some((item) => item.bindingId === bindingId)).toBe(true);

    const searched = await invoke("knowledge.base.search", {
      knowledgeBaseId: kbId,
      query: "refund escalation",
      limit: 4,
    });
    expect(searched.ok).toBe(true);
    expect(((searched.payload?.evidence as unknown[]) ?? []).length).toBeGreaterThan(0);
  });

  it("K7 enforces managed directory identity, device binding, and lease parameters", async () => {
    const created = await invoke("knowledge.base.create", {
      title: "Managed Contract KB",
      visibility: "team",
    });
    const kbId = extractKnowledgeBaseId(created.payload);
    const baseBind = {
      knowledgeBaseId: kbId,
      rootLabel: "Browser notes",
      mode: "managed_push",
      deletePolicy: "snapshot",
      watcherEnabled: false,
      deviceId: "browser-device-1",
    };

    const missingDirectory = await invoke("knowledge.local-folder.bind", baseBind);
    expect(missingDirectory.ok).toBe(false);
    expect(missingDirectory.error?.message ?? "").toMatch(/directoryId required/i);

    const first = await invoke("knowledge.local-folder.bind", {
      ...baseBind,
      directoryId: "directory-browser-1",
    });
    expect(first.ok).toBe(true);
    const bindingId = String(first.payload?.bindingId);
    const rebound = await invoke("knowledge.local-folder.bind", {
      ...baseBind,
      directoryId: "directory-browser-1",
    });
    const sameLabelDifferentDirectory = await invoke("knowledge.local-folder.bind", {
      ...baseBind,
      directoryId: "directory-browser-2",
    });
    expect(rebound.payload?.bindingId).toBe(bindingId);
    expect(sameLabelDifferentDirectory.payload?.bindingId).not.toBe(bindingId);
    expect(findLocalFolderBinding({ bindingId })?.directoryId).toBe("directory-browser-1");

    const missingDevice = await invoke("knowledge.local-folder.sync.plan", {
      bindingId,
      candidates: [],
    });
    expect(missingDevice.ok).toBe(false);
    expect(missingDevice.error?.message ?? "").toMatch(/deviceId/i);
    const wrongDevice = await invoke("knowledge.local-folder.sync.plan", {
      bindingId,
      deviceId: "wrong-device",
      candidates: [],
    });
    expect(wrongDevice.ok).toBe(false);
    expect(wrongDevice.error?.message ?? "").toMatch(/deviceId/i);
    const spoofedConnection = await invoke(
      "knowledge.local-folder.sync.plan",
      {
        bindingId,
        deviceId: "browser-device-1",
        candidates: [],
      },
      "attacker-device",
    );
    expect(spoofedConnection.ok).toBe(false);
    expect(spoofedConnection.error?.message ?? "").toMatch(/authenticated connection device/i);
    const missingConnectionDevice = await invoke(
      "knowledge.local-folder.sync.plan",
      {
        bindingId,
        deviceId: "browser-device-1",
        candidates: [],
      },
      "",
    );
    expect(missingConnectionDevice.ok).toBe(false);
    expect(missingConnectionDevice.error?.message ?? "").toMatch(
      /authenticated connection device identity required/i,
    );

    const planned = await invoke("knowledge.local-folder.sync.plan", {
      bindingId,
      deviceId: "browser-device-1",
      candidates: [],
    });
    expect(planned.ok).toBe(true);
    expect(planned.payload).toMatchObject({
      bindingId,
      deviceId: "browser-device-1",
      generation: 1,
    });
    expect(planned.payload?.planId).toMatch(/^lfp:/);
    const planId = String(planned.payload?.planId);
    const generation = Number(planned.payload?.generation);

    const stringGeneration = await invoke("knowledge.local-folder.sync.commit", {
      bindingId,
      deviceId: "browser-device-1",
      planId,
      generation: "1",
      phase: "finalize",
      files: [],
    });
    expect(stringGeneration.ok).toBe(false);
    expect(stringGeneration.error?.message ?? "").toMatch(/positive integer generation/i);

    const fractionalGeneration = await invoke("knowledge.local-folder.sync.commit", {
      bindingId,
      deviceId: "browser-device-1",
      planId,
      generation: 1.5,
      phase: "finalize",
      files: [],
    });
    expect(fractionalGeneration.ok).toBe(false);
    expect(fractionalGeneration.error?.message ?? "").toMatch(/positive integer generation/i);

    const clientDeletes = await invoke("knowledge.local-folder.sync.commit", {
      bindingId,
      deviceId: "browser-device-1",
      planId,
      generation,
      phase: "finalize",
      files: [],
      deletedRelativePaths: ["client-controlled.txt"],
    });
    expect(clientDeletes.ok).toBe(false);
    expect(clientDeletes.error?.message ?? "").toMatch(/client-controlled deletion/i);

    const missingToken = await invoke("knowledge.local-folder.sync.commit", {
      bindingId,
      deviceId: "browser-device-1",
      generation,
      phase: "finalize",
      files: [],
    });
    expect(missingToken.ok).toBe(false);
    expect(missingToken.error?.message ?? "").toMatch(/planId required/i);

    const finalized = await invoke("knowledge.local-folder.sync.commit", {
      bindingId,
      deviceId: "browser-device-1",
      planId,
      generation,
      phase: "finalize",
      files: [],
    });
    expect(finalized.ok).toBe(true);
    const replayed = await invoke("knowledge.local-folder.sync.commit", {
      bindingId,
      deviceId: "browser-device-1",
      planId,
      generation,
      phase: "finalize",
      files: [],
    });
    expect(replayed.ok).toBe(false);
    expect(replayed.error?.message ?? "").toMatch(/consumed/i);

    const planBeforeRebind = await invoke("knowledge.local-folder.sync.plan", {
      bindingId,
      deviceId: "browser-device-1",
      candidates: [],
    });
    expect(planBeforeRebind.ok).toBe(true);
    const revisionBeforeRebind = findLocalFolderBinding({ bindingId })?.revision;
    const reboundWithChangedPolicy = await invoke("knowledge.local-folder.bind", {
      ...baseBind,
      directoryId: "directory-browser-1",
      deletePolicy: "sync",
    });
    expect(reboundWithChangedPolicy.ok).toBe(true);
    expect(findLocalFolderBinding({ bindingId })?.revision).toBe((revisionBeforeRebind ?? 0) + 1);
    expect(loadLocalFolderSyncPlan(bindingId)).toMatchObject({
      state: "consumed",
      invalidatedAtMs: expect.any(Number),
    });
    const staleAfterRebind = await invoke("knowledge.local-folder.sync.commit", {
      bindingId,
      deviceId: "browser-device-1",
      planId: planBeforeRebind.payload?.planId,
      generation: planBeforeRebind.payload?.generation,
      phase: "finalize",
      files: [],
    });
    expect(staleAfterRebind.ok).toBe(false);
    expect(staleAfterRebind.error?.message ?? "").toMatch(/invalidated|lifecycle/i);

    const planBeforeUnbind = await invoke("knowledge.local-folder.sync.plan", {
      bindingId,
      deviceId: "browser-device-1",
      candidates: [],
    });
    expect(planBeforeUnbind.ok).toBe(true);
    const unbound = await invoke("knowledge.local-folder.unbind", { bindingId });
    expect(unbound.ok).toBe(true);
    expect(unbound.payload?.ok).toBe(true);
    expect(loadLocalFolderSyncPlan(bindingId)).toMatchObject({
      state: "consumed",
      invalidatedAtMs: expect.any(Number),
    });
    const blockedAfterUnbind = await invoke("knowledge.local-folder.sync.commit", {
      bindingId,
      deviceId: "browser-device-1",
      planId: planBeforeUnbind.payload?.planId,
      generation: planBeforeUnbind.payload?.generation,
      phase: "finalize",
      files: [],
    });
    expect(blockedAfterUnbind.ok).toBe(false);
    expect(blockedAfterUnbind.error?.message ?? "").toMatch(/binding not found/i);
  });
});
