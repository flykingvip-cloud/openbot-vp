import type { GroupMemoryCapsule } from "@openbot/collaboration-core";
import { describe, expect, it, vi } from "vitest";
import {
  assertNoPrivateMemoryDirtyWriteToGroupPublic,
  containsPrivateDmHistoryMirrorMarker,
  containsPrivateLongTermMemoryMarker,
  createPrivateLongTermMemoryRecord,
  isCollaborationPrivateMemoryPromoteEnabled,
  preparePrivateCapsuleForGroupPromote,
  promotePrivateMemoryCapsuleToGroup,
  PRIVATE_DM_HISTORY_MIRROR_MARKER,
  PRIVATE_LTM_MARKER,
  resolvePrivateMemoryScopeId,
} from "./private-memory-promote.js";

function personalCapsule(overrides: Partial<GroupMemoryCapsule> = {}): GroupMemoryCapsule {
  return {
    capsuleId: "cap-private-1",
    groupId: "agent:bot-a",
    capsuleType: "lesson",
    status: "approved",
    reusability: "promotable",
    sensitivity: "internal",
    title: "Private lesson",
    summary: "stay private until promote",
    createdBy: "bot-a",
    approvedBy: "bot-a",
    approvedAt: 1,
    createdAt: 1,
    updatedAt: 1,
    structuredContent: { capabilities: ["draft"] },
    ...overrides,
  };
}

describe("private-memory-promote flag", () => {
  it("defaults OFF", () => {
    expect(isCollaborationPrivateMemoryPromoteEnabled(undefined)).toBe(false);
    expect(isCollaborationPrivateMemoryPromoteEnabled({} as never)).toBe(false);
    expect(
      isCollaborationPrivateMemoryPromoteEnabled({
        collaboration: { learning: {} },
      } as never),
    ).toBe(false);
    expect(
      isCollaborationPrivateMemoryPromoteEnabled({
        collaboration: { learning: { privateMemoryPromote: true } },
      } as never),
    ).toBe(true);
  });
});

describe("private LTM stays private (no dirty GROUP_PUBLIC write)", () => {
  it("scopes private memory under agent:<botId>", () => {
    expect(resolvePrivateMemoryScopeId("bot-a")).toBe("agent:bot-a");
    const record = createPrivateLongTermMemoryRecord({
      botId: "bot-a",
      capsuleId: "cap-1",
      summary: "secret note",
    });
    expect(record[PRIVATE_LTM_MARKER]).toBe(true);
    expect(record.scopeId).toBe("agent:bot-a");
  });

  it("refuses private LTM marker on GROUP_PUBLIC payload", () => {
    const record = createPrivateLongTermMemoryRecord({ botId: "bot-a" });
    expect(containsPrivateLongTermMemoryMarker(record)).toBe(true);
    expect(containsPrivateLongTermMemoryMarker({ text: "ok" })).toBe(false);
    expect(() => assertNoPrivateMemoryDirtyWriteToGroupPublic(record)).toThrow(/promote/);
    expect(() =>
      assertNoPrivateMemoryDirtyWriteToGroupPublic(
        JSON.stringify({ msg: record }),
        "GROUP_PUBLIC transcript write",
      ),
    ).toThrow(/private long-term memory/);
  });

  it("refuses private-chat history mirror into GROUP_PUBLIC", () => {
    const mirror = {
      [PRIVATE_DM_HISTORY_MIRROR_MARKER]: true,
      botId: "bot-a",
      messages: [{ role: "user", content: "dm only" }],
    };
    expect(containsPrivateDmHistoryMirrorMarker(mirror)).toBe(true);
    expect(containsPrivateDmHistoryMirrorMarker({ source: "private_dm_history_mirror" })).toBe(
      true,
    );
    expect(containsPrivateDmHistoryMirrorMarker({ text: "normal group msg" })).toBe(false);
    expect(() => assertNoPrivateMemoryDirtyWriteToGroupPublic(mirror)).toThrow(/mirror/);
    expect(() =>
      assertNoPrivateMemoryDirtyWriteToGroupPublic(
        { privateDmHistoryMirror: true, body: "leak" },
        "GROUP_PUBLIC transcript append",
      ),
    ).toThrow(/GROUP_PUBLIC/);
  });
});

