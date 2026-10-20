import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayClient } from "./server-methods/types.js";

const state = vi.hoisted(() => ({
  sessionKey: "agent:main:employee:user-elle",
  agentId: "main",
  tenantWorkspace: "",
  hostWorkspace: "",
  tenantsRoot: "",
  tenantId: "workspace-7" as string | null,
  loadedSessionKeys: [] as string[],
}));

vi.mock("./session-utils.js", () => ({
  loadSessionEntry: (key: string) => {
    state.loadedSessionKeys.push(key);
    return {
      cfg: {},
      storePath: "/tmp/sessions.json",
      entry: { sessionId: "sess-1", sessionFile: "/tmp/sess.jsonl" },
      canonicalKey: state.sessionKey,
    };
  },
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: () => state.hostWorkspace,
  resolveSessionAgentId: () => state.agentId,
}));

vi.mock("./tenant-context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./tenant-context.js")>();
  return {
    ...original,
    resolveAgentWorkspaceDirForClient: async () => {
      throw new Error("no client workspace override");
    },
  };
});

vi.mock("./tenant-store-paths.js", () => ({
  resolveTenantsRoot: () => state.tenantsRoot,
}));

vi.mock("../agents/builtin-steward/employee-isolation.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../agents/builtin-steward/employee-isolation.js")>();
  return {
    ...actual,
    extractEmployeeStewardUserIdFromSessionKey: (sessionKey: string) =>
      sessionKey.includes("employee:user-elle") ? "user-elle" : null,
    resolveEmployeeBuiltinStewardWorkspaceDir: () =>
      path.join(state.hostWorkspace, "employees-unused"),
  };
});

vi.mock("../agents/builtin-steward/identity.js", () => ({
  isBuiltinStewardAgent: (agentId: string) => agentId === "main",
}));

vi.mock("./workspace-resolver/write-roots.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workspace-resolver/write-roots.js")>();
  return {
    ...actual,
    resolveRobotWriteRoot: (params: {
      agentId: string;
      tenantId?: string | null;
      userId?: string | null;
      sessionKey?: string | null;
    }) => {
      const tenantId = params.tenantId?.trim() || state.tenantId;
      const userId =
        params.userId?.trim() ||
        (params.sessionKey?.includes("employee:user-elle") ? "user-elle" : "");
      if (!tenantId || !userId || !state.tenantsRoot) {
        return null;
      }
      return actual.resolveRobotOwnWriteRoot({
        stateDir: path.dirname(state.tenantsRoot),
        tenantId,
        userId,
        agentId: params.agentId,
      });
    },
  };
});

vi.mock("../auto-reply/reply/session-continuity.js", async () => {
  const nodeFs = await import("node:fs/promises");
  const nodePath = await import("node:path");
  return {
    listSessionContinuityCheckpoints: async (params: { workspaceDir: string }) => {
      const dir = nodePath.join(params.workspaceDir, "memory", "checkpoints");
      try {
        const names = await nodeFs.readdir(dir);
        const rows = [];
        for (const name of names) {
          if (!name.endsWith(".json")) {
            continue;
          }
          const raw = JSON.parse(await nodeFs.readFile(nodePath.join(dir, name), "utf8")) as {
            id: string;
            created_at: string;
            boundary_message_id?: string;
            summary?: string;
          };
          rows.push({
            checkpointId: raw.id,
            createdAt: raw.created_at,
            boundaryMessageId: raw.boundary_message_id,
            summary: raw.summary,
          });
        }
        return rows;
      } catch {
        return [];
      }
    },
  };
});

const {
  listChatCheckpoints,
  readTrustedTenantIdFromGatewayClient,
  resolveTenantUserOpenBotWorkspaceCandidates,
  resolveTenantOpenBotAgentWorkspaceCandidates,
} = await import("./checkpoint-store.js");

