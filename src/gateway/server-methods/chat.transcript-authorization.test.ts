/**
 * Real Handle chain for steward transcript cwd.
 * The shadow helper is passed through, but the directory that lands in the
 * transcript header is the Handle path. Denial writes nothing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildEmployeeBuiltinStewardSessionKey } from "../../agents/builtin-steward/employee-isolation.js";
import type { OpenBotConfig } from "../../config/config.js";
import { resetSharedDataGovernanceCatalogForTests } from "../data-governance/runtime-catalog.js";
import { TenantContextError, type TenantContext } from "../tenant-context.js";
import type { GatewayClient } from "./types.js";

const tenantMode = vi.hoisted(() => ({
  value: "ok" as "ok" | "missing" | "mismatch" | "real",
  knowledgeUserId: "usr-steward-owner",
}));
const locatorMode = vi.hoisted(() => ({
  value: "ok" as "ok" | "deny" | "throw",
  locator: "",
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

vi.mock("../knowledge/context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../knowledge/context.js")>();
  return {
    ...original,
    resolveKnowledgeSourceContext: vi.fn(async () => ({
      tenantId: tenantMode.value === "ok" ? "ent-456" : null,
      seatId: null,
      userId: tenantMode.value === "ok" ? tenantMode.knowledgeUserId : null,
      teamLabel: null,
      roleCode: null,
      departmentId: null,
      agentType: "employee-agent" as const,
      hasEnterpriseScope: tenantMode.value === "ok",
    })),
  };
});

vi.mock("../tenant-context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../tenant-context.js")>();
  const resolve = async (client: GatewayClient | null): Promise<TenantContext | null> => {
    if (tenantMode.value === "real") {
      return original.resolveTenantContext(client);
    }
    if (tenantMode.value === "missing") {
      throw new original.TenantContextError(
        "cannot resolve tenant for session (no enterprise membership)",
        "unresolved_tenant",
      );
    }
    if (tenantMode.value === "mismatch") {
      throw new original.TenantContextError(
        "session tenant hint (ent-b) does not match authoritative tenant (ent-456)",
        "hint_mismatch",
      );
    }
    return {
      tenantId: "ent-456",
      userId: "usr-steward-owner",
      domain: "employee",
    };
  };
  return {
    ...original,
    resolveTenantContext: resolve,
    resolveTenantContextForSessionStore: resolve,
  };
});

vi.mock("./agents-handler-workspace-locator.js", () => ({
  resolveAgentsHandlerWorkspaceLocator: vi.fn(async () => {
    if (locatorMode.value === "throw") {
      throw new Error("locator_rejected");
    }
    if (locatorMode.value === "deny") {
      return {
        ok: false as const,
        reasonCode: "missing_tenant_context",
        failClosed: true as const,
      };
    }
    return {
      ok: true as const,
      handle: {
        resourceId: "ws:ent-456:user:usr-steward-owner:asset:asset-alpha",
        agentAssetId: "asset-alpha",
        bindingId: "bind-1",
        locator: locatorMode.locator,
        tenantId: "ent-456",
      },
      locator: {
        resourceId: "ws:ent-456:user:usr-steward-owner:asset:asset-alpha",
        agentAssetId: "asset-alpha",
        bindingId: "bind-1",
        locator: locatorMode.locator,
        tenantId: "ent-456",
      },
    };
  }),
  resolveAgentsHandlerWorkspaceLocatorOrRespond: vi.fn(),
}));

const { ensureTranscriptFile, resolveCallerWorkspaceCwdDetailed, appendUserTranscriptMessage } =
  await import("./chat.js");

const managedCfg = {
  data: { mode: "managed" },
  gateway: { security: { profile: "managed_enterprise" } },
} as OpenBotConfig;

const ownerId = "usr-steward-owner";
const tempDirs: string[] = [];
const envKeys = [
  "OPENBOT_STATE_DIR",
  "OPENBOT_SECURITY_PROFILE",
  "OPENCLAW_SECURITY_PROFILE",
  "OPENBOT_DATA_MODE",
  "OPENCLAW_DATA_MODE",
] as const;
const savedEnv = new Map<string, string | undefined>();

function client(extra?: Partial<GatewayClient>): GatewayClient {
  return {
    platformUserId: ownerId,
    sessionDomain: "employee",
    sessionEnterpriseId: "ent-456",
    user: "owner@example.com",
    ...extra,
  } as GatewayClient;
}

beforeEach(() => {
  for (const key of envKeys) {
    savedEnv.set(key, process.env[key]);
  }
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-transcript-auth-"));
  tempDirs.push(stateDir);
  process.env.OPENBOT_STATE_DIR = stateDir;
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  delete process.env.OPENBOT_DATA_MODE;
  delete process.env.OPENCLAW_DATA_MODE;
  resetSharedDataGovernanceCatalogForTests();
  tenantMode.value = "ok";
  tenantMode.knowledgeUserId = "usr-steward-owner";
  locatorMode.value = "ok";
  locatorMode.locator = fs.mkdtempSync(path.join(stateDir, "handle-"));
  fs.mkdirSync(locatorMode.locator, { recursive: true });
});

afterEach(() => {
  for (const key of envKeys) {
    const previous = savedEnv.get(key);
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("creates a new transcript at the Handle directory and appends the next turn", async () => {
  const resolved = await resolveCallerWorkspaceCwdDetailed({
    cfg: managedCfg,
    sessionKey: buildEmployeeBuiltinStewardSessionKey(ownerId),
    agentId: "main",
    client: client(),
  });
  expect(resolved.cwd).toBe(fs.realpathSync(locatorMode.locator));
  expect(resolved.cwd).not.toContain("employees");

  const sessionsDir = fs.mkdtempSync(path.join(process.env.OPENBOT_STATE_DIR!, "sessions-"));
  tempDirs.push(sessionsDir);
  const transcriptPath = path.join(sessionsDir, "after-new.jsonl");
  const created = await ensureTranscriptFile({
    transcriptPath,
    sessionId: "sess-new",
    cwd: resolved.cwd,
    tenantId: "ent-456",
    ownerUserId: ownerId,
    failClosed: true,
  });
  expect(created.ok).toBe(true);
  const header = JSON.parse(fs.readFileSync(transcriptPath, "utf8").split("\n")[0]) as {
    cwd?: string;
  };
  expect(header.cwd).toBe(resolved.cwd);

  const appended = await appendUserTranscriptMessage({
    sessionId: "sess-new",
    storePath: path.join(sessionsDir, "sessions.json"),
    sessionFile: transcriptPath,
    agentId: "main",
    idempotencyKey: "turn-2",
    message: { role: "user", content: [{ type: "text", text: "下一句" }] },
    workspaceCwd: resolved.cwd,
    tenantId: "ent-456",
    ownerUserId: ownerId,
    failClosed: true,
  });
  expect(appended.ok).toBe(true);
  const lines = fs.readFileSync(transcriptPath, "utf8").trim().split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain("下一句");
  expect(lines[1]).not.toContain("SyntaxError");
});

it("does not write a transcript when Handle denies or throws", async () => {
  const sessionsDir = fs.mkdtempSync(path.join(process.env.OPENBOT_STATE_DIR!, "sessions-deny-"));
  tempDirs.push(sessionsDir);
  for (const mode of ["deny", "throw"] as const) {
    locatorMode.value = mode;
    const transcriptPath = path.join(sessionsDir, `${mode}.jsonl`);
    const resolved = await resolveCallerWorkspaceCwdDetailed({
      cfg: managedCfg,
      sessionKey: buildEmployeeBuiltinStewardSessionKey(ownerId),
      agentId: "main",
      client: client(),
    });
    expect(resolved.cwd).toBeNull();
    expect(resolved.reasonCode).toBeTruthy();
    const ensured = await ensureTranscriptFile({
      transcriptPath,
      sessionId: `sess-${mode}`,
      cwd: resolved.cwd,
      cwdDenialReason: resolved.reasonCode,
      tenantId: "ent-456",
      ownerUserId: ownerId,
      failClosed: true,
    });
    expect(ensured.ok).toBe(false);
    expect(ensured.error).not.toMatch(/SyntaxError|model|switch/i);
    expect(fs.existsSync(transcriptPath)).toBe(false);
    expect(fs.readdirSync(locatorMode.locator).filter((name) => name.endsWith(".jsonl"))).toEqual(
      [],
    );
  }
});

it("refuses a missing trusted tenant without inventing an enterprise or a directory", async () => {
  tenantMode.value = "missing";
  const transcriptPath = path.join(process.env.OPENBOT_STATE_DIR!, "missing-tenant.jsonl");
  const resolved = await resolveCallerWorkspaceCwdDetailed({
    cfg: managedCfg,
    sessionKey: buildEmployeeBuiltinStewardSessionKey(ownerId),
    agentId: "main",
    client: client({ sessionEnterpriseId: undefined }),
  });
  expect(resolved).toEqual({ cwd: null, reasonCode: "missing_tenant" });
  const ensured = await ensureTranscriptFile({
    transcriptPath,
    sessionId: "sess-missing",
    cwd: null,
    cwdDenialReason: resolved.reasonCode,
    tenantId: null,
    ownerUserId: ownerId,
    failClosed: true,
  });
  expect(ensured.error).toBe("trusted tenant context required for managed transcript");
  expect(ensured.error).not.toMatch(/SyntaxError|model|switch/i);
  expect(fs.existsSync(transcriptPath)).toBe(false);
});

it("refuses an enterprise hint mismatch and an actor mismatch without writing", async () => {
  tenantMode.value = "mismatch";
  const mismatchPath = path.join(process.env.OPENBOT_STATE_DIR!, "mismatch.jsonl");
  const mismatch = await resolveCallerWorkspaceCwdDetailed({
    cfg: managedCfg,
    sessionKey: buildEmployeeBuiltinStewardSessionKey(ownerId),
    agentId: "main",
    client: client({ sessionTenantId: "ent-b" } as GatewayClient),
  });
  expect(mismatch.cwd).toBeNull();
  expect(mismatch.reasonCode).toBe("hint_mismatch");
  const mismatchWrite = await ensureTranscriptFile({
    transcriptPath: mismatchPath,
    sessionId: "sess-mismatch",
    cwd: null,
    cwdDenialReason: mismatch.reasonCode,
    tenantId: "ent-456",
    ownerUserId: ownerId,
    failClosed: true,
  });
  expect(mismatchWrite.error).toMatch(/does not match this session/);
  expect(fs.existsSync(mismatchPath)).toBe(false);

  tenantMode.value = "ok";
  tenantMode.knowledgeUserId = "usr-other";
  const actorPath = path.join(process.env.OPENBOT_STATE_DIR!, "actor.jsonl");
  const actor = await resolveCallerWorkspaceCwdDetailed({
    cfg: managedCfg,
    sessionKey: buildEmployeeBuiltinStewardSessionKey(ownerId),
    agentId: "main",
    client: client(),
  });
  expect(actor).toEqual({ cwd: null, reasonCode: "actor_mismatch" });
  expect(fs.existsSync(actorPath)).toBe(false);
});

it("keeps appending an existing transcript when cwd is already known", async () => {
  const sessionsDir = fs.mkdtempSync(path.join(process.env.OPENBOT_STATE_DIR!, "sessions-old-"));
  tempDirs.push(sessionsDir);
  const transcriptPath = path.join(sessionsDir, "existing.jsonl");
  const created = await ensureTranscriptFile({
    transcriptPath,
    sessionId: "sess-old",
    cwd: fs.realpathSync(locatorMode.locator),
    tenantId: "ent-456",
    ownerUserId: ownerId,
    failClosed: true,
  });
  expect(created.ok).toBe(true);
  const again = await appendUserTranscriptMessage({
    sessionId: "sess-old",
    storePath: path.join(sessionsDir, "sessions.json"),
    sessionFile: transcriptPath,
    agentId: "main",
    idempotencyKey: "keep-1",
    message: { role: "user", content: [{ type: "text", text: "还在" }] },
    workspaceCwd: null,
    tenantId: "ent-456",
    ownerUserId: ownerId,
    failClosed: true,
  });
  expect(again.ok).toBe(true);
  const readBack = fs.readFileSync(transcriptPath, "utf8");
  expect(readBack).toContain("还在");
  expect(readBack.split("\n").filter((line) => line.includes('"type":"session"'))).toHaveLength(1);
});

it("explains a real missing membership as unresolved tenant, not a model failure", async () => {
  tenantMode.value = "real";
  await expect(
    resolveCallerWorkspaceCwdDetailed({
      cfg: managedCfg,
      sessionKey: buildEmployeeBuiltinStewardSessionKey(ownerId),
      agentId: "main",
      client: client({
        user: undefined,
        platformUserId: undefined,
        sessionEnterpriseId: "ent-456",
      }),
    }),
  ).resolves.toMatchObject({ cwd: null, reasonCode: "missing_tenant" });
  expect(new TenantContextError("x", "unresolved_tenant").code).toBe("unresolved_tenant");
});
