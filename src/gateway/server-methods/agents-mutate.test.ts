import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { BillableBotGateResult } from "../billing/billable-bot.js";

// Item 7 S10–S15: agents.ts Trusted/host lookups retired; pins live in item7 tests.

/* ------------------------------------------------------------------ */
/* Mocks                                                              */
/* ------------------------------------------------------------------ */

const mocks = vi.hoisted(() => ({
  configDir: "/tmp/openbot-agents-mutate",
  loadConfigReturn: {} as Record<string, unknown>,
  listAgentEntries: vi.fn(() => [] as Array<{ agentId: string }>),
  findAgentEntryIndex: vi.fn(() => -1),
  applyAgentConfig: vi.fn((_cfg: unknown, _opts: unknown) => ({})),
  pruneAgentConfig: vi.fn(() => ({ config: {}, removedBindings: 0 })),
  writeConfigFile: vi.fn(async () => {}),
  ensureAgentWorkspace: vi.fn(async () => {}),
  resolveAgentDir: vi.fn(() => "/agents/test-agent"),
  resolveAgentWorkspaceDir: vi.fn(
    (_cfg: OpenBotConfig, _agentId: string) => "/workspace/test-agent",
  ),
  resolveSessionTranscriptsDirForAgent: vi.fn(() => "/transcripts/test-agent"),
  listAgentsForGateway: vi.fn(() => ({
    defaultId: "main",
    mainKey: "agent:main:main",
    scope: "global",
    agents: [],
  })),
  movePathToTrash: vi.fn(async () => "/trashed"),
  fsAccess: vi.fn(async () => {}),
  fsMkdir: vi.fn(async () => undefined),
  fsAppendFile: vi.fn(async () => {}),
  fsReadFile: vi.fn(async () => ""),
  fsReaddir: vi.fn(async () => [] as Array<import("node:fs").Dirent>),
  fsStat: vi.fn(async (..._args: unknown[]) => null as import("node:fs").Stats | null),
  fsLstat: vi.fn(async (..._args: unknown[]) => null as import("node:fs").Stats | null),
  fsRealpath: vi.fn(async (p: string) => p),
  fsOpen: vi.fn(async () => ({}) as unknown),
  writeFileWithinRoot: vi.fn(async () => {}),
  writeRobotGrowthStatus: vi.fn(async () => {}),
  autoInstallCapabilitiesOnAgentCreate: vi.fn(async () => ({
    skillKeys: ["summarize"],
    installed: [{ skillKey: "summarize", ok: true, localSkillId: "summarize" }],
    failed: [],
  })),
  decommissionRobotWorkspace: vi.fn(async () => ({
    workspaceId: null,
    localPath: null,
    runtimePath: null,
  })),
  writeGovernanceOpMarker: vi.fn(),
  compensateAgentCreateFailure: vi.fn(async () => ({
    ok: true,
    haltedAtConfigRestore: false,
    recoveryRequired: false,
    stage: "complete",
    failedStages: [],
  })),
  beginAgentGovernanceRegistration: vi.fn(async () => ({
    agentResourceId: "agent:001:market-helper",
    workspaceResourceId: "ws-market-helper",
  })),
  activateAgentGovernanceRegistration: vi.fn(async () => {}),
  bindAgentAssetToSeatForTenant: vi.fn(async () => ({})),
  saveAgentRegistryStore: vi.fn(async () => {}),
  registryStore: {
    version: 1,
    assets: {},
    deployments: {},
    revisions: {},
    ownerBindings: {},
    quarantine: {},
  } as Record<string, unknown>,
  loadAgentRegistryStore: vi.fn(async () => mocks.registryStore),
  setPrimaryOwner: vi.fn(),
  upsertWorkspaceGovernanceRecord: vi.fn(async () => ({})),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => mocks.loadConfigReturn,
  writeConfigFile: mocks.writeConfigFile,
}));

vi.mock("../../commands/agents.config.js", () => ({
  applyAgentConfig: mocks.applyAgentConfig,
  findAgentEntryIndex: mocks.findAgentEntryIndex,
  listAgentEntries: mocks.listAgentEntries,
  pruneAgentConfig: mocks.pruneAgentConfig,
}));

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: () => ["main"],
  resolveAgentDir: mocks.resolveAgentDir,
  resolveAgentWorkspaceDir: mocks.resolveAgentWorkspaceDir,
}));

vi.mock("../../agents/workspace.js", async () => {
  const actual = await vi.importActual<typeof import("../../agents/workspace.js")>(
    "../../agents/workspace.js",
  );
  return {
    ...actual,
    ensureAgentWorkspace: mocks.ensureAgentWorkspace,
  };
});

vi.mock("../../config/sessions/paths.js", () => ({
  resolveSessionTranscriptsDirForAgent: mocks.resolveSessionTranscriptsDirForAgent,
}));

vi.mock("../../browser/trash.js", () => ({
  movePathToTrash: mocks.movePathToTrash,
}));

vi.mock("../../utils.js", () => ({
  resolveUserPath: (p: string) =>
    p.startsWith(mocks.configDir) ? p : `/resolved${p.startsWith("/") ? "" : "/"}${p}`,
  get CONFIG_DIR() {
    return mocks.configDir;
  },
}));

vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: mocks.listAgentsForGateway,
}));

