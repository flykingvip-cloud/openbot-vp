import { describe, expect, it, vi } from "vitest";
import {
  OpenBotAuditAdapter,
  OpenBotDirectoryAdapter,
  OpenBotGroupStorage,
  OpenBotLearningStorage,
  OpenBotMetadataStorage,
  OpenBotObjectStorage,
  OpenBotSessionProjectionAdapter,
} from "./index.js";

describe("collaboration-openbot-adapter behavior", () => {
  it("reads and writes group profiles through the group storage adapter", async () => {
    const loadGroupProfile = vi.fn().mockResolvedValue({
      id: "group-1",
      name: "Legacy name",
      groupId: "group-1",
      groupCode: "G-1",
      displayName: "Group One",
      avatar: "🛰️",
      createdAtMs: 1,
      updatedAtMs: 2,
    });
    const saveGroupProfile = vi.fn().mockResolvedValue(undefined);

    const storage = new OpenBotGroupStorage(undefined, {
      loadGroupProfile,
      saveGroupProfile,
      loadGroupMembers: vi.fn().mockResolvedValue([]),
      saveGroupMembers: vi.fn().mockResolvedValue(undefined),
      loadGroupBindings: vi.fn().mockResolvedValue([]),
      saveGroupBindings: vi.fn().mockResolvedValue(undefined),
      loadGroupParticipations: vi.fn().mockResolvedValue([]),
      saveGroupParticipations: vi.fn().mockResolvedValue(undefined),
    });

    const profile = await storage.readProfile("group-1");
    expect(profile?.displayName).toBe("Group One");
    expect(profile?.avatar).toBe("🛰️");

    await storage.writeProfile({
      groupId: "group-1",
      groupCode: "G-1",
      displayName: "Updated Name",
      avatar: "🛡️",
      createdAtMs: 1,
      updatedAtMs: 3,
    });
    expect(saveGroupProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "group-1",
        displayName: "Updated Name",
        avatar: "🛡️",
      }),
      undefined,
    );
  });

  it("reads and writes participation profiles through the group storage adapter", async () => {
    const loadGroupParticipations = vi.fn().mockResolvedValue([
      {
        participationId: "group-1::bot-1",
        groupId: "group-1",
        botId: "bot-1",
        governanceRole: "member",
        status: "active",
        joinedAtMs: 1,
        updatedAtMs: 1,
      },
    ]);
    const saveGroupParticipations = vi.fn().mockResolvedValue(undefined);

    const storage = new OpenBotGroupStorage(undefined, {
      loadGroupProfile: vi.fn().mockResolvedValue(null),
      saveGroupProfile: vi.fn().mockResolvedValue(undefined),
      loadGroupMembers: vi.fn().mockResolvedValue([]),
      saveGroupMembers: vi.fn().mockResolvedValue(undefined),
      loadGroupBindings: vi.fn().mockResolvedValue([]),
      saveGroupBindings: vi.fn().mockResolvedValue(undefined),
      loadGroupParticipations,
      saveGroupParticipations,
    });

    expect(await storage.readParticipations("group-1")).toEqual([
      expect.objectContaining({ participationId: "group-1::bot-1" }),
    ]);

    await storage.writeParticipations("group-1", [
      {
        participationId: "group-1::bot-2",
        groupId: "group-1",
        botId: "bot-2",
        governanceRole: "admin",
        collaborationRole: "reviewer",
        status: "active",
        joinedAtMs: 2,
        updatedAtMs: 2,
      },
    ]);
    expect(saveGroupParticipations).toHaveBeenCalledWith(
      "group-1",
      [expect.objectContaining({ botId: "bot-2" })],
      undefined,
    );
  });

  it("manages aggregated object files through object storage", async () => {
    const readGroupFile = vi
      .fn()
      .mockResolvedValueOnce({
        tasks: [{ taskId: "task-1", title: "Task 1" }],
      })
      .mockResolvedValueOnce({
        tasks: [{ taskId: "task-1", title: "Task 1" }],
      })
      .mockResolvedValueOnce({
        tasks: [
          { taskId: "task-1", title: "Task 1" },
          { taskId: "task-2", title: "Task 2" },
        ],
      });
    const writeGroupFile = vi.fn().mockResolvedValue(undefined);

    const storage = new OpenBotObjectStorage(undefined, { readGroupFile, writeGroupFile });

    expect(await storage.listObjects("group-1", "task")).toEqual([
      { taskId: "task-1", title: "Task 1" },
    ]);

    await storage.writeObject("group-1", "task", "task-2", {
      taskId: "task-2",
      title: "Task 2",
    });
    expect(writeGroupFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "tasks.json",
        data: {
          tasks: [
            { taskId: "task-1", title: "Task 1" },
            { taskId: "task-2", title: "Task 2" },
          ],
        },
      }),
    );

    await storage.deleteObject("group-1", "task", "task-1");
    expect(writeGroupFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          tasks: [{ taskId: "task-2", title: "Task 2" }],
        },
      }),
    );
  });

  it("supports capsule, projection, and learning asset object collections", async () => {
    const readGroupFile = vi
      .fn()
      .mockResolvedValueOnce({
        capsules: [{ capsuleId: "capsule-1", title: "Lesson" }],
      })
      .mockResolvedValueOnce({
        projections: [{ projectionId: "projection-1", targetBotId: "bot-1" }],
      })
      .mockResolvedValueOnce({
        assets: [{ assetId: "asset-1", botId: "bot-1" }],
      });
    const writeGroupFile = vi.fn().mockResolvedValue(undefined);

    const storage = new OpenBotObjectStorage(undefined, { readGroupFile, writeGroupFile });

    expect(await storage.listObjects("group-1", "capsule")).toEqual([
      { capsuleId: "capsule-1", title: "Lesson" },
    ]);
    expect(await storage.listObjects("group-1", "projection")).toEqual([
      { projectionId: "projection-1", targetBotId: "bot-1" },
    ]);
    expect(await storage.listObjects("group-1", "learning_asset")).toEqual([
      { assetId: "asset-1", botId: "bot-1" },
    ]);
  });

  it("reads, filters, and appends learning records through the learning storage adapter", async () => {
    const readGroupFile = vi
      .fn()
      .mockResolvedValueOnce({
        capsules: [{ capsuleId: "capsule-1", groupId: "group-1", title: "Lesson" }],
      })
      .mockResolvedValueOnce({
        projections: [
          { projectionId: "projection-1", sourceGroupId: "group-1", targetBotId: "bot-1" },
        ],
      })
      .mockResolvedValueOnce({
        assets: [
          { assetId: "asset-1", botId: "bot-1", sourceGroupId: "group-1" },
          { assetId: "asset-2", botId: "bot-2", sourceGroupId: "group-1" },
        ],
      })
      .mockResolvedValueOnce({
        capsules: [{ capsuleId: "capsule-1", groupId: "group-1", title: "Lesson" }],
      })
      .mockResolvedValueOnce({
        projections: [
          { projectionId: "projection-1", sourceGroupId: "group-1", targetBotId: "bot-1" },
        ],
      })
      .mockResolvedValueOnce({
        assets: [{ assetId: "asset-1", botId: "bot-1", sourceGroupId: "group-1" }],
      });
    const writeGroupFile = vi.fn().mockResolvedValue(undefined);

    const storage = new OpenBotLearningStorage(undefined, { readGroupFile, writeGroupFile });

    expect(await storage.readCapsules("group-1")).toEqual([
      { capsuleId: "capsule-1", groupId: "group-1", title: "Lesson" },
    ]);
    expect(await storage.readProjections("group-1")).toEqual([
      { projectionId: "projection-1", sourceGroupId: "group-1", targetBotId: "bot-1" },
    ]);
    expect(await storage.readLearningAssets("group-1", "bot-1")).toEqual([
      { assetId: "asset-1", botId: "bot-1", sourceGroupId: "group-1" },
    ]);

    await storage.appendCapsule("group-1", {
      capsuleId: "capsule-2",
      groupId: "group-1",
      title: "Pattern",
    });
    await storage.appendProjection("group-1", {
      projectionId: "projection-2",
      sourceGroupId: "group-1",
      sourceCapsuleId: "capsule-2",
      targetBotId: "bot-2",
    });
    await storage.appendLearningAsset("group-1", {
      assetId: "asset-3",
      botId: "bot-3",
      sourceGroupId: "group-1",
      sourceCapsuleId: "capsule-2",
    });

    expect(writeGroupFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        filename: "capsules.json",
        data: {
          capsules: [
            { capsuleId: "capsule-1", groupId: "group-1", title: "Lesson" },
            { capsuleId: "capsule-2", groupId: "group-1", title: "Pattern" },
          ],
        },
      }),
    );
    expect(writeGroupFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        filename: "projections.json",
        data: {
          projections: [
            { projectionId: "projection-1", sourceGroupId: "group-1", targetBotId: "bot-1" },
            {
              projectionId: "projection-2",
              sourceGroupId: "group-1",
              sourceCapsuleId: "capsule-2",
              targetBotId: "bot-2",
            },
          ],
        },
      }),
    );
    expect(writeGroupFile).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        filename: "learning-assets.json",
        data: {
          assets: [
            { assetId: "asset-1", botId: "bot-1", sourceGroupId: "group-1" },
            {
              assetId: "asset-3",
              botId: "bot-3",
              sourceGroupId: "group-1",
              sourceCapsuleId: "capsule-2",
            },
          ],
        },
      }),
    );
  });

  it("maps governance events back into collaboration audit shape", async () => {
    const recordGovernanceEventWithLock = vi.fn().mockResolvedValue(undefined);
    const adapter = new OpenBotAuditAdapter({
      recordGovernanceEventWithLock,
      loadGovernanceEventsStore: vi.fn().mockReturnValue({
        events: [
          {
            id: "event-1",
            kind: "space_updated",
            occurredAt: 100,
            sourceMethod: "spaces.update",
            targetKind: "space",
            targetId: "group-1",
            actorSubjectId: "human-1",
            actorRole: "owner",
          },
        ],
      }),
    });

    const events = await adapter.queryEvents({ groupId: "group-1" });
    expect(events).toEqual([
      expect.objectContaining({
        id: "event-1",
        groupId: "group-1",
        actor: expect.objectContaining({ id: "human-1", role: "owner" }),
      }),
    ]);

    await adapter.recordEvent({
      id: "event-2",
      kind: "space_closed",
      occurredAt: 200,
      sourceMethod: "spaces.close",
      targetKind: "space",
      targetId: "group-2",
      actor: { id: "human-2", role: "admin" },
    });
    expect(recordGovernanceEventWithLock).toHaveBeenCalledWith({
      event: expect.objectContaining({
        id: "event-2",
        kind: "space_closed",
        targetId: "group-2",
        actorRole: "admin",
        actorSubjectId: "human-2",
      }),
      env: undefined,
    });
  });

  it("resolves directory bindings and member identity mappings", async () => {
    const adapter = new OpenBotDirectoryAdapter({
      loadGroupBindings: vi.fn().mockResolvedValue([
        {
          bindingId: "binding-1",
          channel: "directory",
          accountId: "user-1",
          entryKind: "group",
          entryId: "entry-1",
          status: "linked",
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ]),
      loadGroupMembers: vi.fn().mockResolvedValue([
        {
          memberId: "member-1",
          memberKind: "human",
          userId: "user-1",
          governanceRole: "member",
          status: "active",
          updatedAtMs: 1,
        },
      ]),
      verifyBinding: vi.fn().mockResolvedValue({ status: "linked" }),
    });

    expect(await adapter.resolveBinding("group-1", "binding-1")).toEqual(
      expect.objectContaining({ found: true, status: "linked" }),
    );
    expect(
      await adapter.validateBinding("group-1", {
        bindingId: "binding-1",
        channel: "directory",
        entryKind: "group",
        entryId: "entry-1",
        status: "linked",
        createdAtMs: 1,
        updatedAtMs: 1,
      }),
    ).toBe(true);
    expect(await adapter.mapMemberIdentity("group-1", "member-1")).toEqual({
      memberId: "member-1",
      accountId: "user-1",
      status: "mapped",
    });
  });

  it("delegates session projection reads and writes", async () => {
    const readSessionProjection = vi.fn().mockResolvedValue({
      sessionId: "session-1",
      groupId: "group-1",
      metadata: { a: 1 },
      projectedAt: 1,
    });
    const writeSessionProjection = vi.fn().mockResolvedValue(undefined);
    const flushSessionMemory = vi.fn().mockResolvedValue(undefined);
    const adapter = new OpenBotSessionProjectionAdapter({
      readSessionProjection,
      writeSessionProjection,
      flushSessionMemory,
    });

    expect(await adapter.readProjection("session-1")).toEqual(
      expect.objectContaining({ sessionId: "session-1" }),
    );
    await adapter.writeProjection({
      sessionId: "session-1",
      groupId: "group-1",
      metadata: { a: 2 },
      projectedAt: 2,
    });
    await adapter.flushSessionMemoryToGroup("session-1", "group-1");

    expect(writeSessionProjection).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ metadata: { a: 2 } }),
    );
    expect(flushSessionMemory).toHaveBeenCalledWith("session-1", "group-1");
  });

  it("persists group capability profiles and participation overlays through metadata storage", async () => {
    const readGroupFile = vi
      .fn()
      .mockResolvedValueOnce({
        groupId: "group-1",
        enabledSkills: ["summarize"],
        updatedAtMs: 1,
      })
      .mockResolvedValueOnce([
        {
          participationId: "group-1::bot-1",
          botId: "bot-1",
          groupId: "group-1",
          enabledSkills: ["review"],
          updatedAtMs: 1,
        },
      ]);
    const writeGroupFile = vi.fn().mockResolvedValue(undefined);
    const storage = new OpenBotMetadataStorage(undefined, { readGroupFile, writeGroupFile });

    expect(await storage.readGroupCapabilities("group-1")).toEqual(
      expect.objectContaining({ enabledSkills: ["summarize"] }),
    );
    expect(await storage.readParticipationOverlays("group-1")).toEqual([
      expect.objectContaining({ participationId: "group-1::bot-1" }),
    ]);

    await storage.writeGroupCapabilities("group-1", {
      groupId: "group-1",
      enabledSkills: ["summarize", "review"],
      updatedAtMs: 2,
    });
    await storage.writeParticipationOverlays("group-1", [
      {
        participationId: "group-1::bot-1",
        botId: "bot-1",
        groupId: "group-1",
        enabledSkills: ["review"],
        updatedAtMs: 2,
      },
    ]);

    expect(writeGroupFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        filename: "capabilities.json",
        data: expect.objectContaining({ enabledSkills: ["summarize", "review"] }),
      }),
    );
    expect(writeGroupFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        filename: "participation-overlays.json",
        data: [expect.objectContaining({ participationId: "group-1::bot-1" })],
      }),
    );
  });

  it("covers adapter error paths and ambiguous directory mappings", async () => {
    const objectStorage = new OpenBotObjectStorage(undefined, {
      readGroupFile: vi.fn().mockResolvedValue({ tasks: [] }),
      writeGroupFile: vi.fn().mockResolvedValue(undefined),
    });
    await expect(
      objectStorage.writeObject("group-1", "task", "task-1", { taskId: "task-2" }),
    ).rejects.toThrow("Object identifier mismatch");

    const unconfiguredSessionAdapter = new OpenBotSessionProjectionAdapter();
    await expect(unconfiguredSessionAdapter.readProjection("session-1")).rejects.toThrow(
      "Session functions not provided",
    );

    const ambiguousDirectoryAdapter = new OpenBotDirectoryAdapter({
      loadGroupBindings: vi.fn().mockResolvedValue([
        {
          bindingId: "binding-1",
          channel: "directory",
          accountId: "user-1",
          entryKind: "group",
          entryId: "entry-1",
          status: "linked",
          createdAtMs: 1,
          updatedAtMs: 1,
        },
        {
          bindingId: "binding-2",
          channel: "directory",
          accountId: "user-1",
          entryKind: "group",
          entryId: "entry-2",
          status: "linked",
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ]),
      loadGroupMembers: vi.fn().mockResolvedValue([
        {
          memberId: "member-1",
          memberKind: "human",
          userId: "user-1",
          governanceRole: "member",
          status: "active",
          updatedAtMs: 1,
        },
      ]),
      verifyBinding: vi.fn().mockResolvedValue({ status: "linked" }),
    });

    expect(await ambiguousDirectoryAdapter.mapMemberIdentity("group-1", "member-1")).toEqual({
      memberId: "member-1",
      status: "ambiguous",
    });
  });
});
