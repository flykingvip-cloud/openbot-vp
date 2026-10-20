import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SessionsListResult } from "../../types.ts";
import {
  filterCollaborationSpacesListForEmployeeWorkbench,
  filterSessionsListForEmployeeWorkbench,
  isEmployeeWorkbenchCollaborationSpaceListed,
  isEmployeeWorkbenchCollaborationSpaceVisible,
} from "./employee-workbench-collaboration-scope.ts";

describe("employee-workbench-collaboration-scope", () => {
  const actor = {
    userId: "user-self",
    userEmail: "self@test.com",
    seatSpaceIds: ["space-granted"],
  };

  it("keeps owned and member spaces, drops foreign owner spaces", () => {
    expect(
      isEmployeeWorkbenchCollaborationSpaceVisible(
        {
          id: "space-owned",
          groupId: "space-owned",
          ownerUserId: "user-self",
          operatingState: null,
          members: { humans: [], bots: [] },
        },
        actor,
      ),
    ).toBe(true);
    expect(
      isEmployeeWorkbenchCollaborationSpaceVisible(
        {
          id: "space-member",
          groupId: "space-member",
          ownerUserId: "user-colleague",
          operatingState: null,
          members: {
            humans: [{ userId: "self@test.com", handle: "self@test.com", status: "active" }],
            bots: [],
          },
        },
        actor,
      ),
    ).toBe(true);
    expect(
      isEmployeeWorkbenchCollaborationSpaceVisible(
        {
          id: "space-foreign",
          groupId: "space-foreign",
          ownerUserId: "user-colleague",
          operatingState: null,
          members: {
            humans: [{ userId: "other@test.com", handle: "other@test.com", status: "active" }],
            bots: [],
          },
        },
        actor,
      ),
    ).toBe(false);
  });

  it("matches owner email to actor UUID and owner UUID to actor email", () => {
    const uuid = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";
    expect(
      isEmployeeWorkbenchCollaborationSpaceVisible(
        {
          id: "space-owned-email",
          groupId: "space-owned-email",
          ownerUserId: "glen@example.com",
          operatingState: null,
          members: {
            humans: [
              {
                userId: uuid,
                email: "glen@example.com",
                handle: "glen@example.com",
                status: "active",
              },
            ],
            bots: [],
          },
        },
        { userId: uuid, userEmail: "alias@example.com", seatSpaceIds: [] },
      ),
    ).toBe(true);
    expect(
      isEmployeeWorkbenchCollaborationSpaceVisible(
        {
          id: "space-owned-uuid",
          groupId: "space-owned-uuid",
          ownerUserId: uuid,
          operatingState: null,
          members: {
            humans: [
              {
                userId: uuid,
                email: "glen@example.com",
                handle: "glen@example.com",
                status: "active",
              },
            ],
            bots: [],
          },
        },
        { userId: "actor-alias", userEmail: "glen@example.com", seatSpaceIds: [] },
      ),
    ).toBe(true);
  });

  it("keeps member-only others' groups visible and hides archived owned spaces", () => {
    expect(
      isEmployeeWorkbenchCollaborationSpaceVisible(
        {
          id: "space-member-only",
          groupId: "space-member-only",
          ownerUserId: "user-colleague",
          operatingState: null,
          members: {
            humans: [{ userId: "user-self", email: "self@test.com", status: "active" }],
            bots: [],
          },
        },
        actor,
      ),
    ).toBe(true);
    expect(
      isEmployeeWorkbenchCollaborationSpaceVisible(
        {
          id: "space-owned-archived",
          groupId: "space-owned-archived",
          ownerUserId: "user-self",
          operatingState: {
            groupId: "space-owned-archived",
            groupProfile: { lifecycleStatus: "archived" },
          },
          members: { humans: [{ userId: "user-self", status: "active" }], bots: [] },
        },
        actor,
      ),
    ).toBe(false);
  });

  it("lists pending human-invite spaces for member governance without treating them as chat-visible", () => {
    const inviteOnly = {
      id: "space-invite",
      groupId: "space-invite",
      ownerUserId: "user-colleague",
      operatingState: null,
      members: {
        humans: [{ userId: "user-colleague", handle: "owner@test.com", status: "active" }],
        bots: [],
      },
      invites: {
        humans: [{ userId: "user-self", handle: "self@test.com", status: "invited" }],
        bots: [],
      },
    };
    expect(isEmployeeWorkbenchCollaborationSpaceVisible(inviteOnly, actor)).toBe(false);
    expect(isEmployeeWorkbenchCollaborationSpaceListed(inviteOnly, actor)).toBe(true);
  });

  it("filters collaboration.spaces.list payloads", () => {
    const filtered = filterCollaborationSpacesListForEmployeeWorkbench(
      {
        spaces: [
          {
            id: "space-owned",
            groupId: "space-owned",
            ownerUserId: "user-self",
            members: { humans: [], bots: [] },
          },
          {
            id: "space-foreign",
            groupId: "space-foreign",
            ownerUserId: "user-colleague",
            members: { humans: [], bots: [] },
          },
        ],
      },
      actor,
    );
    expect(filtered?.spaces?.map((space) => space.id)).toEqual(["space-owned"]);
  });

  it("filters install-wide sessions to visible agents and spaces", () => {
    const filtered = filterSessionsListForEmployeeWorkbench(
      {
        ts: 1,
        path: "sessions.json",
        count: 3,
        defaults: { model: null, contextTokens: null },
        sessions: [
          { key: "agent:agent-a:dm:user-1", kind: "direct", updatedAt: null },
          { key: "agent:agent-b:dm:user-2", kind: "direct", updatedAt: null },
          { key: "space:space-granted", kind: "group", chatType: "group", updatedAt: null },
          {
            key: "agent:agent-a:space:space-foreign",
            kind: "group",
            chatType: "group",
            updatedAt: null,
          },
        ],
      } as SessionsListResult,
      {
        ...actor,
        visibleAgentIds: ["agent-a"],
        visibleSpaceIds: ["space-granted"],
      },
    );
    expect(filtered?.sessions.map((session) => session.key)).toEqual([
      "agent:agent-a:dm:user-1",
      "space:space-granted",
    ]);
  });
});

describe("workbench compact compose height SoT", () => {
  it("does not let a stage textarea 22px rule beat compact 28px", () => {
    const workbenchCss = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../styles/workbench.css"),
      "utf8",
    );
    const leftoverStage22 =
      /\.employee-workbench__(?:assistant-stage|collaboration-stage-main)\s*>\s*\.chat\s+\.chat-compose__field\s+textarea\s*\{[^}]*height:\s*22px/s;
    expect(workbenchCss).not.toMatch(leftoverStage22);
    expect(workbenchCss).toMatch(
      /\.chat-compose--workbench-compact[\s\S]{0,400}?\.chat-compose__field[\s\S]{0,80}?textarea[\s\S]{0,200}?height:\s*28px/s,
    );
  });
});
