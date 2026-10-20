// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  createTaskAssignment,
  readOrganizationTaskAssignments,
  type TaskAssignment,
  writeOrganizationTaskAssignments,
} from "../../organization/task-assignment.js";
import type { WorkspaceDeliverable } from "../knowledge/deliverables/types.js";
import {
  buildWorkbenchPendingTasks,
  readTaskAssignmentsAcrossAgentWorkspaces,
  type WorkbenchPendingTasksDeps,
} from "./pending-tasks-read-model.js";

function task(over: Partial<TaskAssignment> & { id: string }): TaskAssignment {
  return {
    organizationId: "space-a",
    title: `Task ${over.id}`,
    ownerAgentId: "bot-x",
    createdByAgentId: "main",
    status: "pending",
    createdAt: new Date(1).toISOString(),
    updatedAt: new Date(100).toISOString(),
    ackRequired: true,
    ...over,
  };
}

function deliverable(over: Partial<WorkspaceDeliverable> & { deliverableId: string }) {
  return {
    title: `Deliverable ${over.deliverableId}`,
    kind: "other",
    source: "agent",
    sourceType: "agent",
    artifactKind: "document",
    governanceStatus: "pending",
    creators: [],
    status: "published",
    updatedAtMs: 100,
    ...over,
  } as unknown as WorkspaceDeliverable;
}

function spaceSnapshot(over: { groupId: string; title?: string } & Record<string, unknown>) {
  return {
    members: { humans: [], bots: [] },
    invites: { humans: [], bots: [] },
    ...over,
    id: `space:${over.groupId}`,
    groupId: over.groupId,
    title: over.title ?? `Space ${over.groupId}`,
  } as never;
}

function buildDeps(over: Partial<WorkbenchPendingTasksDeps>): Partial<WorkbenchPendingTasksDeps> {
  return {
    readTaskAssignments: async () => [],
    listDeliverables: async () => ({ deliverables: [] }),
    listSpaces: async () => ({ spaces: [] }),
    ...over,
  };
}

