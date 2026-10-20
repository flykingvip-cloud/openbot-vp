import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleGatewayRequest } from "../server-methods.js";
import {
  listPatternCandidates,
  resetPatternDetectionStoreForTests,
  structureHashFromText,
} from "./index.js";

const tmpDir = path.join(os.tmpdir(), `openbot-erc-dispatch-${Date.now()}`);

const membershipByEmail = vi.hoisted(() => new Map<string, { tenantId: string; userId: string }>());
const agentOwners = vi.hoisted(() => new Map<string, string[]>());

vi.mock("../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

vi.mock("../tenant-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tenant-context.js")>();
  return {
    ...actual,
    resolveAuthoritativeMembership: async (client: { user?: string } | null) => {
      const email = client?.user?.trim().toLowerCase() ?? "";
      const hit = membershipByEmail.get(email);
      return hit
        ? { tenantId: hit.tenantId, userId: hit.userId }
        : { tenantId: null, userId: null };
    },
  };
});

vi.mock("../agent-tenant.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent-tenant.js")>();
  return {
    ...actual,
    resolveAgentTenant: async (agentId: string) => agentOwners.get(agentId)?.[0] ?? null,
  };
});

vi.mock("../agent-runtime-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent-runtime-store.js")>();
  return {
    ...actual,
    getAgent: (agentId: string) => {
      const owners = agentOwners.get(agentId);
      if (owners?.length) {
        return { runtimeAgentId: agentId, tenantCoverage: owners };
      }
      return actual.getAgent(agentId);
    },
  };
});

function buildClient(scopes: string[], user = "ops-a@acme.com") {
  return {
    user,
    sessionDomain: "enterprise" as const,
    connect: {
      role: "operator",
      scopes,
      client: { id: "openbot-control-ui", version: "1.0.0", platform: "darwin", mode: "ui" },
      minProtocol: 1,
      maxProtocol: 1,
    },
    connId: "conn-dispatch-1",
    clientIp: "127.0.0.1",
  } as Parameters<typeof handleGatewayRequest>[0]["client"];
}

async function dispatch(method: string, params: Record<string, unknown>, scopes: string[]) {
  const respond = vi.fn();
  await handleGatewayRequest({
    req: { type: "req", id: "req-1", method, params },
    respond,
    client: buildClient(scopes),
    isWebchatConnect: () => false,
    context: { logGateway: { warn: vi.fn(), info: vi.fn() } } as never,
  });
  expect(respond).toHaveBeenCalledTimes(1);
  return respond.mock.calls[0] as [boolean, unknown, unknown];
}

describe("evolution-runtime-closure gateway dispatch", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    resetPatternDetectionStoreForTests();
    membershipByEmail.clear();
    agentOwners.clear();
    membershipByEmail.set("ops-a@acme.com", { tenantId: "tenant-a", userId: "user-a" });
    agentOwners.set("agent-a", ["tenant-a"]);
    agentOwners.set("agent-b", ["tenant-a"]);
  });

  it("rejects pattern-detection.approve without operator.approvals at dispatch layer", async () => {
    const [ok, , error] = await dispatch(
      "pattern-detection.approve",
      { candidateId: "pc_missing", agentId: "agent-a" },
      ["operator.write"],
    );
    expect(ok).toBe(false);
    expect((error as { message?: string })?.message).toContain("operator.approvals");
  });

  it("routes pattern-detection.ingest-sample through dispatch with toolsUsed", async () => {
    const inHash = structureHashFromText("# dispatch ingest\n1");
    const outHash = structureHashFromText("# out\n-");
    for (let i = 1; i <= 3; i += 1) {
      const [ok] = await dispatch(
        "pattern-detection.ingest-sample",
        {
          agentId: "agent-a",
          runId: `dispatch-run-${i}`,
          taskId: `dispatch-task-${i}`,
          inputStructureHash: inHash,
          outputStructureHash: outHash,
          toolsUsed: ["notes"],
          success: true,
        },
        ["operator.write"],
      );
      expect(ok).toBe(true);
    }
    const candidate = listPatternCandidates({ agentId: "agent-a", tenantId: "tenant-a" })[0];
    expect(candidate?.contract.toolsRequired).toEqual(["notes"]);
  });

  it("routes evolution-governance.apply-limit through dispatch when scoped", async () => {
    const [ok, payload] = await dispatch(
      "evolution-governance.apply-limit",
      { runtimeAgentId: "agent-a", reason: "dispatch-limit" },
      ["operator.approvals"],
    );
    expect(ok).toBe(true);
    expect((payload as { ok?: boolean })?.ok).toBe(true);
  });
});
