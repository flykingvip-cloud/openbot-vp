import { randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  listAgentIds,
  resolveAgentDir,
} from "../../agents/agent-scope.js";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
  ensureAgentWorkspace,
  isWorkspaceOnboardingCompleted,
} from "../../agents/workspace.js";
import { movePathToTrash } from "../../browser/trash.js";
import {
  applyAgentConfig,
  findAgentEntryIndex,
  listAgentEntries,
  pruneAgentConfig,
} from "../../commands/agents.config.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { resolveSessionTranscriptsDirForAgent } from "../../config/sessions/paths.js";
import {
  applyAgentMemoryDisposal,
  type AgentMemoryDisposalMode,
} from "../../data/memory-lifecycle.js";
import { sameFileIdentity } from "../../infra/file-identity.js";
import { SafeOpenError, readLocalFileSafely, writeFileWithinRoot } from "../../infra/fs-safe.js";
import { assertNoPathAliasEscape } from "../../infra/path-alias-guards.js";
import { isNotFoundPathError } from "../../infra/path-guards.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "../../routing/session-key.js";
import { resolveUserPath } from "../../utils.js";
import { decommissionRobotWorkspace } from "../../workspaces/store.js";
import {
  auditAssetCreated,
  auditOwnershipTransfer,
  type AuthorizeAgentAssetResult,
  authorizeAgentAssetAccess,
  rejectAgentAssetWriteWhenDenied,
} from "../access-control/authorize.js";
import { buildOwnerBaselinePolicies } from "../access-control/policy-v2-evaluator.js";
import { createInitialGrowthStatus } from "../agent-growth/factory.js";
import { writeRobotGrowthStatus } from "../agent-growth/store.js";
import { resolveAgentCreateOwnershipForClient } from "../agent-registry/agent-create-ownership.js";
import { setPrimaryOwner } from "../agent-registry/ownership.js";
import { createAgentAsset } from "../agent-registry/registry.js";
import { loadAgentRegistryStore, saveAgentRegistryStore } from "../agent-registry/store.js";
import { collectAgentRuntimeHealth } from "../agent-runtime-health-collect.js";
import {
  authorizeBillableBotCreate,
  publishBillableBotChanged,
  registerBillableBot,
  releaseBillableBotForAgent,
} from "../billing/billable-bot.js";
import type { BotResource } from "../billing/types.js";
import { autoInstallCapabilitiesOnAgentCreate } from "../capability-packs/install-pack-to-robot.js";
import { compensateAgentCreateFailure } from "../data-governance/create-compensate.js";
import { writeGovernanceOpMarker } from "../data-governance/operation-marker.js";
import {
  activateAgentGovernanceRegistration,
  beginAgentGovernanceRegistration,
  upsertWorkspaceGovernanceRecord,
} from "../data-governance/runtime-catalog.js";
import {
  isAgentOwnedByEmployeeUser,
  requiresEmployeeAssetScope,
  resolveEmployeeWorkbenchActor,
  resolveScopedAgentsForClient,
  type EmployeeWorkbenchActor,
} from "../employee-workbench-scope.js";
import { resolveKnowledgeSourceContext } from "../knowledge/context.js";
import { findActiveOwnershipRecord, revokeOwnershipRecord, upsertOwnershipRecord } from "../ownership-store.js";
import {
  bindAgentAssetToSeatForTenant,
  unbindAgentAssetFromSeatForTenant,
} from "../platform-auth/seat-store-loader.js";
import { buildWorkspaceResourceId } from "../workspace-resolver/builders.js";
import { stringValue } from "../records.js";
import { resolveAgentIdentityWriteAccess } from "./agent-identity-write.js";
import { resolveAgentsHandlerWorkspaceLocatorOrRespond } from "./agents-handler-workspace-locator.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAgentsCreateParams,
  validateAgentsDeleteParams,
  validateAgentsFilesGetParams,
  validateAgentsFilesListParams,
  validateAgentsFilesSetParams,
  validateAgentsListParams,
  validateAgentsUpdateParams,
  validateAgentsWorkspaceBrowseParams,
} from "../protocol/index.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { listAgentsForGateway } from "../session-utils.js";
import {
  authorizeAgentWorkspaceFileAccess,
  PRIMARY_CAPABLE_WRITE_CHANNELS,
  // S14: Trusted locator import retired; keep later watch-line numbers
} from "../workspace/handler-bridge.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

const BOOTSTRAP_FILE_NAMES = [
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
] as const;
const BOOTSTRAP_FILE_NAMES_POST_ONBOARDING = BOOTSTRAP_FILE_NAMES.filter(
  (name) => name !== DEFAULT_BOOTSTRAP_FILENAME,
);

const MEMORY_FILE_NAMES = [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME] as const;

const ALLOWED_FILE_NAMES = new Set<string>([...BOOTSTRAP_FILE_NAMES, ...MEMORY_FILE_NAMES]);

/**
 * 删除数字人后释放对应计费 Bot（软删）。best-effort：config 已删除，计费侧失败只告警，
 * 不让 agents.delete 失败；无对应记录（本地 agent / 历史数据）时 no-op。
 */
async function releaseBillableBotForAgentBestEffort(
  tenantId: string | null,
  agentId: string,
): Promise<void> {
  try {
    await releaseBillableBotForAgent({ enterpriseId: tenantId, agentId });
  } catch (error) {
    console.warn(`[agents.delete] billing bot release failed for ${agentId}: ${String(error)}`);
  }
}

