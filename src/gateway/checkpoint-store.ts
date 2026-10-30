/**
 * Gateway-facing checkpoint queries for the chat checkpoint/rollback feature.
 * Resolves host and tenant Data Space roots, including per-robot dirs.
 * Host, steward, and client workspace lookup uses resolveWorkspaceLocator and fail-closes.
 * // resolveAgentWorkspaceDir
 */

import fs from "node:fs";
import path from "node:path";
import { resolveSessionAgentId } from "../agents/agent-scope.js";
import {
  extractEmployeeStewardUserIdFromSessionKey,
  sessionKeysForChatHistoryActiveRun,
} from "../agents/builtin-steward/employee-isolation.js";
import { isBuiltinStewardAgent } from "../agents/builtin-steward/identity.js";
import {
  listSessionContinuityCheckpoints,
  loadSessionContinuityCheckpointById,
  type MemoryCheckpoint,
  type SessionCheckpointSummary,
} from "../auto-reply/reply/session-continuity.js";
import { loadConfig } from "../config/config.js";
import type { OpenBotConfig } from "../config/types.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveSecurityProfile } from "./security-profile.js";
import type { GatewayClient } from "./server-methods/types.js";
import { loadSessionEntry } from "./session-utils.js";
import { loadSessionEntryForClient } from "./tenant-context.js";
/** Client workspace lookup uses resolveWorkspaceLocator and fail-closes. */
import { resolveTenantsRoot } from "./tenant-store-paths.js";
import { resolveWorkspaceLocator } from "./workspace-resolver/strict-locator.js";
import {
  resolveRobotOwnWriteRoot,
  resolveRobotWriteRoot,
  tryResolveLiveRobotWriteRoot,
} from "./workspace-resolver/write-roots.js";
import {
  resolveAuthorizedToolCwd,
  resolveWorkspaceDirAfterAuthorization,
} from "./workspace/handler-bridge.js";

/** Best-effort trusted tenant id from an already-authenticated gateway client. */
export function readTrustedTenantIdFromGatewayClient(client: GatewayClient | null): string | null {
  if (!client || typeof client !== "object") {
    return null;
  }
  const record = client as {
    tenantId?: unknown;
    sessionEnterpriseId?: unknown;
    sessionTenantId?: unknown;
    connect?: { params?: { tenantId?: unknown } };
  };
  const sessionEnterpriseId =
    typeof record.sessionEnterpriseId === "string" ? record.sessionEnterpriseId.trim() : "";
  if (sessionEnterpriseId) {
    return sessionEnterpriseId;
  }
  const sessionTenantId =
    typeof record.sessionTenantId === "string" ? record.sessionTenantId.trim() : "";
  if (sessionTenantId) {
    return sessionTenantId;
  }
  const direct = typeof record.tenantId === "string" ? record.tenantId.trim() : "";
  if (direct) {
    return direct;
  }
  const nested =
    typeof record.connect?.params?.tenantId === "string"
      ? record.connect.params.tenantId.trim()
      : "";
  return nested || null;
}

function readTrustedTenantIdFromClient(client: GatewayClient | null): string | null {
  return readTrustedTenantIdFromGatewayClient(client);
}

