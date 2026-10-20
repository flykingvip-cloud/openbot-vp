import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot } from "../config/data-space.js";
import {
  closeAllMemorySearchManagers,
  getMemorySearchManager,
  getMemorySearchManagerFromHandle,
  resolveMemorySearchManagerDataRoot,
} from "./search-manager.js";

const createMock = vi.hoisted(() => vi.fn());
const createFromHandleMock = vi.hoisted(() => vi.fn());
const indexGetMock = vi.hoisted(() => vi.fn());
const wrapMock = vi.hoisted(() => vi.fn((manager: unknown, _dataRoot: string) => manager));

vi.mock("./cogniweave-manager.js", () => ({
  CogniWeaveMemoryManager: {
    create: (params: unknown) => createMock(params),
    createFromHandle: (params: unknown) => createFromHandleMock(params),
  },
}));

vi.mock("./manager-runtime.js", () => ({
  MemoryIndexManager: {
    get: (params: unknown) => indexGetMock(params),
  },
  closeAllMemoryIndexManagers: vi.fn(async () => {}),
}));

vi.mock("./recall-deny-search-wrapper.js", () => ({
  wrapMemorySearchManagerWithRecallDeny: (manager: unknown, dataRoot: string) =>
    wrapMock(manager, dataRoot),
}));

function managerStub() {
  return {
    search: vi.fn(async () => []),
    readFile: vi.fn(async () => ({ text: "", path: "MEMORY.md" })),
    status: vi.fn(() => ({
      backend: "cogniweave" as const,
      provider: "cogniweave",
      model: "cogniweave",
      requestedProvider: "cogniweave",
      files: 0,
      chunks: 0,
      dirty: false,
      workspaceDir: "/tmp",
      dbPath: "/tmp/cw.sqlite",
    })),
    sync: vi.fn(async () => {}),
    probeEmbeddingAvailability: vi.fn(async () => ({ ok: true })),
    probeVectorAvailability: vi.fn(async () => true),
    close: vi.fn(async () => {}),
    applyTranscriptSourceLifecycle: vi.fn(async () => ({ ok: true, status: "purged" })),
  };
}

function cogniweaveCfg(dataRoot: string): OpenBotConfig {
  return {
    data: { root: dataRoot, mode: "local", schemaVersion: 1 },
    memory: { backend: "cogniweave", cogniweave: { mode: "embedded" } },
  };
}

function builtinCfg(dataRoot: string): OpenBotConfig {
  return {
    data: { root: dataRoot, mode: "local", schemaVersion: 1 },
  };
}

afterEach(async () => {
  createMock.mockReset();
  createFromHandleMock.mockReset();
  indexGetMock.mockReset();
  wrapMock.mockReset();
  wrapMock.mockImplementation((manager: unknown, _dataRoot: string) => manager);
  await closeAllMemorySearchManagers();
});

describe("resolveMemorySearchManagerDataRoot", () => {
  it("uses explicit dataRoot over cfg.data.root", () => {
    const cfg = builtinCfg("/default-root");
    expect(resolveMemorySearchManagerDataRoot({ cfg, dataRoot: "/plane-a" })).toBe("/plane-a");
    expect(resolveMemorySearchManagerDataRoot({ cfg })).toBe(resolveDataRoot(cfg));
  });
});

