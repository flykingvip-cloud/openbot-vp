// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpRoot, tenantsRoot } = vi.hoisted(() => {
  const root = `/tmp/openbot-steward-p0e-${Math.random().toString(36).slice(2)}`;
  return { tmpRoot: root, tenantsRoot: `${root}/tenants` };
});

let contextValue: { userId: string | null; tenantId: string | null } = {
  userId: "user-elle",
  tenantId: "tenant-a",
};

vi.mock("../knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => contextValue),
}));

vi.mock("../../agents/builtin-steward/employee-isolation.js", () => ({
  resolveEmployeeBuiltinStewardWorkspaceDir: (userId: string) =>
    path.join(tmpRoot, userId, "workspace"),
  extractEmployeeStewardUserIdFromSessionKey: (sessionKey?: string) => {
    const match = /^agent:main:employee:([^:]+)$/i.exec(sessionKey?.trim() ?? "");
    return match?.[1]?.toLowerCase() ?? null;
  },
}));

vi.mock("../../agents/builtin-steward/identity.js", () => ({
  isBuiltinStewardAgent: (agentId: string) => agentId === "main",
}));

vi.mock("../employee-workbench-scope.js", () => ({
  isPersonalWorkbenchClient: () => false,
  resolveEmployeeWorkbenchActor: vi.fn(async () => null),
  filterAgentsForEmployeeActor: (agents: unknown[]) => agents,
}));

vi.mock("../tenant-context.js", () => ({
  resolveAgentWorkspaceDirForClient: vi.fn(async (_client: unknown, agentId: string) =>
    path.join(tmpRoot, "agents", agentId, "workspace"),
  ),
  resolveTenantContext: vi.fn(async () =>
    contextValue.tenantId && contextValue.userId
      ? { tenantId: contextValue.tenantId, userId: contextValue.userId }
      : null,
  ),
}));

vi.mock("../../config/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/paths.js")>();
  return {
    ...actual,
    resolveStateDir: () => tmpRoot,
  };
});

vi.mock("../tenant-store-paths.js", () => ({
  resolveTenantsRoot: () => tenantsRoot,
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    agents: {
      list: [{ id: "agt-hrqb" }, { id: "main" }],
    },
  }),
}));

vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: () => ({
    agents: [{ id: "agt-hrqb" }, { id: "main" }],
  }),
}));

const { stewardWorkspaceFileHandlers } = await import("./steward-workspace-file.js");

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string };
};

async function invoke(filename: unknown, extra?: Record<string, unknown>): Promise<InvokeResult> {
  let result: InvokeResult = { ok: false };
  const respond = (ok: boolean, payload?: unknown, error?: { message?: string }) => {
    result = { ok, payload: payload as Record<string, unknown>, error };
  };
  const handler = stewardWorkspaceFileHandlers["workbench.steward-file.read"];
  try {
    await handler({
      req: {} as never,
      params: { filename, ...extra } as Record<string, unknown>,
      client: {} as never,
      isWebchatConnect: () => false,
      respond: respond as never,
      context: {} as never,
    });
  } catch (error) {
    return {
      ok: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
  return result;
}

beforeEach(() => {
  contextValue = { userId: "user-elle", tenantId: "tenant-a" };
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpRoot, "user-elle", "workspace"), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, "agents", "main", "workspace"), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, "canvas"), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, "workspace-bot-skill"), { recursive: true });
  fs.mkdirSync(path.join(tenantsRoot, "tenant-a", "users", "user-elle", "OpenBot"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(tenantsRoot, "tenant-b", "users", "user-elle", "OpenBot"), {
    recursive: true,
  });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("P0-e steward-file bypass closure", () => {
  it("does not include canvas or global host-skill roots without grants", async () => {
    fs.writeFileSync(path.join(tmpRoot, "canvas", "report.html"), "<html>canvas</html>");
    fs.writeFileSync(path.join(tmpRoot, "workspace-bot-skill", "skill.md"), "HOST SKILL");
    const canvas = await invoke("report.html", { sessionKey: "agent:main:main" });
    const skill = await invoke("skill.md", { sessionKey: "agent:main:main" });
    expect(canvas.ok).toBe(false);
    expect(skill.ok).toBe(false);
  });

  it("returns no sibling roots without an authoritative tenantId", async () => {
    const homeDir = path.join(
      tenantsRoot,
      "tenant-a",
      "users",
      "user-elle",
      "OpenBot",
      "workspace",
    );
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(path.join(homeDir, "shared-name.md"), "HOME OK");

    contextValue = { userId: "user-elle", tenantId: null };
    expect((await invoke("shared-name.md", { sessionKey: "agent:main:main" })).ok).toBe(false);

    contextValue = { userId: "user-elle", tenantId: "personal-local" };
    expect((await invoke("shared-name.md", { sessionKey: "agent:main:main" })).ok).toBe(false);
  });

  it("does not open a same-filename file from another tenant", async () => {
    const foreignDir = path.join(
      tenantsRoot,
      "tenant-b",
      "users",
      "user-elle",
      "OpenBot",
      "workspace",
    );
    fs.mkdirSync(foreignDir, { recursive: true });
    fs.writeFileSync(path.join(foreignDir, "shared-name.md"), "FOREIGN SECRET");

    const res = await invoke("shared-name.md", { sessionKey: "agent:main:main" });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toMatch(/not found|not synced for preview|missing_tenant_context/i);
  });

  it("merges leftover L2 workspace into the robot own space", async () => {
    const leftover = path.join(
      tenantsRoot,
      "tenant-a",
      "users",
      "user-elle",
      "OpenBot",
      "workspace",
    );
    fs.mkdirSync(leftover, { recursive: true });
    fs.writeFileSync(path.join(leftover, "shared-name.md"), "HOME OK");

    const res = await invoke("shared-name.md", { sessionKey: "agent:main:main" });
    expect(res.ok).toBe(true);
    expect(Buffer.from(String(res.payload?.base64), "base64").toString("utf8")).toBe("HOME OK");
  });

  it("does not open a non-legacy sibling folder next to the robot own space", async () => {
    const scratch = path.join(tenantsRoot, "tenant-a", "users", "user-elle", "OpenBot", "scratch");
    fs.mkdirSync(scratch, { recursive: true });
    fs.writeFileSync(path.join(scratch, "shared-name.md"), "SCRATCH SECRET");

    const res = await invoke("shared-name.md", { sessionKey: "agent:main:main" });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toMatch(/not found|not synced for preview|missing_tenant_context/i);
  });

  it("does not open a canvas-hosted file by bare filename", async () => {
    // Even if a canvas file exists under stateDir/canvas, steward-file must not scan it.
    const canvasDir = path.join(tmpRoot, "canvas");
    fs.writeFileSync(path.join(canvasDir, "report.html"), "<html>canvas</html>");
    const res = await invoke("report.html", { sessionKey: "agent:main:main" });
    expect(res.ok).toBe(false);
  });
});
