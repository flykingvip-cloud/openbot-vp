/**
 * P0 G7 — Namespace cutover gate. N2 production cutover is not signed here.
 *
 * Flag off: fact paths stay legacy and writers do not touch `<ns>`.
 * Flag on + managed_enterprise without a trusted tenant: fail closed.
 * Write freeze rejects round-store writes and ledger appends; reads stay open.
 * Migration `--apply` still requires `--confirm-write-freeze`. This suite does
 * not flip the flag and does not run `--apply` against production data.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { readCollaborationLedgerArchive } from "../collaboration-ledger/reader.js";
import { appendCollaborationPromotionAuditRecord } from "../collaboration-ledger/writer.js";
import {
  LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR,
  readCollaborationCutoverFlags,
  resolveProductionCollaborationExecutor,
} from "./legacy-production-executor.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import {
  applyRoundTransition,
  createPersistedRound,
  listPersistedRounds,
  readPersistedRound,
  writePersistedRound,
} from "./round-store.js";
import { createRuntimeAuthority } from "./runtime-authority.js";
import {
  MIGRATION_APPLY_REFUSED_EXIT,
  runRuntimeNamespaceMigration,
  runtimeNamespaceMigrationApplyRefusal,
} from "./runtime-namespace-migration.js";
import {
  CollaborationRuntimeWriteFrozenError,
  RUNTIME_NAMESPACE_CUTOVER_DEFAULT,
  RuntimeNamespaceTenantRequiredError,
  isCollabRuntimeNamespaceEnabled,
  resolveCollaborationRuntimeFactPaths,
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

function authorityFor(cfg: OpenBotConfig, tenantId: string | null, trust: "membership" | "none") {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_g7" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_g7",
    tenant: { tenantId, trust },
    groupId: "grp-g7",
    profile: "managed_enterprise",
    cfg,
  });
}

async function appendPromotion(groupId: string, tenantId?: string) {
  await appendCollaborationPromotionAuditRecord({
    groupId,
    sourceGroupId: groupId,
    botId: "bot-a",
    promoted: false,
    reason: "g7",
    targetScope: "group",
    ...(tenantId ? { tenantId } : {}),
  });
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-g7-ns-"));
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
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("P0 G7 namespace cutover gate", () => {
  test("default config keeps fact paths on the legacy root and does not touch <ns>", async () => {
    expect(RUNTIME_NAMESPACE_CUTOVER_DEFAULT).toBe(false);
    const cfg = useCfg(cfgFor({ profile: "managed_enterprise" }));
    expect(isCollabRuntimeNamespaceEnabled(cfg)).toBe(false);
    expect(isCollabRuntimeNamespaceEnabled({})).toBe(false);
    expect(readCollaborationCutoverFlags(cfg).runtimeNamespace).toBe(false);
    expect(resolveProductionCollaborationExecutor(cfg)).toBe(LEGACY_PRIMARY_SUPPLEMENT_EXECUTOR);

    const legacyGroupDir = path.join(collabRoot, "groups", "grp-g7");
    const paths = resolveCollaborationRuntimeFactPaths({
      groupId: "grp-g7",
      tenantId: "001",
      cfg,
    });
    expect(paths).toEqual({
      roundsDir: path.join(legacyGroupDir, "runtime", "rounds"),
      ledgerFile: path.join(legacyGroupDir, "ledger", "collaboration.jsonl"),
      namespace: null,
    });
    expect(paths.roundsDir.includes(`${path.sep}tenants${path.sep}`)).toBe(false);

    const persisted = round("round-g7", "grp-g7", "001");
    await writePersistedRound({ round: persisted, tenantId: "001" });
    await appendPromotion("grp-g7", "001");
    await expect(
      fs.readFile(path.join(paths.roundsDir, "round-g7.json"), "utf8"),
    ).resolves.toContain("round-g7");
    await expect(fs.readFile(paths.ledgerFile, "utf8")).resolves.toContain('"kind":"promotion"');
    await expect(fs.stat(tenantsRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(path.join(legacyGroupDir, "runtime", "ledger", "collaboration.jsonl")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const authority = authorityFor(cfg, null, "none");
    expect(authority.namespace.root.startsWith(tenantsRoot)).toBe(false);

    // Managed + trusted tenant must still use legacy root while the cutover flag is off
    // (board-claims / executor-todolists read authority.namespace.root).
    const managedTenantAuthority = authorityFor(cfg, "001", "membership");
    expect(managedTenantAuthority.namespace.root).toBe(path.join(legacyGroupDir, "runtime"));
    expect(managedTenantAuthority.namespace.root.startsWith(tenantsRoot)).toBe(false);
  });

  test("flag on and a missing or untrusted managed tenant fails closed", async () => {
    const cfg = useCfg(cfgFor({ profile: "managed_enterprise", runtimeNamespace: true }));
    const hostOverride = path.join(tmp, "host-legacy-override");

    for (const tenantId of [undefined, null, "", "   "]) {
      expect(() =>
        resolveCollaborationRuntimeFactPaths({ groupId: "grp-g7", tenantId, cfg }),
      ).toThrow(RuntimeNamespaceTenantRequiredError);
    }
    expect(() =>
      resolveCollaborationRuntimeFactPaths({
        groupId: "grp-g7",
        tenantId: "001",
        tenantTrust: "none",
        cfg,
      }),
    ).toThrow(RuntimeNamespaceTenantRequiredError);

    expect(() => authorityFor(cfg, null, "none")).toThrow(RuntimeNamespaceTenantRequiredError);
    expect(() => authorityFor(cfg, "001", "none")).toThrow(RuntimeNamespaceTenantRequiredError);
    expect(() => authorityFor(cfg, "   ", "membership")).toThrow(
      RuntimeNamespaceTenantRequiredError,
    );

    await expect(
      writePersistedRound({ round: round("r-missing", "grp-g7"), roundsDir: hostOverride }),
    ).rejects.toBeInstanceOf(RuntimeNamespaceTenantRequiredError);
    await expect(appendPromotion("grp-g7")).rejects.toBeInstanceOf(
      RuntimeNamespaceTenantRequiredError,
    );
    await expect(readCollaborationLedgerArchive({ groupId: "grp-g7" })).rejects.toBeInstanceOf(
      RuntimeNamespaceTenantRequiredError,
    );
    await expect(fs.stat(hostOverride)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(tenantsRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(collabRoot, "groups"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const trusted = authorityFor(cfg, "001", "membership");
    expect(trusted.namespace.root).toBe(
      path.join(tenantsRoot, "001", "collaboration", "groups", "grp-g7", "runtime"),
    );
    const mismatch = path.join(tmp, "not-the-namespace");
    await expect(
      writePersistedRound({
        round: round("r-bypass", "grp-g7", "001"),
        tenantId: "001",
        roundsDir: mismatch,
      }),
    ).rejects.toThrow(/P0 G7: roundsDir override cannot bypass/);
    await expect(fs.stat(mismatch)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("write freeze rejects round-store writes and ledger appends and still allows reads", async () => {
    useCfg(cfgFor({ profile: "managed_enterprise" }));
    const persisted = round("round-freeze", "grp-freeze", "001");
    await writePersistedRound({ round: persisted, tenantId: "001" });
    await appendPromotion("grp-freeze", "001");

    useCfg(cfgFor({ profile: "managed_enterprise", runtimeWriteFreeze: true }));
    const override = await fs.mkdtemp(path.join(tmp, "freeze-override-"));
    await expect(
      writePersistedRound({ round: persisted, tenantId: "001", roundsDir: override }),
    ).rejects.toBeInstanceOf(CollaborationRuntimeWriteFrozenError);
    await expect(
      applyRoundTransition({
        round: persisted,
        event: "message_received",
        eventType: "ROUND_CREATED",
        eventId: "evt-freeze",
        tenantId: "001",
        roundsDir: override,
      }),
    ).rejects.toBeInstanceOf(CollaborationRuntimeWriteFrozenError);
    await expect(appendPromotion("grp-freeze", "001")).rejects.toBeInstanceOf(
      CollaborationRuntimeWriteFrozenError,
    );
    expect(await fs.readdir(override)).toEqual([]);

    const readBack = await readPersistedRound({
      groupId: "grp-freeze",
      roundId: "round-freeze",
      tenantId: "001",
    });
    expect(readBack?.state).toBe("ROUND_CREATED");
    expect(readBack?.stateVersion).toBe(0);
    const archive = await readCollaborationLedgerArchive({
      groupId: "grp-freeze",
      tenantId: "001",
    });
    expect(archive.records).toHaveLength(1);
  });

  test("migration apply requires confirm-write-freeze and dry-run writes nothing", async () => {
    expect(runtimeNamespaceMigrationApplyRefusal(false)).toMatch(/--confirm-write-freeze/);
    expect(runtimeNamespaceMigrationApplyRefusal(true)).toBeNull();
    expect(MIGRATION_APPLY_REFUSED_EXIT).toBe(3);

    const script = readFileSync(
      new URL("../../../scripts/migrate-collab-runtime-namespace.ts", import.meta.url),
      "utf8",
    );
    const refusalAt = script.indexOf("runtimeNamespaceMigrationApplyRefusal(");
    const applyAt = script.indexOf("runRuntimeNamespaceMigration({ ...base, apply })");
    expect(refusalAt).toBeGreaterThan(-1);
    expect(applyAt).toBeGreaterThan(refusalAt);
    expect(script).toContain('hasFlag("--reverse")');
    expect(script).toContain("MIGRATION_APPLY_REFUSED_EXIT");
    expect(script).not.toContain("runtimeNamespace: true");

    const legacyRoot = path.join(tmp, "legacy-groups");
    const groupDir = path.join(legacyRoot, "grp-keep");
    await fs.mkdir(path.join(groupDir, "runtime"), { recursive: true });
    await fs.writeFile(
      path.join(groupDir, "operating-state.json"),
      JSON.stringify({ tenantId: "001" }),
    );
    await fs.writeFile(path.join(groupDir, "runtime", "behavior-buffer.json"), "{}\n");
    await fs.mkdir(path.join(groupDir, "runtime", "rounds"), { recursive: true });
    await fs.writeFile(
      path.join(groupDir, "runtime", "rounds", "r1.json"),
      `${JSON.stringify({ roundId: "r1", state: "ROUND_COMPLETE" })}\n`,
    );
    const before = createHash("sha256")
      .update(await fs.readFile(path.join(groupDir, "operating-state.json")))
      .digest("hex");
    const report = await runRuntimeNamespaceMigration({
      sourceGroupsRoot: legacyRoot,
      target: { profile: "managed_enterprise", tenantsRoot },
      groupIds: ["grp-keep"],
    });
    expect(report.mode).toBe("dry-run");
    expect(report.direction).toBe("forward");
    expect(report.groups[0]?.status).toBe("planned");
    expect(report.groups[0]?.files.map((file) => file.fact)).toEqual(["rounds/r1.json"]);
    expect(report.groups[0]?.retainedOnLegacyStore).toEqual(
      expect.arrayContaining(["operating-state.json", "runtime/behavior-buffer.json"]),
    );
    expect(report.groups[0]?.files.some((file) => file.fact.includes("operating-state"))).toBe(
      false,
    );
    expect(report.groups[0]?.files.some((file) => file.fact.includes("behavior-buffer"))).toBe(
      false,
    );
    await expect(fs.stat(path.join(tenantsRoot, "001"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      createHash("sha256")
        .update(await fs.readFile(path.join(groupDir, "operating-state.json")))
        .digest("hex"),
    ).toBe(before);

    const reverse = await runRuntimeNamespaceMigration({
      sourceGroupsRoot: legacyRoot,
      target: { profile: "managed_enterprise", tenantsRoot },
      direction: "reverse",
      groupIds: ["grp-keep"],
    });
    expect(reverse.mode).toBe("dry-run");
    expect(reverse.direction).toBe("reverse");
    await expect(fs.stat(tenantsRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("production writers stay on the resolver and the flag is not defaulted on", () => {
    const roundStore = readFileSync(new URL("./round-store.ts", import.meta.url), "utf8");
    const writer = readFileSync(
      new URL("../collaboration-ledger/writer.ts", import.meta.url),
      "utf8",
    );
    const authority = readFileSync(new URL("./runtime-authority.ts", import.meta.url), "utf8");
    const chat = readFileSync(new URL("../server-methods/chat.ts", import.meta.url), "utf8");
    const schema = readFileSync(new URL("../../config/zod-schema.ts", import.meta.url), "utf8");

    expect(roundStore).toContain("resolveCollaborationRuntimeFactPaths");
    expect(roundStore).toContain("assertCollaborationRuntimeWritable");
    expect(roundStore).toContain("if (!isCollabRuntimeNamespaceEnabled() && params.roundsDir)");
    expect(roundStore).not.toMatch(/if \(params\.roundsDir\) \{\s*return params\.roundsDir;/);
    expect(writer).toContain("resolveCollaborationRuntimeFactPaths");
    expect(writer).toContain("assertCollaborationRuntimeWritable");
    expect(authority).toContain("!isCollabRuntimeNamespaceEnabled(params.cfg)");
    expect(schema).toContain("runtimeNamespace: z.boolean().optional()");
    expect(schema).not.toContain("runtimeNamespace: z.boolean().default(true)");

    const callAt = chat.indexOf("executeCollaborationRound(authority, facts, {");
    expect(callAt).toBeGreaterThan(-1);
    expect(chat.slice(callAt, callAt + 500)).not.toContain("roundsDir");
    expect(chat).toContain("resolveProductionCollaborationExecutor(policySnapshotCfg)");
  });
});

describe("P0 G7 list/history overreach (flag on)", () => {
  test("list-overreach (G7): tenant B listPersistedRounds cannot see tenant A", async () => {
    useCfg(cfgFor({ profile: "managed_enterprise", runtimeNamespace: true }));
    await writePersistedRound({ round: round("r-g7-a", "grp-g7-over", "001") });
    await writePersistedRound({ round: round("r-g7-b", "grp-g7-over", "002") });
    const listedA = await listPersistedRounds({ groupId: "grp-g7-over", tenantId: "001" });
    const listedB = await listPersistedRounds({ groupId: "grp-g7-over", tenantId: "002" });
    expect(listedA.map((r) => r.roundId)).toEqual(["r-g7-a"]);
    expect(listedB.map((r) => r.roundId)).toEqual(["r-g7-b"]);
    await expect(
      readPersistedRound({ groupId: "grp-g7-over", roundId: "r-g7-a", tenantId: "002" }),
    ).resolves.toBeNull();
  });

  test("history overreach (G7): tenant B ledger archive cannot see tenant A", async () => {
    useCfg(cfgFor({ profile: "managed_enterprise", runtimeNamespace: true }));
    await appendCollaborationPromotionAuditRecord({
      groupId: "grp-g7-hist",
      sourceGroupId: "grp-g7-hist",
      botId: "bot-g7-a",
      promoted: true,
      reason: "a-only",
      targetScope: "group",
      tenantId: "001",
    });
    await appendCollaborationPromotionAuditRecord({
      groupId: "grp-g7-hist",
      sourceGroupId: "grp-g7-hist",
      botId: "bot-g7-b",
      promoted: true,
      reason: "b-only",
      targetScope: "group",
      tenantId: "002",
    });
    const a = await readCollaborationLedgerArchive({ groupId: "grp-g7-hist", tenantId: "001" });
    const b = await readCollaborationLedgerArchive({ groupId: "grp-g7-hist", tenantId: "002" });
    expect(a.records.map((r) => (r as { botId?: string }).botId)).toEqual(["bot-g7-a"]);
    expect(b.records.map((r) => (r as { botId?: string }).botId)).toEqual(["bot-g7-b"]);
  });
});