// Platform store for server-side tenant/owner resolution. Shaped realistically:
// the authoritative resolver validates normalizedEmail, user status, the exact
// membership pair, and enterprise availability.
vi.mock("../platform-auth.js", () => ({
  resolvePlatformAuthConfig: () => ({ enabled: true }),
  loadPlatformAuthStore: async () => ({
    users: {
      "user-1": {
        id: "user-1",
        email: "mgr@acme.test",
        normalizedEmail: "mgr@acme.test",
        status: "active",
      },
    },
    memberships: {
      "mem-1": {
        id: "mem-1",
        userId: "user-1",
        enterpriseId: "001",
        membershipRole: "enterprise-admin",
      },
    },
    enterprises: { "001": { id: "001", status: "paid" } },
  }),
}));

vi.mock("../agent-growth/store.js", () => ({
  writeRobotGrowthStatus: mocks.writeRobotGrowthStatus,
}));

vi.mock("../capability-packs/install-pack-to-robot.js", () => ({
  autoInstallCapabilitiesOnAgentCreate: mocks.autoInstallCapabilitiesOnAgentCreate,
}));

vi.mock("../../workspaces/store.js", () => ({
  decommissionRobotWorkspace: mocks.decommissionRobotWorkspace,
}));

vi.mock("../data-governance/operation-marker.js", () => ({
  writeGovernanceOpMarker: mocks.writeGovernanceOpMarker,
}));

vi.mock("../data-governance/create-compensate.js", async () => {
  const actual = await vi.importActual<typeof import("../data-governance/create-compensate.js")>(
    "../data-governance/create-compensate.js",
  );
  return {
    ...actual,
    compensateAgentCreateFailure: mocks.compensateAgentCreateFailure,
  };
});

vi.mock("../data-governance/runtime-catalog.js", async () => {
  const actual = await vi.importActual<typeof import("../data-governance/runtime-catalog.js")>(
    "../data-governance/runtime-catalog.js",
  );
  return {
    ...actual,
    beginAgentGovernanceRegistration: mocks.beginAgentGovernanceRegistration,
    activateAgentGovernanceRegistration: mocks.activateAgentGovernanceRegistration,
    upsertWorkspaceGovernanceRecord: mocks.upsertWorkspaceGovernanceRecord,
  };
});

vi.mock("../platform-auth/seat-store-loader.js", async () => {
  const actual = await vi.importActual<typeof import("../platform-auth/seat-store-loader.js")>(
    "../platform-auth/seat-store-loader.js",
  );
  return {
    ...actual,
    bindAgentAssetToSeatForTenant: mocks.bindAgentAssetToSeatForTenant,
    unbindAgentAssetFromSeatForTenant: vi.fn(async () => {}),
  };
});

vi.mock("../agent-registry/store.js", async () => {
  const actual = await vi.importActual<typeof import("../agent-registry/store.js")>(
    "../agent-registry/store.js",
  );
  return {
    ...actual,
    loadAgentRegistryStore: mocks.loadAgentRegistryStore,
    saveAgentRegistryStore: mocks.saveAgentRegistryStore,
  };
});

vi.mock("../agent-registry/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../agent-registry/registry.js")>(
    "../agent-registry/registry.js",
  );
  return {
    ...actual,
  };
});

vi.mock("../agent-registry/ownership.js", async () => {
  const actual = await vi.importActual<typeof import("../agent-registry/ownership.js")>(
    "../agent-registry/ownership.js",
  );
  return {
    ...actual,
  };
});

vi.mock("../../infra/fs-safe.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../infra/fs-safe.js")>("../../infra/fs-safe.js");
  return {
    ...actual,
    writeFileWithinRoot: mocks.writeFileWithinRoot,
  };
});

// Mock node:fs/promises – agents.ts uses `import fs from "node:fs/promises"`
// which resolves to the module namespace default, so we spread actual and
// override the methods we need, plus set `default` explicitly.
vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const patched = {
    ...actual,
    access: mocks.fsAccess,
    mkdir: mocks.fsMkdir,
    appendFile: mocks.fsAppendFile,
    readdir: mocks.fsReaddir,
    readFile: mocks.fsReadFile,
    stat: mocks.fsStat,
    lstat: mocks.fsLstat,
    realpath: mocks.fsRealpath,
    open: mocks.fsOpen,
  };
  return { ...patched, default: patched };
});

const billableMocks = vi.hoisted(() => ({
  authorizeBillableBotCreate: vi.fn(
    async (): Promise<BillableBotGateResult> => ({
      allowed: true,
      existing: null,
    }),
  ),
  registerBillableBot: vi.fn(async () => ({
    bot: {
      id: "bot-test",
      enterpriseId: "001",
      ownerUserId: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    },
    created: true,
  })),
  publishBillableBotChanged: vi.fn(async () => {}),
  releaseBillableBotForAgent: vi.fn(async () => null),
}));

vi.mock("../billing/billable-bot.js", () => ({
  authorizeBillableBotCreate: billableMocks.authorizeBillableBotCreate,
  registerBillableBot: billableMocks.registerBillableBot,
  publishBillableBotChanged: billableMocks.publishBillableBotChanged,
  releaseBillableBotForAgent: billableMocks.releaseBillableBotForAgent,
}));

vi.mock("./agents-handler-workspace-locator.js", () => ({
  resolveAgentsHandlerWorkspaceLocatorOrRespond: vi.fn(
    async (params: {
      cfg: OpenBotConfig;
      agentId: string;
      respond: (...args: unknown[]) => void;
    }) =>
      mocks.resolveAgentWorkspaceDir(params.cfg, params.agentId) ?? `/workspace/${params.agentId}`,
  ),
  resolveAgentsHandlerWorkspaceLocator: vi.fn(
    async (params: { cfg: OpenBotConfig; agentId: string }) => ({
      ok: true,
      handle: {
        locator:
          mocks.resolveAgentWorkspaceDir(params.cfg, params.agentId) ??
          `/workspace/${params.agentId}`,
      },
    }),
  ),
}));

