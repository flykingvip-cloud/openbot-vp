import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { readCollaborationLedgerArchive } from "../collaboration-ledger/reader.js";
import { appendCollaborationPromotionAuditRecord } from "../collaboration-ledger/writer.js";
import {
  createPersistedRound,
  listPersistedRounds,
  readPersistedRound,
  writePersistedRound,
} from "./round-store.js";
import { resolveRoundStoreDir } from "./round-store.js";
import { resolveMigrationNamespace } from "./runtime-namespace-migration.js";
import {
  CollaborationRuntimeWriteFrozenError,
  RuntimeNamespaceTenantRequiredError,
  resolveCollaborationRuntimeFactPaths,
  resolveRuntimeNamespace,
} from "./runtime-namespace.js";

let tmp: string;
let collabRoot: string;
let tenantsRoot: string;
const savedEnv = { ...process.env };

function cfgFor(params: {
  profile: "managed_enterprise" | "personal_local";
  runtimeNamespace?: boolean;
  runtimeWriteFreeze?: boolean;
}): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(tmp, "agent-ws") } },
    gateway: { security: { profile: params.profile } },
    collaboration: {
      defaults: { workspace: collabRoot },
      ...(params.runtimeNamespace !== undefined
        ? { runtimeNamespace: params.runtimeNamespace }
        : {}),
      ...(params.runtimeWriteFreeze !== undefined
        ? { runtimeWriteFreeze: params.runtimeWriteFreeze }
        : {}),
    },
  } as OpenBotConfig;
}

function useCfg(cfg: OpenBotConfig) {
  setRuntimeConfigSnapshot(cfg, cfg);
  return cfg;
}

function round(roundId: string, groupId: string, tenantId?: string) {
  return createPersistedRound({
    roundId,
    groupId,
    ...(tenantId ? { tenantId } : {}),
    sessionKey: `space:${groupId}`,
    userMessageId: `msg-${roundId}`,
    collaborationMode: "lead_plus_supplement",
    policyVersion: "1.0",
    policyHash: "abc",
    policySnapshot: {},
    state: "ROUND_CREATED",
    primaryMode: "single",
    mentionMode: "none",
    primaryQueue: ["bot-a"],
    primaryCursor: 0,
  });
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-runtime-ns-"));
  collabRoot = path.join(tmp, "collaboration");
  tenantsRoot = path.join(tmp, "tenants");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
  process.env.OPENBOT_STATE_DIR = path.join(tmp, "state");
});

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  process.env = { ...savedEnv };
  vi.useRealTimers();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("runtime namespace resolver (P0.0a §3.4)", () => {
  test("same groupId under two tenants resolves to disjoint namespaces", () => {
    const cfg = cfgFor({ profile: "managed_enterprise", runtimeNamespace: true });
    const a = resolveRuntimeNamespace({
      tenantId: "001",
      tenantTrust: "membership",
      groupId: "grp-shared",
      profile: "managed_enterprise",
      cfg,
    });
    const b = resolveRuntimeNamespace({
      tenantId: "002",
      tenantTrust: "membership",
      groupId: "grp-shared",
      profile: "managed_enterprise",
      cfg,
    });
    expect(a.root).toBe(
      path.join(tenantsRoot, "001", "collaboration", "groups", "grp-shared", "runtime"),
    );
    expect(b.root).toBe(
      path.join(tenantsRoot, "002", "collaboration", "groups", "grp-shared", "runtime"),
    );
    expect(a.roundsDir.startsWith(b.root)).toBe(false);
    expect(a.ledgerFile).not.toBe(b.ledgerFile);
    expect(a.tenantKey).toBe("001");
  });

  test("managed_enterprise without a trusted tenant fails closed", () => {
    const cfg = cfgFor({ profile: "managed_enterprise", runtimeNamespace: true });
    for (const tenantId of [null, "", "   "]) {
      expect(() =>
        resolveRuntimeNamespace({
          tenantId,
          tenantTrust: "membership",
          groupId: "g",
          profile: "managed_enterprise",
          cfg,
        }),
      ).toThrow(RuntimeNamespaceTenantRequiredError);
    }
    expect(() =>
      resolveRuntimeNamespace({
        tenantId: "001",
        tenantTrust: "none",
        groupId: "g",
        profile: "managed_enterprise",
        cfg,
      }),
    ).toThrow(RuntimeNamespaceTenantRequiredError);
    expect(() =>
      resolveRuntimeNamespace({
        tenantId: "../escape",
        tenantTrust: "membership",
        groupId: "g",
        profile: "managed_enterprise",
        cfg,
      }),
    ).toThrow(/invalid tenant id/);
  });

  test("personal_local keeps the collaboration root with tenantKey _local", () => {
    const cfg = cfgFor({ profile: "personal_local", runtimeNamespace: true });
    const ns = resolveRuntimeNamespace({
      tenantId: null,
      tenantTrust: "none",
      groupId: "grp a/b",
      profile: "personal_local",
      cfg,
    });
    expect(ns.tenantKey).toBe("_local");
    expect(ns.root).toBe(path.join(collabRoot, "groups", encodeURIComponent("grp a/b"), "runtime"));
  });

  test("offline migration namespace equals the runtime resolver", () => {
    const cfg = cfgFor({ profile: "managed_enterprise", runtimeNamespace: true });
    const live = resolveRuntimeNamespace({
      tenantId: "001",
      tenantTrust: "membership",
      groupId: "grp-x",
      profile: "managed_enterprise",
      cfg,
    });
    expect(
      resolveMigrationNamespace({ profile: "managed_enterprise", tenantsRoot }, "grp-x", "001"),
    ).toEqual(live);
    const personalCfg = cfgFor({ profile: "personal_local", runtimeNamespace: true });
    expect(
      resolveMigrationNamespace(
        { profile: "personal_local", groupsRoot: path.join(collabRoot, "groups") },
        "grp-x",
        null,
      ),
    ).toEqual(
      resolveRuntimeNamespace({
        tenantId: null,
        tenantTrust: "none",
        groupId: "grp-x",
        profile: "personal_local",
        cfg: personalCfg,
      }),
    );
  });
});

