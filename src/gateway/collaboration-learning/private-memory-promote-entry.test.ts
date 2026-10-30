import type { GroupMemoryCapsule } from "@openbot/collaboration-core";
import { describe, expect, it, vi } from "vitest";
import { promotePrivateMemoryCapsuleAuthorized } from "./private-memory-promote-entry.js";

function approvedPersonalCapsule(overrides: Partial<GroupMemoryCapsule> = {}): GroupMemoryCapsule {
  return {
    capsuleId: "cap-private-1",
    groupId: "agent:bot-a",
    capsuleType: "lesson",
    status: "approved",
    reusability: "promotable",
    sensitivity: "internal",
    title: "Private lesson",
    summary: "stay private until promote",
    createdBy: "owner-user",
    approvedBy: "owner-user",
    approvedAt: 1,
    createdAt: 1,
    updatedAt: 1,
    structuredContent: { capabilities: ["draft"] },
    metadata: {
      personalOwnerUserId: "owner-user",
      personalOwnerAgentId: "bot-a",
      personalOwnerTenantId: null,
      personalSecurityProfile: "personal_local",
    },
    ...overrides,
  };
}

describe("promotePrivateMemoryCapsuleAuthorized", () => {
  it("returns flag_off with no learning writes when flag OFF", async () => {
    const appendCapsule = vi.fn();
    const appendProjection = vi.fn();
    const appendLearningAsset = vi.fn();
    const recordAudit = vi.fn(async () => undefined);
    const capsule = approvedPersonalCapsule();

    const result = await promotePrivateMemoryCapsuleAuthorized({
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "cap-private-1",
      actorId: "owner-user",
      cfg: { collaboration: { learning: { privateMemoryPromote: false } } } as never,
      deps: {
        readCapsules: async () => [capsule],
        learningStorage: {
          appendCapsule,
          appendProjection,
          appendLearningAsset,
        } as never,
        recordAudit,
      },
    });

    expect(result).toMatchObject({
      capsuleId: "cap-private-1",
      promoted: false,
      reason: "flag_off",
      sourceScopeId: "agent:bot-a",
      groupId: "group-1",
    });
    expect(appendCapsule).not.toHaveBeenCalled();
    expect(appendLearningAsset).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("promotes when flag ON → asset + audit, no transcript markers", async () => {
    const appendCapsule = vi.fn(async () => undefined);
    const appendProjection = vi.fn(async () => undefined);
    const appendLearningAsset = vi.fn(async () => undefined);
    const audits: Array<Record<string, unknown>> = [];
    const capsule = approvedPersonalCapsule();

    const result = await promotePrivateMemoryCapsuleAuthorized({
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "cap-private-1",
      actorId: "owner-user",
      cfg: { collaboration: { learning: { privateMemoryPromote: true } } } as never,
      deps: {
        readCapsules: async () => [capsule],
        learningStorage: {
          appendCapsule,
          appendProjection,
          appendLearningAsset,
        } as never,
        recordAudit: (async (entry: Record<string, unknown>) => {
          audits.push(entry);
        }) as never,
        evaluatePolicy: async () =>
          ({
            allowed: true,
            reason: "allowed",
            policy: {} as never,
            lifecycleStatus: "ACTIVE",
          }) as never,
      },
    });

    expect(result.promoted).toBe(true);
    expect(result.reason).toBe("promoted");
    expect(result.assetId).toBeTruthy();
    expect(appendCapsule).toHaveBeenCalled();
    expect(appendLearningAsset).toHaveBeenCalled();
    expect(audits[0]).toMatchObject({
      groupId: "group-1",
      sourceGroupId: "agent:bot-a",
      promoted: true,
      targetScope: "group",
    });
    expect(JSON.stringify(result)).not.toMatch(/__privateDmHistoryMirror/);
    expect(JSON.stringify(result)).not.toMatch(/__privateLongTermMemory/);
  });

  it("rejects wrong owner without calling promote writes", async () => {
    const appendCapsule = vi.fn();
    const appendLearningAsset = vi.fn();
    const capsule = approvedPersonalCapsule();

    const result = await promotePrivateMemoryCapsuleAuthorized({
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "cap-private-1",
      actorId: "intruder",
      cfg: { collaboration: { learning: { privateMemoryPromote: true } } } as never,
      deps: {
        readCapsules: async () => [capsule],
        learningStorage: {
          appendCapsule,
          appendProjection: vi.fn(),
          appendLearningAsset,
        } as never,
      },
    });

    expect(result).toMatchObject({
      promoted: false,
      reason: "actor_not_owner",
    });
    expect(appendCapsule).not.toHaveBeenCalled();
    expect(appendLearningAsset).not.toHaveBeenCalled();
  });

  it("rejects missing capsule without leaking another owner's body", async () => {
    const appendCapsule = vi.fn();
    const result = await promotePrivateMemoryCapsuleAuthorized({
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "missing",
      actorId: "owner-user",
      cfg: { collaboration: { learning: { privateMemoryPromote: true } } } as never,
      deps: {
        readCapsules: async () => [approvedPersonalCapsule()],
        learningStorage: {
          appendCapsule,
          appendProjection: vi.fn(),
          appendLearningAsset: vi.fn(),
        } as never,
      },
    });
    expect(result).toMatchObject({ promoted: false, reason: "capsule_not_found" });
    expect(appendCapsule).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/stay private/);
  });

  it("rejects candidate (not yet approved) capsules", async () => {
    const result = await promotePrivateMemoryCapsuleAuthorized({
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "cap-private-1",
      actorId: "owner-user",
      cfg: { collaboration: { learning: { privateMemoryPromote: true } } } as never,
      deps: {
        readCapsules: async () => [approvedPersonalCapsule({ status: "candidate" })],
      },
    });
    expect(result).toMatchObject({ promoted: false, reason: "capsule_not_approved" });
  });

  it("repeat promote is upsert-safe (same capsuleId + stable projection/asset ids)", async () => {
    const store = new Map<string, GroupMemoryCapsule>();
    const projections = new Map<string, { projectionId: string }>();
    const assets = new Map<string, { assetId: string }>();
    const appendCapsule = vi.fn(async (_groupId: string, capsule: GroupMemoryCapsule) => {
      store.set(capsule.capsuleId, capsule);
    });
    const appendProjection = vi.fn(
      async (_groupId: string, projection: { projectionId: string }) => {
        projections.set(projection.projectionId, projection);
      },
    );
    const appendLearningAsset = vi.fn(async (_groupId: string, asset: { assetId: string }) => {
      assets.set(asset.assetId, asset);
    });
    const capsule = approvedPersonalCapsule();
    const deps = {
      readCapsules: async () => [capsule],
      learningStorage: {
        appendCapsule,
        appendProjection,
        appendLearningAsset,
      } as never,
      recordAudit: vi.fn(async () => undefined),
      evaluatePolicy: async () =>
        ({
          allowed: true,
          reason: "allowed",
          policy: {} as never,
          lifecycleStatus: "ACTIVE",
        }) as never,
    };

    const first = await promotePrivateMemoryCapsuleAuthorized({
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "cap-private-1",
      actorId: "owner-user",
      tenantId: null,
      cfg: { collaboration: { learning: { privateMemoryPromote: true } } } as never,
      deps,
    });
    const second = await promotePrivateMemoryCapsuleAuthorized({
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "cap-private-1",
      actorId: "owner-user",
      tenantId: null,
      cfg: { collaboration: { learning: { privateMemoryPromote: true } } } as never,
      deps,
    });

    expect(first.promoted).toBe(true);
    expect(second.promoted).toBe(true);
    expect(second.assetId).toBe(first.assetId);
    expect(second.projectionId).toBe(first.projectionId);
    expect(store.size).toBe(1);
    expect(store.has("cap-private-1")).toBe(true);
    expect(projections.size).toBe(1);
    expect(assets.size).toBe(1);
    expect(assets.has(String(first.assetId))).toBe(true);
  });

  it("independent: policy denial must not copy private body to target", async () => {
    const appendCapsule = vi.fn(async () => undefined);
    const appendProjection = vi.fn(async () => undefined);
    const appendLearningAsset = vi.fn(async () => undefined);
    const result = await promotePrivateMemoryCapsuleAuthorized({
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "cap-private-1",
      actorId: "owner-user",
      cfg: { collaboration: { learning: { privateMemoryPromote: true } } } as never,
      deps: {
        readCapsules: async () => [approvedPersonalCapsule()],
        learningStorage: {
          appendCapsule,
          appendProjection,
          appendLearningAsset,
        } as never,
        recordAudit: vi.fn(async () => undefined) as never,
        evaluatePolicy: async () =>
          ({
            allowed: false,
            reason: "lifecycle_blocked",
            policy: {} as never,
            lifecycleStatus: "ARCHIVED",
          }) as never,
      },
    });
    expect(result.promoted).toBe(false);
    expect(result.reason).toBe("lifecycle_blocked");
    expect(appendCapsule).not.toHaveBeenCalled();
    expect(appendProjection).not.toHaveBeenCalled();
    expect(appendLearningAsset).not.toHaveBeenCalled();
    // Denial result must not echo private body.
    expect(JSON.stringify(result)).not.toMatch(/stay private/);
  });

  it("uses caller stores + tenantId (trusted context, not capsule self-compare)", async () => {
    const appendCapsule = vi.fn(async () => undefined);
    const appendProjection = vi.fn(async () => undefined);
    const appendLearningAsset = vi.fn(async () => undefined);
    const evaluatePolicy = vi.fn(async (args: { tenantId?: string | null }) => {
      expect(args.tenantId).toBeNull();
      return {
        allowed: true,
        reason: "allowed",
        policy: {} as never,
        lifecycleStatus: "ACTIVE",
      };
    });
    const callerStores = {
      learningStorage: {
        appendCapsule,
        appendProjection,
        appendLearningAsset,
      } as never,
    };

    const result = await promotePrivateMemoryCapsuleAuthorized({
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "cap-private-1",
      actorId: "owner-user",
      tenantId: null,
      securityProfile: "personal_local",
      stores: callerStores,
      cfg: { collaboration: { learning: { privateMemoryPromote: true } } } as never,
      deps: {
        readCapsules: async () => [approvedPersonalCapsule()],
        // Intentionally omit deps.learningStorage — stores from caller must be used.
        recordAudit: vi.fn(async () => undefined),
        evaluatePolicy: evaluatePolicy as never,
      },
    });

    expect(result.promoted).toBe(true);
    expect(appendCapsule).toHaveBeenCalledTimes(1);
    expect(appendLearningAsset).toHaveBeenCalledTimes(1);
    expect(evaluatePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: "group-1", tenantId: null }),
    );
  });

  it("rejects trusted tenant mismatch vs capsule recorded tenant", async () => {
    const appendCapsule = vi.fn();
    const capsule = approvedPersonalCapsule({
      metadata: {
        personalOwnerUserId: "owner-user",
        personalOwnerAgentId: "bot-a",
        personalOwnerTenantId: "tenant-a",
        personalSecurityProfile: "managed_enterprise",
      },
    });
    const result = await promotePrivateMemoryCapsuleAuthorized({
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "cap-private-1",
      actorId: "owner-user",
      tenantId: "tenant-b",
      securityProfile: "managed_enterprise",
      stores: {
        learningStorage: {
          appendCapsule,
          appendProjection: vi.fn(),
          appendLearningAsset: vi.fn(),
        } as never,
      },
      cfg: { collaboration: { learning: { privateMemoryPromote: true } } } as never,
      deps: {
        readCapsules: async () => [capsule],
      },
    });
    expect(result).toMatchObject({
      promoted: false,
      reason: "cross_tenant_ownership",
    });
    expect(appendCapsule).not.toHaveBeenCalled();
  });

  it("fail-closes managed without trusted stores/tenant (no default reopen)", async () => {
    const capsule = approvedPersonalCapsule({
      metadata: {
        personalOwnerUserId: "owner-user",
        personalOwnerAgentId: "bot-a",
        personalOwnerTenantId: "tenant-a",
        personalSecurityProfile: "managed_enterprise",
      },
    });
    const result = await promotePrivateMemoryCapsuleAuthorized({
      botId: "bot-a",
      groupId: "group-1",
      capsuleId: "cap-private-1",
      actorId: "owner-user",
      // missing tenantId + stores on purpose
      cfg: { collaboration: { learning: { privateMemoryPromote: true } } } as never,
      deps: {
        readCapsules: async () => [capsule],
      },
    });
    expect(result).toMatchObject({
      promoted: false,
      reason: "managed_requires_trusted_context",
    });
  });
});