describe("getMemorySearchManager data-plane routing", () => {
  it("overlays cfg.data.root and recall-deny onto the plane root (cogniweave)", async () => {
    const stub = managerStub();
    createMock.mockResolvedValue(stub);
    const cfg = cogniweaveCfg("/default-root");
    const result = await getMemorySearchManager({
      cfg,
      agentId: "main",
      tenantId: "tenant-a",
      dataPlaneId: "dp_a",
      dataRoot: "/plane-a",
    });
    expect(result.manager).toBe(stub);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: expect.objectContaining({
          data: expect.objectContaining({ root: "/plane-a", tenantId: "tenant-a" }),
        }),
      }),
    );
    expect(wrapMock).toHaveBeenCalledWith(stub, "/plane-a");
  });

  it("does not mutate the caller's cfg object", async () => {
    createMock.mockResolvedValue(managerStub());
    const cfg = cogniweaveCfg("/default-root");
    await getMemorySearchManager({
      cfg,
      agentId: "main",
      dataRoot: "/plane-a",
    });
    expect(cfg.data?.root).toBe("/default-root");
  });

  it("keeps the default resolveDataRoot(cfg) path when dataRoot is omitted", async () => {
    const stub = managerStub();
    createMock.mockResolvedValue(stub);
    const cfg = cogniweaveCfg("/default-root");
    await getMemorySearchManager({ cfg, agentId: "main" });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: expect.objectContaining({
          data: expect.objectContaining({ root: "/default-root" }),
        }),
      }),
    );
    expect(wrapMock).toHaveBeenCalledWith(stub, resolveDataRoot(cfg));
  });

  it("does not share a CogniWeave cache entry across data planes", async () => {
    const planeA = managerStub();
    const planeB = managerStub();
    createMock.mockResolvedValueOnce(planeA).mockResolvedValueOnce(planeB);
    const cfg = cogniweaveCfg("/default-root");

    const first = await getMemorySearchManager({
      cfg,
      agentId: "main",
      tenantId: "tenant-a",
      dataPlaneId: "dp_a",
      dataRoot: "/plane-a",
    });
    const firstCached = await getMemorySearchManager({
      cfg,
      agentId: "main",
      tenantId: "tenant-a",
      dataPlaneId: "dp_a",
      dataRoot: "/plane-a",
    });
    const second = await getMemorySearchManager({
      cfg,
      agentId: "main",
      tenantId: "tenant-b",
      dataPlaneId: "dp_b",
      dataRoot: "/plane-b",
    });

    expect(first.manager).toBe(planeA);
    expect(firstCached.manager).toBe(planeA);
    expect(second.manager).toBe(planeB);
    expect(second.manager).not.toBe(first.manager);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("does not share a cache entry across tenants on the same dataRoot", async () => {
    const tenantA = managerStub();
    const tenantB = managerStub();
    createMock.mockResolvedValueOnce(tenantA).mockResolvedValueOnce(tenantB);
    const cfg = cogniweaveCfg("/shared-root");

    const first = await getMemorySearchManager({
      cfg,
      agentId: "main",
      tenantId: "tenant-a",
      dataPlaneId: "dp_a",
      dataRoot: "/shared-root",
    });
    const second = await getMemorySearchManager({
      cfg,
      agentId: "main",
      tenantId: "tenant-b",
      dataPlaneId: "dp_b",
      dataRoot: "/shared-root",
    });

    expect(first.manager).toBe(tenantA);
    expect(second.manager).toBe(tenantB);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("overlays the plane root onto builtin MemoryIndexManager + recall-deny", async () => {
    const stub = managerStub();
    indexGetMock.mockResolvedValue(stub);
    const cfg = builtinCfg("/default-root");
    const result = await getMemorySearchManager({
      cfg,
      agentId: "main",
      tenantId: "tenant-a",
      dataPlaneId: "dp_a",
      dataRoot: "/plane-a",
    });
    expect(result.manager).toBe(stub);
    expect(indexGetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: expect.objectContaining({
          data: expect.objectContaining({ root: "/plane-a", tenantId: "tenant-a" }),
        }),
        agentId: "main",
      }),
    );
    expect(wrapMock).toHaveBeenCalledWith(stub, "/plane-a");
  });
});

describe("getMemorySearchManagerFromHandle data-plane routing", () => {
  it("overlays cfg.data.root before createFromHandle and recall-deny", async () => {
    const stub = managerStub();
    createFromHandleMock.mockResolvedValue({ ok: true, manager: stub });
    const { createMemoryWorkspaceHandle } = await import("./memory-workspace-handle.js");
    const minted = createMemoryWorkspaceHandle({
      resourceId: "ws-1",
      memoryAssetResourceId: "mem-1",
      tenantId: "tenant-a",
      agentAssetId: "aa-1",
      bindingId: "bind-1",
      canonicalObjectKey: "obj://tenant-a/ws-1/memory",
      governanceVersion: 1,
      fencingToken: "ft-1",
      lifecycle: "active",
      permissions: {
        search: true,
        ingest: false,
        distill: false,
        prune: false,
        reset: false,
        export: true,
      },
    });
    if (!minted.ok) {
      throw new Error(minted.reason);
    }
    const cfg = cogniweaveCfg("/default-root");
    const result = await getMemorySearchManagerFromHandle({
      cfg,
      agentId: "main",
      handle: minted.handle,
      tenantId: "tenant-a",
      dataPlaneId: "dp_a",
      dataRoot: "/plane-a",
    });
    expect(result.manager).toBe(stub);
    expect(createFromHandleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg: expect.objectContaining({
          data: expect.objectContaining({ root: "/plane-a", tenantId: "tenant-a" }),
        }),
      }),
    );
    expect(wrapMock).toHaveBeenCalledWith(stub, "/plane-a");
  });
});