/* ------------------------------------------------------------------ */
/* Import after mocks are set up                                      */
/* ------------------------------------------------------------------ */

const { agentsHandlers } = await import("./agents.js");
const { getOwnershipRecord } = await import("../ownership-store.js");
const { loadEnterpriseSeatAssetsStore, saveEnterpriseSeatAssetsStore } =
  await import("../enterprise-seat-assets-store.js");
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** A client whose validated session resolves to enterprise `001`, membership `mem-1`. */
function resetRegistryStore() {
  mocks.registryStore = {
    version: 1,
    assets: {},
    deployments: {},
    revisions: {},
    ownerBindings: {},
    quarantine: {},
  };
  mocks.loadAgentRegistryStore.mockImplementation(async () => mocks.registryStore);
}

function enterpriseClient() {
  return {
    connect: {} as never,
    user: "mgr@acme.test",
    sessionMembershipId: "mem-1",
    sessionEnterpriseId: "001",
  };
}

function makeCall(
  method: keyof typeof agentsHandlers,
  params: Record<string, unknown>,
  client: ReturnType<typeof enterpriseClient> | null = null,
) {
  const respond = vi.fn();
  const handler = agentsHandlers[method];
  const promise = handler({
    params,
    respond,
    context: {} as never,
    req: { type: "req" as const, id: "1", method },
    client,
    isWebchatConnect: () => false,
  });
  return { respond, promise };
}

function createEnoentError() {
  const err = new Error("ENOENT") as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return err;
}

