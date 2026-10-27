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
    const statusView =
      params.statusView === "tentative" ? ("tentative" as const) : ("active" as const);
    const result = await listAgentMemoryEntries({ cfg: loadConfig(), agentId });
    let atoms: MemoryCenterAtomRow[] = [];
    let atomList:
      | {
          ok: true;
          statusView: "active" | "tentative";
          total: number;
          truncated: boolean;
          otherViewTotal?: number;
        }
      | {
          ok: false;
          statusView: "active" | "tentative";
          code: string;
          message: string;
        }
      | undefined;
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
    type ReadonlyLister = {
      listMemoryCenterAtomsReadonly?: (opts?: {
        statusView?: "active" | "tentative";
        limit?: number;
      }) => Promise<
        | {
            ok: true;
            statusView: "active" | "tentative";
            atoms: MemoryCenterAtomRow[];
            total: number;
            truncated: boolean;
          }
        | { ok: false; code: string; message: string }
      >;
      listMemoryCenterAtoms?: (opts?: { limit?: number }) => Promise<MemoryCenterAtomRow[]>;
    };
    const typedManager = manager as ReadonlyLister | null | undefined;
    const listReadonly = typedManager?.listMemoryCenterAtomsReadonly;
    if (typeof listReadonly === "function") {
      try {
        const listed = await listReadonly({ statusView, limit: 200 });
        if (listed.ok) {
          atoms = listed.atoms;
          let otherViewTotal: number | undefined;
          // Empty-state branch hint (C1): when current view is empty, probe sibling total readonly.
          if (listed.total === 0) {
            const siblingView = statusView === "active" ? "tentative" : "active";
            const sibling = await listReadonly({
              statusView: siblingView,
              limit: 0,
            });
            if (sibling.ok) {
              otherViewTotal = sibling.total;
            }
          }
          atomList = {
            ok: true,
            statusView: listed.statusView,
            total: listed.total,
            truncated: listed.truncated,
            ...(typeof otherViewTotal === "number" ? { otherViewTotal } : {}),
          };
        } else {
          // Explicit unbound / store errors — do not fake success empty for Memory Center.
          atoms = [];
          atomList = {
            ok: false,
            statusView,
            code: listed.code,
            message: listed.message,
          };
        }
      } catch (err) {
        atoms = [];
        atomList = {
          ok: false,
          statusView,
          code: "MEMORY_CENTER_ACCESS_DENIED",
          message: String(err),
        };
      }
    } else if (typedManager && typeof typedManager.listMemoryCenterAtoms === "function") {
      // Legacy fallback: active-only path (pre-O4 managers).
      if (statusView === "active") {
        try {
          atoms = await typedManager.listMemoryCenterAtoms({ limit: 200 });
          atomList = {
            ok: true,
            statusView: "active",
            total: atoms.length,
            truncated: false,
          };
        } catch {
          atoms = [];
        }
      } else {
        atomList = {
          ok: false,
          statusView,
          code: "MEMORY_BACKEND_UNSUPPORTED",
          message: "candidate statusView requires O4 readonly Memory Center foundation",
        };
      }
    }
    const entries = result.entries.map((entry) => ({
      key: entry.key,
      label: memoryCenterEntryLabel(entry.key),
      bytes: entry.bytes,
      updatedAtMs: entry.updatedAtMs,
    }));
    respond(true, {
      entries,
      atoms,
      statusView,
      ...(atomList ? { atomList } : {}),
      viewMode: atoms.length > 0 ? (entries.length > 0 ? "mixed" : "atoms") : ("files" as const),
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

  "data.memory.forgetFact": async ({ params, respond, client }) => {
    if (rejectWhenManaged("data.memory.forgetFact", respond)) {
      return;
    }
    const agentId = typeof params.agentId === "string" ? params.agentId.trim() : "";
    const atomId = typeof params.atomId === "string" ? params.atomId.trim() : "";
    const operationIdRaw = typeof params.operationId === "string" ? params.operationId.trim() : "";
    const operationId = operationIdRaw || `fact-forget:${atomId}:${Date.now().toString(36)}`;
    if (!agentId || !atomId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agentId and atomId are required"),
      );
      return;
    }
    if (
      !(await assertMemoryCenterAgentAccess({
        client,
        agentId,
        respond,
        method: "data.memory.forgetFact",
      }))
    ) {
      return;
    }
    const actor = await Promise.resolve(resolveEmployeeWorkbenchActor(client)).catch(() => null);
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
    type FactForgetManager = {
      forgetFact?: (input: {
        atomId: string;
        operationId: string;
        reasonCode?: string;
      }) => Promise<{
        ok: boolean;
        factRef: { atomId: string };
        sources: Array<Record<string, unknown>>;
        atomMissing?: boolean;
        error?: string;
      }>;
    };
    const typed = manager as FactForgetManager | null | undefined;
    if (!typed || typeof typed.forgetFact !== "function") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "fact-level forget requires cogniweave memory backend"),
      );
      return;
    }
    try {
      const result = await typed.forgetFact({
        atomId,
        operationId,
        reasonCode:
          typeof params.reasonCode === "string" && params.reasonCode.trim()
            ? params.reasonCode.trim()
            : "FACT_LEVEL_FORGET",
      });
      if (result.atomMissing) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "atom not found"));
        return;
      }
      if (!result.ok) {
        respond(
          false,
          result,
          errorShape(ErrorCodes.UNAVAILABLE, result.error ?? "forgetFact failed"),
        );
        return;
      }
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
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