function uniqueWorkspaceDirs(dirs: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of dirs) {
    const trimmed = typeof dir === "string" ? dir.trim() : "";
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Same key set as `chat.history` in-flight adoption.
 * After an employee remap, the raw `main` / `agent:main:main` alias is not a
 * second conversation to list or restore. Loading it also heals the global
 * steward transcript into the operator store.
 */
function checkpointSessionKeys(sessionKey: string, rawSessionKey?: string): string[] {
  return sessionKeysForChatHistoryActiveRun({
    resolvedSessionKey: sessionKey,
    rawSessionKey: rawSessionKey ?? "",
  });
}

async function loadCheckpointListingConfig(
  client: GatewayClient | null,
  keys: readonly string[],
): Promise<OpenBotConfig> {
  for (const key of keys) {
    try {
      const loaded = await loadSessionEntryForClient(key, client);
      return loaded.cfg;
    } catch {
      // The next allowed key may still resolve config.
    }
  }
  // Config only. Do not load "main" here: that call heals the global steward
  // session after history has already remapped the employee off it.
  return loadConfig();
}

function hasCheckpointDir(workspaceDir: string): boolean {
  try {
    return fs.existsSync(path.join(workspaceDir, "memory", "checkpoints"));
  } catch {
    return false;
  }
}

function robotOwnCheckpointDir(params: {
  tenantId: string;
  userId: string;
  agentId: string;
}): string {
  return resolveRobotOwnWriteRoot({
    stateDir: path.dirname(resolveTenantsRoot()),
    tenantId: params.tenantId,
    userId: params.userId,
    agentId: params.agentId,
  });
}

/**
 * Steward tenant root: tenants/<tid>/users/<owner>/OpenBot/agents/main/workspace.
 * P0-e: never enumerate all tenant directories. Missing tenantId returns [].
 */
export function resolveTenantUserOpenBotWorkspaceCandidates(
  platformUserId: string,
  tenantId: string | null | undefined,
): string[] {
  const owner = platformUserId.trim();
  const tenant = tenantId?.trim() ?? "";
  if (!owner || !tenant) {
    return [];
  }
  const candidate = robotOwnCheckpointDir({
    tenantId: tenant,
    userId: owner,
    agentId: "main",
  });
  return hasCheckpointDir(candidate) ? [candidate] : [];
}

/**
 * Per-robot tenant root for one authoritative tenant + owner:
 * tenants/<tid>/users/<uid>/OpenBot/agents/<agentId>/workspace.
 *
 * P0-e: never scan all tenants or all users. Missing tenant/owner returns [].
 */
export function resolveTenantOpenBotAgentWorkspaceCandidates(
  agentId: string,
  tenantId: string | null | undefined,
  ownerUserId: string | null | undefined,
): string[] {
  const agent = normalizeAgentId(agentId);
  const tenant = tenantId?.trim() ?? "";
  const owner = ownerUserId?.trim() ?? "";
  if (!agent || isBuiltinStewardAgent(agent) || !tenant || !owner) {
    return [];
  }
  const candidate = robotOwnCheckpointDir({
    tenantId: tenant,
    userId: owner,
    agentId: agent,
  });
  return hasCheckpointDir(candidate) ? [candidate] : [];
}

function resolveChatCheckpointWorkspaceDirsSync(params: {
  cfg: OpenBotConfig;
  sessionKey: string;
  agentId: string;
  tenantId?: string | null;
}): string[] {
  const { cfg, sessionKey, agentId, tenantId } = params;
  const dirs: Array<string | null | undefined> = [];
  const locatedHost = resolveWorkspaceLocator({ cfg });
  dirs.push(locatedHost.ok ? locatedHost.handle.locator : null);
  // Live robot own root only — never invent retired host workspace-<id>.
  if (!isBuiltinStewardAgent(agentId)) {
    const live = tryResolveLiveRobotWriteRoot({
      agentId,
      sessionKey,
      tenantId,
      configuredDefaultWorkspace: cfg.agents?.defaults?.workspace,
    });
    if (live) {
      dirs.push(live);
    }
  }
  const employeeOwner = extractEmployeeStewardUserIdFromSessionKey(sessionKey);
  if (employeeOwner) {
    const locatedSteward = resolveWorkspaceLocator({
      cfg,
      tenantId,
      tenantContext: tenantId ? { tenantId, userId: employeeOwner, domain: "enterprise" } : null,
      actor: {
        userId: employeeOwner,
        grant: { kind: "user", subjectId: employeeOwner, purpose: "checkpoint.steward" },
      },
      agentAssetId: "steward:builtin",
    });
    dirs.push(locatedSteward.ok ? locatedSteward.handle.locator : null);
    dirs.push(...resolveTenantUserOpenBotWorkspaceCandidates(employeeOwner, tenantId));
  }
  dirs.push(...resolveTenantOpenBotAgentWorkspaceCandidates(agentId, tenantId, employeeOwner));
  return uniqueWorkspaceDirs(dirs);
}

/**
 * List a (already scope-resolved) session's checkpoints, ascending by time.
 *
 * Session identity MUST come from the same store as chat.history / chat.restore
 * (`loadSessionEntryForClient`): the single conversation-following store.
 * Mixing a different loader here makes checkpointMatchesSession miss
 * (UI lists a 检查点; restore says not found).
 */
export async function listChatCheckpoints(
  sessionKey: string,
  client: GatewayClient | null = null,
  rawSessionKey?: string,
): Promise<SessionCheckpointSummary[]> {
  const keys = checkpointSessionKeys(sessionKey, rawSessionKey);
  const cfg = await loadCheckpointListingConfig(client, keys);
  const tenantId = readTrustedTenantIdFromClient(client);
  const byId = new Map<string, SessionCheckpointSummary>();
  const allWorkspaceDirs: string[] = [];
  for (const key of keys) {
    let entry: ReturnType<typeof loadSessionEntry>["entry"];
    try {
      ({ entry } = await loadSessionEntryForClient(key, client, cfg));
    } catch {
      entry = undefined;
    }
    const agentId = resolveSessionAgentId({ sessionKey: key, config: cfg });
    const workspaceDirs = await resolveChatCheckpointWorkspaceDirsForClient({
      cfg,
      sessionKey: key,
      agentId,
      client,
    });
    if (workspaceDirs.length === 0) {
      workspaceDirs.push(process.cwd());
    }
    allWorkspaceDirs.push(...workspaceDirs);
    for (const workspaceDir of workspaceDirs) {
      let checkpoints: SessionCheckpointSummary[] = [];
      try {
        checkpoints = await listSessionContinuityCheckpoints({
          cfg,
          workspaceDir,
          agentId,
          sessionKey: key,
          sessionEntry: entry,
          tenantId,
        });
      } catch {
        continue;
      }
      for (const checkpoint of checkpoints) {
        if (!byId.has(checkpoint.checkpointId)) {
          byId.set(checkpoint.checkpointId, checkpoint);
        }
      }
    }
  }
  if (client) {
    try {
      const locatedTenant = resolveWorkspaceLocator({ cfg });
      const tenantDir = locatedTenant.ok ? locatedTenant.handle.locator : null;
      void import("./checkpoint-store-w2-shadow.js").then(({ scheduleCheckpointStoreS07Shadow }) =>
        scheduleCheckpointStoreS07Shadow({
          legacyLocator: allWorkspaceDirs[0] ?? null,
          replacementLocator: tenantDir,
        }),
      );
    } catch {
      // Shadow-only; listing already used the client-aware workspace dirs.
    }
  }
  void import("./checkpoint-store-w2-shadow.js").then(({ scheduleCheckpointStoreS05S06Shadow }) =>
    scheduleCheckpointStoreS05S06Shadow({
      workspaceDirs: uniqueWorkspaceDirs(allWorkspaceDirs),
      employeeOwner:
        extractEmployeeStewardUserIdFromSessionKey(sessionKey) ??
        extractEmployeeStewardUserIdFromSessionKey(rawSessionKey ?? ""),
    }),
  );
  return [...byId.values()].toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function resolveChatCheckpointWorkspaceDirsForClient(params: {
  cfg: OpenBotConfig;
  sessionKey: string;
  agentId: string;
  client: GatewayClient | null;
  primaryWorkspaceDir?: string | null;
}): Promise<string[]> {
  const tenantId = readTrustedTenantIdFromClient(params.client);
  const dirs = resolveChatCheckpointWorkspaceDirsSync({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    tenantId,
  });
  const owner =
    params.client?.platformUserId?.trim() ||
    extractEmployeeStewardUserIdFromSessionKey(params.sessionKey) ||
    "";
  const robotOwn = resolveRobotWriteRoot({
    agentId: params.agentId,
    tenantId,
    userId: owner,
    sessionKey: params.sessionKey,
  });
  if (robotOwn) {
    dirs.push(robotOwn);
  }
  if (owner) {
    dirs.push(...resolveTenantOpenBotAgentWorkspaceCandidates(params.agentId, tenantId, owner));
    dirs.push(...resolveTenantUserOpenBotWorkspaceCandidates(owner, tenantId));
  }
  const primary = params.primaryWorkspaceDir?.trim();
  if (primary && !dirs.includes(primary)) {
    dirs.unshift(primary);
  }
  // Commits write into the authorized turn cwd. Listing only the locator
  // candidates misses robots whose checkpoints landed on that cwd.
  if (owner) {
    try {
      const authorized = await resolveAuthorizedToolCwd({
        client: params.client,
        cfg: params.cfg,
        userId: owner,
        agentId: params.agentId,
        purpose: "chat.checkpoint.list",
      });
      const cwd = resolveWorkspaceDirAfterAuthorization({
        profile: resolveSecurityProfile(params.cfg, process.env).profile,
        authorizedCwd: authorized,
      });
      if (cwd) {
        dirs.push(cwd);
      }
    } catch {
      // Locator candidates above still apply.
    }
  }
  return uniqueWorkspaceDirs(dirs);
}

/**
 * Restore must find the same checkpoint the divider listed. Listing searches
 * host + tenant `workspace-<agentId>` candidates; a single authorized cwd
 * can miss the file after identity hydrate picks a different locator.
 */
export async function loadChatCheckpointForRestore(params: {
  cfg: OpenBotConfig;
  sessionKey: string;
  rawSessionKey?: string;
  agentId: string;
  client: GatewayClient | null;
  sessionEntry?: ReturnType<typeof loadSessionEntry>["entry"];
  checkpointId: string;
  primaryWorkspaceDir: string;
}): Promise<{ checkpoint: MemoryCheckpoint; workspaceDir: string; sessionKey: string } | null> {
  const keys = checkpointSessionKeys(params.sessionKey, params.rawSessionKey);
  const dirs: string[] = [];
  for (const sessionKey of keys) {
    const agentId = resolveSessionAgentId({ sessionKey, config: params.cfg });
    dirs.push(
      ...(await resolveChatCheckpointWorkspaceDirsForClient({
        cfg: params.cfg,
        sessionKey,
        agentId,
        client: params.client,
        primaryWorkspaceDir: params.primaryWorkspaceDir,
      })),
    );
  }
  const seenDir = new Set<string>();
  for (const workspaceDir of uniqueWorkspaceDirs(dirs)) {
    if (seenDir.has(workspaceDir)) {
      continue;
    }
    seenDir.add(workspaceDir);
    for (const sessionKey of keys) {
      // Same store as listChatCheckpoints / chat.history: never match against a
      // process-global sessionId while the UI listed via the tenant entry.
      let sessionEntry = params.sessionEntry;
      if (sessionKey !== params.sessionKey || !sessionEntry) {
        try {
          ({ entry: sessionEntry } = await loadSessionEntryForClient(
            sessionKey,
            params.client,
            params.cfg,
          ));
        } catch {
          sessionEntry = params.sessionEntry;
        }
      }
      const checkpoint = await loadSessionContinuityCheckpointById({
        cfg: params.cfg,
        workspaceDir,
        agentId: resolveSessionAgentId({ sessionKey, config: params.cfg }),
        sessionKey,
        sessionEntry,
        checkpointId: params.checkpointId,
        tenantId: readTrustedTenantIdFromClient(params.client),
      });
      if (checkpoint) {
        return { checkpoint, workspaceDir, sessionKey };
      }
    }
  }
  return null;
}