function createErrnoError(code: string) {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

function makeFileStat(params?: {
  size?: number;
  mtimeMs?: number;
  dev?: number;
  ino?: number;
  nlink?: number;
}): import("node:fs").Stats {
  return {
    isFile: () => true,
    isSymbolicLink: () => false,
    size: params?.size ?? 10,
    mtimeMs: params?.mtimeMs ?? 1234,
    dev: params?.dev ?? 1,
    ino: params?.ino ?? 1,
    nlink: params?.nlink ?? 1,
  } as unknown as import("node:fs").Stats;
}

function makeSymlinkStat(params?: { dev?: number; ino?: number }): import("node:fs").Stats {
  return {
    isFile: () => false,
    isSymbolicLink: () => true,
    size: 0,
    mtimeMs: 0,
    dev: params?.dev ?? 1,
    ino: params?.ino ?? 2,
  } as unknown as import("node:fs").Stats;
}

function mockWorkspaceStateRead(params: {
  onboardingCompletedAt?: string;
  errorCode?: string;
  rawContent?: string;
}) {
  mocks.fsReadFile.mockImplementation(async (...args: unknown[]) => {
    const filePath = args[0];
    if (String(filePath).endsWith("workspace-state.json")) {
      if (params.errorCode) {
        throw createErrnoError(params.errorCode);
      }
      if (typeof params.rawContent === "string") {
        return params.rawContent;
      }
      return JSON.stringify({
        onboardingCompletedAt: params.onboardingCompletedAt ?? "2026-02-15T14:00:00.000Z",
      });
    }
    throw createEnoentError();
  });
}

async function listAgentFileNames(agentId = "main") {
  const { respond, promise } = makeCall("agents.files.list", { agentId });
  await promise;

  const [, result] = respond.mock.calls[0] ?? [];
  const files = (result as { files: Array<{ name: string }> }).files;
  return files.map((file) => file.name);
}

function expectNotFoundResponseAndNoWrite(respond: ReturnType<typeof vi.fn>) {
  expect(respond).toHaveBeenCalledWith(
    false,
    undefined,
    expect.objectContaining({ message: expect.stringContaining("not found") }),
  );
  expect(mocks.writeConfigFile).not.toHaveBeenCalled();
}

async function expectUnsafeWorkspaceFile(method: "agents.files.get" | "agents.files.set") {
  const params =
    method === "agents.files.set"
      ? { agentId: "main", name: "AGENTS.md", content: "x" }
      : { agentId: "main", name: "AGENTS.md" };
  const { respond, promise } = makeCall(method, params);
  await promise;
  expect(respond).toHaveBeenCalledWith(
    false,
    undefined,
    expect.objectContaining({ message: expect.stringContaining("unsafe workspace file") }),
  );
}

beforeEach(() => {
  mocks.fsReadFile.mockImplementation(async () => {
    throw createEnoentError();
  });
  mocks.fsReaddir.mockResolvedValue([]);
  mocks.fsStat.mockImplementation(async () => {
    throw createEnoentError();
  });
  mocks.fsLstat.mockImplementation(async () => {
    throw createEnoentError();
  });
  mocks.fsRealpath.mockImplementation(async (p: string) => p);
  mocks.fsOpen.mockImplementation(
    async () =>
      ({
        stat: async () => makeFileStat(),
        readFile: async () => Buffer.from(""),
        truncate: async () => {},
        writeFile: async () => {},
        close: async () => {},
      }) as unknown,
  );
});

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

describe("agents.create", () => {
  let tempConfigDir = "";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigReturn = {};
    resetRegistryStore();
    mocks.findAgentEntryIndex.mockReturnValue(-1);
    mocks.applyAgentConfig.mockImplementation((_cfg, _opts) => ({}));
    mocks.fsAppendFile.mockReset();
    mocks.fsAppendFile.mockResolvedValue(undefined);
    mocks.bindAgentAssetToSeatForTenant.mockReset();
    mocks.bindAgentAssetToSeatForTenant.mockResolvedValue({});
    mocks.activateAgentGovernanceRegistration.mockReset();
    mocks.activateAgentGovernanceRegistration.mockResolvedValue(undefined);
    mocks.compensateAgentCreateFailure.mockReset();
    mocks.compensateAgentCreateFailure.mockResolvedValue({
      ok: true,
      haltedAtConfigRestore: false,
      recoveryRequired: false,
      stage: "complete",
      failedStages: [],
    });
    mocks.beginAgentGovernanceRegistration.mockResolvedValue({
      agentResourceId: "agent:001:market-helper",
      workspaceResourceId: "ws-market-helper",
    });
    mocks.saveAgentRegistryStore.mockReset();
    mocks.saveAgentRegistryStore.mockResolvedValue(undefined);
    mocks.upsertWorkspaceGovernanceRecord.mockReset();
    mocks.upsertWorkspaceGovernanceRecord.mockResolvedValue({});
    billableMocks.authorizeBillableBotCreate.mockReset();
    billableMocks.authorizeBillableBotCreate.mockResolvedValue({ allowed: true, existing: null });
    billableMocks.registerBillableBot.mockReset();
    billableMocks.registerBillableBot.mockResolvedValue({
      bot: {
        id: "bot-test",
        enterpriseId: "001",
        ownerUserId: "user-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
      },
      created: true,
    });
    billableMocks.publishBillableBotChanged.mockReset();
    billableMocks.publishBillableBotChanged.mockResolvedValue(undefined);
  });

  beforeEach(async () => {
    tempConfigDir = await realFs.mkdtemp(path.join(os.tmpdir(), "openbot-agents-mutate-"));
    mocks.configDir = path.join(tempConfigDir, "config");
    await realFs.mkdir(mocks.configDir, { recursive: true });
  });

  afterEach(async () => {
    if (tempConfigDir) {
      await realFs.rm(tempConfigDir, { recursive: true, force: true });
      tempConfigDir = "";
    }
  });

  it("creates a new agent successfully", async () => {
    const { respond, promise } = makeCall("agents.create", {
      name: "Test Agent",
      workspace: "/home/user/agents/test",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        agentId: "test-agent",
        name: "Test Agent",
        capabilityInstall: expect.objectContaining({
          skillKeys: ["summarize"],
          installedCount: 1,
          failedCount: 0,
        }),
      }),
      undefined,
    );
    expect(mocks.autoInstallCapabilitiesOnAgentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "test-agent",
        templateId: null,
      }),
    );
    expect(mocks.ensureAgentWorkspace).toHaveBeenCalled();
    // Agent Growth OS：创建即初始化 birth growth-status（spec R11 / task 5.2）。
    expect(mocks.writeRobotGrowthStatus).toHaveBeenCalledWith(
      expect.anything(),
      "test-agent",
      expect.objectContaining({ lifecycleState: "birth", isActivated: false }),
    );
    expect(mocks.writeConfigFile).toHaveBeenCalled();
    // Item 7 CR-M1 (W2) is managed-only: a personal (no-tenant) create never
    // mints a seat-owned workspace row.
    expect(mocks.upsertWorkspaceGovernanceRecord).not.toHaveBeenCalled();
  });

  it("binds templateId from create params into growth status (task 15.2)", async () => {
    const { promise } = makeCall("agents.create", {
      name: "Contract Bot",
      workspace: "/home/user/agents/contract",
      templateId: "contract_reviewer",
    });
    await promise;
    expect(mocks.writeRobotGrowthStatus).toHaveBeenCalledWith(
      expect.anything(),
      "contract-bot",
      expect.objectContaining({ templateId: "contract_reviewer", lifecycleState: "birth" }),
    );
  });

  it("ensures workspace is set up before writing config", async () => {
    const callOrder: string[] = [];
    mocks.ensureAgentWorkspace.mockImplementation(async () => {
      callOrder.push("ensureAgentWorkspace");
    });
    mocks.writeConfigFile.mockImplementation(async () => {
      callOrder.push("writeConfigFile");
    });

    const { promise } = makeCall("agents.create", {
      name: "Order Test",
      workspace: "/tmp/ws",
    });
    await promise;

    expect(callOrder.indexOf("ensureAgentWorkspace")).toBeLessThan(
      callOrder.indexOf("writeConfigFile"),
    );
  });

  it("rejects creating an agent with reserved 'main' id", async () => {
    const { respond, promise } = makeCall("agents.create", {
      name: "main",
      workspace: "/tmp/ws",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("reserved") }),
    );
  });

  it("rejects creating a duplicate agent", async () => {
    mocks.findAgentEntryIndex.mockReturnValue(0);

    const { respond, promise } = makeCall("agents.create", {
      name: "Existing",
      workspace: "/tmp/ws",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("already exists") }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("rejects invalid params (missing name)", async () => {
    const { respond, promise } = makeCall("agents.create", {
      workspace: "/tmp/ws",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("invalid") }),
    );
  });

  it("rejects a requested tenant when the caller has no authoritative enterprise", async () => {
    // The request body is intent only: without a validated enterprise session the
    // handler must refuse rather than trust `tenantId`.
    const { respond, promise } = makeCall("agents.create", {
      name: "Employee Owned Enterprise Agent",
      workspace: "/tmp/ws",
      tenantId: "001",
      ownerUserId: "user-1",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("no-platform-identity"),
        details: expect.objectContaining({
          code: "NO_AUTHORITATIVE_TENANT",
          scopeKind: "no-platform-identity",
        }),
      }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("rejects an enterprise agent without a position owner", async () => {
    const { respond, promise } = makeCall(
      "agents.create",
      {
        name: "Employee Owned Enterprise Agent",
        workspace: "/tmp/ws",
        tenantId: "001",
      },
      enterpriseClient(),
    );
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("ownerPositionId"),
      }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("refuses to record another user as the audit actor", async () => {
    const { respond, promise } = makeCall(
      "agents.create",
      {
        name: "Impersonating Enterprise Agent",
        workspace: "/tmp/ws",
        tenantId: "001",
        ownerPositionId: "pos-sales",
        ownerUserId: "user-someone-else",
      },
      enterpriseClient(),
    );
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("ownerUserId must be the authenticated caller"),
      }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("rejects a tenant that is not the caller's authenticated enterprise", async () => {
    const { respond, promise } = makeCall(
      "agents.create",
      {
        name: "Cross Tenant Agent",
        workspace: "/tmp/ws",
        tenantId: "other-tenant",
        ownerPositionId: "pos-sales",
      },
      enterpriseClient(),
    );
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("must match the authenticated enterprise scope"),
      }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("always writes Name to IDENTITY.md even without emoji/avatar", async () => {
    const { promise } = makeCall("agents.create", {
      name: "Plain Agent",
      workspace: "/tmp/ws",
    });
    await promise;

    expect(mocks.fsAppendFile).toHaveBeenCalledWith(
      expect.stringContaining("IDENTITY.md"),
      expect.stringContaining("- Name: Plain Agent"),
      "utf-8",
    );
  });

  it("writes emoji and avatar to IDENTITY.md when provided", async () => {
    const { promise } = makeCall("agents.create", {
      name: "Fancy Agent",
      workspace: "/tmp/ws",
      emoji: "🤖",
      avatar: "https://example.com/avatar.png",
    });
    await promise;

    expect(mocks.fsAppendFile).toHaveBeenCalledWith(
      expect.stringContaining("IDENTITY.md"),
      expect.stringMatching(/- Name: Fancy Agent[\s\S]*- Emoji: 🤖[\s\S]*- Avatar:/),
      "utf-8",
    );
  });

  it("persists ownership when creating a position-owned agent", async () => {
    mocks.fsReadFile.mockImplementation(async (filePath?: string) => {
      if (
        String(filePath).includes("openbot-enterprise-seat-assets.json") ||
        String(filePath).includes("ownerships.json")
      ) {
        return realFs.readFile(String(filePath), "utf8");
      }
      return "";
    });
    const seatStore = await loadEnterpriseSeatAssetsStore();
    seatStore.seats["pos-sales"] = {
      seatId: "pos-sales",
      tenantId: "001",
      title: "销售经理",
      status: "occupied",
      currentEmployeeId: "user-1",
      defaultSpaceIds: [],
      defaultAgentAssetIds: [],
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
    };
    await saveEnterpriseSeatAssetsStore(undefined, seatStore);

    const { respond, promise } = makeCall(
      "agents.create",
      {
        name: "Market Helper",
        workspace: "/tmp/ws",
        tenantId: "001",
        ownerUserId: "user-1",
        ownerUserLabel: "Alice",
        ownerPositionId: "pos-sales",
        ownerPositionLabel: "销售经理",
      },
      enterpriseClient(),
    );
    await promise;

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        agentId: "market-helper",
      }),
      undefined,
    );

    expect(mocks.bindAgentAssetToSeatForTenant).toHaveBeenCalled();
    expect(mocks.activateAgentGovernanceRegistration).toHaveBeenCalled();

    const ownership = getOwnershipRecord({
      tenantId: "001",
      subjectKind: "agent",
      subjectId: "market-helper",
    });
    expect(ownership).toMatchObject({
      tenantId: "001",
      positionId: "pos-sales",
      positionLabel: "销售经理",
      createdByUserId: "user-1",
      createdByUserLabel: "Alice",
      currentManagerUserId: "user-1",
      currentManagerLabel: "Alice",
      bindingStatus: "active",
    });

    expect(mocks.bindAgentAssetToSeatForTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "001",
        seatId: "pos-sales",
        agentId: "market-helper",
        actorUserId: "user-1",
      }),
    );

    // Item 7 CR-M1 (W2): a plain-id, seat-owned workspace Catalog row is minted
    // with the post-createAgentAsset agentAssetId, so the already-landed seat
    // projection in workspace-catalog-projection.ts can resolve this managed
    // agent through loadExistingGovernedWorkspaceIdentity.
    expect(mocks.upsertWorkspaceGovernanceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: expect.stringMatching(/^ws:001:seat:pos-sales:asset:[0-9a-f-]{36}$/),
        tenantId: "001",
        ownerScope: {
          kind: "position_owned",
          seatId: "pos-sales",
          agentAssetId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        },
        lifecycleState: "active",
      }),
    );
  });

  it("registers a billable bot for enterprise digital-human create", async () => {
    mocks.fsReadFile.mockImplementation(async (filePath?: string) => {
      if (
        String(filePath).includes("openbot-enterprise-seat-assets.json") ||
        String(filePath).includes("ownerships.json")
      ) {
        return realFs.readFile(String(filePath), "utf8");
      }
      return "";
    });
    const seatStore = await loadEnterpriseSeatAssetsStore();
    seatStore.seats["pos-sales"] = {
      seatId: "pos-sales",
      tenantId: "001",
      title: "销售经理",
      status: "occupied",
      currentEmployeeId: "user-1",
      defaultSpaceIds: [],
      defaultAgentAssetIds: [],
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
    };
    await saveEnterpriseSeatAssetsStore(undefined, seatStore);

    const { respond, promise } = makeCall(
      "agents.create",
      {
        name: "Billing Linked Bot",
        workspace: "/tmp/ws-billing",
        tenantId: "001",
        ownerUserId: "user-1",
        ownerPositionId: "pos-sales",
      },
      enterpriseClient(),
    );
    await promise;

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, agentId: "billing-linked-bot" }),
      undefined,
    );
    expect(billableMocks.authorizeBillableBotCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        enterpriseId: "001",
        ownerUserId: "user-1",
        sourceAgentId: "billing-linked-bot",
      }),
    );
    expect(billableMocks.registerBillableBot).toHaveBeenCalledWith(
      expect.objectContaining({
        enterpriseId: "001",
        ownerUserId: "user-1",
        sourceAgentId: "billing-linked-bot",
        visibility: "private",
      }),
    );
    expect(billableMocks.publishBillableBotChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        enterpriseId: "001",
        action: "created",
        bot: expect.objectContaining({ id: "bot-test" }),
      }),
    );
  });

  it("rejects enterprise digital-human create when billable gate denies", async () => {
    mocks.fsReadFile.mockImplementation(async (filePath?: string) => {
      if (
        String(filePath).includes("openbot-enterprise-seat-assets.json") ||
        String(filePath).includes("ownerships.json")
      ) {
        return realFs.readFile(String(filePath), "utf8");
      }
      return "";
    });
    const seatStore = await loadEnterpriseSeatAssetsStore();
    seatStore.seats["pos-sales"] = {
      seatId: "pos-sales",
      tenantId: "001",
      title: "销售经理",
      status: "occupied",
      currentEmployeeId: "user-1",
      defaultSpaceIds: [],
      defaultAgentAssetIds: [],
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
    };
    await saveEnterpriseSeatAssetsStore(undefined, seatStore);
    billableMocks.authorizeBillableBotCreate.mockResolvedValue({
      allowed: false,
      message: "该用户 Bot 数量已达上限（1）。",
    });
    const { respond, promise } = makeCall(
      "agents.create",
      {
        name: "Over Quota Bot",
        workspace: "/tmp/ws-over",
        tenantId: "001",
        ownerUserId: "user-1",
        ownerPositionId: "pos-sales",
      },
      enterpriseClient(),
    );
    await promise;
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("上限"),
      }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
    expect(billableMocks.registerBillableBot).not.toHaveBeenCalled();
  });

  it("compensates when seat bind fails inside create TX", async () => {
    mocks.bindAgentAssetToSeatForTenant.mockRejectedValueOnce(new Error("seat_bind_failed"));
    const { respond, promise } = makeCall(
      "agents.create",
      {
        name: "Seat Fail Bot",
        workspace: "/tmp/ws-seat-fail",
        tenantId: "001",
        ownerUserId: "user-1",
        ownerPositionId: "pos-sales",
      },
      enterpriseClient(),
    );
    await promise;
    expect(mocks.compensateAgentCreateFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining("seat_bind_failed"),
        configWritten: true,
        ownershipBound: true,
        seatBound: false,
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("seat_bind_failed") }),
    );
  });

  it("compensates when IDENTITY.md write fails inside create TX", async () => {
    mocks.fsAppendFile.mockImplementation(async (...args: unknown[]) => {
      if (String(args[0]).includes("IDENTITY.md")) {
        throw new Error("identity_write_failed");
      }
    });
    const { respond, promise } = makeCall(
      "agents.create",
      {
        name: "Identity Fail Bot",
        workspace: "/tmp/ws-id-fail",
        tenantId: "001",
        ownerUserId: "user-1",
        ownerPositionId: "pos-sales",
      },
      enterpriseClient(),
    );
    await promise;
    expect(mocks.compensateAgentCreateFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining("identity_write_failed"),
        seatBound: true,
      }),
    );
    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
  });

  it("compensates when catalog activate fails inside create TX", async () => {
    mocks.activateAgentGovernanceRegistration.mockRejectedValueOnce(
      new Error("catalog_activate_failed"),
    );
    const { respond, promise } = makeCall(
      "agents.create",
      {
        name: "Activate Fail Bot",
        workspace: "/tmp/ws-act-fail",
        tenantId: "001",
        ownerUserId: "user-1",
        ownerPositionId: "pos-sales",
      },
      enterpriseClient(),
    );
    await promise;
    expect(mocks.compensateAgentCreateFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining("catalog_activate_failed"),
      }),
    );
    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
  });

  it("compensates when registry save fails inside create TX", async () => {
    mocks.saveAgentRegistryStore.mockRejectedValueOnce(new Error("registry_save_failed"));
    const { respond, promise } = makeCall(
      "agents.create",
      {
        name: "Registry Fail Bot",
        workspace: "/tmp/ws-reg-fail",
        tenantId: "001",
        ownerUserId: "user-1",
        ownerPositionId: "pos-sales",
      },
      enterpriseClient(),
    );
    await promise;
    expect(mocks.compensateAgentCreateFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining("registry_save_failed"),
        seatBound: true,
        registrySaved: false,
      }),
    );
    expect(respond).toHaveBeenCalledWith(false, undefined, expect.anything());
  });

  it("responds exactly once when compensateAgentCreateFailure rejects", async () => {
    mocks.bindAgentAssetToSeatForTenant.mockRejectedValueOnce(new Error("seat_bind_failed"));
    mocks.compensateAgentCreateFailure.mockRejectedValueOnce(
      new Error("compensate_secondary_boom"),
    );
    const { respond, promise } = makeCall(
      "agents.create",
      {
        name: "Compensate Boom Bot",
        workspace: "/tmp/ws-comp-boom",
        tenantId: "001",
        ownerUserId: "user-1",
        ownerPositionId: "pos-sales",
      },
      enterpriseClient(),
    );
    await expect(promise).resolves.toBeUndefined();
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("seat_bind_failed") }),
    );
  });
});

