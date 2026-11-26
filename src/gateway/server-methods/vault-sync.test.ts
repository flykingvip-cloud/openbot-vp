import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_DIR } from "../../utils.js";
import { createKnowledgeBase } from "../knowledge/knowledge-base-store.js";
import type { KnowledgeSourceContext } from "../knowledge/sources/types.js";
import type { GatewayClient } from "./types.js";
import { vaultSyncHandlers } from "./vault-sync.js";

const knowledgeAuth = vi.hoisted(() => ({
  dir: `/tmp/openbot-vault-sync-kb-${Math.random().toString(36).slice(2)}`,
  resolveKnowledgeSourceContext: vi.fn(),
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: knowledgeAuth.dir,
  };
});

vi.mock("../knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: knowledgeAuth.resolveKnowledgeSourceContext,
}));

const tmpDirs: string[] = [];

const VAULT_OWNER = "owner@acme.test";
const ACTOR_USER_ID = "user-owner";
const TENANT_ACME = "tenant-acme";
const TENANT_OTHER = "tenant-other";

const EMPTY_KNOWLEDGE_CONTEXT: KnowledgeSourceContext = {
  tenantId: null,
  seatId: null,
  userId: null,
  teamLabel: null,
  roleCode: null,
  departmentId: null,
  agentType: "employee-agent",
  hasEnterpriseScope: false,
};

function kbStorePath(): string {
  return path.join(knowledgeAuth.dir, "knowledge", "bases.json");
}

function setKnowledgeContext(context: Partial<KnowledgeSourceContext> = {}): void {
  knowledgeAuth.resolveKnowledgeSourceContext.mockResolvedValue({
    ...EMPTY_KNOWLEDGE_CONTEXT,
    ...context,
  });
}

function setAuthorizedKnowledgeContext(overrides: Partial<KnowledgeSourceContext> = {}): void {
  setKnowledgeContext({
    userId: ACTOR_USER_ID,
    tenantId: TENANT_ACME,
    ...overrides,
  });
}

function createOwnedKnowledgeBase(params?: { tenantId?: string | null; ownerId?: string }): {
  id: string;
} {
  return createKnowledgeBase(
    {
      title: "Authorized target KB",
      ownerId: params?.ownerId ?? ACTOR_USER_ID,
      tenantId: params?.tenantId === undefined ? TENANT_ACME : params.tenantId,
      visibility: "private",
    },
    kbStorePath(),
  );
}

beforeEach(() => {
  expect(CONFIG_DIR).toBe(knowledgeAuth.dir);
  fs.rmSync(knowledgeAuth.dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(kbStorePath()), { recursive: true });
  setKnowledgeContext();
});

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.rmSync(knowledgeAuth.dir, { recursive: true, force: true });
  delete process.env.OPENBOT_VAULT_SYNC_DIR;
  delete process.env.OPENBOT_VAULT_SYNC_LEGACY_GATEWAY_SYNC;
  knowledgeAuth.resolveKnowledgeSourceContext.mockReset();
});

function mockRespond() {
  let last: { ok: boolean; payload?: unknown; error?: unknown } | null = null;
  const respond = (ok: boolean, payload?: unknown, error?: unknown) => {
    last = { ok, payload, error };
  };
  return {
    respond,
    get last() {
      return last;
    },
  };
}

function mockClient(user: string): GatewayClient {
  return { connect: {} as GatewayClient["connect"], user };
}

async function createVault(user: string): Promise<string> {
  const createMock = mockRespond();
  await vaultSyncHandlers["knowledge.vault-sync.create"]({
    params: { deviceId: "dev-1" },
    respond: createMock.respond as never,
    client: mockClient(user),
    req: {} as never,
    isWebchatConnect: () => false,
    context: {} as never,
  });
  expect(createMock.last?.ok).toBe(true);
  const payload = createMock.last?.payload as { vaultId?: string } | undefined;
  const vaultId = payload?.vaultId ?? "";
  expect(vaultId).toBeTruthy();
  return vaultId;
}

function errorMessage(mock: { last: { error?: unknown } | null }): string | undefined {
  return (mock.last?.error as { message?: string } | undefined)?.message;
}

