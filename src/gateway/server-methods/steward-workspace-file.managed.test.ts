// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpRoot } = vi.hoisted(() => ({
  tmpRoot: `/tmp/openbot-steward-file-managed-${Math.random().toString(36).slice(2)}`,
}));

const state = vi.hoisted(() => ({
  userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa" as string | null,
  tenantId: "001" as string | null,
}));

vi.mock("../knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => ({
    userId: state.userId,
    tenantId: state.tenantId,
  })),
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

vi.mock("../../config/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/paths.js")>();
  return {
    ...actual,
    resolveStateDir: () => tmpRoot,
  };
});

vi.mock("../security-profile.js", () => ({
  resolveSecurityProfile: () => ({
    ok: true,
    profile: "managed_enterprise",
    isolationLevel: "I3",
    source: "env",
    tenantExecutionBoundary: "dedicated",
    errors: [],
  }),
}));

vi.mock("../tenant-context.js", () => ({
  resolveAgentWorkspaceDirForClient: vi.fn(async (_client: unknown, agentId: string) =>
    path.join(tmpRoot, "agents", agentId, "workspace"),
  ),
  resolveTenantContext: vi.fn(async () =>
    state.tenantId && state.userId ? { tenantId: state.tenantId, userId: state.userId } : null,
  ),
  resolveTenantContextForSessionStore: vi.fn(async () =>
    state.tenantId && state.userId ? { tenantId: state.tenantId, userId: state.userId } : null,
  ),
}));

const registryState = vi.hoisted(() => ({
  store: {
    version: 1,
    assets: {} as Record<string, unknown>,
    deployments: {},
    revisions: {},
    ownerBindings: {} as Record<string, unknown>,
    quarantine: {},
  },
}));

vi.mock("../agent-registry/store.js", () => ({
  loadAgentRegistryStore: async () => registryState.store,
}));

vi.mock("../../config/data-space.js", () => ({
  isSharedTenantAddressingEnabled: () => true,
  resolveDataMode: () => "shared",
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    agents: {
      list: [
        { id: "agt-hrqb", workspace: path.join(tmpRoot, "agents", "agt-hrqb", "workspace") },
        { id: "main", workspace: path.join(tmpRoot, "agents", "main", "workspace") },
        { id: "bot-skill", workspace: path.join(tmpRoot, "agents", "bot-skill", "workspace") },
      ],
    },
  }),
}));

vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: () => ({
    agents: [{ id: "agt-hrqb" }, { id: "main" }, { id: "bot-skill" }],
  }),
}));

const { stewardWorkspaceFileHandlers } = await import("./steward-workspace-file.js");
const { upsertWorkspaceGovernanceRecord, resetSharedDataGovernanceCatalogForTests } =
  await import("../data-governance/runtime-catalog.js");

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
  await handler({
    req: {} as never,
    params: { filename, ...extra } as Record<string, unknown>,
    client: { platformUserId: state.userId } as never,
    isWebchatConnect: () => false,
    respond: respond as never,
    context: {} as never,
  });
  return result;
}

function stewardWorkspace(): string {
  return path.join(
    tmpRoot,
    "tenants",
    "001",
    "users",
    "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
    "OpenBot",
    "agents",
    "main",
    "workspace",
  );
}

async function seedCanonicalWorkspace(params: {
  resourceId: string;
  locator: string;
  agentAssetId: string;
}): Promise<void> {
  const userId = state.userId ?? "";
  await upsertWorkspaceGovernanceRecord({
    resourceId: params.resourceId,
    tenantId: state.tenantId,
    ownerScope: {
      kind: "user_owned",
      userId,
      agentAssetId: params.agentAssetId,
      proof: {
        source: "explicit_binding",
        ownerType: "user",
        ownerId: userId,
        agentAssetId: params.agentAssetId,
      },
    },
    locator: params.locator,
    classification: "agent_workspace",
    stateDir: tmpRoot,
  });
}

