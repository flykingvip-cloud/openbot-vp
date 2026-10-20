/**
 * Session store unify: list + restore must share one session identity store.
 * Regression for "恢复失败: checkpoint not found for this session" when
 * chat.checkpoints.list used process-global loadSessionEntry while chat.restore
 * used tenant loadSessionEntryForClient (checkpointMatchesSession missed).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sessionKey: "agent:panda:main",
  agentId: "panda",
  workspaceDir: "",
  /** Process-global store session id (wrong for this conversation after split-brain). */
  globalSessionId: "sess-global",
  /** Conversation-store session id — the one commits and restore must use. */
  tenantSessionId: "sess-tenant",
  /** Alternate tenant/user/bot must not see this conversation's checkpoints. */
  otherTenantSessionId: "sess-other-tenant",
  loadCalls: [] as Array<{ via: "global" | "client"; key: string }>,
}));

vi.mock("./session-utils.js", () => ({
  loadSessionEntry: (key: string) => {
    state.loadCalls.push({ via: "global", key });
    return {
      cfg: {},
      storePath: "/tmp/global-sessions.json",
      entry: {
        sessionId: state.globalSessionId,
        sessionFile: `/tmp/${state.globalSessionId}.jsonl`,
      },
      canonicalKey: key,
    };
  },
}));

vi.mock("./tenant-context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./tenant-context.js")>();
  return {
    ...original,
    loadSessionEntryForClient: async (key: string, _client: unknown, cfg?: unknown) => {
      state.loadCalls.push({ via: "client", key });
      return {
        cfg: (cfg as object) ?? {},
        storePath: "/tmp/tenant-sessions.json",
        store: {},
        entry: {
          sessionId: state.tenantSessionId,
          sessionFile: `/tmp/${state.tenantSessionId}.jsonl`,
        },
        canonicalKey: key,
        legacyKey: undefined,
        resolveAgentStorePath: (agentId: string) => `/tmp/tenant/${agentId}/sessions.json`,
      };
    },
    resolveAgentWorkspaceDirForClient: async () => {
      throw new Error("unused");
    },
  };
});

vi.mock("../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: () => state.workspaceDir,
  resolveSessionAgentId: () => state.agentId,
}));

vi.mock("./tenant-store-paths.js", () => ({
  resolveTenantsRoot: () => path.join(state.workspaceDir, "tenants"),
}));

vi.mock("../agents/builtin-steward/employee-isolation.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../agents/builtin-steward/employee-isolation.js")>();
  return {
    ...actual,
    extractEmployeeStewardUserIdFromSessionKey: () => null,
    resolveEmployeeBuiltinStewardWorkspaceDir: () => null,
  };
});

vi.mock("../agents/builtin-steward/identity.js", () => ({
  isBuiltinStewardAgent: () => false,
}));

vi.mock("./workspace-resolver/write-roots.js", () => ({
  resolveRobotOwnWriteRoot: () => null,
  resolveRobotWriteRoot: () => null,
  tryResolveLiveRobotWriteRoot: () => null,
}));

vi.mock("./workspace/handler-bridge.js", () => ({
  resolveAuthorizedToolCwd: async () => null,
  resolveWorkspaceDirAfterAuthorization: () => null,
}));

vi.mock("./workspace-resolver/strict-locator.js", () => ({
  resolveWorkspaceLocator: () => {
    if (!state.workspaceDir) {
      return { ok: false as const, error: { code: "denied", message: "unused" } };
    }
    return {
      ok: true as const,
      handle: {
        resourceId: "fixture",
        agentAssetId: "fixture",
        bindingId: "fixture",
        locator: state.workspaceDir,
        tenantId: "001",
      },
      locator: {
        resourceId: "fixture",
        agentAssetId: "fixture",
        bindingId: "fixture",
        locator: state.workspaceDir,
        tenantId: "001",
      },
    };
  },
}));

// Keep real session-continuity matching (checkpointMatchesSession).
const { listChatCheckpoints, loadChatCheckpointForRestore } = await import("./checkpoint-store.js");

async function writeCheckpoint(params: {
  id: string;
  sessionId: string;
  sessionKey: string;
  createdAt?: string;
}) {
  const dir = path.join(state.workspaceDir, "memory", "checkpoints");
  await fs.mkdir(dir, { recursive: true });
  const createdAt = params.createdAt ?? "2026-10-03T12:00:00.000Z";
  const checkpoint = {
    id: params.id,
    scope: "agent",
    owner_id: state.agentId,
    session_id: params.sessionId,
    session_key: params.sessionKey,
    created_at: createdAt,
    summary: "stable",
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
    path.join(dir, `${createdAt.replaceAll(":", "-")}-${params.id}.json`),
    `${JSON.stringify(checkpoint, null, 2)}\n`,
    "utf8",
  );
  return checkpoint;
}