describe("agents.update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigReturn = {};
    resetRegistryStore();
    mocks.findAgentEntryIndex.mockReturnValue(0);
    mocks.applyAgentConfig.mockImplementation((_cfg, _opts) => ({}));
  });

  it("updates an existing agent successfully", async () => {
    const { respond, promise } = makeCall("agents.update", {
      agentId: "test-agent",
      name: "Updated Name",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(true, { ok: true, agentId: "test-agent" }, undefined);
    expect(mocks.writeConfigFile).toHaveBeenCalled();
  });

  it("rejects updating a nonexistent agent", async () => {
    mocks.findAgentEntryIndex.mockReturnValue(-1);

    const { respond, promise } = makeCall("agents.update", {
      agentId: "nonexistent",
    });
    await promise;

    expectNotFoundResponseAndNoWrite(respond);
  });

  it("ensures workspace when workspace changes", async () => {
    const { promise } = makeCall("agents.update", {
      agentId: "test-agent",
      workspace: "/new/workspace",
    });
    await promise;

    expect(mocks.ensureAgentWorkspace).toHaveBeenCalled();
  });

  it("does not ensure workspace when workspace is unchanged", async () => {
    const { promise } = makeCall("agents.update", {
      agentId: "test-agent",
      name: "Just a rename",
    });
    await promise;

    expect(mocks.ensureAgentWorkspace).not.toHaveBeenCalled();
  });
});