beforeEach(async () => {
  state.userId = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";
  state.tenantId = "001";
  process.env.OPENBOT_STATE_DIR = tmpRoot;
  registryState.store.assets = {};
  registryState.store.ownerBindings = {};
  resetSharedDataGovernanceCatalogForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(stewardWorkspace(), { recursive: true });
  await seedCanonicalWorkspace({
    resourceId: `ws:001:user:${state.userId}:steward`,
    locator: stewardWorkspace(),
    agentAssetId: "steward:builtin",
  });
});

afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("workbench.steward-file.read managed steward session", () => {
  it("opens a PDF when the UI sends the builtin steward sessionKey", async () => {
    const pdf = Buffer.from("%PDF-1.4 steward preview");
    fs.writeFileSync(path.join(stewardWorkspace(), "OpenBot_高质量投资介绍.pdf"), pdf);
    const res = await invoke("OpenBot_高质量投资介绍.pdf", {
      sessionKey: `agent:main:employee:${state.userId}`,
    });
    expect(res.ok).toBe(true);
    expect(res.payload?.filename).toBe("OpenBot_高质量投资介绍.pdf");
    expect(res.payload?.mimeType).toBe("application/pdf");
    expect(Buffer.from(String(res.payload?.base64), "base64")).toEqual(pdf);
  });

  it("does not report builtin_steward_exception_required for agent:main:main", async () => {
    fs.writeFileSync(path.join(stewardWorkspace(), "notes.md"), "# ok");
    const res = await invoke("notes.md", { sessionKey: "agent:main:main" });
    expect(res.ok).toBe(true);
    expect(String(res.error?.message ?? "")).not.toContain("builtin_steward_exception_required");
  });

  it("opens a nested memory markdown file from the bot-skill canonical workspace", async () => {
    const skillWorkspace = path.join(
      tmpRoot,
      "tenants",
      "001",
      "users",
      "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
      "OpenBot",
      "agents",
      "bot-skill",
      "workspace",
    );
    fs.mkdirSync(path.join(skillWorkspace, "memory"), { recursive: true });
    fs.writeFileSync(path.join(skillWorkspace, "memory", "2026-08-15.md"), "# Skill memory\n");
    registryState.store.assets["bot-skill"] = {
      agentAssetId: "bot-skill",
      enterpriseId: "001",
      agentSlug: "skill-alias",
      legacyAgentId: "bot-skill",
      displayName: "Skill Bot",
      status: "active",
      createdAt: "now",
      updatedAt: "now",
    };
    registryState.store.ownerBindings["bot-skill-owner"] = {
      bindingId: "bot-skill-owner",
      enterpriseId: "001",
      agentAssetId: "bot-skill",
      ownerType: "membership",
      ownerId: state.userId,
      isPrimary: true,
      effectiveAt: "now",
    };
    await seedCanonicalWorkspace({
      resourceId: `ws:001:user:${state.userId}:asset:bot-skill`,
      locator: skillWorkspace,
      agentAssetId: "bot-skill",
    });
    const res = await invoke("memory/2026-08-15.md", { sessionKey: "agent:bot-skill:main" });
    expect(res.ok).toBe(true);
    expect(String(res.error?.message ?? "")).not.toContain("agent_id_unmapped");
    expect(res.payload?.filename).toBe("2026-08-15.md");
    expect(res.payload?.relativePath).toBe("memory/2026-08-15.md");
    expect(res.payload?.textLike).toBe(true);
    expect(Buffer.from(String(res.payload?.base64), "base64").toString("utf8")).toBe(
      "# Skill memory\n",
    );
  });

  it("fail-closes when a session agent has no canonical workspace binding", async () => {
    const res = await invoke("notes.md", { sessionKey: "agent:ghost-bot:main" });
    expect(res.ok).toBe(false);
    expect(String(res.error?.message ?? "")).toContain("workspace_binding_required");
  });
});
