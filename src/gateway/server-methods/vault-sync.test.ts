import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GatewayClient } from "./types.js";
import { vaultSyncHandlers } from "./vault-sync.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.OPENBOT_VAULT_SYNC_DIR;
  delete process.env.OPENBOT_VAULT_SYNC_LEGACY_GATEWAY_SYNC;
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

  it("binds knowledge base and reindexes for member", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-gw-bind-"));
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
    const bindMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.runtime.bind-kb"]({
      params: { vaultId: created.vaultId, knowledgeBaseId: "kb-sales" },
      respond: bindMock.respond as never,
      client: mockClient("owner@acme.test"),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(bindMock.last?.ok).toBe(true);
    const bindPayload = bindMock.last?.payload as
      | { binding?: { knowledgeBaseId?: string } }
      | undefined;
    expect(bindPayload?.binding?.knowledgeBaseId).toBe("kb-sales");

    const reindexMock = mockRespond();
    await vaultSyncHandlers["knowledge.vault-sync.runtime.reindex"]({
      params: {
        vaultId: created.vaultId,
        knowledgeBaseId: "kb-sales",
        touchedRelativePaths: ["."],
      },
      respond: reindexMock.respond as never,
      client: mockClient("owner@acme.test"),
      req: {} as never,
      isWebchatConnect: () => false,
      context: {} as never,
    });
    expect(reindexMock.last?.ok).toBe(true);
    const summary = reindexMock.last?.payload as {
      matchedBindings: number;
      knowledgeBaseId: string | null;
    };
    expect(summary.knowledgeBaseId).toBe("kb-sales");
    expect(summary.matchedBindings).toBe(0);
  });
});