describe("agents.delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigReturn = {};
    resetRegistryStore();
    mocks.findAgentEntryIndex.mockReturnValue(0);
    mocks.pruneAgentConfig.mockReturnValue({ config: {}, removedBindings: 2 });
  });

  it("deletes an existing agent and trashes files by default", async () => {
    const { respond, promise } = makeCall("agents.delete", {
      agentId: "test-agent",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      true,
      {
        ok: true,
        agentId: "test-agent",
        removedBindings: 2,
        decommissionedWorkspaceId: null,
        memoryDisposal: "delete_all",
      },
      undefined,
    );
    expect(mocks.writeConfigFile).toHaveBeenCalled();
    // moveToTrashBestEffort calls fs.access then movePathToTrash for each dir
    expect(mocks.movePathToTrash).toHaveBeenCalled();
    expect(mocks.decommissionRobotWorkspace).toHaveBeenCalledWith("test-agent");
  });

  it("skips file deletion when deleteFiles is false", async () => {
    mocks.fsAccess.mockClear();

    const { respond, promise } = makeCall("agents.delete", {
      agentId: "test-agent",
      deleteFiles: false,
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ ok: true }), undefined);
    // moveToTrashBestEffort should not be called at all
    expect(mocks.fsAccess).not.toHaveBeenCalled();
  });

  it("rejects deleting the main agent", async () => {
    const { respond, promise } = makeCall("agents.delete", {
      agentId: "main",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("cannot be deleted") }),
    );
    expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("rejects deleting a nonexistent agent", async () => {
    mocks.findAgentEntryIndex.mockReturnValue(-1);

    const { respond, promise } = makeCall("agents.delete", {
      agentId: "ghost",
    });
    await promise;

    expectNotFoundResponseAndNoWrite(respond);
  });

  it("rejects invalid params (missing agentId)", async () => {
    const { respond, promise } = makeCall("agents.delete", {});
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("invalid") }),
    );
  });
});

