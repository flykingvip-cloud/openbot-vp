import { loadConfig } from "../../config/config.js";
import { isManagedDataMode, resolveDataRoot } from "../../config/data-space.js";
import { buildRetentionPolicySummary } from "../../conversations/retention-enforcer.js";
import { resolveConversationRetentionPolicy } from "../../conversations/retention-policy.js";
import { execFileUtf8 } from "../../daemon/exec-file.js";
import {
  listAccessGrants,
  recordAccessGrant,
  revokeAccessGrant,
  type AccessGrantResourceType,
} from "../../data/access-grants.js";
import { archiveConversationToDataSpace } from "../../data/conversation-archive.js";
import { createDataExportArchive, restoreDataExportArchive } from "../../data/data-export.js";
import { buildDataRootInfo, listMountedVolumes } from "../../data/data-root-info.js";
import { forgetMemoryEntry } from "../../data/memory-lifecycle.js";
import { listAgentMemoryEntries } from "../../data/memory-list.js";
import {
  cancelMigration,
  getActiveMigrationJob,
  preflightMigration,
  startMigration,
} from "../../data/migration-engine.js";
import type { MemoryCenterAtomRow } from "../../memory/memory-center-atoms.js";
import {
  buildMemorySearchGovernanceFromCallEntry,
  getMemorySearchManager,
} from "../../memory/search-manager.js";
import { resolveEmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { assertMemoryCenterAgentAccess } from "./memory-center-access.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function rejectWhenManaged(method: string, respond: RespondFn): boolean {
  if (!isManagedDataMode(loadConfig())) {
    return false;
  }
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.LOCAL_ONLY,
      `${method} is unavailable on managed (SaaS) OpenBot; your data is hosted by the platform.`,
    ),
  );
  return true;
}

/** User-facing Memory Center title — basename only, no store path leakage. */
function memoryCenterEntryLabel(key: string): string {
  const trimmed = key.trim().replace(/\\/g, "/");
  const base = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
  return base || trimmed;
}