describe("checkpoint list/restore share one session store", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    state.loadCalls = [];
    for (const dir of dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("lists and restores the conversation-store checkpoint (shared list/restore identity)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-store-unify-"));
    dirs.push(root);
    state.workspaceDir = root;
    // Checkpoint was committed with the tenant store session id (chat.send path).
    await writeCheckpoint({
      id: "checkpoint_tenant_line",
      sessionId: state.tenantSessionId,
      sessionKey: state.sessionKey,
    });
    // A decoy checkpoint for the process-global session id must not be required for restore.
    await writeCheckpoint({
      id: "checkpoint_global_decoy",
      sessionId: state.globalSessionId,
      sessionKey: "agent:other:main",
      createdAt: "2026-10-03T11:00:00.000Z",
    });

    const client = { sessionEnterpriseId: "001", platformUserId: "user-a" };
    const listed = await listChatCheckpoints(state.sessionKey, client as never);
    expect(listed.map((row) => row.checkpointId)).toEqual(["checkpoint_tenant_line"]);
    expect(state.loadCalls.some((c) => c.via === "client")).toBe(true);
    // Must not fall back to process-global session identity for matching.
    expect(state.loadCalls.every((c) => c.via === "client")).toBe(true);

    const located = await loadChatCheckpointForRestore({
      cfg: {} as never,
      sessionKey: state.sessionKey,
      agentId: state.agentId,
      client: client as never,
      sessionEntry: {
        sessionId: state.tenantSessionId,
        sessionFile: `/tmp/${state.tenantSessionId}.jsonl`,
      } as never,
      checkpointId: "checkpoint_tenant_line",
      primaryWorkspaceDir: state.workspaceDir,
    });
    expect(located?.checkpoint.id).toBe("checkpoint_tenant_line");
    expect(located?.workspaceDir).toBe(state.workspaceDir);
  });

  it("does not load the global steward alias after the session key was remapped", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-store-steward-"));
    dirs.push(root);
    state.workspaceDir = root;
    const client = { sessionEnterpriseId: "001", platformUserId: "user-a" };
    const employeeKey = "agent:main:employee:user-a";
    await listChatCheckpoints(employeeKey, client as never, "main");
    await loadChatCheckpointForRestore({
      cfg: {} as never,
      sessionKey: employeeKey,
      rawSessionKey: "agent:main",
      agentId: "main",
      client: client as never,
      sessionEntry: {
        sessionId: state.tenantSessionId,
        sessionFile: `/tmp/${state.tenantSessionId}.jsonl`,
      } as never,
      checkpointId: "checkpoint_missing",
      primaryWorkspaceDir: state.workspaceDir,
    });
    const keys = state.loadCalls.map((call) => call.key);
    expect(keys).toContain(employeeKey);
    expect(keys).not.toContain("main");
    expect(keys).not.toContain("agent:main");
  });

  it("does not restore another tenant/user/bot session's checkpoint id", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-store-iso-"));
    dirs.push(root);
    state.workspaceDir = root;
    await writeCheckpoint({
      id: "checkpoint_foreign",
      sessionId: state.otherTenantSessionId,
      sessionKey: "agent:panda:employee:other-user",
    });

    const client = { sessionEnterpriseId: "001", platformUserId: "user-a" };
    const listed = await listChatCheckpoints(state.sessionKey, client as never);
    expect(listed.map((row) => row.checkpointId)).not.toContain("checkpoint_foreign");

    const located = await loadChatCheckpointForRestore({
      cfg: {} as never,
      sessionKey: state.sessionKey,
      agentId: state.agentId,
      client: client as never,
      sessionEntry: {
        sessionId: state.tenantSessionId,
        sessionFile: `/tmp/${state.tenantSessionId}.jsonl`,
      } as never,
      checkpointId: "checkpoint_foreign",
      primaryWorkspaceDir: state.workspaceDir,
    });
    expect(located).toBeNull();
  });

  it("reproduces the restore miss when session identity is taken from the global store", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cp-store-miss-"));
    dirs.push(root);
    state.workspaceDir = root;
    // Same shape as production split-brain: checkpoint bound to tenant session id,
    // while a global-only entry would advertise a different sessionId.
    await writeCheckpoint({
      id: "checkpoint_listed_then_miss",
      sessionId: state.tenantSessionId,
      // Key form differs from the remapped restore key so session_key alone
      // cannot rescue a wrong sessionId (the historical miss shape).
      sessionKey: "agent:panda:employee:user-a",
    });

    const { loadSessionContinuityCheckpointById, listSessionContinuityCheckpoints } =
      await import("../auto-reply/reply/session-continuity.js");

    const listedViaGlobal = await listSessionContinuityCheckpoints({
      cfg: {} as never,
      workspaceDir: state.workspaceDir,
      agentId: state.agentId,
      sessionKey: state.sessionKey,
      sessionEntry: { sessionId: state.globalSessionId, updatedAt: Date.now() },
    });
    // Global sessionId does not match; remapped key also differs from cp.session_key.
    expect(listedViaGlobal.map((r) => r.checkpointId)).not.toContain("checkpoint_listed_then_miss");

    const listedViaTenant = await listSessionContinuityCheckpoints({
      cfg: {} as never,
      workspaceDir: state.workspaceDir,
      agentId: state.agentId,
      sessionKey: state.sessionKey,
      sessionEntry: { sessionId: state.tenantSessionId, updatedAt: Date.now() },
    });
    // Tenant sessionId matches → UI would list this checkpoint.
    expect(listedViaTenant.map((r) => r.checkpointId)).toContain("checkpoint_listed_then_miss");

    const missViaGlobal = await loadSessionContinuityCheckpointById({
      cfg: {} as never,
      workspaceDir: state.workspaceDir,
      agentId: state.agentId,
      sessionKey: state.sessionKey,
      sessionEntry: { sessionId: state.globalSessionId, updatedAt: Date.now() },
      checkpointId: "checkpoint_listed_then_miss",
    });
    expect(missViaGlobal).toBeUndefined();

    const hitViaTenant = await loadSessionContinuityCheckpointById({
      cfg: {} as never,
      workspaceDir: state.workspaceDir,
      agentId: state.agentId,
      sessionKey: state.sessionKey,
      sessionEntry: { sessionId: state.tenantSessionId, updatedAt: Date.now() },
      checkpointId: "checkpoint_listed_then_miss",
    });
    expect(hitViaTenant?.id).toBe("checkpoint_listed_then_miss");
  });
});
