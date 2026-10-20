import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readOrganizationArtifacts,
  readOrganizationDecisions,
  readOrganizationOwnerships,
} from "../../organization/shared-memory.js";
import {
  createTaskAssignment,
  readOrganizationTaskAssignments,
  writeOrganizationTaskAssignments,
} from "../../organization/task-assignment.js";
import { createOrganizationMemoryTool } from "./organization-memory-tool.js";
import { createOrganizationTasksTool } from "./organization-tasks-tool.js";

const callGatewayMock = vi.hoisted(() => vi.fn());

vi.mock("../../gateway/call.js", () => ({
  callGateway: (...args: unknown[]) => callGatewayMock(...args),
}));

type Member = { agentId: string; status?: string };

async function writeOrg(root: string, orgId: string, coordinator: string, members: Member[]) {
  const groupDir = path.join(root, "groups", encodeURIComponent(orgId));
  await fs.mkdir(groupDir, { recursive: true });
  await fs.writeFile(
    path.join(groupDir, "profile.json"),
    JSON.stringify({ groupId: orgId, displayName: orgId, coordinatorBotId: coordinator }),
  );
  await fs.writeFile(
    path.join(groupDir, "members.json"),
    JSON.stringify({
      members: members.map((m) => ({
        memberId: m.agentId,
        memberKind: "bot",
        agentId: m.agentId,
        name: m.agentId,
        status: m.status ?? "active",
      })),
    }),
  );
}

/**
 * Two organizations on one host:
 * - HOME: coordinator `main`, members main, bot-2 (also active in RIVAL), paused-bot (paused).
 * - RIVAL: coordinator `rival-coord`, members rival-coord, rival-bot, bot-2.
 * Org ids are unique per test so the managed state dir cannot leak between runs.
 */
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-org-authz-"));
  const suffix = path
    .basename(root)
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  const HOME = `home-${suffix}`;
  const RIVAL = `rival-${suffix}`;
  await writeOrg(root, HOME, "main", [
    { agentId: "main" },
    { agentId: "bot-2" },
    { agentId: "paused-bot", status: "paused" },
  ]);
  await writeOrg(root, RIVAL, "rival-coord", [
    { agentId: "rival-coord" },
    { agentId: "rival-bot" },
    { agentId: "bot-2" },
  ]);
  const cfg = { collaboration: { defaults: { workspace: root } }, agents: { defaults: {} } };
  const rivalTask = createTaskAssignment({
    organizationId: RIVAL,
    title: "rival secret task",
    ownerAgentId: "rival-bot",
    createdByAgentId: "rival-coord",
  });
  await writeOrganizationTaskAssignments({
    cfg,
    workspaceDir: root,
    organizationId: RIVAL,
    assignments: [rivalTask],
  });
  const tasksTool = (agentId: string | undefined, sessionKey: string | undefined) =>
    createOrganizationTasksTool({
      ...(agentId ? { requesterAgentIdOverride: agentId } : {}),
      ...(sessionKey ? { agentSessionKey: sessionKey } : {}),
      workspaceDir: root,
      config: cfg,
    });
  const memoryTool = (agentId: string | undefined, sessionKey: string | undefined) =>
    createOrganizationMemoryTool({
      ...(agentId ? { requesterAgentIdOverride: agentId } : {}),
      ...(sessionKey ? { agentSessionKey: sessionKey } : {}),
      workspaceDir: root,
      config: cfg,
    });
  const read = {
    tasks: (org: string) =>
      readOrganizationTaskAssignments({ cfg, workspaceDir: root, organizationId: org }),
    decisions: (org: string) =>
      readOrganizationDecisions({ cfg, workspaceDir: root, organizationId: org }),
    artifacts: (org: string) =>
      readOrganizationArtifacts({ cfg, workspaceDir: root, organizationId: org }),
    ownerships: (org: string) =>
      readOrganizationOwnerships({ cfg, workspaceDir: root, organizationId: org }),
  };
  return { root, cfg, HOME, RIVAL, rivalTask, tasksTool, memoryTool, read };
}

