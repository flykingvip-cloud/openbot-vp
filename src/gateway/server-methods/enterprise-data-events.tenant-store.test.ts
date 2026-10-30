// @vitest-environment node
/**
 * P1-F acceptance blockers (Codex 9b127fb9 review):
 * 1) events.ingest must resolve the same tenant control-plane store as binding APIs.
 * 2) load/save failures must not look like "no matching bindings" (all-zero + failed=0).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeEnterpriseDataEventStore } from "../enterprise-data/enterprise-data-event-store.js";
import { listKnowledgeFeedItems } from "../enterprise-data/knowledge-feed-item-store.js";
import { normalizeEnterpriseDataStore } from "../enterprise-data/store.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(async () => {}),
  resolve: vi.fn(async () => "/tenant-acme/enterprise-data.json"),
}));

vi.mock("../billing/scope.js", () => ({
  resolveBillingScope: async () => ({
    enterpriseId: "tenant-acme",
    user: { id: "admin" },
    membership: null,
    isEnterpriseAdmin: true,
    permissions: new Set(["operator"]),
  }),
}));

vi.mock("../protocol/index.js", () => ({
  ErrorCodes: { INVALID_REQUEST: "INVALID_REQUEST" },
  errorShape: (code: string, message: string, extra?: { code?: string }) => ({
    code,
    message,
    ...extra,
  }),
}));

vi.mock("../tenant-context.js", () => ({
  resolveControlPlaneStorePathForClient: mocks.resolve,
}));

vi.mock("../enterprise-data/store.js", async (original) => {
  const actual = await original<typeof import("../enterprise-data/store.js")>();
  return {
    ...actual,
    loadEnterpriseDataStore: mocks.load,
    saveEnterpriseDataStore: mocks.save,
  };
});

const { createEnterpriseDataEventHandlers } = await import("./enterprise-data-events.js");

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string; code?: string };
};

async function invokeIngest(
  handlers: ReturnType<typeof createEnterpriseDataEventHandlers>,
  params: Record<string, unknown>,
): Promise<InvokeResult> {
  const handler = handlers["enterprise-data.events.ingest"];
  let response: InvokeResult | null = null;
  await handler({
    req: { type: "req", id: "test", method: "enterprise-data.events.ingest", params },
    params,
    client: { connect: {} as never, user: "admin" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as { message?: string; code?: string } | undefined,
      };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error("handler did not respond");
  }
  return response;
}

describe("P1-F events.ingest tenant store locator", () => {
  beforeEach(() => {
    mocks.load.mockReset();
    mocks.save.mockReset();
    mocks.save.mockResolvedValue(undefined);
    mocks.resolve.mockReset();
    mocks.resolve.mockResolvedValue("/tenant-acme/enterprise-data.json");
  });

  it("ingest loads the same tenant-scoped data store as projection binding writes", async () => {
    // Codex path-repro PoC: resolver must be called; load receives tenant path.
    mocks.load.mockResolvedValue(normalizeEnterpriseDataStore(null));
    const eventStore = normalizeEnterpriseDataEventStore(null);
    const handlers = createEnterpriseDataEventHandlers({
      withStore: async (run) => run(eventStore),
      now: () => "2026-10-30T12:00:00.000Z",
    });
    const response = await invokeIngest(handlers, {
      sourceId: "src-a",
      externalId: "e-1",
      eventType: "created",
      objectKind: "order",
      objectKey: "o-1",
      title: "created",
    });
    expect(response.ok).toBe(true);
    expect(response.payload?.deduped).toBe(false);
    expect(mocks.resolve).toHaveBeenCalled();
    expect(mocks.resolve.mock.calls[0]?.[1]).toBe("enterprise-data.json");
    expect(mocks.load).toHaveBeenCalledWith("/tenant-acme/enterprise-data.json");
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), "/tenant-acme/enterprise-data.json");
  });

  it("surfaces store load failure as failed>0 with stage/errorCode (not all-zero success)", async () => {
    mocks.load.mockRejectedValue(new Error("EIO load"));
    const eventStore = normalizeEnterpriseDataEventStore(null);
    const handlers = createEnterpriseDataEventHandlers({
      withStore: async (run) => run(eventStore),
      now: () => "2026-10-30T12:00:00.000Z",
    });
    const response = await invokeIngest(handlers, {
      sourceId: "src-a",
      externalId: "e-load-fail",
      eventType: "created",
      objectKind: "order",
      title: "load-fail",
    });
    expect(response.ok).toBe(true);
    const materialization = response.payload?.materialization as {
      attempted: number;
      succeeded: number;
      failed: number;
      skipped: number;
      stage?: string;
      errorCode?: string;
      retryHint?: string;
    };
    expect(materialization.attempted).toBe(0);
    expect(materialization.succeeded).toBe(0);
    expect(materialization.failed).toBe(1);
    expect(materialization.skipped).toBe(0);
    expect(materialization.stage).toBe("load");
    expect(materialization.errorCode).toBe("store_load_failed");
    expect(materialization.retryHint).toBe("deduped_external_id_will_not_rematerialize");
  });

  it("surfaces store save failure without claiming persisted success", async () => {
    mocks.load.mockResolvedValue(normalizeEnterpriseDataStore(null));
    mocks.save.mockRejectedValue(new Error("EIO save"));
    const eventStore = normalizeEnterpriseDataEventStore(null);
    const handlers = createEnterpriseDataEventHandlers({
      withStore: async (run) => run(eventStore),
      now: () => "2026-10-30T12:00:00.000Z",
    });
    const response = await invokeIngest(handlers, {
      sourceId: "src-a",
      externalId: "e-save-fail",
      eventType: "created",
      objectKind: "order",
      title: "save-fail",
    });
    expect(response.ok).toBe(true);
    const materialization = response.payload?.materialization as {
      succeeded: number;
      failed: number;
      stage?: string;
      errorCode?: string;
    };
    expect(materialization.succeeded).toBe(0);
    expect(materialization.failed).toBeGreaterThanOrEqual(1);
    expect(materialization.stage).toBe("save");
    expect(materialization.errorCode).toBe("store_save_failed");
  });

  it("no matching bindings still returns zeros without stage/errorCode", async () => {
    mocks.load.mockResolvedValue(normalizeEnterpriseDataStore(null));
    const eventStore = normalizeEnterpriseDataEventStore(null);
    const handlers = createEnterpriseDataEventHandlers({
      withStore: async (run) => run(eventStore),
      now: () => "2026-10-30T12:00:00.000Z",
    });
    const response = await invokeIngest(handlers, {
      sourceId: "src-none",
      externalId: "e-nomatch",
      eventType: "created",
      objectKind: "order",
      title: "nomatch",
    });
    const materialization = response.payload?.materialization as {
      attempted: number;
      failed: number;
      stage?: string;
      errorCode?: string;
    };
    expect(materialization.attempted).toBe(0);
    expect(materialization.failed).toBe(0);
    expect(materialization.stage).toBeUndefined();
    expect(materialization.errorCode).toBeUndefined();
  });
});

describe("P1-F events.ingest real tenant file path (binding → ingest → feed)", () => {
  let tmpRoot = "";
  let acmePath = "";
  let globexPath = "";

  beforeEach(async () => {
    const real = await vi.importActual<typeof import("../enterprise-data/store.js")>(
      "../enterprise-data/store.js",
    );
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p1f-event-store-"));
    acmePath = path.join(tmpRoot, "tenant-acme", "control-plane", "enterprise-data.json");
    globexPath = path.join(tmpRoot, "tenant-globex", "control-plane", "enterprise-data.json");
    fs.mkdirSync(path.dirname(acmePath), { recursive: true });
    fs.mkdirSync(path.dirname(globexPath), { recursive: true });

    mocks.resolve.mockReset();
    mocks.resolve.mockImplementation(async () => acmePath);
    mocks.load.mockReset();
    mocks.save.mockReset();
    mocks.load.mockImplementation(async (storePath?: string) =>
      real.loadEnterpriseDataStore(storePath),
    );
    mocks.save.mockImplementation(async (store, storePath?: string) =>
      real.saveEnterpriseDataStore(store, storePath),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("uses tenant file for load/save and does not touch peer-tenant store", async () => {
    const nowIso = "2026-10-30T12:00:00.000Z";
    const real = await vi.importActual<typeof import("../enterprise-data/store.js")>(
      "../enterprise-data/store.js",
    );

    // Seed both tenant files with distinct marker bindings (direct store write —
    // path isolation under test; full SAR materialize covered by materializer suite).
    const acmeStore = normalizeEnterpriseDataStore(null);
    acmeStore.enterpriseKnowledgeProjectionBindings["bind-acme"] = {
      bindingId: "bind-acme",
      tenantId: "tenant-acme",
      projectionId: "proj-acme",
      materializationMode: "event_driven",
      materializationTeamLabel: "华北销售",
      enabled: true,
      generatorVersion: "p1f-path",
      createdAt: nowIso,
      updatedAt: nowIso,
    } as never;
    await real.saveEnterpriseDataStore(acmeStore, acmePath);

    const globexStore = normalizeEnterpriseDataStore(null);
    globexStore.enterpriseKnowledgeProjectionBindings["bind-globex"] = {
      bindingId: "bind-globex",
      tenantId: "tenant-globex",
      projectionId: "proj-globex",
      materializationMode: "event_driven",
      materializationTeamLabel: "华北销售",
      enabled: true,
      generatorVersion: "p1f-path",
      createdAt: nowIso,
      updatedAt: nowIso,
    } as never;
    await real.saveEnterpriseDataStore(globexStore, globexPath);
    const beforeGlobex = fs.readFileSync(globexPath, "utf8");

    const eventStore = normalizeEnterpriseDataEventStore(null);
    const handlers = createEnterpriseDataEventHandlers({
      withStore: async (run) => run(eventStore),
      now: () => nowIso,
    });

    const response = await invokeIngest(handlers, {
      sourceId: "src-a",
      externalId: "e-tenant-path-1",
      eventType: "created",
      objectKind: "order",
      title: "tenant-path",
    });
    expect(response.ok).toBe(true);
    expect(mocks.resolve).toHaveBeenCalled();
    expect(mocks.load.mock.calls.some((call) => call[0] === acmePath)).toBe(true);
    expect(mocks.save.mock.calls.some((call) => call[1] === acmePath)).toBe(true);
    expect(fs.readFileSync(globexPath, "utf8")).toBe(beforeGlobex);

    const reloaded = await real.loadEnterpriseDataStore(acmePath);
    expect(reloaded.enterpriseKnowledgeProjectionBindings["bind-acme"]?.tenantId).toBe(
      "tenant-acme",
    );
    expect(reloaded.enterpriseKnowledgeProjectionBindings["bind-globex"]).toBeUndefined();
    // Peer tenant file still only has globex binding.
    const peer = await real.loadEnterpriseDataStore(globexPath);
    expect(peer.enterpriseKnowledgeProjectionBindings["bind-globex"]?.tenantId).toBe(
      "tenant-globex",
    );
    expect(peer.enterpriseKnowledgeProjectionBindings["bind-acme"]).toBeUndefined();
    // Consume surface: feed list from reloaded tenant store (may be empty without SAR seed).
    const feed = listKnowledgeFeedItems({ store: reloaded, tenantId: "tenant-acme" });
    expect(feed.every((item) => item.tenantId === "tenant-acme")).toBe(true);
  });
});