async function resolveAgentWorkspaceFileOrRespondError(
  params: Record<string, unknown>,
  respond: RespondFn,
  client: GatewayClient | null | undefined,
): Promise<{
  cfg: ReturnType<typeof loadConfig>;
  agentId: string;
  workspaceDir: string;
  name: string;
} | null> {
  const cfg = loadConfig();
  const rawAgentId = params.agentId;
  const agentId = resolveAgentIdOrError(
    typeof rawAgentId === "string" || typeof rawAgentId === "number" ? String(rawAgentId) : "",
    cfg,
  );
  if (!agentId) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
    return null;
  }
  const rawName = params.name;
  const name = (
    typeof rawName === "string" || typeof rawName === "number" ? String(rawName) : ""
  ).trim();
  if (!ALLOWED_FILE_NAMES.has(name)) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unsupported file "${name}"`));
    return null;
  }
  const workspaceDir = await resolveAgentsHandlerWorkspaceLocatorOrRespond({ client, cfg, agentId, purpose: "agents.files", respond });
  if (!workspaceDir) { return null; }
  return (void import("../agents-w2-shadow.js").then((m) => m.scheduleAgentsW2ResolvedShadowPair({ siteIdTrusted: "S10-agents-files-trusted", siteIdLegacy: "S11-agents-files-legacy", resolvedLocator: workspaceDir })), { cfg, agentId, workspaceDir, name });
}

type FileMeta = {
  size: number;
  updatedAtMs: number;
};

type ResolvedAgentWorkspaceFilePath =
  | {
      kind: "ready";
      requestPath: string;
      ioPath: string;
      workspaceReal: string;
    }
  | {
      kind: "missing";
      requestPath: string;
      ioPath: string;
      workspaceReal: string;
    }
  | {
      kind: "invalid";
      requestPath: string;
      reason: string;
    };

function resolveNotFoundWorkspaceFilePathResult(params: {
  error: unknown;
  allowMissing: boolean;
  requestPath: string;
  ioPath: string;
  workspaceReal: string;
}): Extract<ResolvedAgentWorkspaceFilePath, { kind: "missing" | "invalid" }> | undefined {
  if (!isNotFoundPathError(params.error)) {
    return undefined;
  }
  if (params.allowMissing) {
    return {
      kind: "missing",
      requestPath: params.requestPath,
      ioPath: params.ioPath,
      workspaceReal: params.workspaceReal,
    };
  }
  return { kind: "invalid", requestPath: params.requestPath, reason: "file not found" };
}

function resolveWorkspaceFilePathResultOrThrow(params: {
  error: unknown;
  allowMissing: boolean;
  requestPath: string;
  ioPath: string;
  workspaceReal: string;
}): Extract<ResolvedAgentWorkspaceFilePath, { kind: "missing" | "invalid" }> {
  const notFoundResult = resolveNotFoundWorkspaceFilePathResult(params);
  if (notFoundResult) {
    return notFoundResult;
  }
  throw params.error;
}

async function resolveWorkspaceRealPath(workspaceDir: string): Promise<string> {
  try {
    return await fs.realpath(workspaceDir);
  } catch {
    return path.resolve(workspaceDir);
  }
}

async function resolveAgentWorkspaceFilePath(params: {
  workspaceDir: string;
  name: string;
  allowMissing: boolean;
}): Promise<ResolvedAgentWorkspaceFilePath> {
  const requestPath = path.join(params.workspaceDir, params.name);
  const workspaceReal = await resolveWorkspaceRealPath(params.workspaceDir);
  const candidatePath = path.resolve(workspaceReal, params.name);

  try {
    await assertNoPathAliasEscape({
      absolutePath: candidatePath,
      rootPath: workspaceReal,
      boundaryLabel: "workspace root",
    });
  } catch (error) {
    return {
      kind: "invalid",
      requestPath,
      reason: error instanceof Error ? error.message : "path escapes workspace root",
    };
  }

  const notFoundContext = {
    allowMissing: params.allowMissing,
    requestPath,
    workspaceReal,
  } as const;

  let candidateLstat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    candidateLstat = await fs.lstat(candidatePath);
  } catch (err) {
    return resolveWorkspaceFilePathResultOrThrow({
      error: err,
      ...notFoundContext,
      ioPath: candidatePath,
    });
  }

  if (candidateLstat.isSymbolicLink()) {
    let targetReal: string;
    try {
      targetReal = await fs.realpath(candidatePath);
    } catch (err) {
      return resolveWorkspaceFilePathResultOrThrow({
        error: err,
        ...notFoundContext,
        ioPath: candidatePath,
      });
    }
    let targetStat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      targetStat = await fs.stat(targetReal);
    } catch (err) {
      return resolveWorkspaceFilePathResultOrThrow({
        error: err,
        ...notFoundContext,
        ioPath: targetReal,
      });
    }
    if (!targetStat.isFile()) {
      return { kind: "invalid", requestPath, reason: "path is not a regular file" };
    }
    if (targetStat.nlink > 1) {
      return { kind: "invalid", requestPath, reason: "hardlinked file path not allowed" };
    }
    return { kind: "ready", requestPath, ioPath: targetReal, workspaceReal };
  }

  if (!candidateLstat.isFile()) {
    return { kind: "invalid", requestPath, reason: "path is not a regular file" };
  }
  if (candidateLstat.nlink > 1) {
    return { kind: "invalid", requestPath, reason: "hardlinked file path not allowed" };
  }

  const targetReal = await fs.realpath(candidatePath).catch(() => candidatePath);
  return { kind: "ready", requestPath, ioPath: targetReal, workspaceReal };
}

async function statFileSafely(filePath: string): Promise<FileMeta | null> {
  try {
    const [stat, lstat] = await Promise.all([fs.stat(filePath), fs.lstat(filePath)]);
    if (lstat.isSymbolicLink() || !stat.isFile()) {
      return null;
    }
    if (stat.nlink > 1) {
      return null;
    }
    if (!sameFileIdentity(stat, lstat)) {
      return null;
    }
    return {
      size: stat.size,
      updatedAtMs: Math.floor(stat.mtimeMs),
    };
  } catch {
    return null;
  }
}

async function listBrowsableDirectories(dirPath: string) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const directories: Array<{ name: string; path: string }> = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      directories.push({ name: entry.name, path: fullPath });
      continue;
    }
    if (!entry.isSymbolicLink()) {
      continue;
    }
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        directories.push({ name: entry.name, path: fullPath });
      }
    } catch {
      // Ignore broken symlinks and permission-denied entries.
    }
  }
  return directories.toSorted((left, right) =>
    left.name.localeCompare(right.name, "en", { sensitivity: "base" }),
  );
}

async function listAgentFiles(workspaceDir: string, options?: { hideBootstrap?: boolean }) {
  const files: Array<{
    name: string;
    path: string;
    missing: boolean;
    size?: number;
    updatedAtMs?: number;
  }> = [];

  const bootstrapFileNames = options?.hideBootstrap
    ? BOOTSTRAP_FILE_NAMES_POST_ONBOARDING
    : BOOTSTRAP_FILE_NAMES;
  for (const name of bootstrapFileNames) {
    const resolved = await resolveAgentWorkspaceFilePath({
      workspaceDir,
      name,
      allowMissing: true,
    });
    const filePath = resolved.requestPath;
    const meta =
      resolved.kind === "ready"
        ? await statFileSafely(resolved.ioPath)
        : resolved.kind === "missing"
          ? null
          : null;
    if (meta) {
      files.push({
        name,
        path: filePath,
        missing: false,
        size: meta.size,
        updatedAtMs: meta.updatedAtMs,
      });
    } else {
      files.push({ name, path: filePath, missing: true });
    }
  }

  const primaryResolved = await resolveAgentWorkspaceFilePath({
    workspaceDir,
    name: DEFAULT_MEMORY_FILENAME,
    allowMissing: true,
  });
  const primaryMeta =
    primaryResolved.kind === "ready" ? await statFileSafely(primaryResolved.ioPath) : null;
  if (primaryMeta) {
    files.push({
      name: DEFAULT_MEMORY_FILENAME,
      path: primaryResolved.requestPath,
      missing: false,
      size: primaryMeta.size,
      updatedAtMs: primaryMeta.updatedAtMs,
    });
  } else {
    const altMemoryResolved = await resolveAgentWorkspaceFilePath({
      workspaceDir,
      name: DEFAULT_MEMORY_ALT_FILENAME,
      allowMissing: true,
    });
    const altMeta =
      altMemoryResolved.kind === "ready" ? await statFileSafely(altMemoryResolved.ioPath) : null;
    if (altMeta) {
      files.push({
        name: DEFAULT_MEMORY_ALT_FILENAME,
        path: altMemoryResolved.requestPath,
        missing: false,
        size: altMeta.size,
        updatedAtMs: altMeta.updatedAtMs,
      });
    } else {
      files.push({
        name: DEFAULT_MEMORY_FILENAME,
        path: primaryResolved.requestPath,
        missing: true,
      });
    }
  }

  return files;
}

function resolveAgentIdOrError(agentIdRaw: string, cfg: ReturnType<typeof loadConfig>) {
  const agentId = normalizeAgentId(agentIdRaw);
  const allowed = new Set(listAgentIds(cfg));
  if (!allowed.has(agentId)) {
    return null;
  }
  return agentId;
}

function sanitizeIdentityLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function resolveOptionalStringParam(value: unknown): string | undefined {
  return stringValue(value) ?? undefined;
}

function respondInvalidMethodParams(
  respond: RespondFn,
  method: string,
  errors: Parameters<typeof formatValidationErrors>[0],
): void {
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `invalid ${method} params: ${formatValidationErrors(errors)}`,
    ),
  );
}

function isConfiguredAgent(cfg: ReturnType<typeof loadConfig>, agentId: string): boolean {
  return findAgentEntryIndex(listAgentEntries(cfg), agentId) >= 0;
}

function actorOwnsPersonalAgent(actor: EmployeeWorkbenchActor, agentId: string): boolean {
  return actor.seatAgentIds.includes(agentId);
}

/** Owner delete is a hard remove. Seat unbind is internal cleanup, not a user step. */
async function releaseOwnedAgentEntitlements(params: {
  actor: EmployeeWorkbenchActor;
  agentId: string;
}): Promise<void> {
  const { actor, agentId } = params;
  if (!actor.tenantId) {
    return;
  }
  const ownership = findActiveOwnershipRecord({
    tenantId: actor.tenantId,
    subjectKind: "agent",
    subjectId: agentId,
  });
  const seatIds = new Set(
    [actor.currentSeatId, ownership?.positionId]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  for (const seatId of seatIds) {
    try {
      await unbindAgentAssetFromSeatForTenant({
        tenantId: actor.tenantId,
        seatId,
        agentId,
        actorUserId: actor.userId,
      });
    } catch {
      // Seat store may already lack the binding; owner delete must still finish.
    }
  }
  if (ownership) {
    revokeOwnershipRecord({
      tenantId: actor.tenantId,
      subjectKind: "agent",
      subjectId: agentId,
      revokedByUserId: actor.userId,
      revokedByUserLabel: actor.userEmail,
      notes: "robot deleted via agents.delete",
    });
  }
}

function respondAgentNotFound(respond: RespondFn, agentId: string): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `agent "${agentId}" not found`));
}

function resolveAgentDeleteMemoryDisposal(params: {
  memoryDisposal?: unknown;
  deleteFiles?: unknown;
}): AgentMemoryDisposalMode {
  const raw = typeof params.memoryDisposal === "string" ? params.memoryDisposal.trim() : "";
  if (raw === "delete_all" || raw === "keep_artifacts_conversations" || raw === "soft_unbind") {
    return raw;
  }
  if (params.deleteFiles === false) {
    return "soft_unbind";
  }
  return "delete_all";
}

async function moveToTrashBestEffort(pathname: string): Promise<void> {
  if (!pathname) {
    return;
  }
  try {
    await fs.access(pathname);
  } catch {
    return;
  }
  try {
    await movePathToTrash(pathname);
  } catch {
    // Best-effort: path may already be gone or trash unavailable.
  }
}

function respondWorkspaceFileUnsafe(respond: RespondFn, name: string): void {
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, `unsafe workspace file "${name}"`),
  );
}

function respondWorkspaceFileMissing(params: {
  respond: RespondFn;
  agentId: string;
  workspaceDir: string;
  name: string;
  filePath: string;
}): void {
  params.respond(
    true,
    {
      agentId: params.agentId,
      workspace: params.workspaceDir,
      file: { name: params.name, path: params.filePath, missing: true },
    },
    undefined,
  );
}

/** Object ACL for personal-workbench agent workspace file RPCs. */
async function assertPersonalWorkbenchAgentAccess(params: {
  client: Parameters<typeof resolveEmployeeWorkbenchActor>[0];
  agentId: string;
  respond: RespondFn;
  method: string;
}): Promise<boolean> {
  if (!requiresEmployeeAssetScope(params.client)) {
    return true;
  }
  const actor = await resolveEmployeeWorkbenchActor(params.client);
  if (!actor) {
    params.respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `${params.method} requires a resolved employee actor for personal workbench sessions`,
      ),
    );
    return false;
  }
  const agent = listAgentsForGateway(loadConfig()).agents.find(
    (entry) => entry.id === params.agentId,
  );
  if (!agent || !isAgentOwnedByEmployeeUser(agent, actor)) {
    params.respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `you do not have permission to access files for agent "${params.agentId}"`,
      ),
    );
    return false;
  }
  return true;
}

export const agentsHandlers: GatewayRequestHandlers = {
  "agents.list": async ({ params, respond, client }) => {
    if (!validateAgentsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.list params: ${formatValidationErrors(validateAgentsListParams.errors)}`,
        ),
      );
      return;
    }

    const cfg = loadConfig();
    const result = listAgentsForGateway(cfg);
    // Personal-workbench roster is the caller's position bot set (seatId is
    // the stable position id) plus the steward — never the tenant mesh and
    // never a user-email ownership union.
    // (docs/design/isolation-layers-hard-rules-2026-08-06.md).
    const agents = await resolveScopedAgentsForClient(client, result.agents);
    respond(true, { ...result, agents }, undefined);
  },
  "agents.runtime-health": async ({ respond, client, context }) => {
    // Honest per-agent runtime health (readiness + channel connectivity), scoped
    // to the same agent roster the caller can see via agents.list.
    const cfg = loadConfig();
    const result = listAgentsForGateway(cfg);
    const agents = await resolveScopedAgentsForClient(client, result.agents);
    const reports = collectAgentRuntimeHealth({
      cfg,
      agentIds: agents.map((agent) => agent.id),
      runtimeSnapshot: context.getRuntimeSnapshot(),
    });
    respond(true, { reports }, undefined);
  },
  "agents.create": async ({ params, respond, context, client }) => {
    if (!validateAgentsCreateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.create params: ${formatValidationErrors(
            validateAgentsCreateParams.errors,
          )}`,
        ),
      );
      return;
    }

    const cfg = loadConfig();
    const rawName = String(params.name ?? "").trim();
    const requestedAgentId =
      typeof params.agentId === "string" && params.agentId.trim()
        ? normalizeAgentId(params.agentId)
        : "";
    const agentId = requestedAgentId || normalizeAgentId(rawName);
    if (agentId === DEFAULT_AGENT_ID) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `"${DEFAULT_AGENT_ID}" is reserved`),
      );
      return;
    }

    if (findAgentEntryIndex(listAgentEntries(cfg), agentId) >= 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `agent "${agentId}" already exists`),
      );
      return;
    }

    const workspaceDir = resolveUserPath(String(params.workspace ?? "").trim());
    // Tenant and audit actor are resolved server-side: the request body may express
    // intent (which tenant, which seat) but is never an authority source.
    const ownership = await resolveAgentCreateOwnershipForClient({
      client,
      requestedTenantId: typeof params.tenantId === "string" ? params.tenantId : null,
      requestedOwnerUserId: typeof params.ownerUserId === "string" ? params.ownerUserId : null,
      requestedOwnerPositionId:
        typeof params.ownerPositionId === "string" ? params.ownerPositionId : null,
    });
    if (ownership.kind === "reject") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, ownership.message, {
          details: {
            code: ownership.code,
            ...(ownership.scopeKind ? { scopeKind: ownership.scopeKind } : {}),
            ...(ownership.denyReason ? { denyReason: ownership.denyReason } : {}),
          },
        }),
      );
      return;
    }
    const enterpriseOwnership = ownership.kind === "enterprise" ? ownership : null;
    const tenantId = enterpriseOwnership?.tenantId ?? null;
    const ownerUserId = enterpriseOwnership?.actorUserId ?? null;
    const ownerPositionId = enterpriseOwnership?.ownerPositionId ?? null;
    const ownerUserLabel =
      typeof params.ownerUserLabel === "string" && params.ownerUserLabel.trim()
        ? params.ownerUserLabel.trim()
        : ownerUserId;
    const ownerPositionLabel =
      typeof params.ownerPositionLabel === "string" && params.ownerPositionLabel.trim()
        ? params.ownerPositionLabel.trim()
        : ownerPositionId;

    // 企业数字人 = 计费 Bot：与 resources.create-bot 共用商业闸口（bot_create + 用户上限），
    // 在任何落盘之前拒绝，不留半成品。非企业（local）创建不计费。
    if (tenantId && ownerUserId) {
      const billingGate = await authorizeBillableBotCreate({
        enterpriseId: tenantId,
        ownerUserId,
        sourceAgentId: agentId,
      });
      if (!billingGate.allowed) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, billingGate.message));
        return;
      }
    }

    // Resolve agentDir against the config we're about to persist (vs the pre-write config),
    // so subsequent resolutions can't disagree about the agent's directory.
    let nextConfig = applyAgentConfig(cfg, {
      agentId,
      name: rawName,
      workspace: workspaceDir,
      ...(ownerPositionId
        ? {
            scope: "shared" as const,
            shareStatus: "shared" as const,
            ownerType: "position" as const,
            ownerId: ownerPositionId,
            ownerName: ownerPositionLabel ?? ownerPositionId,
          }
        : {}),
    });
    const agentDir = resolveAgentDir(nextConfig, agentId);
    nextConfig = applyAgentConfig(nextConfig, { agentId, agentDir });

    // Governance-first create: pending → materialize+markers → activate.
    // Failure uses compensateAgentCreateFailure (config halt / seat+registry / marker quarantine).
    const profile = resolveSecurityProfile(cfg, process.env);
    const governanceRequired = profile.profile === "managed_enterprise" || Boolean(tenantId);
    const workspaceLocator = path.resolve(workspaceDir);
    const agentDirLocator = path.resolve(agentDir);
    const transcriptsDir = resolveSessionTranscriptsDirForAgent(agentId);
    const workspaceExistedBefore = fsSync.existsSync(workspaceLocator);
    const agentDirExistedBefore = fsSync.existsSync(agentDirLocator);
    const transcriptsExistedBefore = fsSync.existsSync(transcriptsDir);
    const operationId = randomUUID();
    const configSnapshot = cfg;
    let configWritten = false;
    let ownershipBound = false;
    let seatBound = false;
    let registrySaved = false;
    let registryAssetId: string | null = null;
    let governanceIds: { agentResourceId: string; workspaceResourceId: string } | null = null;
    let billingBotCreated: BotResource | null = null;
    const allowedRoots = [workspaceLocator, agentDirLocator, transcriptsDir];

    const compensateCreateFailure = async (reason: string) =>
      compensateAgentCreateFailure({
        operationId,
        reason,
        agentId,
        configSnapshot,
        configWritten,
        writeConfigFile,
        ownershipBound,
        seatBound,
        registrySaved,
        registryAssetId,
        tenantId,
        ownerUserId,
        ownerUserLabel: ownerUserLabel ?? null,
        ownerPositionId,
        governanceIds,
        workspaceLocator,
        agentDirLocator,
        transcriptsDir,
        allowedRoots,
      });

    /** Always respond exactly once after create failure — compensate must not prevent respond. */
    const respondAfterCreateFailure = async (params: { reason: string; errorMessage: string }) => {
      try {
        await compensateCreateFailure(params.reason);
      } catch {
        // compensateAgentCreateFailure is designed not to throw; absorb any surprise reject.
      }
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, params.errorMessage));
    };

    if (governanceRequired) {
      if (!tenantId || (!ownerUserId && !ownerPositionId)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "trusted tenant and owner context required for managed agent create",
          ),
        );
        return;
      }
      try {
        governanceIds = await beginAgentGovernanceRegistration({
          agentId,
          tenantId,
          ownerUserId,
          ownerPositionId,
          workspaceLocator,
          agentDirLocator,
        });
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            `governance catalog unavailable: ${String((err as Error)?.message ?? err)}`,
          ),
        );
        return;
      }
    }

    const skipBootstrap = Boolean(nextConfig.agents?.defaults?.skipBootstrap);
    try {
      await ensureAgentWorkspace({ dir: workspaceDir, ensureBootstrapFiles: !skipBootstrap });
      if (!workspaceExistedBefore) {
        writeGovernanceOpMarker({
          targetPath: workspaceLocator,
          operationId,
          kind: "directory",
        });
      }
      await fs.mkdir(agentDirLocator, { recursive: true });
      if (!agentDirExistedBefore) {
        writeGovernanceOpMarker({
          targetPath: agentDirLocator,
          operationId,
          kind: "directory",
        });
      }
      await fs.mkdir(transcriptsDir, { recursive: true });
      if (!transcriptsExistedBefore) {
        writeGovernanceOpMarker({
          targetPath: transcriptsDir,
          operationId,
          kind: "directory",
        });
      }
      await writeConfigFile(nextConfig);
      configWritten = true;
    } catch (err) {
      await respondAfterCreateFailure({
        reason: `agent_create_failed:${String((err as Error)?.message ?? err)}`,
        errorMessage: String((err as Error)?.message ?? err),
      });
      return;
    }

    // Unified create transaction (pending → active): ownership/seat/registry,
    // IDENTITY.md, and catalog activate. Growth + capability install stay best-effort.
    let assetAccess: AuthorizeAgentAssetResult | undefined;
    try {
      if (tenantId && ownerUserId && ownerPositionId) {
        const nowIso = new Date().toISOString();
        upsertOwnershipRecord({
          tenantId,
          subjectKind: "agent",
          subjectId: agentId,
          positionId: ownerPositionId,
          positionLabel: ownerPositionLabel ?? ownerPositionId,
          createdByUserId: ownerUserId,
          createdByUserLabel: ownerUserLabel ?? ownerUserId,
          currentManagerUserId: ownerUserId,
          currentManagerLabel: ownerUserLabel ?? ownerUserId,
        });
        ownershipBound = true;
        await bindAgentAssetToSeatForTenant({
          tenantId,
          seatId: ownerPositionId,
          agentId,
          actorUserId: ownerUserId,
        });
        seatBound = true;

        const registry = await loadAgentRegistryStore();
        const asset = createAgentAsset({
          store: registry,
          enterpriseId: tenantId,
          agentSlug: agentId,
          displayName: rawName,
          nowIso,
          legacyAgentId: agentId,
        });
        registryAssetId = asset.agentAssetId;
        const ref = { enterpriseId: tenantId, agentAssetId: asset.agentAssetId };
        setPrimaryOwner({
          store: registry,
          ref,
          ownerType: "seat",
          ownerId: ownerPositionId,
          nowIso,
        });
        await saveAgentRegistryStore(registry);
        registrySaved = true;
        const actor = {
          subjectType: "membership" as const,
          subjectId: enterpriseOwnership?.actorMembershipId ?? ownerUserId,
        };
        await auditAssetCreated({
          resource: ref,
          actor,
          agentSlug: asset.agentSlug,
          legacyAgentId: agentId,
        });
        await auditOwnershipTransfer({
          resource: ref,
          actor,
          ownerType: "seat",
          ownerId: ownerPositionId,
        });
        assetAccess = await authorizeAgentAssetAccess({
          policies: buildOwnerBaselinePolicies({
            registry,
            resource: ref,
            nowIso,
            makePolicyId: (permission) => `owner:${asset.agentAssetId}:${permission}`,
          }),
          registry,
          subject: {
            subjectType: "seat",
            subjectId: ownerPositionId,
            status: "active",
          },
          resource: ref,
          permission: "agent.manage",
        });
      }

      const safeName = sanitizeIdentityLine(rawName);
      const emoji = resolveOptionalStringParam(params.emoji);
      const avatar = resolveOptionalStringParam(params.avatar);
      const identityPath = path.join(workspaceDir, DEFAULT_IDENTITY_FILENAME);
      const lines = [
        "",
        `- Name: ${safeName}`,
        ...(emoji ? [`- Emoji: ${sanitizeIdentityLine(emoji)}`] : []),
        ...(avatar ? [`- Avatar: ${sanitizeIdentityLine(avatar)}`] : []),
        "",
      ];
      if (assetAccess) {
        rejectAgentAssetWriteWhenDenied(assetAccess);
      }
      await fs.appendFile(identityPath, lines.join("\n"), "utf-8");

      if (governanceIds) {
        await activateAgentGovernanceRegistration(governanceIds);
      }

      // Item 7 CR-M1 (W2): mint the canonical plain-id, seat-owned workspace
      // Catalog row (ws:<tenant>:seat:<seatId>:asset:<agentAssetId>) so the
      // already-landed seat projection in workspace-catalog-projection.ts can
      // resolve this managed agent through loadExistingGovernedWorkspaceIdentity
      // / resolveAuthorizedAgentToolWorkspaceCwd. agentAssetId only exists after
      // createAgentAsset above, so this plain id cannot be minted at
      // beginAgentGovernanceRegistration (that id hashes agentId, not
      // agentAssetId). Placed after activate so a failed activation never leaves
      // an orphan row; idempotent (upsert no-ops on an existing active row). The
      // agentAssetId-free sha256 begin/activate row is left intact — the seat
      // regex never matches it, so no projection ambiguity. Freeze-safe: neither
      // upsertWorkspaceGovernanceRecord nor buildWorkspaceResourceId is a watched
      // synthesis symbol.
      if (tenantId && ownerPositionId && registryAssetId) {
        const seatWorkspaceScope = {
          kind: "position_owned" as const,
          seatId: ownerPositionId,
          agentAssetId: registryAssetId,
        };
        await upsertWorkspaceGovernanceRecord({
          resourceId: buildWorkspaceResourceId({ tenantId, scope: seatWorkspaceScope }),
          tenantId,
          ownerScope: seatWorkspaceScope,
          locator: workspaceLocator,
          classification: "internal",
          lifecycleState: "active",
        });
      }

      // 登记计费 Bot（已用 AI 员工 / 各用户 Bot 分布）。放在事务最后一步：若此处抛错，
      // 前序步骤由补偿回滚且不会留下计费记录；按 sourceAgentId 幂等，重试不重复计数。
      if (tenantId && ownerUserId) {
        const registered = await registerBillableBot({
          enterpriseId: tenantId,
          ownerUserId,
          sourceAgentId: agentId,
          visibility: "private",
        });
        if (registered.created) {
          billingBotCreated = registered.bot;
        }
      }
    } catch (error) {
      await respondAfterCreateFailure({
        reason: `agent_create_tx_failed:${String((error as Error)?.message ?? error)}`,
        errorMessage: `agent create failed: ${String((error as Error)?.message ?? error)}`,
      });
      return;
    }

    if (tenantId && billingBotCreated) {
      try {
        await publishBillableBotChanged({
          enterpriseId: tenantId,
          bot: billingBotCreated,
          action: "created",
        });
      } catch (error) {
        // 计费记录已落盘；事件 / 超配刷新失败不回滚已成功的创建（可由 replay / 下次刷新补齐）。
        console.warn(`[agents.create] billing bot.changed publish failed: ${String(error)}`);
      }
    }

    // Agent Growth OS：创建即初始化 growth-status.json（lifecycleState=birth、
    // templateId=generic_worker、milestones.createdAtMs=now）。spec R11 / task 5.1。
    const templateId = resolveOptionalStringParam(params.templateId) ?? null;
    try {
      await writeRobotGrowthStatus(
        nextConfig,
        agentId,
        createInitialGrowthStatus({
          kind: "robot",
          atMs: Date.now(),
          templateId,
        }),
      );
      // R7.3：创建成功发出成长漏斗 create 事件（best-effort）。
      context?.broadcast?.("agent_growth.create", { agentId, ts: Date.now() });
    } catch {
      // best-effort：growth 初始化失败不应阻断创建；recompute RPC 会按需补建。
    }

    // Official starter (+ template extras): materialize registry skills onto the new robot.
    // Best-effort — missing registry seed must not block agent create.
    let capabilityInstall:
      | {
          skillKeys: string[];
          installedCount: number;
          failedCount: number;
        }
      | undefined;
    try {
      if (params.skipCapabilityAutoInstall === true) {
        capabilityInstall = {
          skillKeys: [],
          installedCount: 0,
          failedCount: 0,
        };
      } else {
        const install = await autoInstallCapabilitiesOnAgentCreate({
          agentId,
          tenantId,
          templateId,
          cfg: nextConfig,
        });
        capabilityInstall = {
          skillKeys: install.skillKeys,
          installedCount: install.installed.length,
          failedCount: install.failed.length,
        };
      }
    } catch (error) {
      console.warn(`[agents.create] capability auto-install failed: ${String(error)}`);
    }

    respond(
      true,
      {
        ok: true,
        agentId,
        name: rawName,
        workspace: workspaceDir,
        ...(capabilityInstall ? { capabilityInstall } : {}),
      },
      undefined,
    );
  },
  "agents.update": async ({ params, respond, client }) => {
    if (!validateAgentsUpdateParams(params)) {
      respondInvalidMethodParams(respond, "agents.update", validateAgentsUpdateParams.errors);
      return;
    }

    const cfg = loadConfig();
    const agentId = normalizeAgentId(String(params.agentId ?? ""));
    if (!isConfiguredAgent(cfg, agentId)) {
      respondAgentNotFound(respond, agentId);
      return;
    }

    const workspaceDir =
      typeof params.workspace === "string" && params.workspace.trim()
        ? resolveUserPath(params.workspace.trim())
        : undefined;

    const model = resolveOptionalStringParam(params.model);
    const avatar = resolveOptionalStringParam(params.avatar);

    const avatarWorkspace = avatar ? await resolveAgentsHandlerWorkspaceLocatorOrRespond({ client, cfg, agentId, purpose: "agents.update.avatar", respond }) : undefined;
    if (avatar && !avatarWorkspace) { return; }

    const nextConfig = applyAgentConfig(cfg, {
      agentId,
      ...(typeof params.name === "string" && params.name.trim()
        ? { name: params.name.trim() }
        : {}),
      ...(workspaceDir ? { workspace: workspaceDir } : {}),
      ...(model ? { model } : {}),
    });

    await writeConfigFile(nextConfig);

    if (workspaceDir) {
      const skipBootstrap = Boolean(nextConfig.agents?.defaults?.skipBootstrap);
      await ensureAgentWorkspace({ dir: workspaceDir, ensureBootstrapFiles: !skipBootstrap });
    }

    if (avatar && avatarWorkspace) {
      try {
        const identityAccess = await resolveAgentIdentityWriteAccess({ client, agentId });
        if (identityAccess) {
          rejectAgentAssetWriteWhenDenied(identityAccess);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
        return;
      }
      void import("../agents-w2-shadow.js").then((m) =>
        m.scheduleAgentsW2ResolvedShadow({
          siteId: "S12-agents-create-avatar",
          resolvedLocator: avatarWorkspace,
        }),
      );
      await fs.mkdir(avatarWorkspace, { recursive: true });
      const identityPath = path.join(avatarWorkspace, DEFAULT_IDENTITY_FILENAME);
      await fs.appendFile(identityPath, `\n- Avatar: ${sanitizeIdentityLine(avatar)}\n`, "utf-8");
    }

    respond(true, { ok: true, agentId }, undefined);
  },
  "agents.delete": async ({ params, respond, client }) => {
    if (!validateAgentsDeleteParams(params)) {
      respondInvalidMethodParams(respond, "agents.delete", validateAgentsDeleteParams.errors);
      return;
    }

    const cfg = loadConfig();
    const agentId = normalizeAgentId(String(params.agentId ?? ""));
    if (agentId === DEFAULT_AGENT_ID || isBuiltinStewardAgent(agentId)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `"${DEFAULT_AGENT_ID}" cannot be deleted`),
      );
      return;
    }
    const actor = await resolveEmployeeWorkbenchActor(client);
    const configured = isConfiguredAgent(cfg, agentId);
    if (!configured) {
      // Owner leftover: config already gone, seat grant / roster stub still listed.
      if (requiresEmployeeAssetScope(client) && actor && actorOwnsPersonalAgent(actor, agentId)) {
        await releaseOwnedAgentEntitlements({ actor, agentId });
        await releaseBillableBotForAgentBestEffort(actor.tenantId ?? null, agentId);
        respond(
          true,
          {
            ok: true,
            agentId,
            removedBindings: 0,
            decommissionedWorkspaceId: null,
            memoryDisposal: resolveAgentDeleteMemoryDisposal(params),
          },
          undefined,
        );
        return;
      }
      respondAgentNotFound(respond, agentId);
      return;
    }

    if (requiresEmployeeAssetScope(client)) {
      if (!actor) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `agents.delete requires a resolved employee actor for personal workbench sessions`,
          ),
        );
        return;
      }
      const agent = listAgentsForGateway(cfg).agents.find((entry) => entry.id === agentId);
      if (!agent || !isAgentOwnedByEmployeeUser(agent, actor)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `you do not have permission to delete agent "${agentId}"`,
          ),
        );
        return;
      }
    } else if (actor) {
      const agent = listAgentsForGateway(cfg).agents.find((entry) => entry.id === agentId);
      if (!agent) {
        respondAgentNotFound(respond, agentId);
        return;
      }
      if (!isAgentOwnedByEmployeeUser(agent, actor)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `you do not have permission to delete agent "${agentId}"`,
          ),
        );
        return;
      }
    }

    const memoryDisposal = resolveAgentDeleteMemoryDisposal(params);
    const workspaceDir = await resolveAgentsHandlerWorkspaceLocatorOrRespond({ client, cfg, agentId, purpose: "agents.delete", respond });
    if (!workspaceDir) { return; }
    const agentDir = (void import("../agents-w2-shadow.js").then((m) => m.scheduleAgentsW2ResolvedShadow({ siteId: "S13-agents-delete", resolvedLocator: workspaceDir })), resolveAgentDir(cfg, agentId));
    const sessionsDir = resolveSessionTranscriptsDirForAgent(agentId);
    const decommissioned = await decommissionRobotWorkspace(agentId);

    const result = pruneAgentConfig(cfg, agentId);
    await writeConfigFile(result.config);

    if (actor) {
      await releaseOwnedAgentEntitlements({ actor, agentId });
    }
    // 同步软删计费 Bot（保留历史，供按账期重建 Bot 数）。
    await releaseBillableBotForAgentBestEffort(actor?.tenantId ?? null, agentId);

    if (memoryDisposal !== "soft_unbind") {
      await applyAgentMemoryDisposal({ cfg, agentId, mode: memoryDisposal });
      const paths =
        memoryDisposal === "keep_artifacts_conversations"
          ? [agentDir, sessionsDir]
          : [workspaceDir, agentDir, sessionsDir];
      if (decommissioned.localPath) {
        paths.push(decommissioned.localPath);
      }
      if (decommissioned.runtimePath) {
        paths.push(decommissioned.runtimePath);
      }
      await Promise.all(paths.map((entry) => moveToTrashBestEffort(entry)));
    }

    respond(
      true,
      {
        ok: true,
        agentId,
        removedBindings: result.removedBindings,
        decommissionedWorkspaceId: decommissioned.workspaceId,
        memoryDisposal,
      },
      undefined,
    );
  },
  "agents.files.list": async ({ params, respond, client }) => {
    if (!validateAgentsFilesListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.files.list params: ${formatValidationErrors(
            validateAgentsFilesListParams.errors,
          )}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const agentId = resolveAgentIdOrError(String(params.agentId ?? ""), cfg);
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
      return;
    }
    if (
      !(await assertPersonalWorkbenchAgentAccess({
        client,
        agentId,
        respond,
        method: "agents.files.list",
      }))
    ) {
      return;
    }
    const workspaceDir = await resolveAgentsHandlerWorkspaceLocatorOrRespond({ client, cfg, agentId, purpose: "agents.files.list", respond });
    if (!workspaceDir) {
      return;
    }
    void import("../agents-w2-shadow.js").then(({ scheduleAgentsW2ResolvedShadowPair }) =>
      scheduleAgentsW2ResolvedShadowPair({
        siteIdTrusted: "S14-agents-list-trusted",
        siteIdLegacy: "S15-agents-list-legacy",
        resolvedLocator: workspaceDir,
      }),
    );
    let hideBootstrap = false;
    try {
      hideBootstrap = await isWorkspaceOnboardingCompleted(workspaceDir);
    } catch {
      // Fall back to showing BOOTSTRAP if workspace state cannot be read.
    }
    const files = await listAgentFiles(workspaceDir, { hideBootstrap });
    respond(true, { agentId, workspace: workspaceDir, files }, undefined);
  },
  "agents.files.get": async ({ params, respond, client }) => {
    if (!validateAgentsFilesGetParams(params)) {
      respondInvalidMethodParams(respond, "agents.files.get", validateAgentsFilesGetParams.errors);
      return;
    }
    const resolved = await resolveAgentWorkspaceFileOrRespondError(params, respond, client);
    if (!resolved) {
      return;
    }
    const { agentId, workspaceDir, name, cfg } = resolved;
    if (
      !(await assertPersonalWorkbenchAgentAccess({
        client,
        agentId,
        respond,
        method: "agents.files.get",
      }))
    ) {
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.userId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "user context required"));
      return;
    }
    const authorized = await authorizeAgentWorkspaceFileAccess({
      client,
      cfg,
      userId: context.userId,
      agentId,
      relativePath: name,
      operation: "preview",
      purpose: "agents.files.get",
      locator: workspaceDir,
      stewardException: isBuiltinStewardAgent(agentId),
    });
    if (!authorized.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, authorized.message));
      return;
    }
    const filePath = authorized.absoluteFilePath;
    let safeRead: Awaited<ReturnType<typeof readLocalFileSafely>>;
    try {
      safeRead = await readLocalFileSafely({ filePath });
    } catch (err) {
      if (err instanceof SafeOpenError && err.code === "not-found") {
        respondWorkspaceFileMissing({ respond, agentId, workspaceDir, name, filePath });
        return;
      }
      respondWorkspaceFileUnsafe(respond, name);
      return;
    }
    respond(
      true,
      {
        agentId,
        workspace: workspaceDir,
        file: {
          name,
          path: filePath,
          missing: false,
          size: safeRead.stat.size,
          updatedAtMs: Math.floor(safeRead.stat.mtimeMs),
          content: safeRead.buffer.toString("utf-8"),
        },
      },
      undefined,
    );
  },
  "agents.files.set": async ({ params, respond, client }) => {
    if (!validateAgentsFilesSetParams(params)) {
      respondInvalidMethodParams(respond, "agents.files.set", validateAgentsFilesSetParams.errors);
      return;
    }
    const resolved = await resolveAgentWorkspaceFileOrRespondError(params, respond, client);
    if (!resolved) {
      return;
    }
    const { agentId, workspaceDir, name, cfg } = resolved;
    if (
      !(await assertPersonalWorkbenchAgentAccess({
        client,
        agentId,
        respond,
        method: "agents.files.set",
      }))
    ) {
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.userId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "user context required"));
      return;
    }
    await fs.mkdir(workspaceDir, { recursive: true });
    const authorized = await authorizeAgentWorkspaceFileAccess({
      client,
      cfg,
      userId: context.userId,
      agentId,
      relativePath: name,
      operation: "write",
      purpose: "agents.files.set",
      locator: workspaceDir,
      stewardException: isBuiltinStewardAgent(agentId),
      allowedWriteChannels: PRIMARY_CAPABLE_WRITE_CHANNELS,
    });
    if (!authorized.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, authorized.message));
      return;
    }
    const content = String(params.content ?? "");
    const relativeWritePath = path.relative(
      authorized.access.baseReal,
      authorized.absoluteFilePath,
    );
    if (
      !relativeWritePath ||
      relativeWritePath.startsWith("..") ||
      path.isAbsolute(relativeWritePath)
    ) {
      respondWorkspaceFileUnsafe(respond, name);
      return;
    }
    try {
      await writeFileWithinRoot({
        rootDir: authorized.access.baseReal,
        relativePath: relativeWritePath,
        data: content,
        encoding: "utf8",
      });
    } catch {
      respondWorkspaceFileUnsafe(respond, name);
      return;
    }
    const meta = await statFileSafely(authorized.absoluteFilePath);
    respond(
      true,
      {
        ok: true,
        agentId,
        workspace: workspaceDir,
        file: {
          name,
          path: authorized.absoluteFilePath,
          missing: false,
          size: meta?.size,
          updatedAtMs: meta?.updatedAtMs,
          content,
        },
      },
      undefined,
    );
  },
  "agents.workspace.browse": async ({ params, respond }) => {
    if (!validateAgentsWorkspaceBrowseParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.workspace.browse params: ${formatValidationErrors(
            validateAgentsWorkspaceBrowseParams.errors,
          )}`,
        ),
      );
      return;
    }
    // Managed Enterprise: arbitrary host-path browse is a filesystem bypass — deny.
    // Personal Local retains the legacy directory browser for local ops UX.
    const cfg = loadConfig();
    const profile = resolveSecurityProfile(cfg, process.env);
    if (profile.profile === "managed_enterprise") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "agents.workspace.browse is disabled in managed enterprise; use authorized workspace resource access",
        ),
      );
      return;
    }
    const requestedPath =
      typeof params.path === "string" && params.path.trim()
        ? resolveUserPath(params.path.trim())
        : resolveUserPath("~");
    const currentPath = await fs.realpath(requestedPath).catch(() => path.resolve(requestedPath));
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(currentPath);
    } catch {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `directory not found: ${requestedPath}`),
      );
      return;
    }
    if (!stat.isDirectory()) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `not a directory: ${requestedPath}`),
      );
      return;
    }
    try {
      const entries = await listBrowsableDirectories(currentPath);
      const parentPath = path.dirname(currentPath);
      respond(
        true,
        {
          currentPath,
          ...(parentPath !== currentPath ? { parentPath } : {}),
          entries,
        },
        undefined,
      );
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
    }
  },
};