const CROSS_ORG = /Cross-organization access denied/;

describe("P0-S organization tool cross-org authorization", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    callGatewayMock.mockResolvedValue({ runId: "run-x" });
  });

  describe("organization_tasks", () => {
    it("rejects cross-org list without leaking the other org's tasks", async () => {
      const t = await setup();
      const tool = t.tasksTool("main", `agent:main:main:space:${t.HOME}`);
      await expect(tool.execute("c", { action: "list", organizationId: t.RIVAL })).rejects.toThrow(
        CROSS_ORG,
      );
    });

    it("rejects cross-org create by the home coordinator and writes nothing", async () => {
      const t = await setup();
      const tool = t.tasksTool("main", `agent:main:main:space:${t.HOME}`);
      await expect(
        tool.execute("c", {
          action: "create",
          organizationId: t.RIVAL,
          title: "injected",
          ownerAgentId: "rival-bot",
        }),
      ).rejects.toThrow(CROSS_ORG);
      expect((await t.read.tasks(t.RIVAL)).map((a) => a.id)).toEqual([t.rivalTask.id]);
      expect(await t.read.tasks(t.HOME)).toEqual([]);
    });

    it("rejects cross-org create+notify without pinging the other org's owner", async () => {
      const t = await setup();
      const tool = t.tasksTool("main", `agent:main:main:space:${t.HOME}`);
      await expect(
        tool.execute("c", {
          action: "create",
          organizationId: t.RIVAL,
          title: "ping",
          ownerAgentId: "rival-bot",
          notify: true,
        }),
      ).rejects.toThrow(CROSS_ORG);
      expect(callGatewayMock).not.toHaveBeenCalled();
    });

    it("rejects cross-org transitions (complete/reject) and leaves the task untouched", async () => {
      const t = await setup();
      const tool = t.tasksTool("main", `agent:main:main:space:${t.HOME}`);
      for (const action of ["accept", "start", "complete", "reject"]) {
        await expect(
          tool.execute("c", { action, organizationId: t.RIVAL, taskId: t.rivalTask.id }),
        ).rejects.toThrow(CROSS_ORG);
      }
      const [stored] = await t.read.tasks(t.RIVAL);
      expect(stored?.status).toBe("pending");
    });

    it("stays session-bound even when the agent is also a member of the other org", async () => {
      const t = await setup();
      const tool = t.tasksTool("bot-2", `agent:bot-2:main:space:${t.HOME}`);
      await expect(tool.execute("c", { action: "list", organizationId: t.RIVAL })).rejects.toThrow(
        CROSS_ORG,
      );
    });

    it("cannot reach another org's task by id from the home org (no implicit lookup)", async () => {
      const t = await setup();
      const tool = t.tasksTool("main", `agent:main:main:space:${t.HOME}`);
      await expect(
        tool.execute("c", { action: "complete", taskId: t.rivalTask.id }),
      ).rejects.toThrow("Task assignment not found");
    });

    it("allows a matching explicit organizationId (same-org)", async () => {
      const t = await setup();
      const tool = t.tasksTool("main", `agent:main:main:space:${t.HOME}`);
      const created = await tool.execute("c", {
        action: "create",
        organizationId: ` ${t.HOME} `,
        title: "ok",
        ownerAgentId: "bot-2",
        notify: true,
      });
      expect(created.details).toMatchObject({
        status: "ok",
        assignment: { organizationId: t.HOME, ownerAgentId: "bot-2" },
        delivery: { status: "accepted", targetSessionKey: `agent:bot-2:org:${t.HOME}` },
      });
      const listed = await tool.execute("c", { action: "list", organizationId: t.HOME });
      expect(listed.details).toMatchObject({ status: "ok", organizationId: t.HOME });
      expect((listed.details as { assignments: unknown[] }).assignments).toHaveLength(1);
    });

    it("same-org flow without organizationId is unchanged (create → owner accept/complete)", async () => {
      const t = await setup();
      const coord = t.tasksTool("main", `agent:main:main:space:${t.HOME}`);
      const created = await coord.execute("c", {
        action: "create",
        title: "same org",
        ownerAgentId: "bot-2",
      });
      const id = (created.details as { assignment: { id: string } }).assignment.id;
      // Owner acknowledges from its org inbox session (what notify targets).
      const owner = t.tasksTool(undefined, `agent:bot-2:org:${t.HOME}`);
      await owner.execute("c", { action: "accept", taskId: id });
      const done = await owner.execute("c", { action: "complete", taskId: id });
      expect((done.details as { assignment: { status: string } }).assignment.status).toBe(
        "completed",
      );
      const otherBot = t.tasksTool("paused-bot", `agent:paused-bot:main:space:${t.HOME}`);
      await expect(otherBot.execute("c", { action: "reject", taskId: id })).rejects.toThrow(
        "Only the task owner or organization coordinator can update this task.",
      );
    });

    it("rejects when the requester cannot be resolved (no 'main' fallback)", async () => {
      const t = await setup();
      for (const sessionKey of [undefined, "main", "not-an-agent-key"]) {
        const tool = t.tasksTool(undefined, sessionKey);
        await expect(
          tool.execute("c", {
            action: "create",
            organizationId: t.HOME,
            title: "as main?",
            ownerAgentId: "bot-2",
          }),
        ).rejects.toThrow("Cannot resolve the requesting agent");
        await expect(tool.execute("c", { action: "list", organizationId: t.HOME })).rejects.toThrow(
          "Cannot resolve the requesting agent",
        );
      }
      expect(await t.read.tasks(t.HOME)).toEqual([]);
    });

    describe("outside an organization session (membership path)", () => {
      it("still requires organizationId", async () => {
        const t = await setup();
        const tool = t.tasksTool("main", "agent:main:main");
        await expect(tool.execute("c", { action: "list" })).rejects.toThrow(
          "organizationId required outside an organization session",
        );
      });

      it("allows an active member and authorizes against the TARGET org", async () => {
        const t = await setup();
        const main = t.tasksTool("main", "agent:main:main");
        const created = await main.execute("c", {
          action: "create",
          organizationId: t.HOME,
          title: "from dm",
          ownerAgentId: "bot-2",
        });
        expect(created.details).toMatchObject({ assignment: { organizationId: t.HOME } });
        // bot-2 is an active RIVAL member but not RIVAL's coordinator.
        const bot2 = t.tasksTool("bot-2", "agent:bot-2:main");
        await expect(
          bot2.execute("c", {
            action: "create",
            organizationId: t.RIVAL,
            title: "x",
            ownerAgentId: "rival-bot",
          }),
        ).rejects.toThrow("Only the organization coordinator can create task assignments.");
        await expect(
          bot2.execute("c", {
            action: "complete",
            organizationId: t.RIVAL,
            taskId: t.rivalTask.id,
          }),
        ).rejects.toThrow("Only the task owner or organization coordinator can update this task.");
      });

      it("rejects non-members, non-active members and unknown orgs", async () => {
        const t = await setup();
        const cases: Array<[string, string]> = [
          ["main", t.RIVAL],
          ["paused-bot", t.HOME],
          ["main", "does-not-exist"],
        ];
        for (const [agentId, org] of cases) {
          const tool = t.tasksTool(agentId, `agent:${agentId}:main`);
          await expect(tool.execute("c", { action: "list", organizationId: org })).rejects.toThrow(
            CROSS_ORG,
          );
        }
      });
    });
  });

  describe("organization_memory", () => {
    it("rejects cross-org reads", async () => {
      const t = await setup();
      const tool = t.memoryTool("main", `agent:main:main:space:${t.HOME}`);
      for (const action of ["list_decisions", "list_artifacts", "list_ownerships"]) {
        await expect(tool.execute("c", { action, organizationId: t.RIVAL })).rejects.toThrow(
          CROSS_ORG,
        );
      }
    });

    it("rejects cross-org writes (record_decision, assign_owner) and writes nothing", async () => {
      const t = await setup();
      const tool = t.memoryTool("main", `agent:main:main:space:${t.HOME}`);
      await expect(
        tool.execute("c", { action: "record_decision", organizationId: t.RIVAL, title: "x" }),
      ).rejects.toThrow(CROSS_ORG);
      await expect(
        tool.execute("c", {
          action: "assign_owner",
          organizationId: t.RIVAL,
          subjectType: "task",
          subjectId: t.rivalTask.id,
          ownerAgentId: "main",
        }),
      ).rejects.toThrow(CROSS_ORG);
      expect(await t.read.decisions(t.RIVAL)).toEqual([]);
      expect(await t.read.ownerships(t.RIVAL)).toEqual([]);
    });

    it("rejects cross-org record_artifact and writes nothing", async () => {
      const t = await setup();
      const tool = t.memoryTool("bot-2", `agent:bot-2:main:space:${t.HOME}`);
      await expect(
        tool.execute("c", {
          action: "record_artifact",
          organizationId: t.RIVAL,
          title: "x",
          artifactType: "doc",
          taskId: "task-1",
        }),
      ).rejects.toThrow(CROSS_ORG);
      expect(await t.read.artifacts(t.RIVAL)).toEqual([]);
      expect(await t.read.ownerships(t.RIVAL)).toEqual([]);
    });

    it("record_artifact: members record their own; only the coordinator assigns other owners", async () => {
      const t = await setup();
      const member = t.memoryTool("bot-2", `agent:bot-2:main:space:${t.HOME}`);
      const own = await member.execute("c", {
        action: "record_artifact",
        organizationId: t.HOME,
        title: "mine",
        artifactType: "doc",
        taskId: "task-1",
      });
      expect(own.details).toMatchObject({
        artifact: { organizationId: t.HOME, ownerAgentId: "bot-2" },
      });
      await expect(
        member.execute("c", {
          action: "record_artifact",
          title: "theirs",
          artifactType: "doc",
          taskId: "task-1",
          ownerAgentId: "main",
        }),
      ).rejects.toThrow(
        "Only the organization coordinator can record artifacts owned by another agent.",
      );
      const coord = t.memoryTool("main", `agent:main:main:space:${t.HOME}`);
      const assigned = await coord.execute("c", {
        action: "record_artifact",
        title: "for bot-2",
        artifactType: "doc",
        taskId: "task-1",
        ownerAgentId: "bot-2",
      });
      expect(assigned.details).toMatchObject({ artifact: { ownerAgentId: "bot-2" } });
      for (const [agentId, label] of [
        ["paused-bot", "paused"],
        ["stranger", "not listed"],
      ]) {
        const tool = t.memoryTool(agentId, `agent:${agentId}:main:space:${t.HOME}`);
        await expect(
          tool.execute("c", {
            action: "record_artifact",
            title: label,
            artifactType: "doc",
            taskId: "task-1",
          }),
        ).rejects.toThrow("Only active members of this organization can record artifacts.");
      }
      expect(await t.read.artifacts(t.HOME)).toHaveLength(2);
    });

    it("same-org reads/writes with matching or omitted organizationId still work", async () => {
      const t = await setup();
      const coord = t.memoryTool("main", `agent:main:main:space:${t.HOME}`);
      await coord.execute("c", {
        action: "record_decision",
        organizationId: t.HOME,
        title: "approved plan",
        status: "approved",
      });
      const listed = await coord.execute("c", { action: "list_decisions" });
      expect(listed.details).toMatchObject({ status: "ok", organizationId: t.HOME });
      expect((listed.details as { decisions: unknown[] }).decisions).toHaveLength(1);
    });

    it("rejects when the requester cannot be resolved", async () => {
      const t = await setup();
      const tool = t.memoryTool(undefined, undefined);
      await expect(
        tool.execute("c", { action: "list_decisions", organizationId: t.HOME }),
      ).rejects.toThrow("Cannot resolve the requesting agent");
    });
  });
});
