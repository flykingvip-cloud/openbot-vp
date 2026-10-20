import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createOrganizationMemoryTool } from "./organization-memory-tool.js";

async function createWorkspaceRegistry() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-org-memory-tool-"));
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

describe("organization_memory tool", () => {
  it("records artifact ownership with organization and task ids", async () => {
    const root = await createWorkspaceRegistry();
    const tool = createOrganizationMemoryTool({
      requesterAgentIdOverride: "bot-2",
      agentSessionKey: "agent:bot-2:main:space:upbeyond",
      workspaceDir: root,
      config: { collaboration: { defaults: { workspace: root } }, agents: { defaults: {} } },
    });

    const result = await tool.execute("call-artifact", {
      action: "record_artifact",
      title: "AI热点选题清单",
      artifactType: "doc",
      taskId: "task-1",
      uri: "memory://artifact/ai-topics",
    });

    expect(result.details).toMatchObject({
      status: "ok",
      artifact: {
        organizationId: "upbeyond",
        ownerAgentId: "bot-2",
        taskId: "task-1",
      },
      ownership: {
        organizationId: "upbeyond",
        subjectType: "artifact",
        ownerAgentId: "bot-2",
        taskId: "task-1",
      },
    });
  });

  it("blocks non-coordinator decision records", async () => {
    const root = await createWorkspaceRegistry();
    const tool = createOrganizationMemoryTool({
      requesterAgentIdOverride: "bot-2",
      agentSessionKey: "agent:bot-2:main:space:upbeyond",
      workspaceDir: root,
      config: { collaboration: { defaults: { workspace: root } }, agents: { defaults: {} } },
    });

    await expect(
      tool.execute("call-decision", {
        action: "record_decision",
        title: "采用公众号AI运营项目锚点",
      }),
    ).rejects.toThrow("Only the organization coordinator can record this item.");
  });
});