describe("vaultSyncHandlers", () => {
  it("creates an e2ee vault without password on gateway", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-gw-"));
    tmpDirs.push(dir);
    process.env.OPENBOT_VAULT_SYNC_DIR = dir;
    const mock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.create"]({
      params: { deviceId: "dev-1" },
      respond: mock.respond as never,
      client: mockClient("owner@acme.test"),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(mock.last?.ok).toBe(true);
    const payload = mock.last?.payload as { vaultId: string; saltB64: string };
    expect(payload.vaultId).toBeTruthy();
    expect(payload.saltB64).toBeTruthy();
  });

  it("rejects forged ownerAccountId when client.user is set", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-gw-forge-"));
    tmpDirs.push(dir);
    process.env.OPENBOT_VAULT_SYNC_DIR = dir;
    const mock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.create"]({
      params: { ownerAccountId: "attacker@evil.test", deviceId: "dev-x" },
      respond: mock.respond as never,
      client: mockClient("owner@acme.test"),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(mock.last?.ok).toBe(false);
  });

  it("blocks gateway-side sync by default", async () => {
    const mock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.sync"]({
      params: {
        vaultId: "v1",
        deviceId: "d1",
        rootPath: "/tmp",
        password: "secret",
      },
      respond: mock.respond as never,
      client: null,
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(mock.last?.ok).toBe(false);
    const err = mock.last?.error as { message?: string };
    expect(err?.message).toContain("client-side E2EE");
  });

  it("enables team vault with password helper only in legacy mode", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-gw-team-"));
    tmpDirs.push(dir);
    process.env.OPENBOT_VAULT_SYNC_DIR = dir;
    process.env.OPENBOT_VAULT_SYNC_LEGACY_GATEWAY_SYNC = "1";
    const mock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.create"]({
      params: {
        deviceId: "dev-team",
      },
      respond: mock.respond as never,
      client: mockClient("owner@acme"),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    const created = mock.last?.payload as { vaultId: string };
    const enableMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.team.enable-with-password"]({
      params: {
        vaultId: created.vaultId,
        ownerAccountId: "owner@acme",
        password: "owner-team-password",
      },
      respond: enableMock.respond as never,
      client: mockClient("owner@acme"),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(enableMock.last?.ok).toBe(true);
    const enabled = enableMock.last?.payload as { teamEnabled?: boolean };
    expect(enabled.teamEnabled).toBe(true);
    expect(JSON.stringify(enableMock.last)).not.toContain("owner-team-password");
  });

  it("requires vault manager to revoke devices", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-gw-revoke-"));
    tmpDirs.push(dir);
    process.env.OPENBOT_VAULT_SYNC_DIR = dir;
    const createMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.create"]({
      params: { deviceId: "dev-1" },
      respond: createMock.respond as never,
      client: mockClient("owner@acme.test"),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    const created = createMock.last?.payload as { vaultId: string; deviceId: string };
    const revokeMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.devices.revoke"]({
      params: { vaultId: created.vaultId, deviceId: created.deviceId },
      respond: revokeMock.respond as never,
      client: mockClient("intruder@evil.test"),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(revokeMock.last?.ok).toBe(false);
  });

  it("rejects inventory for non-member", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-gw-inv-"));
    tmpDirs.push(dir);
    process.env.OPENBOT_VAULT_SYNC_DIR = dir;
    const createMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.create"]({
      params: { deviceId: "dev-1" },
      respond: createMock.respond as never,
      client: mockClient("owner@acme.test"),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    const created = createMock.last?.payload as { vaultId: string };
    const invMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.inventory"]({
      params: { vaultId: created.vaultId },
      respond: invMock.respond as never,
      client: mockClient("intruder@evil.test"),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(invMock.last?.ok).toBe(false);
  });

  it("rejects runtime reindex for non-member", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-gw-reidx-"));
    tmpDirs.push(dir);
    process.env.OPENBOT_VAULT_SYNC_DIR = dir;
    const createMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.create"]({
      params: { deviceId: "dev-1" },
      respond: createMock.respond as never,
      client: mockClient("owner@acme.test"),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    const created = createMock.last?.payload as { vaultId: string };
    const reindexMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.runtime.reindex"]({
      params: {
        vaultId: created.vaultId,
        knowledgeBaseId: "kb-test",
        touchedRelativePaths: ["."],
      },
      respond: reindexMock.respond as never,
      client: mockClient("intruder@evil.test"),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(reindexMock.last?.ok).toBe(false);
  });

  it("rejects arbitrary target knowledge base even for vault owner", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-gw-bind-"));
    tmpDirs.push(dir);
    process.env.OPENBOT_VAULT_SYNC_DIR = dir;
    setAuthorizedKnowledgeContext();
    createOwnedKnowledgeBase();
    const vaultId = await createVault(VAULT_OWNER);
    const bindMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.runtime.bind-kb"]({
      params: { vaultId, knowledgeBaseId: "kb-sales" },
      respond: bindMock.respond as never,
      client: mockClient(VAULT_OWNER),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(bindMock.last?.ok).toBe(false);
    const bindPayload = bindMock.last?.payload as
      | { binding?: { knowledgeBaseId?: string } }
      | undefined;
    expect(bindPayload?.binding).toBeUndefined();
    expect(errorMessage(bindMock)).toBe("target knowledge base write denied");

    const reindexMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.runtime.reindex"]({
      params: {
        vaultId,
        knowledgeBaseId: "kb-sales",
        touchedRelativePaths: ["."],
      },
      respond: reindexMock.respond as never,
      client: mockClient(VAULT_OWNER),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(reindexMock.last?.ok).toBe(false);
    expect(errorMessage(reindexMock)).toBe("target knowledge base write denied");
  });

  it("binds and reindexes an authorized same-tenant target knowledge base", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-gw-legal-"));
    tmpDirs.push(dir);
    process.env.OPENBOT_VAULT_SYNC_DIR = dir;
    setAuthorizedKnowledgeContext();
    const kb = createOwnedKnowledgeBase();
    const vaultId = await createVault(VAULT_OWNER);

    const bindMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.runtime.bind-kb"]({
      params: { vaultId, knowledgeBaseId: kb.id },
      respond: bindMock.respond as never,
      client: mockClient(VAULT_OWNER),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(bindMock.last?.ok).toBe(true);
    const bindPayload = bindMock.last?.payload as
      | { binding?: { knowledgeBaseId?: string } }
      | undefined;
    expect(bindPayload?.binding?.knowledgeBaseId).toBe(kb.id);

    const reindexMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.runtime.reindex"]({
      params: {
        vaultId,
        knowledgeBaseId: kb.id,
        touchedRelativePaths: ["."],
      },
      respond: reindexMock.respond as never,
      client: mockClient(VAULT_OWNER),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(reindexMock.last?.ok).toBe(true);
    const summary = reindexMock.last?.payload as {
      knowledgeBaseId: string | null;
      matchedBindings: number;
    };
    expect(summary.knowledgeBaseId).toBe(kb.id);
    expect(summary.matchedBindings).toBe(0);
  });

  it("rejects a cross-tenant target even when the actor owns that knowledge base", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-gw-xtenant-"));
    tmpDirs.push(dir);
    process.env.OPENBOT_VAULT_SYNC_DIR = dir;
    setAuthorizedKnowledgeContext();
    const foreignKb = createOwnedKnowledgeBase({ tenantId: TENANT_OTHER });
    const vaultId = await createVault(VAULT_OWNER);

    const bindMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.runtime.bind-kb"]({
      params: { vaultId, knowledgeBaseId: foreignKb.id },
      respond: bindMock.respond as never,
      client: mockClient(VAULT_OWNER),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(bindMock.last?.ok).toBe(false);
    expect(errorMessage(bindMock)).toBe("target knowledge base write denied");

    const reindexMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.runtime.reindex"]({
      params: {
        vaultId,
        knowledgeBaseId: foreignKb.id,
        touchedRelativePaths: ["."],
      },
      respond: reindexMock.respond as never,
      client: mockClient(VAULT_OWNER),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(reindexMock.last?.ok).toBe(false);
    expect(errorMessage(reindexMock)).toBe("target knowledge base write denied");
  });

  it("revalidates a persisted binding on reindex and rejects after the tenant no longer matches", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-gw-persist-"));
    tmpDirs.push(dir);
    process.env.OPENBOT_VAULT_SYNC_DIR = dir;
    setAuthorizedKnowledgeContext();
    const kb = createOwnedKnowledgeBase();
    const vaultId = await createVault(VAULT_OWNER);

    const bindMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.runtime.bind-kb"]({
      params: { vaultId, knowledgeBaseId: kb.id },
      respond: bindMock.respond as never,
      client: mockClient(VAULT_OWNER),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(bindMock.last?.ok).toBe(true);

    const persistedOk = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.runtime.reindex"]({
      params: {
        vaultId,
        touchedRelativePaths: ["."],
      },
      respond: persistedOk.respond as never,
      client: mockClient(VAULT_OWNER),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(persistedOk.last?.ok).toBe(true);
    const persistedSummary = persistedOk.last?.payload as { knowledgeBaseId: string | null };
    expect(persistedSummary.knowledgeBaseId).toBe(kb.id);

    setAuthorizedKnowledgeContext({ tenantId: TENANT_OTHER });
    const persistedDenied = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.runtime.reindex"]({
      params: {
        vaultId,
        touchedRelativePaths: ["."],
      },
      respond: persistedDenied.respond as never,
      client: mockClient(VAULT_OWNER),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(persistedDenied.last?.ok).toBe(false);
    expect(errorMessage(persistedDenied)).toBe("target knowledge base write denied");
  });

  it("rejects an RPC rootPath override even for an authorized target knowledge base", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-gw-root-"));
    tmpDirs.push(dir);
    process.env.OPENBOT_VAULT_SYNC_DIR = dir;
    setAuthorizedKnowledgeContext();
    const kb = createOwnedKnowledgeBase();
    const vaultId = await createVault(VAULT_OWNER);

    const reindexMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.runtime.reindex"]({
      params: {
        vaultId,
        knowledgeBaseId: kb.id,
        rootPath: "/tmp/openbot-forged-vault-root",
        touchedRelativePaths: ["."],
        persistBinding: false,
      },
      respond: reindexMock.respond as never,
      client: mockClient(VAULT_OWNER),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(reindexMock.last?.ok).toBe(false);
    expect(errorMessage(reindexMock)).toBe("RPC root override denied");
  });
});
