import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { upsertOrganizationPresence } from "./presence.js";
import { resolveRuntimeOrganizationContext } from "./runtime.js";
import {
  createTaskAssignment,
  transitionTaskAssignment,
  upsertOrganizationTaskAssignment,
} from "./task-assignment.js";

describe("resolveRuntimeOrganizationContext", () => {
  let previousStateDir: string | undefined;

  afterEach(() => {
    if (previousStateDir === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = previousStateDir;
    }
    previousStateDir = undefined;
  });

  it("uses organization registry membership ahead of agent config names", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-org-runtime-"));
    const groupDir = path.join(root, "groups", encodeURIComponent("upbeyond"));
    await fs.mkdir(groupDir, { recursive: true });
    await fs.writeFile(
      path.join(groupDir, "profile.json"),
      JSON.stringify({
        groupId: "upbeyond",
        groupCode: "upbeyond",
        displayName: "upbeyond",
        coordinatorBotId: "main",
        currentMission: "公众号AI运营",
        updatedAtMs: 1,
      }),
    );
    await fs.writeFile(
      path.join(groupDir, "members.json"),
      JSON.stringify({
        members: [
          {
            memberId: "main",
            memberKind: "bot",
            agentId: "main",
            name: "大白管家",
            governanceRole: "admin",
            collaborationRole: "coordinator",
            status: "active",
            updatedAtMs: 1,
          },
          {
            memberId: "bot-2",
            memberKind: "bot",
            agentId: "bot-2",
            name: "市场助手",
            governanceRole: "member",
            collaborationRole: "reviewer",
            status: "active",
            updatedAtMs: 1,
          },
        ],
      }),
    );
    const cfg = {
      collaboration: { defaults: { workspace: root } },
      agents: {
        list: [
          { id: "main", identity: { name: "Main Config" } },
          { id: "bot-2", identity: { name: "Market Config" } },
        ],
      },
    };
    await upsertOrganizationTaskAssignment({
      cfg,
      workspaceDir: root,
      assignment: transitionTaskAssignment(
        createTaskAssignment({
          organizationId: "upbeyond",
          title: "发布失败原因分析",
          ownerAgentId: "project",
          createdByAgentId: "main",
          now: "2026-05-11T00:00:00.000Z",
        }),
        "running",
        { now: "2026-05-11T00:02:00.000Z" },
      ),
    });
    await upsertOrganizationPresence({
      cfg,
      workspaceDir: root,
      organizationId: "upbeyond",
      presence: {
        agentId: "bot-2",
        online: true,
        lastActiveAt: "2026-05-11T00:03:00.000Z",
        currentTask: "文章质量审核",
      },
    });

    const context = await resolveRuntimeOrganizationContext({
      cfg,
      agentId: "bot-2",
      workspaceDir: root,
      sessionKey: "agent:bot-2:org:upbeyond",
    });

    expect(context.self.displayName).toBe("市场助手");
    expect(context.self.identitySource).toBe("organization_registry");
    expect(context.self.online).toBe(true);
    expect(context.self.lastActiveAt).toBe("2026-05-11T00:03:00.000Z");
    expect(context.self.currentTask).toBe("文章质量审核");
    expect(context.coordinator).toMatchObject({ agentId: "main", displayName: "大白管家" });
    expect(context.self.reachableAgents.map((agent) => agent.agentId)).toEqual(["main"]);
    expect(context.activeProject?.name).toBe("公众号AI运营");
    expect(context.activeTasks).toEqual([
      expect.objectContaining({
        title: "发布失败原因分析",
        ownerAgentId: "project",
        status: "running",
      }),
    ]);
  });

  it("prefers runtime workspace members over stale managed mirror roster", async () => {
    previousStateDir = process.env.OPENBOT_STATE_DIR;
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-org-runtime-sot-"));
    const stateDir = path.join(root, "state");
    process.env.OPENBOT_STATE_DIR = stateDir;

    const groupId = "product-test";
    const runtimeDir = path.join(root, "groups", encodeURIComponent(groupId));
    const managedDir = path.join(stateDir, "spaces", groupId);
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.mkdir(managedDir, { recursive: true });

    const profile = {
      groupId,
      displayName: "产品测试组",
      ownerUserId: "ceo-user",
      coordinatorBotId: "main",
      updatedAtMs: 1,
    };
    await fs.writeFile(path.join(runtimeDir, "profile.json"), JSON.stringify(profile));
    await fs.writeFile(path.join(managedDir, "profile.json"), JSON.stringify({ profile }));

    await fs.writeFile(
      path.join(managedDir, "members.json"),
      JSON.stringify({
        members: [
          {
            memberId: "stale-owner",
            memberKind: "human",
            userId: "wang-old",
            name: "王老师",
            governanceRole: "owner",
            status: "active",
            updatedAtMs: 1,
          },
          {
            memberId: "main",
            memberKind: "bot",
            agentId: "main",
            name: "大白管家",
            governanceRole: "admin",
            status: "active",
            updatedAtMs: 1,
          },
        ],
      }),
    );
    await fs.writeFile(
      path.join(runtimeDir, "members.json"),
      JSON.stringify({
        members: [
          {
            memberId: "ceo",
            memberKind: "human",
            userId: "ceo-user",
            name: "CEO",
            governanceRole: "owner",
            status: "active",
            updatedAtMs: 2,
          },
          {
            memberId: "wang",
            memberKind: "human",
            userId: "wang-user",
            name: "王军",
            governanceRole: "member",
            status: "active",
            updatedAtMs: 2,
          },
          {
            memberId: "main",
            memberKind: "bot",
            agentId: "main",
            name: "大白管家",
            governanceRole: "admin",
            status: "active",
            updatedAtMs: 2,
          },
        ],
      }),
    );

    const context = await resolveRuntimeOrganizationContext({
      cfg: { collaboration: { defaults: { workspace: root } }, agents: { list: [] } },
      agentId: "main",
      workspaceDir: root,
      sessionKey: `agent:main:main:space:${groupId}`,
    });

    expect(context.humans?.map((human) => human.displayName)).toEqual(
      expect.arrayContaining(["CEO", "王军"]),
    );
    expect(context.humans?.some((human) => human.displayName === "王老师")).toBe(false);
  });
});
