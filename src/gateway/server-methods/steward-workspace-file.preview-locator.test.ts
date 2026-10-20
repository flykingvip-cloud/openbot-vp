// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tmpRoot } = vi.hoisted(() => ({
  tmpRoot: `/tmp/openbot-steward-preview-locator-${Math.random().toString(36).slice(2)}`,
}));

const resolveTrustedAgentLocatorMock = vi.hoisted(() => vi.fn());

vi.mock("../knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => ({
    userId: "user-elle",
    tenantId: "001",
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

vi.mock("../tenant-context.js", () => ({
  resolveAgentWorkspaceDirForClient: vi.fn(async () => path.join(tmpRoot, "unused")),
  resolveTenantContext: vi.fn(async () => ({ tenantId: "001", userId: "user-elle" })),
}));

vi.mock("../agent-registry/store.js", () => ({
  loadAgentRegistryStore: async () => ({
    version: 1,
    assets: {},
    deployments: {},
    revisions: {},
    ownerBindings: {},
    quarantine: {},
  }),
}));

vi.mock("../../config/data-space.js", () => ({
  isSharedTenantAddressingEnabled: () => false,
  resolveDataMode: () => "local",
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    agents: {
      list: [
        {
          id: "bot-skill",
          workspace: path.join(tmpRoot, "workspace-bot-skill"),
        },
        {
          id: "main",
          workspace: path.join(tmpRoot, "workspace-repo-checkout"),
        },
      ],
    },
  }),
}));

vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: () => ({
    agents: [{ id: "bot-skill" }, { id: "main" }],
  }),
}));

vi.mock("../workspace/handler-bridge.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../workspace/handler-bridge.js")>();
  return {
    ...orig,
    resolveTrustedAgentLocator: (...args: unknown[]) => resolveTrustedAgentLocatorMock(...args),
  };
});

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
  await handler({
    req: {} as never,
    params: { filename, ...extra } as Record<string, unknown>,
    client: {} as never,
    isWebchatConnect: () => false,
    respond: respond as never,
    context: {} as never,
  });
  return result;
}

function skillWorkspace(): string {
  return path.join(
    tmpRoot,
    "tenants",
    "001",
    "users",
    "user-elle",
    "OpenBot",
    "agents",
    "bot-skill",
    "workspace",
  );
}

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(skillWorkspace(), "deliverables"), { recursive: true });
  resolveTrustedAgentLocatorMock.mockReset();
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("workbench.steward-file.read preview locator fallback", () => {
  it("reads the robot own workspace when Item 7 locator is first_canonical", async () => {
    resolveTrustedAgentLocatorMock.mockRejectedValue(
      new Error("first_canonical_selection_forbidden"),
    );
    const pdf = Buffer.from("%PDF-1.4 candidate-comparison");
    fs.writeFileSync(path.join(skillWorkspace(), "deliverables", "candidate-comparison.pdf"), pdf);

    const res = await invoke("deliverables/candidate-comparison.pdf", {
      sessionKey: "agent:bot-skill:main",
    });

    expect(res.ok).toBe(true);
    expect(res.payload?.filename).toBe("candidate-comparison.pdf");
    expect(res.payload?.relativePath).toBe("deliverables/candidate-comparison.pdf");
    expect(res.payload?.mimeType).toBe("application/pdf");
    expect(Buffer.from(String(res.payload?.base64), "base64")).toEqual(pdf);
  });

  it("reads the robot own workspace when the catalog locator is unplaced", async () => {
    resolveTrustedAgentLocatorMock.mockResolvedValue(
      "unplaced://classified/ws:001:user:elle:asset:bot-skill",
    );
    fs.writeFileSync(path.join(skillWorkspace(), "notes.md"), "# skill notes\n");

    const res = await invoke("notes.md", { sessionKey: "agent:bot-skill:main" });

    expect(res.ok).toBe(true);
    expect(Buffer.from(String(res.payload?.base64), "base64").toString("utf8")).toBe(
      "# skill notes\n",
    );
  });

  it("reads the tenant-user write workspace when Item 7 is unplaced and config still points at a checkout", async () => {
    resolveTrustedAgentLocatorMock.mockResolvedValue(
      "unplaced://classified/ws:001:user:elle:asset:main",
    );
    const live = path.join(tmpRoot, "tenants/001/users/user-elle/OpenBot/agents/main/workspace");
    fs.mkdirSync(path.join(live, "competitor-price"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "workspace-repo-checkout"), { recursive: true });
    fs.writeFileSync(
      path.join(live, "competitor-price", "361飞燃4.5_价格监控_20260916.md"),
      "# live write\n",
    );

    const res = await invoke("361飞燃4.5_价格监控_20260916.md", {
      sessionKey: "agent:main:employee:user-elle",
    });

    expect(res.ok).toBe(true);
    expect(res.payload?.relativePath).toBe("competitor-price/361飞燃4.5_价格监控_20260916.md");
    expect(Buffer.from(String(res.payload?.base64), "base64").toString("utf8")).toBe(
      "# live write\n",
    );
  });

  it("does not rewrite a declared deliverables/ path onto a live sibling folder", async () => {
    resolveTrustedAgentLocatorMock.mockResolvedValue(
      "unplaced://classified/ws:001:user:elle:asset:main",
    );
    const live = path.join(tmpRoot, "tenants/001/users/user-elle/OpenBot/agents/main/workspace");
    fs.mkdirSync(path.join(live, "competitor-price"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "workspace-repo-checkout"), { recursive: true });
    fs.writeFileSync(
      path.join(live, "competitor-price", "361飞燃4.5_价格监控_20260916.md"),
      "# live write\n",
    );

    const res = await invoke("deliverables/361飞燃4.5_价格监控_20260916.md", {
      sessionKey: "agent:main:employee:user-elle",
    });

    expect(res.ok).toBe(false);
  });
});