describe("workbench pending tasks read model", () => {
  it("aggregates pending tasks, pending-governance deliverables, and invites", async () => {
    const result = await buildWorkbenchPendingTasks({
      userId: "user-1",
      userEmail: "u1@example.com",
      seatSpaceIds: ["space-a"],
      visibleAgentIds: ["bot-x"],
      deps: buildDeps({
        readTaskAssignments: async (orgId) =>
          orgId === "space-a"
            ? [
                task({ id: "t1", status: "pending", updatedAt: new Date(200).toISOString() }),
                task({ id: "t2", status: "completed" }),
              ]
            : [],
        listDeliverables: async () => ({
          deliverables: [
            deliverable({ deliverableId: "d1", governanceStatus: "pending", updatedAtMs: 300 }),
            deliverable({ deliverableId: "d2", governanceStatus: "verified" }),
          ],
        }),
        listSpaces: async () => ({
          spaces: [
            // bot awaiting confirmation in a space the actor seats
            spaceSnapshot({
              groupId: "space-a",
              title: "Alpha 小组",
              ownerUserId: "user-1",
              members: {
                humans: [{ userId: "user-1", name: "Elle", status: "active" }],
                bots: [{ agentId: "bot-y", name: "Bot Y", status: "invited" }],
              },
            }),
            // the actor's own pending invite into another space
            spaceSnapshot({
              groupId: "space-b",
              title: "Beta 小组",
              ownerUserId: "owner-b",
              members: {
                humans: [
                  { userId: "owner-b", name: "Bob", status: "active" },
                  { userId: "u1@example.com", status: "invited" },
                ],
                bots: [],
              },
            }),
          ],
        }),
      }),
    });

    expect(result.taskCount).toBe(1); // only the pending one
    expect(result.ackRequiredCount).toBe(1); // the pending task requires ack
    expect(result.governanceCount).toBe(1); // only the pending one
    expect(result.inviteCount).toBe(2); // owned-space bot + own invite
    expect(result.totalCount).toBe(4);
    // ack-required pending task is layered first, ahead of the more-recent
    // governance deliverable (d1@300 vs t1@200).
    expect(result.items[0]?.id).toBe("task:t1");
    expect(result.items.find((item) => item.id === "invite:bot:space-a:bot-y")?.title).toBe(
      "待确认：Bot Y加入「Alpha 小组」",
    );
    expect(
      result.items.find((item) => item.id === "invite:human:space-b:u1@example.com")?.title,
    ).toBe("收到Bob发来的协作邀请");
  });

  it("layers ack-required pending tasks ahead of newer non-ack items and counts them", async () => {
    const result = await buildWorkbenchPendingTasks({
      userId: "user-1",
      seatSpaceIds: ["space-a"],
      deps: buildDeps({
        readTaskAssignments: async () => [
          // older but ack-required
          task({
            id: "ack-old",
            ackRequired: true,
            updatedAt: new Date(100).toISOString(),
          }),
          // newer but does NOT require ack
          task({
            id: "noack-new",
            ackRequired: false,
            updatedAt: new Date(900).toISOString(),
          }),
        ],
      }),
    });
    expect(result.taskCount).toBe(2);
    expect(result.ackRequiredCount).toBe(1);
    // ack-required first despite being older.
    expect(result.items.map((item) => item.id)).toEqual(["task:ack-old", "task:noack-new"]);
  });

  it("surfaces a human-assigned task only to its assignee; existing tasks unchanged", async () => {
    const result = await buildWorkbenchPendingTasks({
      userId: "user-1",
      userEmail: "u1@example.com",
      seatSpaceIds: ["space-a"],
      deps: buildDeps({
        readTaskAssignments: async () => [
          task({ id: "mine", assigneeUserId: "user-1" }),
          task({ id: "theirs", assigneeUserId: "user-2" }),
          task({ id: "legacy" }), // no assignee → space-scoped, unchanged
        ],
      }),
    });
    // theirs (assigned to user-2) is filtered out; mine + legacy remain.
    expect(result.taskCount).toBe(2);
    const ids = result.items.map((item) => item.id);
    expect(ids).toContain("task:mine");
    expect(ids).toContain("task:legacy");
    expect(ids).not.toContain("task:theirs");
  });

  it("returns zero for a brand-new member with no spaces or assets", async () => {
    const result = await buildWorkbenchPendingTasks({
      userId: "newcomer",
      seatSpaceIds: [],
      deps: buildDeps({}),
    });
    expect(result.totalCount).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("does not count bot confirmations for non-owners who do not seat the space", async () => {
    const result = await buildWorkbenchPendingTasks({
      userId: "user-1",
      seatSpaceIds: [], // actor seats no space
      deps: buildDeps({
        listSpaces: async () => ({
          spaces: [
            spaceSnapshot({
              groupId: "space-x",
              members: {
                humans: [],
                bots: [{ agentId: "bot-z", status: "invited", ownerUserId: "other-owner" }],
              },
            }),
          ],
        }),
      }),
    });
    expect(result.inviteCount).toBe(0);
  });

  it("matches human invites when roster userId is email and actor id is uuid", async () => {
    const result = await buildWorkbenchPendingTasks({
      userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      userEmail: "daniel.hhd@gmail.com",
      seatSpaceIds: [],
      deps: buildDeps({
        listSpaces: async () => ({
          spaces: [
            spaceSnapshot({
              groupId: "grp-hrqb-权变管理专家",
              title: "权变管理专家",
              ownerUserId: "c6862233-2e3e-4c89-a942-ce813e782637",
              members: {
                humans: [
                  {
                    userId: "c6862233-2e3e-4c89-a942-ce813e782637",
                    name: "王军",
                    status: "active",
                  },
                ],
                bots: [],
              },
              invites: {
                humans: [{ userId: "daniel.hhd@gmail.com", name: "CEO", status: "invited" }],
                bots: [],
              },
            }),
          ],
        }),
      }),
    });
    expect(result.inviteCount).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: "invite:human:grp-hrqb-权变管理专家:daniel.hhd@gmail.com",
      title: "收到王军发来的协作邀请",
    });
  });

  it("surfaces bot invites to the bot owner even when they do not seat the space", async () => {
    const result = await buildWorkbenchPendingTasks({
      userId: "bot-owner-1",
      userEmail: "owner@example.com",
      seatSpaceIds: [],
      deps: buildDeps({
        listSpaces: async () => ({
          spaces: [
            spaceSnapshot({
              groupId: "colleague-space",
              title: "市场协同组",
              ownerUserId: "inviter-9",
              members: {
                humans: [{ userId: "inviter-9", name: "小王", status: "active" }],
                bots: [],
              },
              invites: {
                humans: [],
                bots: [
                  {
                    agentId: "market-assistant",
                    name: "市场助手",
                    status: "invited",
                    ownerUserId: "bot-owner-1",
                  },
                ],
              },
            }),
          ],
        }),
      }),
    });
    expect(result.inviteCount).toBe(1);
    expect(result.items.map((item) => item.id)).toContain(
      "invite:bot:colleague-space:market-assistant",
    );
    const invite = result.items.find(
      (item) => item.id === "invite:bot:colleague-space:market-assistant",
    );
    expect(invite?.title).toBe("收到小王发来的协作邀请");
  });

  it("dedupes a bot present in both members and invites rosters", async () => {
    const result = await buildWorkbenchPendingTasks({
      userId: "user-1",
      seatSpaceIds: ["space-a"],
      deps: buildDeps({
        listSpaces: async () => ({
          spaces: [
            spaceSnapshot({
              groupId: "space-a",
              members: { humans: [], bots: [{ agentId: "bot-y", status: "invited" }] },
              invites: { humans: [], bots: [{ agentId: "bot-y", status: "pending" }] },
            }),
          ],
        }),
      }),
    });
    expect(result.inviteCount).toBe(1);
  });

  it("surfaces ledger human gates without mixing in execution steps", async () => {
    const result = await buildWorkbenchPendingTasks({
      userId: "user-1",
      deps: buildDeps({
        listHumanGates: async () => [
          {
            id: "ledger-gate:job-1",
            taskId: "job-1",
            title: "价差按含税价还是活动价？",
            reason: "blocked_user",
            goal: "Q2 竞品价格巡检",
            updatedAtMs: 500,
            ackRequired: true,
          },
        ],
      }),
    });
    expect(result.humanGateCount).toBe(1);
    expect(result.taskCount).toBe(0);
    expect(result.ackRequiredCount).toBe(1);
    expect(result.totalCount).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: "ledger-gate:job-1",
      kind: "human-gate",
      title: "价差按含税价还是活动价？",
      visibility: "personal",
    });
    expect(result.items.some((item) => item.kind === "task")).toBe(false);
  });
});

