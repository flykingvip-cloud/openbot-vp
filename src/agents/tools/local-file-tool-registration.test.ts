import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExecutionIdentityContext } from "../../gateway/execution-identity-context.js";
import {
  configureLocalFilesRuntime,
  resetLocalFilesRuntime,
  type LocalFilesRuntime,
} from "../../gateway/local-files/runtime.js";
import { NODE_LOCAL_FILES_READONLY_COMMANDS } from "../../infra/node-commands.js";
import { LOCAL_FILES_READONLY_PROFILE } from "../../local-files/types.js";
import {
  createLocalFileToolsIfAvailable,
  resolveLocalFileToolIdentity,
  selectSolePairedLocalFilesNode,
} from "./local-file-tool-registration.js";

const NODE_A = "node-a";
const NODE_B = "node-b";

let runtime: LocalFilesRuntime;

function identity(overrides: Partial<ExecutionIdentityContext> = {}): ExecutionIdentityContext {
  return {
    enterpriseId: "t1",
    platformUserId: "u1",
    agentId: "bot-skill",
    sessionKey: "s1",
    ...overrides,
  };
}

function bindNode(nodeId: string, opts?: { agents?: string[]; userId?: string }) {
  runtime.bindings.put({
    tenantId: "t1",
    userId: opts?.userId ?? "u1",
    nodeId,
    devicePublicKey: `key-${nodeId}`,
    allowedAgentIds: opts?.agents ?? ["bot-skill"],
    capabilityProfile: LOCAL_FILES_READONLY_PROFILE,
    status: "active",
    createdAtMs: Date.now(),
  });
}

beforeEach(() => {
  resetLocalFilesRuntime();
  runtime = configureLocalFilesRuntime({
    bindingPersistence: null,
    node: { invoke: async () => ({ ok: true, payload: {} }) },
    approvals: { requestLocalFileApproval: async () => "deny" },
  });
});

afterEach(() => {
  resetLocalFilesRuntime();
});

describe("turn identity comes from the validated session only", () => {
  it("resolves tenant, user, agent, session and turn", () => {
    const res = resolveLocalFileToolIdentity({
      executionIdentity: identity(),
      runId: "run-1",
      currentMessageId: "msg-1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.identity).toMatchObject({
      tenantId: "t1",
      userId: "u1",
      agentId: "bot-skill",
      sessionKey: "s1",
      turnId: "run-1",
      inboundMessageId: "msg-1",
    });
  });

  it("refuses when any binding field is absent rather than defaulting it", () => {
    const cases: Array<
      [Partial<ExecutionIdentityContext> | undefined, string, string | undefined]
    > = [
      [undefined, "no-execution-identity", "run-1"],
      [{ enterpriseId: undefined }, "no-tenant", "run-1"],
      [{ platformUserId: undefined, user: undefined }, "no-user", "run-1"],
      [{ agentId: undefined }, "no-agent", "run-1"],
      [{ sessionKey: undefined }, "no-session", "run-1"],
      [{}, "no-turn", undefined],
    ];
    for (const [overrides, reason, runId] of cases) {
      const res = resolveLocalFileToolIdentity({
        executionIdentity: overrides === undefined ? undefined : identity(overrides),
        runId,
      });
      expect(res.ok).toBe(false);
      expect(!res.ok && res.reason).toBe(reason);
    }
  });

  it("falls back to the login email only when the platform user id is absent", () => {
    const res = resolveLocalFileToolIdentity({
      executionIdentity: identity({ platformUserId: undefined, user: "someone@example.com" }),
      runId: "run-1",
    });
    expect(res.ok && res.identity.userId).toBe("someone@example.com");
  });

  it("does not take the tenant from a caller-supplied field", () => {
    // Only `enterpriseId` counts, and it is documented as session-pinned. There is
    // no other input on this path that could carry a tenant.
    const res = resolveLocalFileToolIdentity({
      executionIdentity: identity({ enterpriseId: undefined }),
      agentId: "bot-skill",
      sessionKey: "s1",
      runId: "run-1",
    });
    expect(!res.ok && res.reason).toBe("no-tenant");
  });
});

describe("tools are omitted rather than offered-and-failing", () => {
  it("offers nothing when the gateway runtime is absent from this process", () => {
    resetLocalFilesRuntime();
    const tools = createLocalFileToolsIfAvailable({
      executionIdentity: identity(),
      runId: "run-1",
    });
    expect(tools).toEqual([]);
  });

  it("offers nothing without a trusted identity", () => {
    const tools = createLocalFileToolsIfAvailable({ runId: "run-1" });
    expect(tools).toEqual([]);
  });

  it("offers the five tools when runtime and identity are both present", () => {
    bindNode(NODE_A);
    const tools = createLocalFileToolsIfAvailable({
      executionIdentity: identity(),
      runId: "run-1",
    });
    expect(tools.map((t) => t.name).toSorted()).toEqual([
      "local_archive.list",
      "local_archive.read_entry",
      "local_file.list",
      "local_file.read",
      "local_file.stat",
    ]);
  });
});

describe("device selection never guesses (design 4.3)", () => {
  async function resolveDevice(opts?: { agents?: string[] }) {
    const tools = createLocalFileToolsIfAvailable({
      executionIdentity: identity(),
      runId: "run-1",
    });
    // Drive the tool and observe whether it refused before reaching the service.
    const read = tools.find((t) => t.name === "local_file.read");
    const result = await read?.execute?.("call-1", { path: "~/Desktop/a.txt" });
    void opts;
    return (result as { details?: { ok?: boolean } } | undefined)?.details;
  }

  it("refuses when the user has no active binding", async () => {
    const details = await resolveDevice();
    expect(details?.ok).toBe(false);
  });

  it("refuses when the user has several bound devices and has not chosen", async () => {
    bindNode(NODE_A);
    bindNode(NODE_B);
    const details = await resolveDevice();
    // Broadcasting across a person's machines is never correct.
    expect(details?.ok).toBe(false);
  });

  it("refuses when the single binding does not list this digital human", async () => {
    bindNode(NODE_A, { agents: ["bot-other"] });
    const details = await resolveDevice();
    expect(details?.ok).toBe(false);
  });

  it("ignores another user's binding", async () => {
    bindNode(NODE_B, { userId: "someone-else" });
    const details = await resolveDevice();
    expect(details?.ok).toBe(false);
  });
});

describe("one paired computer can be selected for a missing binding", () => {
  it("selects the single node that declared the file commands", () => {
    const mac = {
      nodeId: "mac-1",
      caps: ["system", "local-files"],
      commands: ["system.run", ...NODE_LOCAL_FILES_READONLY_COMMANDS],
      devicePublicKey: "key-mac",
      displayName: "UPBEYOND Mac",
    };
    expect(selectSolePairedLocalFilesNode([mac])?.nodeId).toBe("mac-1");
    expect(
      selectSolePairedLocalFilesNode([mac, { ...mac, nodeId: "mac-2", devicePublicKey: "key-2" }]),
    ).toBeNull();
    expect(
      selectSolePairedLocalFilesNode([
        { nodeId: "shell", caps: ["system"], commands: ["system.run"], devicePublicKey: "k" },
      ]),
    ).toBeNull();
  });
});
