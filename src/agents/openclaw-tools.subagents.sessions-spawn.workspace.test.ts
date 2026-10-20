import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import "./test-helpers/fast-core-tools.js";
import {
  getCallGatewayMock,
  getSessionsSpawnTool,
  resetSessionsSpawnConfigOverride,
  setSessionsSpawnConfigOverride,
} from "./openclaw-tools.subagents.sessions-spawn.test-harness.js";
import { resetSubagentRegistryForTests } from "./subagent-registry.js";

const callGatewayMock = getCallGatewayMock();

// The requester's real agent workspace, which runEmbeddedAttempt hands to sessions_spawn
// even when the requester itself runs in a ro/none sandbox copy (#246).
const REQUESTER_WORKSPACE = path.join(os.tmpdir(), "openbot-spawn-requester-workspace");

type WorkspaceAccess = "none" | "ro" | "rw";

function sandboxed(workspaceAccess: WorkspaceAccess) {
  return { sandbox: { mode: "all" as const, workspaceAccess } };
}

function setAgents(params: { requester?: WorkspaceAccess; research?: WorkspaceAccess }) {
  setSessionsSpawnConfigOverride({
    session: { mainKey: "main", scope: "per-sender" },
    agents: {
      list: [
        {
          id: "main",
          subagents: { allowAgents: ["research"] },
          ...(params.requester ? sandboxed(params.requester) : {}),
        },
        {
          id: "research",
          ...(params.research ? sandboxed(params.research) : {}),
        },
      ],
    },
  });
}

/** Accept the child run and remember the workspace the gateway was asked to run it in. */
function captureChildWorkspace(): () => string | undefined {
  let childWorkspace: string | undefined;
  callGatewayMock.mockImplementation(async (opts: unknown) => {
    const request = opts as { method?: string; params?: { workspaceDir?: string } };
    if (request.method === "agent") {
      childWorkspace = request.params?.workspaceDir;
      return { runId: "run-1", status: "accepted", acceptedAt: 1000 };
    }
    if (request.method === "agent.wait") {
      return { status: "timeout" };
    }
    return {};
  });
  return () => childWorkspace;
}

async function spawnChild(callId: string, agentId?: string) {
  const tool = await getSessionsSpawnTool({
    agentSessionKey: "main",
    agentChannel: "whatsapp",
    // Production (pi-tools) pins the requester agent server-side.
    requesterAgentIdOverride: "main",
    workspaceDir: REQUESTER_WORKSPACE,
  });
  return tool.execute(callId, { task: "do thing", ...(agentId ? { agentId } : {}) });
}

describe("openclaw-tools: subagents (sessions_spawn workspace)", () => {
  beforeEach(() => {
    resetSessionsSpawnConfigOverride();
    resetSubagentRegistryForTests();
    callGatewayMock.mockReset();
  });

  it.each(["none", "ro"] as const)(
    "keeps the requester workspace for a same-agent child of a %s requester",
    async (requester) => {
      setAgents({ requester });
      const childWorkspace = captureChildWorkspace();

      const result = await spawnChild(`call-same-${requester}`);

      expect(result.details).toMatchObject({ status: "accepted" });
      expect(childWorkspace()).toBe(REQUESTER_WORKSPACE);
    },
  );

  // The child applies its own sandbox access to the workspace it inherits, so a target whose
  // sandbox allows more would read or write a workspace the requester's sandbox does not expose.
  it.each([
    ["none", "ro"],
    ["none", "rw"],
    ["ro", "rw"],
  ] as const)(
    "refuses a cross-agent child with broader access (%s requester, %s target)",
    async (requester, research) => {
      setAgents({ requester, research });

      const result = await spawnChild(`call-broader-${requester}-${research}`, "research");

      const details = result.details as { status?: string; error?: string };
      expect(details.status).toBe("forbidden");
      expect(details.error).toContain(`broader workspace access (${requester} -> ${research})`);
      expect(callGatewayMock).not.toHaveBeenCalled();
    },
  );

  it("matches the target agent id case-insensitively", async () => {
    setAgents({ requester: "none", research: "rw" });

    const result = await spawnChild("call-broader-mixed-case", "Research");

    expect(result.details).toMatchObject({ status: "forbidden" });
    expect(callGatewayMock).not.toHaveBeenCalled();
  });

  it.each([
    ["none", "none"],
    ["ro", "ro"],
    ["ro", "none"],
    ["rw", "rw"],
  ] as const)(
    "allows a cross-agent child with equal or narrower access (%s requester, %s target)",
    async (requester, research) => {
      setAgents({ requester, research });
      const childWorkspace = captureChildWorkspace();

      const result = await spawnChild(`call-allowed-${requester}-${research}`, "research");

      expect(result.details).toMatchObject({ status: "accepted" });
      expect(childWorkspace()).toBe(REQUESTER_WORKSPACE);
    },
  );

  it("does not restrict an unsandboxed requester", async () => {
    setAgents({ research: "rw" });
    const childWorkspace = captureChildWorkspace();

    const result = await spawnChild("call-unsandboxed", "research");

    expect(result.details).toMatchObject({ status: "accepted" });
    expect(childWorkspace()).toBe(REQUESTER_WORKSPACE);
  });
});