describe("readTaskAssignmentsAcrossAgentWorkspaces (multi-agent workspace coverage)", () => {
  it("reads a pending task written into a NON-default agent's workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "obx-pending-"));
    const mainWs = path.join(root, "main-ws");
    const bot2Ws = path.join(root, "bot2-ws");
    await fs.mkdir(mainWs, { recursive: true });
    await fs.mkdir(bot2Ws, { recursive: true });
    // Unique org id so the workspace-independent managed dir (<stateDir>/spaces/<id>)
    // is guaranteed empty and cannot pollute the assertion.
    const organizationId = `space-multiagent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cfg = {
      agents: {
        list: [
          { id: "main", default: true, workspace: mainWs },
          { id: "bot-2", workspace: bot2Ws },
        ],
      },
    } as unknown as OpenBotConfig;
    const assignment = createTaskAssignment({
      organizationId,
      title: "Created by non-default agent",
      ownerAgentId: "bot-2",
      createdByAgentId: "bot-2",
    });
    // Write the task into the NON-default agent's workspace (the executing agent).
    await writeOrganizationTaskAssignments({
      cfg,
      workspaceDir: bot2Ws,
      organizationId,
      assignments: [assignment],
    });
    try {
      // A default-agent-only read MISSES it — this is exactly the under-count the
      // cross-agent read fixes (read/write workspace inconsistency).
      const defaultOnly = await readOrganizationTaskAssignments({
        cfg,
        workspaceDir: mainWs,
        organizationId,
      });
      expect(defaultOnly.some((entry) => entry.id === assignment.id)).toBe(false);
      // The cross-agent read picks up the non-default agent's task.
      const all = await readTaskAssignmentsAcrossAgentWorkspaces(cfg, organizationId);
      expect(all.some((entry) => entry.id === assignment.id)).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