describe("promotePrivateMemoryCapsuleToGroup", () => {
  it("no-ops when flag OFF (no learning write)", async () => {
    const appendCapsule = vi.fn();
    const appendProjection = vi.fn();
    const appendLearningAsset = vi.fn();
    const recordAudit = vi.fn(async () => undefined);

    const result = await promotePrivateMemoryCapsuleToGroup({
      botId: "bot-a",
      groupId: "group-1",
      capsule: personalCapsule(),
      confidentialityTier: "internal",
      deps: {
        cfg: { collaboration: { learning: { privateMemoryPromote: false } } } as never,
        learningStorage: {
          appendCapsule,
          appendProjection,
          appendLearningAsset,
        } as never,
        recordAudit,
        evaluatePolicy: async () =>
          ({
            allowed: true,
            reason: "allowed",
            policy: {} as never,
            lifecycleStatus: "ACTIVE",
          }) as never,
      },
    });

    expect(result).toMatchObject({
      promoted: false,
      reason: "flag_off",
      sourceScopeId: "agent:bot-a",
      groupId: "group-1",
    });
    expect(appendCapsule).not.toHaveBeenCalled();
    expect(appendLearningAsset).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("promotes into group learning asset with confidentiality + audit (not transcript)", async () => {
    const appendCapsule = vi.fn(async () => undefined);
    const appendProjection = vi.fn(async () => undefined);
    const appendLearningAsset = vi.fn(async () => undefined);
    const audits: Array<Record<string, unknown>> = [];
    const recordAudit = vi.fn(async (entry: Record<string, unknown>) => {
      audits.push(entry);
    });

    const prepared = preparePrivateCapsuleForGroupPromote({
      capsule: personalCapsule({ status: "candidate", reusability: "group_only" }),
      groupId: "group-1",
      confidentialityTier: "restricted",
      actorId: "operator-1",
    });
    expect(prepared.groupId).toBe("group-1");
    expect(prepared.status).toBe("approved");
    expect(prepared.sensitivity).toBe("restricted");
    expect(prepared.metadata?.promotedFromPrivateScope).toBe(true);

    const result = await promotePrivateMemoryCapsuleToGroup({
      botId: "bot-a",
      groupId: "group-1",
      capsule: personalCapsule({ status: "candidate", reusability: "group_only" }),
      actor: "operator-1",
      confidentialityTier: "restricted",
      deps: {
        cfg: { collaboration: { learning: { privateMemoryPromote: true } } } as never,
        learningStorage: {
          appendCapsule,
          appendProjection,
          appendLearningAsset,
        } as never,
        recordAudit: recordAudit as never,
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
    expect(result.sourceScopeId).toBe("agent:bot-a");
    expect(result.confidentialityTier).toBe("restricted");
    expect(result.assetId).toBeTruthy();
    expect(appendCapsule).toHaveBeenCalledTimes(1);
    expect(appendCapsule.mock.calls[0][0]).toBe("group-1");
    expect(appendCapsule.mock.calls[0][1].groupId).toBe("group-1");
    expect(appendCapsule.mock.calls[0][1].metadata?.confidentialityTier).toBe("restricted");
    expect(appendLearningAsset).toHaveBeenCalledTimes(1);
    expect(appendLearningAsset.mock.calls[0][0]).toBe("group-1");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      groupId: "group-1",
      sourceGroupId: "agent:bot-a",
      botId: "bot-a",
      promoted: true,
      targetScope: "group",
    });
    // Contract: promote path never returns a transcript payload / mirror marker.
    expect(containsPrivateDmHistoryMirrorMarker(result)).toBe(false);
    expect(containsPrivateLongTermMemoryMarker(result)).toBe(false);
  });

  it("records audit when group promotion policy blocks", async () => {
    const appendCapsule = vi.fn(async () => undefined);
    const appendProjection = vi.fn(async () => undefined);
    const appendLearningAsset = vi.fn(async () => undefined);
    const audits: Array<Record<string, unknown>> = [];

    // Use internal sensitivity so projection eligibility passes; policy still blocks.
    const result = await promotePrivateMemoryCapsuleToGroup({
      botId: "bot-a",
      groupId: "group-1",
      capsule: personalCapsule({ sensitivity: "internal" }),
      confidentialityTier: "internal",
      deps: {
        cfg: { collaboration: { learning: { privateMemoryPromote: true } } } as never,
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
            allowed: false,
            reason: "auto_promote_disabled",
            policy: {} as never,
            lifecycleStatus: "ACTIVE",
          }) as never,
      },
    });

    expect(result.promoted).toBe(false);
    expect(result.reason).toBe("auto_promote_disabled");
    expect(appendLearningAsset).not.toHaveBeenCalled();
    expect(audits[0]).toMatchObject({
      promoted: false,
      reason: "auto_promote_disabled",
      sourceGroupId: "agent:bot-a",
      targetScope: "group",
    });
  });
});
