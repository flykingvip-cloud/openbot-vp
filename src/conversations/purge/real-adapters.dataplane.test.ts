import { describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { ConversationCatalogRepository } from "../catalog/repository.js";
import type {
  ConversationPurgeJob,
  ConversationPurgeManifest,
  ConversationRecord,
  ConversationSessionBinding,
} from "../types.js";
import { createRealPurgeAdapters } from "./real-adapters.js";

const getMemorySearchManager = vi.hoisted(() => vi.fn());

vi.mock("../../memory/search-manager.js", () => ({
  getMemorySearchManager,
}));

function record(overrides?: Partial<ConversationRecord>): ConversationRecord {
  return {
    schemaVersion: 1,
    conversationId: "conv_plane",
    dataPlaneId: "dp_plane_a",
    tenantId: "tenant-a",
    ownershipScopeType: "USER",
    ownershipScopeId: "user-a",
    createdByUserId: "user-a",
    surfaceType: "AGENT",
    agentId: "helper",
    groupId: null,
    title: "Plane purge",
    titleSource: "USER",
    lifecycleStatus: "ACTIVE",
    lifecycleStatusBeforeArchive: null,
    storageTier: "HOT",
    retentionState: "PURGE_PENDING",
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    closedAt: null,
    archivedAt: null,
    deletedAt: null,
    lastMessageAt: null,
    messageCount: 0,
    participantIds: ["user-a"],
    primaryBindingId: "b1",
    etag: "etag-1",
    ...overrides,
  };
}

function binding(): ConversationSessionBinding {
  return {
    schemaVersion: 1,
    bindingId: "b1",
    dataPlaneId: "dp_plane_a",
    conversationId: "conv_plane",
    sessionKey: "agent:helper:main",
    sessionId: "sess-1",
    agentId: "helper",
    role: "PRIMARY",
    aliasTargetBindingId: null,
    transcriptState: "LIVE",
    createdAt: "2026-08-25T00:00:00.000Z",
    endedAt: null,
  };
}

describe("real purge adapters data-plane routing", () => {
  it("MEMORY_REVOKE passes planeDataRoot (not cfg.data.root) into getMemorySearchManager", async () => {
    const apply = vi.fn(async () => ({ ok: true, status: "purged" as const }));
    getMemorySearchManager.mockResolvedValue({
      manager: { applyTranscriptSourceLifecycle: apply },
    });

    const defaultRoot = "/default-data-root";
    const planeRoot = "/tenant-a/plane-a";
    const cfg = {
      data: { root: defaultRoot, mode: "local" as const, schemaVersion: 1 },
    } satisfies OpenBotConfig;
    const conv = record();
    const adapters = createRealPurgeAdapters({
      cfg,
      catalog: { saveBinding: vi.fn() } as unknown as ConversationCatalogRepository,
      bindings: [binding()],
      transcriptAbsPaths: [{ bindingId: "b1", sessionId: "sess-1", absPath: "/tmp/sess-1.jsonl" }],
      dataRoot: planeRoot,
    });

    const job = { purgeJobId: "job-1" } as ConversationPurgeJob;
    const manifest: ConversationPurgeManifest = {
      schemaVersion: 1,
      conversationId: conv.conversationId,
      dataPlaneId: conv.dataPlaneId,
      createdAt: conv.createdAt,
      objects: [
        {
          kind: "cogniweave_source",
          id: "msrc://src-1",
          locator: "msrc://src-1",
        },
      ],
    };

    const revoke = adapters.find((a) => a.name === "MEMORY_REVOKE");
    if (!revoke) {
      throw new Error("expected MEMORY_REVOKE adapter");
    }

    await revoke.run({ job, record: conv, manifest });

    expect(getMemorySearchManager).toHaveBeenCalledTimes(1);
    for (const [args] of getMemorySearchManager.mock.calls) {
      expect(args).toMatchObject({
        agentId: "helper",
        tenantId: "tenant-a",
        dataPlaneId: "dp_plane_a",
        dataRoot: planeRoot,
      });
      expect(args.dataRoot).not.toBe(defaultRoot);
      expect(args.cfg.data?.root).toBe(defaultRoot);
    }
  });

  it("does not pass another tenant's dataRoot when the adapter is bound to this plane", async () => {
    getMemorySearchManager.mockResolvedValue({
      manager: {
        applyTranscriptSourceLifecycle: vi.fn(async () => ({ ok: true, status: "purged" })),
      },
    });
    const otherPlane = "/tenant-b/plane-b";
    const thisPlane = "/tenant-a/plane-a";
    const adapters = createRealPurgeAdapters({
      cfg: { data: { root: otherPlane, mode: "local", schemaVersion: 1 } },
      catalog: { saveBinding: vi.fn() } as unknown as ConversationCatalogRepository,
      bindings: [binding()],
      transcriptAbsPaths: [{ bindingId: "b1", sessionId: "sess-1", absPath: "/tmp/sess-1.jsonl" }],
      dataRoot: thisPlane,
    });
    const revoke = adapters.find((a) => a.name === "MEMORY_REVOKE");
    if (!revoke) {
      throw new Error("expected MEMORY_REVOKE");
    }
    await revoke.run({
      job: { purgeJobId: "job-2" } as ConversationPurgeJob,
      record: record({ tenantId: "tenant-a", dataPlaneId: "dp_plane_a" }),
      manifest: {
        schemaVersion: 1,
        conversationId: "conv_plane",
        dataPlaneId: "dp_plane_a",
        createdAt: "2026-08-25T00:00:00.000Z",
        objects: [],
      },
    });
    expect(getMemorySearchManager).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        dataPlaneId: "dp_plane_a",
        dataRoot: thisPlane,
      }),
    );
    expect(getMemorySearchManager).not.toHaveBeenCalledWith(
      expect.objectContaining({ dataRoot: otherPlane }),
    );
  });

  it("VERIFY passes planeDataRoot (not cfg.data.root) into getMemorySearchManager", async () => {
    getMemorySearchManager.mockClear();
    const apply = vi.fn(async () => ({ ok: true, status: "purged" as const }));
    getMemorySearchManager.mockResolvedValue({
      manager: { applyTranscriptSourceLifecycle: apply },
    });

    const defaultRoot = "/default-data-root";
    const planeRoot = "/tenant-a/plane-a";
    const cfg = {
      data: { root: defaultRoot, mode: "local" as const, schemaVersion: 1 },
    } satisfies OpenBotConfig;
    const conv = record();
    const adapters = createRealPurgeAdapters({
      cfg,
      catalog: { saveBinding: vi.fn() } as unknown as ConversationCatalogRepository,
      bindings: [binding()],
      transcriptAbsPaths: [{ bindingId: "b1", sessionId: "sess-1", absPath: "/tmp/sess-1.jsonl" }],
      dataRoot: planeRoot,
    });

    const job = { purgeJobId: "job-3" } as ConversationPurgeJob;
    const manifest: ConversationPurgeManifest = {
      schemaVersion: 1,
      conversationId: conv.conversationId,
      dataPlaneId: conv.dataPlaneId,
      createdAt: conv.createdAt,
      objects: [
        {
          kind: "cogniweave_source",
          id: "msrc://src-1",
          locator: "msrc://src-1",
        },
      ],
    };

    const verify = adapters.find((a) => a.name === "VERIFY");
    if (!verify) {
      throw new Error("expected VERIFY adapter");
    }

    // VERIFY also probes index/projection/fs; this test only asserts manager routing.
    await verify.run({ job, record: conv, manifest }).catch(() => undefined);

    expect(getMemorySearchManager).toHaveBeenCalled();
    for (const [args] of getMemorySearchManager.mock.calls) {
      expect(args).toMatchObject({
        agentId: "helper",
        tenantId: "tenant-a",
        dataPlaneId: "dp_plane_a",
        dataRoot: planeRoot,
      });
      expect(args.dataRoot).not.toBe(defaultRoot);
      expect(args.cfg.data?.root).toBe(defaultRoot);
    }
  });
});
