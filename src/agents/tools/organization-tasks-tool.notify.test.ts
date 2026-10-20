import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createOrganizationTasksTool } from "./organization-tasks-tool.js";

const callGatewayMock = vi.hoisted(() => vi.fn());

vi.mock("../../gateway/call.js", () => ({
  callGateway: (...args: unknown[]) => callGatewayMock(...args),
}));

async function createWorkspaceRegistry() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-org-tasks-notify-"));
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

describe("organization_tasks notification delivery", () => {
  it("can notify the owner agent after creating an assignment", async () => {
    callGatewayMock.mockResolvedValueOnce({ runId: "run-1" });
    const root = await createWorkspaceRegistry();
    const tool = createOrganizationTasksTool({
      requesterAgentIdOverride: "main",
      agentSessionKey: "agent:main:main:space:upbeyond",
      workspaceDir: root,
      config: { collaboration: { defaults: { workspace: root } }, agents: { defaults: {} } },
    });

    const result = await tool.execute("call-create-notify", {
      action: "create",
      title: "文章质量审核",
      ownerAgentId: "bot-2",
      notify: true,
    });

    expect(result.details).toMatchObject({
      status: "ok",
      delivery: {
        status: "accepted",
        runId: "run-1",
        targetSessionKey: "agent:bot-2:org:upbeyond",
      },
    });
  });
});