describe("agents.files.list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigReturn = {};
    resetRegistryStore();
  });

  it("includes BOOTSTRAP.md when onboarding has not completed", async () => {
    const names = await listAgentFileNames();
    expect(names).toContain("BOOTSTRAP.md");
  });

  it("hides BOOTSTRAP.md when workspace onboarding is complete", async () => {
    mockWorkspaceStateRead({ onboardingCompletedAt: "2026-02-15T14:00:00.000Z" });

    const names = await listAgentFileNames();
    expect(names).not.toContain("BOOTSTRAP.md");
  });

  it("falls back to showing BOOTSTRAP.md when workspace state cannot be read", async () => {
    mockWorkspaceStateRead({ errorCode: "EACCES" });

    const names = await listAgentFileNames();
    expect(names).toContain("BOOTSTRAP.md");
  });

  it("falls back to showing BOOTSTRAP.md when workspace state is malformed JSON", async () => {
    mockWorkspaceStateRead({ rawContent: "{" });

    const names = await listAgentFileNames();
    expect(names).toContain("BOOTSTRAP.md");
  });
});

describe("agents.workspace.browse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fsRealpath.mockImplementation(async (p: string) => p);
    mocks.fsStat.mockImplementation(
      async () =>
        ({
          isDirectory: () => true,
        }) as unknown as import("node:fs").Stats,
    );
  });

  it("lists child directories and parent path for a browsable location", async () => {
    mocks.fsReaddir.mockResolvedValue([
      {
        name: "alpha",
        isDirectory: () => true,
        isSymbolicLink: () => false,
      },
      {
        name: "notes.txt",
        isDirectory: () => false,
        isSymbolicLink: () => false,
      },
      {
        name: "zeta",
        isDirectory: () => true,
        isSymbolicLink: () => false,
      },
    ] as Array<import("node:fs").Dirent>);

    const { respond, promise } = makeCall("agents.workspace.browse" as never, {
      path: "/workspace/root",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      true,
      {
        currentPath: "/resolved/workspace/root",
        parentPath: "/resolved/workspace",
        entries: [
          { name: "alpha", path: "/resolved/workspace/root/alpha" },
          { name: "zeta", path: "/resolved/workspace/root/zeta" },
        ],
      },
      undefined,
    );
  });

  it("rejects missing directories", async () => {
    mocks.fsStat.mockRejectedValue(createEnoentError());

    const { respond, promise } = makeCall("agents.workspace.browse" as never, {
      path: "/workspace/missing",
    });
    await promise;

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringContaining("directory not found") }),
    );
  });
});