describe("listChatCheckpoints workspace roots", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    state.sessionKey = "agent:main:employee:user-elle";
    state.agentId = "main";
    state.tenantId = "workspace-7";
    state.loadedSessionKeys = [];
  });

  it("does not load the global steward alias after the employee key is remapped", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-list-steward-"));
    dirs.push(root);
    state.tenantsRoot = path.join(root, "tenants");
    state.hostWorkspace = path.join(root, "host-workspace");
    state.loadedSessionKeys = [];
    await listChatCheckpoints(
      "agent:main:employee:user-elle",
      {
        sessionEnterpriseId: "workspace-7",
        platformUserId: "user-elle",
      } as never,
      "agent:main:main",
    );
    expect(state.loadedSessionKeys).toContain("agent:main:employee:user-elle");
    expect(state.loadedSessionKeys).not.toContain("agent:main:main");
    expect(state.loadedSessionKeys).not.toContain("main");
  });

  it("finds checkpoints under the authoritative tenant workspace with client context", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-list-"));
    dirs.push(root);
    state.tenantsRoot = path.join(root, "tenants");
    state.hostWorkspace = path.join(root, "host-workspace");
    state.tenantId = "workspace-7";
    state.tenantWorkspace = path.join(
      state.tenantsRoot,
      "workspace-7",
      "users",
      "user-elle",
      "OpenBot",
      "agents",
      "main",
      "workspace",
    );
    // Decoy tenant that must not be scanned.
    const decoy = path.join(
      state.tenantsRoot,
      "other-tenant",
      "users",
      "user-elle",
      "OpenBot",
      "agents",
      "main",
      "workspace",
    );
    await fs.mkdir(path.join(state.tenantWorkspace, "memory", "checkpoints"), { recursive: true });
    await fs.mkdir(path.join(decoy, "memory", "checkpoints"), { recursive: true });
    await fs.mkdir(path.join(state.hostWorkspace, "memory", "checkpoints"), { recursive: true });

    const checkpoint = {
      id: "checkpoint_tenant1",
      scope: "agent",
      owner_id: "main",
      session_id: "sess-1",
      session_key: state.sessionKey,
      created_at: "2026-08-04T01:00:00.000Z",
      summary: "tenant cp",
      decisions: [],
      preferences: [],
      open_tasks: [],
      completed_tasks: [],
      artifacts: [],
      evidence_refs: [],
      boundary_message_id: "m1",
      restorable: { files: true, transcript: true },
      external_effects: { present: false, kinds: [] },
      snapshot: { store: "none" },
    };
    await fs.writeFile(
      path.join(
        state.tenantWorkspace,
        "memory",
        "checkpoints",
        `2026-08-04T01-00-00.000Z-${checkpoint.id}.json`,
      ),
      `${JSON.stringify(checkpoint, null, 2)}\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(decoy, "memory", "checkpoints", "2026-08-04T01-00-00.000Z-decoy.json"),
      `${JSON.stringify({ ...checkpoint, id: "decoy" }, null, 2)}\n`,
      "utf8",
    );

    const listed = await listChatCheckpoints(state.sessionKey, {
      sessionEnterpriseId: state.tenantId,
      platformUserId: "user-elle",
    } as never);
    expect(listed.map((row) => row.checkpointId)).toEqual(["checkpoint_tenant1"]);
    expect(listed[0]?.boundaryMessageId).toBe("m1");
  });

  it("finds checkpoints when client only carries sessionEnterpriseId (web workbench)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-list-enterprise-id-"));
    dirs.push(root);
    state.tenantsRoot = path.join(root, "tenants");
    state.hostWorkspace = path.join(root, "host-workspace");
    state.tenantId = "001";
    state.sessionKey = "agent:main:main";
    state.tenantWorkspace = path.join(
      state.tenantsRoot,
      "001",
      "users",
      "90fed19a",
      "OpenBot",
      "agents",
      "main",
      "workspace",
    );
    await fs.mkdir(path.join(state.tenantWorkspace, "memory", "checkpoints"), { recursive: true });
    await fs.writeFile(
      path.join(
        state.tenantWorkspace,
        "memory",
        "checkpoints",
        "2026-08-21T00-00-00.000Z-checkpoint_main.json",
      ),
      `${JSON.stringify(
        {
          id: "checkpoint_main",
          scope: "agent",
          owner_id: "main",
          session_id: "sess-main",
          session_key: state.sessionKey,
          created_at: "2026-08-21T00:00:00.000Z",
          summary: "main cp",
          decisions: [],
          preferences: [],
          open_tasks: [],
          completed_tasks: [],
          artifacts: [],
          evidence_refs: [],
          boundary_message_id: "m574",
          restorable: { files: true, transcript: true },
          external_effects: { present: false, kinds: [] },
          snapshot: { store: "none" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const listed = await listChatCheckpoints(state.sessionKey, {
      sessionEnterpriseId: "001",
      platformUserId: "90fed19a",
    } as never);
    expect(listed.map((row) => row.checkpointId)).toEqual(["checkpoint_main"]);
  });

  it("does not enumerate all tenants when trusted tenant context is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-list-no-tenant-"));
    dirs.push(root);
    state.tenantsRoot = path.join(root, "tenants");
    state.hostWorkspace = path.join(root, "host-workspace");
    state.tenantId = null;
    state.tenantWorkspace = path.join(
      state.tenantsRoot,
      "workspace-7",
      "users",
      "user-elle",
      "OpenBot",
      "agents",
      "main",
      "workspace",
    );
    await fs.mkdir(path.join(state.tenantWorkspace, "memory", "checkpoints"), { recursive: true });
    await fs.mkdir(path.join(state.hostWorkspace, "memory", "checkpoints"), { recursive: true });
    await fs.writeFile(
      path.join(
        state.tenantWorkspace,
        "memory",
        "checkpoints",
        "2026-08-04T01-00-00.000Z-checkpoint_hidden.json",
      ),
      `${JSON.stringify(
        {
          id: "checkpoint_hidden",
          scope: "agent",
          owner_id: "main",
          session_id: "sess-1",
          session_key: state.sessionKey,
          created_at: "2026-08-04T01:00:00.000Z",
          summary: "hidden",
          decisions: [],
          preferences: [],
          open_tasks: [],
          completed_tasks: [],
          artifacts: [],
          evidence_refs: [],
          boundary_message_id: "h1",
          restorable: { files: true, transcript: true },
          external_effects: { present: false, kinds: [] },
          snapshot: { store: "none" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const listed = await listChatCheckpoints(state.sessionKey, null);
    expect(listed.map((row) => row.checkpointId)).not.toContain("checkpoint_hidden");
  });

  it("finds robot checkpoints under the authoritative tenant+owner path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-list-robot-"));
    dirs.push(root);
    state.sessionKey = "agent:panda:employee:user-elle";
    state.agentId = "panda";
    state.tenantId = "001";
    state.tenantsRoot = path.join(root, "tenants");
    state.hostWorkspace = path.join(root, "host-workspace-panda");
    state.tenantWorkspace = path.join(
      state.tenantsRoot,
      "001",
      "users",
      "user-elle",
      "OpenBot",
      "agents",
      "panda",
      "workspace",
    );
    await fs.mkdir(path.join(state.tenantWorkspace, "memory", "checkpoints"), { recursive: true });
    await fs.mkdir(path.join(state.hostWorkspace, "memory", "checkpoints"), { recursive: true });

    const checkpoint = {
      id: "checkpoint_panda1",
      scope: "agent",
      owner_id: "panda",
      session_id: "sess-1",
      session_key: state.sessionKey,
      created_at: "2026-08-04T02:00:00.000Z",
      summary: "panda cp",
      decisions: [],
      preferences: [],
      open_tasks: [],
      completed_tasks: [],
      artifacts: [],
      evidence_refs: [],
      boundary_message_id: "p1",
      restorable: { files: true, transcript: true },
      external_effects: { present: false, kinds: [] },
      snapshot: { store: "none" },
    };
    await fs.writeFile(
      path.join(
        state.tenantWorkspace,
        "memory",
        "checkpoints",
        `2026-08-04T02-00-00.000Z-${checkpoint.id}.json`,
      ),
      `${JSON.stringify(checkpoint, null, 2)}\n`,
      "utf8",
    );

    const listed = await listChatCheckpoints(state.sessionKey, {
      tenantId: state.tenantId,
    } as never);
    expect(listed.map((row) => row.checkpointId)).toEqual(["checkpoint_panda1"]);
    expect(listed[0]?.boundaryMessageId).toBe("p1");
  });
});

describe("readTrustedTenantIdFromGatewayClient", () => {
  it("prefers sessionEnterpriseId over legacy tenantId fields", () => {
    expect(
      readTrustedTenantIdFromGatewayClient({
        connect: {} as never,
        sessionEnterpriseId: "001",
        sessionTenantId: "hint",
        tenantId: "legacy",
      } as GatewayClient),
    ).toBe("001");
  });
});

describe("tenant workspace candidate helpers (P0-e)", () => {
  it("requires tenantId and never needs all-tenant readdir", () => {
    expect(resolveTenantUserOpenBotWorkspaceCandidates("user-elle", null)).toEqual([]);
    expect(resolveTenantOpenBotAgentWorkspaceCandidates("panda", null, "user-elle")).toEqual([]);
    expect(resolveTenantOpenBotAgentWorkspaceCandidates("panda", "t1", null)).toEqual([]);
  });
});