describe("flag collaboration.runtimeNamespace", () => {
  test("flag off (default): legacy paths, tenant ignored, no namespace", () => {
    for (const cfg of [
      cfgFor({ profile: "managed_enterprise" }),
      cfgFor({ profile: "managed_enterprise", runtimeNamespace: false }),
    ]) {
      useCfg(cfg);
      const legacyGroupDir = path.join(collabRoot, "groups", "grp-a");
      for (const tenantId of [undefined, null, "001", "002"]) {
        const paths = resolveCollaborationRuntimeFactPaths({ groupId: "grp-a", tenantId, cfg });
        expect(paths).toEqual({
          roundsDir: path.join(legacyGroupDir, "runtime", "rounds"),
          ledgerFile: path.join(legacyGroupDir, "ledger", "collaboration.jsonl"),
          namespace: null,
        });
        expect(resolveRoundStoreDir({ groupId: "grp-a", tenantId })).toBe(paths.roundsDir);
      }
    }
  });

  test("flag off golden: round + ledger bytes land exactly where baseline wrote them", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_760_000_000_000);
    useCfg(cfgFor({ profile: "managed_enterprise" }));
    const r = round("round-golden", "grp-a", "001");
    await writePersistedRound({ round: r, tenantId: "001" });
    await appendCollaborationPromotionAuditRecord({
      groupId: "grp-a",
      sourceGroupId: "grp-a",
      botId: "bot-a",
      promoted: true,
      reason: "golden",
      targetScope: "group",
      tenantId: "001",
    });
    const legacyGroupDir = path.join(collabRoot, "groups", "grp-a");
    const roundBytes = await fs.readFile(
      path.join(legacyGroupDir, "runtime", "rounds", "round-golden.json"),
      "utf8",
    );
    expect(JSON.parse(roundBytes)).toMatchObject({ roundId: "round-golden", groupId: "grp-a" });
    const ledgerBytes = await fs.readFile(
      path.join(legacyGroupDir, "ledger", "collaboration.jsonl"),
      "utf8",
    );
    expect(ledgerBytes).toBe(
      `${JSON.stringify({
        kind: "promotion",
        groupId: "grp-a",
        sourceGroupId: "grp-a",
        botId: "bot-a",
        promoted: true,
        reason: "golden",
        targetScope: "group",
        recordedAtMs: 1_760_000_000_000,
      })}\n`,
    );
    await expect(fs.stat(tenantsRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("flag on: same groupId in two tenants is isolated end to end", async () => {
    useCfg(cfgFor({ profile: "managed_enterprise", runtimeNamespace: true }));
    for (const tenantId of ["001", "002"]) {
      await writePersistedRound({ round: round(`r-${tenantId}`, "grp-s", tenantId) });
      await appendCollaborationPromotionAuditRecord({
        groupId: "grp-s",
        sourceGroupId: "grp-s",
        botId: `bot-${tenantId}`,
        promoted: true,
        reason: tenantId,
        targetScope: "group",
        tenantId,
      });
    }
    const roundsOf = (tenantId: string) =>
      fs.readdir(
        path.join(tenantsRoot, tenantId, "collaboration", "groups", "grp-s", "runtime", "rounds"),
      );
    expect((await roundsOf("001")).filter((f) => f.endsWith(".json"))).toEqual(["r-001.json"]);
    expect((await roundsOf("002")).filter((f) => f.endsWith(".json"))).toEqual(["r-002.json"]);
    const a = await readCollaborationLedgerArchive({ groupId: "grp-s", tenantId: "001" });
    const b = await readCollaborationLedgerArchive({ groupId: "grp-s", tenantId: "002" });
    expect(a.records.map((r) => (r as { botId?: string }).botId)).toEqual(["bot-001"]);
    expect(b.records.map((r) => (r as { botId?: string }).botId)).toEqual(["bot-002"]);
    await expect(fs.stat(path.join(collabRoot, "groups", "grp-s"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("flag on: list-overreach — tenant B listPersistedRounds cannot see tenant A rounds", async () => {
    useCfg(cfgFor({ profile: "managed_enterprise", runtimeNamespace: true }));
    await writePersistedRound({ round: round("r-a-only", "grp-overreach", "001") });
    await writePersistedRound({ round: round("r-b-only", "grp-overreach", "002") });

    const listedA = await listPersistedRounds({ groupId: "grp-overreach", tenantId: "001" });
    const listedB = await listPersistedRounds({ groupId: "grp-overreach", tenantId: "002" });
    expect(listedA.map((r) => r.roundId).toSorted()).toEqual(["r-a-only"]);
    expect(listedB.map((r) => r.roundId).toSorted()).toEqual(["r-b-only"]);

    // Cross-tenant history read: B must not resolve A's round by id via A's path.
    await expect(
      readPersistedRound({ groupId: "grp-overreach", roundId: "r-a-only", tenantId: "002" }),
    ).resolves.toBeNull();
    await expect(
      readPersistedRound({ groupId: "grp-overreach", roundId: "r-b-only", tenantId: "001" }),
    ).resolves.toBeNull();
    await expect(
      readPersistedRound({ groupId: "grp-overreach", roundId: "r-a-only", tenantId: "001" }),
    ).resolves.toMatchObject({ roundId: "r-a-only", tenantId: "001" });
  });

  test("flag on: history overreach — tenant B ledger archive cannot see tenant A records", async () => {
    useCfg(cfgFor({ profile: "managed_enterprise", runtimeNamespace: true }));
    await appendCollaborationPromotionAuditRecord({
      groupId: "grp-hist",
      sourceGroupId: "grp-hist",
      botId: "bot-a",
      promoted: true,
      reason: "tenant-a-only",
      targetScope: "group",
      tenantId: "001",
    });
    await appendCollaborationPromotionAuditRecord({
      groupId: "grp-hist",
      sourceGroupId: "grp-hist",
      botId: "bot-b",
      promoted: true,
      reason: "tenant-b-only",
      targetScope: "group",
      tenantId: "002",
    });

    const archiveA = await readCollaborationLedgerArchive({ groupId: "grp-hist", tenantId: "001" });
    const archiveB = await readCollaborationLedgerArchive({ groupId: "grp-hist", tenantId: "002" });
    expect(archiveA.records.map((r) => (r as { botId?: string }).botId)).toEqual(["bot-a"]);
    expect(archiveB.records.map((r) => (r as { botId?: string }).botId)).toEqual(["bot-b"]);
    expect(archiveA.records.map((r) => (r as { reason?: string }).reason)).toEqual([
      "tenant-a-only",
    ]);
    expect(archiveB.records.map((r) => (r as { reason?: string }).reason)).toEqual([
      "tenant-b-only",
    ]);
  });

  test("flag on: missing tenant is rejected for round and ledger writes and reads", async () => {
    useCfg(cfgFor({ profile: "managed_enterprise", runtimeNamespace: true }));
    await expect(writePersistedRound({ round: round("r-x", "grp-s") })).rejects.toBeInstanceOf(
      RuntimeNamespaceTenantRequiredError,
    );
    await expect(
      appendCollaborationPromotionAuditRecord({
        groupId: "grp-s",
        sourceGroupId: "grp-s",
        botId: "b",
        promoted: false,
        reason: "x",
        targetScope: "group",
      }),
    ).rejects.toBeInstanceOf(RuntimeNamespaceTenantRequiredError);
    await expect(readCollaborationLedgerArchive({ groupId: "grp-s" })).rejects.toBeInstanceOf(
      RuntimeNamespaceTenantRequiredError,
    );
    await expect(fs.stat(tmp + "/tenants")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(collabRoot, "groups"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("collaboration.runtimeWriteFreeze", () => {
  test("rejects round and ledger writes during the cutover window", async () => {
    useCfg(cfgFor({ profile: "managed_enterprise", runtimeWriteFreeze: true }));
    await expect(
      writePersistedRound({ round: round("r-f", "grp-f", "001") }),
    ).rejects.toBeInstanceOf(CollaborationRuntimeWriteFrozenError);
    await expect(
      appendCollaborationPromotionAuditRecord({
        groupId: "grp-f",
        sourceGroupId: "grp-f",
        botId: "b",
        promoted: false,
        reason: "x",
        targetScope: "group",
        tenantId: "001",
      }),
    ).rejects.toBeInstanceOf(CollaborationRuntimeWriteFrozenError);
    await expect(fs.stat(path.join(collabRoot, "groups"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    // Reads stay available while frozen.
    await expect(readCollaborationLedgerArchive({ groupId: "grp-f" })).resolves.toMatchObject({
      records: [],
    });
  });
});