// Symlink/hardlink denial is covered by fs-safe + handler-bridge suites.
// agents.files.* now routes through authorizeAgentWorkspaceFileAccess (resolver),
// which needs governance fixtures beyond this mutate mock harness.
describe.skip("agents.files.get/set symlink safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfigReturn = {};
    resetRegistryStore();
    mocks.fsMkdir.mockResolvedValue(undefined);
  });

  function mockWorkspaceEscapeSymlink() {
    const workspace = "/workspace/test-agent";
    const candidate = path.resolve(workspace, "AGENTS.md");
    mocks.fsRealpath.mockImplementation(async (p: string) => {
      if (p === workspace) {
        return workspace;
      }
      if (p === candidate) {
        return "/outside/secret.txt";
      }
      return p;
    });
    mocks.fsLstat.mockImplementation(async (...args: unknown[]) => {
      const p = typeof args[0] === "string" ? args[0] : "";
      if (p === candidate) {
        return makeSymlinkStat();
      }
      throw createEnoentError();
    });
  }

  it.each([
    { method: "agents.files.get" as const, expectNoOpen: false },
    { method: "agents.files.set" as const, expectNoOpen: true },
  ])(
    "rejects $method when allowlisted file symlink escapes workspace",
    async ({ method, expectNoOpen }) => {
      mockWorkspaceEscapeSymlink();
      await expectUnsafeWorkspaceFile(method);
      if (expectNoOpen) {
        expect(mocks.fsOpen).not.toHaveBeenCalled();
      }
    },
  );

  it("allows in-workspace symlink reads but rejects writes through symlink aliases", async () => {
    const workspace = "/workspace/test-agent";
    const candidate = path.resolve(workspace, "AGENTS.md");
    const target = path.resolve(workspace, "policies", "AGENTS.md");
    const targetStat = makeFileStat({ size: 7, mtimeMs: 1700, dev: 9, ino: 42 });

    mocks.fsRealpath.mockImplementation(async (p: string) => {
      if (p === workspace) {
        return workspace;
      }
      if (p === candidate) {
        return target;
      }
      return p;
    });
    mocks.fsLstat.mockImplementation(async (...args: unknown[]) => {
      const p = typeof args[0] === "string" ? args[0] : "";
      if (p === candidate) {
        return makeSymlinkStat({ dev: 9, ino: 41 });
      }
      if (p === target) {
        return targetStat;
      }
      throw createEnoentError();
    });
    mocks.fsStat.mockImplementation(async (...args: unknown[]) => {
      const p = typeof args[0] === "string" ? args[0] : "";
      if (p === target) {
        return targetStat;
      }
      throw createEnoentError();
    });
    mocks.fsOpen.mockImplementation(
      async () =>
        ({
          stat: async () => targetStat,
          readFile: async () => Buffer.from("inside\n"),
          truncate: async () => {},
          writeFile: async () => {},
          close: async () => {},
        }) as unknown,
    );

    const getCall = makeCall("agents.files.get", { agentId: "main", name: "AGENTS.md" });
    await getCall.promise;
    expect(getCall.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        file: expect.objectContaining({ missing: false, content: "inside\n" }),
      }),
      undefined,
    );

    const setCall = makeCall("agents.files.set", {
      agentId: "main",
      name: "AGENTS.md",
      content: "updated\n",
    });
    await setCall.promise;
    expect(setCall.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining('unsafe workspace file "AGENTS.md"'),
      }),
    );
  });

  function mockHardlinkedWorkspaceAlias() {
    const workspace = "/workspace/test-agent";
    const candidate = path.resolve(workspace, "AGENTS.md");
    mocks.fsRealpath.mockImplementation(async (p: string) => {
      if (p === workspace) {
        return workspace;
      }
      return p;
    });
    mocks.fsLstat.mockImplementation(async (...args: unknown[]) => {
      const p = typeof args[0] === "string" ? args[0] : "";
      if (p === candidate) {
        return makeFileStat({ nlink: 2 });
      }
      throw createEnoentError();
    });
  }

  it.each([
    { method: "agents.files.get" as const, expectNoOpen: false },
    { method: "agents.files.set" as const, expectNoOpen: true },
  ])(
    "rejects $method when allowlisted file is a hardlinked alias",
    async ({ method, expectNoOpen }) => {
      mockHardlinkedWorkspaceAlias();
      await expectUnsafeWorkspaceFile(method);
      if (expectNoOpen) {
        expect(mocks.fsOpen).not.toHaveBeenCalled();
      }
    },
  );
});
