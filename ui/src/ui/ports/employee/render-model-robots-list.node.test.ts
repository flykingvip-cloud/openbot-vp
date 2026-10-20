import { describe, expect, it } from "vitest";
import {
  isWorkbenchListableCollaborationBotStatus,
  isWorkbenchSettingsListableCollaborationSpace,
} from "./render-model.ts";

describe("isWorkbenchListableCollaborationBotStatus", () => {
  it("keeps active and unspecified members", () => {
    expect(isWorkbenchListableCollaborationBotStatus("active")).toBe(true);
    expect(isWorkbenchListableCollaborationBotStatus("pending")).toBe(true);
    expect(isWorkbenchListableCollaborationBotStatus(null)).toBe(true);
    expect(isWorkbenchListableCollaborationBotStatus(undefined)).toBe(true);
    expect(isWorkbenchListableCollaborationBotStatus("")).toBe(true);
  });

  it("hides removed/revoked/invited tombstones (ghost 高级秘书)", () => {
    expect(isWorkbenchListableCollaborationBotStatus("removed")).toBe(false);
    expect(isWorkbenchListableCollaborationBotStatus("revoked")).toBe(false);
    expect(isWorkbenchListableCollaborationBotStatus("invited")).toBe(false);
    expect(isWorkbenchListableCollaborationBotStatus("deleted")).toBe(false);
    expect(isWorkbenchListableCollaborationBotStatus("REMOVED")).toBe(false);
  });
});

describe("isWorkbenchSettingsListableCollaborationSpace", () => {
  const actor = new Set(["ceo@example.com", "user-ceo"]);
  const human = (status: string) => ({
    userId: "user-ceo",
    name: "CEO",
    handle: "ceo@example.com",
    status,
  });
  const bot = (agentId: string, status: string) => ({
    agentId,
    name: agentId,
    status,
  });

  it("keeps a living group where the actor is still active", () => {
    expect(
      isWorkbenchSettingsListableCollaborationSpace(
        {
          id: "space:test",
          groupId: "grp-test",
          title: "测试组",
          ownerUserId: "user-ceo",
          members: {
            humans: [human("active")],
            bots: [bot("market-bot", "active")],
          },
        },
        actor,
      ),
    ).toBe(true);
  });

  it("hides groups where the actor is already removed", () => {
    expect(
      isWorkbenchSettingsListableCollaborationSpace(
        {
          id: "space:contingency",
          groupId: "grp-contingency",
          title: "权变思维解决问题小组",
          ownerUserId: "user-ceo",
          members: {
            humans: [human("removed")],
            bots: [bot("hr-bot", "active")],
          },
        },
        actor,
      ),
    ).toBe(false);
  });

  it("hides empty shells, UUID titles, and archived leftovers", () => {
    expect(
      isWorkbenchSettingsListableCollaborationSpace(
        {
          id: "space:empty",
          groupId: "grp-empty",
          title: "空壳组",
          ownerUserId: "user-ceo",
          members: { humans: [], bots: [] },
        },
        actor,
      ),
    ).toBe(false);
    expect(
      isWorkbenchSettingsListableCollaborationSpace(
        {
          id: "space-b1e30f37-aaaa-bbbb-cccc-ddddeeeeffff",
          groupId: "space-b1e30f37-aaaa-bbbb-cccc-ddddeeeeffff",
          title: "space-b1e30f37-aaaa-bbbb-cccc-ddddeeeeffff",
          members: {
            humans: [human("active")],
            bots: [],
          },
        },
        actor,
      ),
    ).toBe(false);
    expect(
      isWorkbenchSettingsListableCollaborationSpace(
        {
          id: "space:old",
          groupId: "grp-old",
          title: "已归档组",
          operatingState: {
            groupId: "grp-old",
            groupProfile: { lifecycleStatus: "archived" },
          },
          members: {
            humans: [human("active")],
            bots: [],
          },
        },
        actor,
      ),
    ).toBe(false);
  });
});
