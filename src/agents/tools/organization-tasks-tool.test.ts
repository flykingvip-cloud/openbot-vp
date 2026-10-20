import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createOrganizationTasksTool } from "./organization-tasks-tool.js";

async function createWorkspaceRegistry() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-org-tasks-tool-"));
  const groupDir = path.join(root, "groups", encodeURIComponent("upbeyond"));
  await fs.mkdir(groupDir, { recursive: true });
  await fs.writeFile(
    path.join(groupDir, "profile.json"),
    JSON.stringify({
      groupId: "upbeyond",
      displayName: "upbeyond",
      coordinatorBotId: "main",
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
          status: "active",
        },
        {
          memberId: "bot-2",
          memberKind: "bot",
          agentId: "bot-2",
          name: "市场助手",
          status: "active",
        },
      ],
    }),
  );
  return root;
}

describe("organization_tasks tool", () => {
  it("lets the coordinator create an assignment and the owner acknowledge it", async () => {
    const root = await createWorkspaceRegistry();
    const cfg = { collaboration: { defaults: { workspace: root } }, agents: { defaults: {} } };
    const coordinatorTool = createOrganizationTasksTool({
      requesterAgentIdOverride: "main",
      agentSessionKey: "agent:main:main:space:upbeyond",
      workspaceDir: root,
      config: cfg,
    });

    const createResult = await coordinatorTool.execute("call-create", {
      action: "create",
      title: "文章质量审核",
      ownerAgentId: "bot-2",
    });
    const assignment = (
      createResult.details as {
        assignment: { id: string; status: string; ownerAgentId: string };
      }
    ).assignment;
    expect(assignment).toMatchObject({ ownerAgentId: "bot-2", status: "pending" });

    const ownerTool = createOrganizationTasksTool({
      requesterAgentIdOverride: "bot-2",
      agentSessionKey: "agent:bot-2:main:space:upbeyond",
      workspaceDir: root,
      config: cfg,
    });
    const acceptResult = await ownerTool.execute("call-accept", {
      action: "accept",
      taskId: assignment.id,
    });

    expect((acceptResult.details as { assignment: { status: string } }).assignment.status).toBe(
      "accepted",
    );
  });

  it("blocks non-coordinator assignment creation", async () => {
    const root = await createWorkspaceRegistry();
    const tool = createOrganizationTasksTool({
      requesterAgentIdOverride: "bot-2",
      agentSessionKey: "agent:bot-2:main:space:upbeyond",
      workspaceDir: root,
      config: { collaboration: { defaults: { workspace: root } }, agents: { defaults: {} } },
    });

    await expect(
      tool.execute("call-denied", {
        action: "create",
        title: "文章质量审核",
        ownerAgentId: "main",
      }),
    ).rejects.toThrow("Only the organization coordinator can create task assignments.");
  });

  it("points non-coordinators in a collaboration group at same-round collab edges", async () => {
    // Real 数字人战队 round 3cc87151: panda was asked to organize peers, hit this refusal
    // twice, then asked the human to change coordinator settings (dead end).
    const root = await createWorkspaceRegistry();
    const tool = createOrganizationTasksTool({
      requesterAgentIdOverride: "bot-2",
      agentSessionKey: "agent:bot-2:main:space:upbeyond",
      workspaceDir: root,
      config: { collaboration: { defaults: { workspace: root } }, agents: { defaults: {} } },
    });

    const error = await tool
      .execute("call-denied-hint", {
        action: "create",
        title: "市场调研分工",
        ownerAgentId: "main",
      })
      .then(
        () => null,
        (err: unknown) => err as Error,
      );
    expect(error?.message).toContain("[[collab_edge:handoff|to=");
    expect(error?.message).toContain("[[collab_edge:peer_ask|to=");
    expect(error?.message).toContain("do not ask the user to change coordinator settings");
  });
});