export const dataHandlers: GatewayRequestHandlers = {
  "data.root.get": async ({ params, respond }) => {
    const cfg = loadConfig();
    if (isManagedDataMode(cfg)) {
      respond(true, { mode: "managed" as const });
      return;
    }
    const includeCache = params.includeCache === true;
    respond(true, buildDataRootInfo(cfg, { includeCache }));
  },

  "data.root.reveal": async ({ respond }) => {
    if (rejectWhenManaged("data.root.reveal", respond)) {
      return;
    }
    const root = resolveDataRoot(loadConfig());
    if (process.platform === "darwin") {
      await execFileUtf8("open", [root]);
    }
    respond(true, { ok: true, path: root });
  },

  "data.volumes.list": async ({ respond }) => {
    if (rejectWhenManaged("data.volumes.list", respond)) {
      return;
    }
    respond(true, { volumes: listMountedVolumes() });
  },

  "data.migration.preflight": async ({ params, respond }) => {
    if (rejectWhenManaged("data.migration.preflight", respond)) {
      return;
    }
    const targetPath = typeof params.targetPath === "string" ? params.targetPath : "";
    const includeCache = params.includeCache === true;
    const result = await preflightMigration({ targetPath, includeCache });
    respond(true, result);
  },

  "data.migration.start": async ({ params, respond }) => {
    if (rejectWhenManaged("data.migration.start", respond)) {
      return;
    }
    const targetPath = typeof params.targetPath === "string" ? params.targetPath : "";
    const includeCache = params.includeCache === true;
    try {
      const job = await startMigration({ targetPath, includeCache });
      respond(true, { job });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "data.migration.status": async ({ respond }) => {
    if (rejectWhenManaged("data.migration.status", respond)) {
      return;
    }
    respond(true, { job: getActiveMigrationJob() });
  },

  "data.migration.cancel": async ({ respond }) => {
    if (rejectWhenManaged("data.migration.cancel", respond)) {
      return;
    }
    const job = await cancelMigration();
    respond(true, { job });
  },

  "data.export.create": async ({ params, respond }) => {
    if (rejectWhenManaged("data.export.create", respond)) {
      return;
    }
    try {
      const result = await createDataExportArchive({
        includeCache: params.includeCache === true,
      });
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "data.export.restore": async ({ params, respond }) => {
    if (rejectWhenManaged("data.export.restore", respond)) {
      return;
    }
    const archivePath = typeof params.archivePath === "string" ? params.archivePath.trim() : "";
    if (!archivePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "archivePath is required"));
      return;
    }
    try {
      const restored = await restoreDataExportArchive({ archivePath });
      respond(true, restored);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "data.conversations.archive": async ({ params, respond }) => {
    if (rejectWhenManaged("data.conversations.archive", respond)) {
      return;
    }
    const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
    const sessionId = typeof params.sessionId === "string" ? params.sessionId.trim() : "";
    if (!agentId || !sessionId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agentId and sessionId are required"),
      );
      return;
    }
    const cfg = loadConfig();
    try {
      const result = await archiveConversationToDataSpace({ cfg, agentId, sessionId });
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "data.memory.list": async ({ params, respond, client }) => {
    if (rejectWhenManaged("data.memory.list", respond)) {
      return;
    }
    const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId is required"));
      return;
    }
    if (
      !(await assertMemoryCenterAgentAccess({
        client,
        agentId,
        respond,
        method: "data.memory.list",
      }))
    ) {
      return;
    }
    const result = await listAgentMemoryEntries({ cfg: loadConfig(), agentId });
    let atoms: MemoryCenterAtomRow[] = [];
    const actor = await resolveEmployeeWorkbenchActor(client).catch(() => null);
    const governance = actor?.tenantId
      ? buildMemorySearchGovernanceFromCallEntry({
          tenantId: actor.tenantId,
          userId: actor.userId,
          seatId: actor.currentSeatId,
        })
      : undefined;
    const { manager } = await getMemorySearchManager({
      cfg: loadConfig(),
      agentId,
      governance,
    });
    if (manager && "listMemoryCenterAtoms" in manager) {
      const listAtoms = (
        manager as {
          listMemoryCenterAtoms?: (opts?: { limit?: number }) => Promise<MemoryCenterAtomRow[]>;
        }
      ).listMemoryCenterAtoms;
      if (typeof listAtoms === "function") {
        try {
          atoms = await listAtoms.call(manager, { limit: 200 });
        } catch {
          atoms = [];
        }
      }
    }
    respond(true, {
      entries: result.entries.map((entry) => ({
        key: entry.key,
        label: memoryCenterEntryLabel(entry.key),
        bytes: entry.bytes,
        updatedAtMs: entry.updatedAtMs,
      })),
      atoms,
      viewMode: atoms.length > 0 ? "mixed" : ("files" as const),
    });
  },

  "data.memory.forget": async ({ params, respond, client }) => {
    if (rejectWhenManaged("data.memory.forget", respond)) {
      return;
    }
    const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
    const memoryKey = typeof params.memoryKey === "string" ? params.memoryKey.trim() : "";
    if (!agentId || !memoryKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agentId and memoryKey are required"),
      );
      return;
    }
    if (
      !(await assertMemoryCenterAgentAccess({
        client,
        agentId,
        respond,
        method: "data.memory.forget",
      }))
    ) {
      return;
    }
    const result = await forgetMemoryEntry({
      cfg: loadConfig(),
      agentId,
      memoryKey,
    });
    if (!result.deletedPath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "memory entry not found"));
      return;
    }
    respond(true, result);
  },

  "data.retention.summary": async ({ params, respond }) => {
    const cfg = loadConfig();
    const tenantId =
      typeof params.tenantId === "string" && params.tenantId.trim() ? params.tenantId.trim() : null;
    const resolved = resolveConversationRetentionPolicy(cfg, tenantId);
    respond(true, {
      summary: buildRetentionPolicySummary(cfg, tenantId),
      resolved,
    });
  },

  "data.accessGrants.list": async ({ params, respond }) => {
    if (rejectWhenManaged("data.accessGrants.list", respond)) {
      return;
    }
    const agentId = typeof params.agentId === "string" ? params.agentId.trim() : undefined;
    const grants = await listAccessGrants({
      cfg: loadConfig(),
      agentId: agentId || undefined,
      includeRevoked: params.includeRevoked === true,
    });
    respond(true, { grants });
  },

  "data.accessGrants.record": async ({ params, respond }) => {
    if (rejectWhenManaged("data.accessGrants.record", respond)) {
      return;
    }
    const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
    const resourcePath = typeof params.resourcePath === "string" ? params.resourcePath.trim() : "";
    const resourceTypeRaw =
      typeof params.resourceType === "string" ? params.resourceType.trim() : "knowledge";
    const resourceType = resourceTypeRaw as AccessGrantResourceType;
    if (!agentId || !resourcePath) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agentId and resourcePath are required"),
      );
      return;
    }
    const grant = await recordAccessGrant({
      cfg: loadConfig(),
      agentId,
      resourceType,
      resourcePath,
      grantedBy: typeof params.grantedBy === "string" ? params.grantedBy : "user",
      reason: typeof params.reason === "string" ? params.reason : undefined,
    });
    respond(true, { grant });
  },

  "data.accessGrants.revoke": async ({ params, respond }) => {
    if (rejectWhenManaged("data.accessGrants.revoke", respond)) {
      return;
    }
    const grantId = typeof params.grantId === "string" ? params.grantId.trim() : "";
    if (!grantId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "grantId is required"));
      return;
    }
    const grant = await revokeAccessGrant({ cfg: loadConfig(), grantId });
    if (!grant) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "grant not found"));
      return;
    }
    respond(true, { grant });
  },
};
