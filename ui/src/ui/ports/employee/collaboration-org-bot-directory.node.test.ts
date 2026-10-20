/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  buildEmployeeDirectoryBotCandidates,
  isCollaborationOrgBotOwnedByActor,
  loadCollaborationOrgBotDirectory,
} from "./collaboration-org-bot-directory.ts";

describe("collaboration-org-bot-directory (ui)", () => {
  it("marks foreign bots as invite-mode candidates grouped by owner", () => {
    const candidates = buildEmployeeDirectoryBotCandidates({
      orgDirectory: [
        {
          agentId: "main",
          label: "大白管家",
          ownerUserId: "ceo@acme.com",
          ownerLabel: "CEO",
          scope: "self",
        },
        {
          agentId: "legal-bot",
          label: "法律机器人",
          ownerUserId: "legal@acme.com",
          ownerLabel: "法务同学",
          scope: "self",
        },
      ],
      directoryMembers: [
        {
          user: "legal@acme.com",
          displayName: "法务同学",
          membershipRole: "member",
          status: "active",
        },
      ],
      currentUserId: "ceo@acme.com",
      currentUserEmail: "ceo@acme.com",
      ownedAgentIds: new Set(["main"]),
      currentBotIds: new Set(),
      pendingBotIds: new Set(),
    });

    expect(candidates.find((entry) => entry.id === "main")).toMatchObject({
      actionMode: "add",
      orgSegments: ["我的机器人"],
    });
    expect(candidates.find((entry) => entry.id === "legal-bot")).toMatchObject({
      actionMode: "invite",
      orgSegments: ["法务同学 的机器人"],
    });
  });

  it("detects ownership via actor identities", () => {
    const identities = new Set(["ceo@acme.com"]);
    expect(
      isCollaborationOrgBotOwnedByActor(
        { agentId: "main", ownerUserId: "ceo@acme.com" },
        identities,
      ),
    ).toBe(true);
  });

  it("coalesces in-flight directory loads and skips TTL refreshes", async () => {
    const pending: Array<(value: { bots: [] }) => void> = [];
    const request = vi.fn(
      () =>
        new Promise<{ bots: [] }>((resolve) => {
          pending.push(resolve);
        }),
    );
    const state = {
      client: { request } as never,
      connected: true,
      workbenchCollaborationOrgBotDirectory: undefined as
        | {
            agentId: string;
            label: string;
            ownerUserId: string | null;
            ownerLabel: string | null;
            scope: string | null;
          }[]
        | undefined,
    };

    const first = loadCollaborationOrgBotDirectory(state);
    const second = loadCollaborationOrgBotDirectory(state);
    expect(request).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(1);
    pending.shift()!({ bots: [] });
    await Promise.all([first, second]);
    expect(state.workbenchCollaborationOrgBotDirectory).toEqual([]);

    await loadCollaborationOrgBotDirectory(state);
    expect(request).toHaveBeenCalledTimes(1);

    const forced = loadCollaborationOrgBotDirectory(state, { force: true });
    expect(request).toHaveBeenCalledTimes(2);
    pending.shift()!({ bots: [] });
    await forced;
  });
});
