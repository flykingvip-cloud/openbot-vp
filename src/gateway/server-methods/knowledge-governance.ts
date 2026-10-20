import { resolveKnowledgeSourceContext } from "../knowledge/context.js";
import {
  getGovernanceSummary,
  getGovernanceTaskById,
  listGovernanceTasks,
} from "../knowledge/governance/chunk-governance-store.js";
import { listClaimsByKb, listClaimsForChunks } from "../knowledge/governance/claims/claim-store.js";
import {
  getExpertAuthority,
  upsertExpertAuthority,
} from "../knowledge/governance/expert-authority-store.js";
import { buildGovernanceTaskIssueGraph } from "../knowledge/governance/graph/task-issue-graph.js";
import { resolveGovernanceTask } from "../knowledge/governance/resolution/task-resolver.js";
import type { GovernanceTaskStatus } from "../knowledge/governance/types.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "../knowledge/kb-index.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { exactMember, stringValue } from "./request-params.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

function stringParam(value: unknown): string | undefined {
  return stringValue(value) ?? undefined;
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseTaskStatus(value: unknown): GovernanceTaskStatus | null {
  return exactMember(value, ["open", "in_review", "resolved", "dismissed"] as const);
}

async function withUserKnowledgeIndex<T>(
  client: Parameters<GatewayRequestHandlers[string]>[0]["client"],
  fn: (db: import("node:sqlite").DatabaseSync) => T | Promise<T>,
): Promise<T> {
  const context = await resolveKnowledgeSourceContext(client);
  if (!context.userId) {
    throw new Error("user context required");
  }
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: context.userId,
    tenantId: context.tenantId,
  });
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    return await fn(index.db);
  } finally {
    index.close();
  }
}

function respondGovernanceError(respond: RespondFn, error: unknown) {
  const message = error instanceof Error ? error.message : "knowledge governance failed";
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

/**
 * Resolve the caller's user-scoped knowledge governance summary via the same
 * per-user index path that `knowledge.governance.summary` uses. Exported so
 * other workbench surfaces (e.g. the 重要通知 notices read-model) consume the
 * identical, tenant-isolated data instead of re-deriving the index path.
 */
export async function getUserGovernanceSummary(
  client: Parameters<GatewayRequestHandlers[string]>[0]["client"],
  kbId?: string,
): Promise<import("../knowledge/governance/types.js").GovernanceSummary> {
  return withUserKnowledgeIndex(client, (db) => getGovernanceSummary(db, kbId));
}

export const knowledgeGovernanceHandlers: GatewayRequestHandlers = {
  "knowledge.governance.summary": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.kbId);
    try {
      const summary = await withUserKnowledgeIndex(client, (db) => getGovernanceSummary(db, kbId));
      respond(true, { summary });
    } catch (error) {
      respondGovernanceError(respond, error);
    }
  },

  "knowledge.governance.tasks.list": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.kbId);
    const status = parseTaskStatus(record.status) ?? undefined;
    const limit = numberParam(record.limit, 50);
    try {
      const tasks = await withUserKnowledgeIndex(client, (db) =>
        listGovernanceTasks({ db, kbId, status, limit }),
      );
      respond(true, { tasks });
    } catch (error) {
      respondGovernanceError(respond, error);
    }
  },

  "knowledge.governance.tasks.update": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const taskId = stringParam(record.taskId);
    const status = parseTaskStatus(record.status);
    const comment = stringParam(record.comment);
    const kbId = stringParam(record.kbId);
    const canonicalClaimId = stringParam(record.canonicalClaimId);
    if (!taskId || !status) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "taskId and status required"),
      );
      return;
    }
    try {
      const context = await resolveKnowledgeSourceContext(client);
      if (!context.userId) {
        throw new Error("user context required");
      }
      const updated = await withUserKnowledgeIndex(client, (db) =>
        resolveGovernanceTask({
          db,
          taskId,
          status,
          expertId: context.userId!,
          comment,
          domainScope: kbId,
          canonicalClaimId,
        }),
      );
      if (!updated) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "task not found"));
        return;
      }
      respond(true, { ok: true });
    } catch (error) {
      respondGovernanceError(respond, error);
    }
  },

  "knowledge.governance.tasks.graph": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const taskId = stringParam(record.taskId);
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "taskId required"));
      return;
    }
    try {
      const payload = await withUserKnowledgeIndex(client, (db) => {
        const task = getGovernanceTaskById(db, taskId);
        if (!task) {
          return null;
        }
        return buildGovernanceTaskIssueGraph({ db, task });
      });
      if (!payload) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "task not found"));
        return;
      }
      respond(true, payload);
    } catch (error) {
      respondGovernanceError(respond, error);
    }
  },

  "knowledge.governance.claims.list": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.kbId);
    const normalizedKey = stringParam(record.normalizedKey);
    const chunkIds = Array.isArray(record.chunkIds)
      ? record.chunkIds.filter((entry): entry is string => typeof entry === "string")
      : undefined;
    const limit = numberParam(record.limit, 100);
    try {
      const claims = await withUserKnowledgeIndex(client, (db) => {
        if (chunkIds && chunkIds.length > 0) {
          return listClaimsForChunks(db, chunkIds);
        }
        if (!kbId) {
          throw new Error("kbId or chunkIds required");
        }
        return listClaimsByKb({ db, kbId, normalizedKey, limit });
      });
      respond(true, { claims });
    } catch (error) {
      respondGovernanceError(respond, error);
    }
  },

  "knowledge.governance.expert.get": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const expertId = stringParam(record.expertId);
    try {
      const context = await resolveKnowledgeSourceContext(client);
      const targetId = expertId ?? context.userId;
      if (!targetId) {
        throw new Error("expertId required");
      }
      const authority = await withUserKnowledgeIndex(client, (db) =>
        getExpertAuthority(db, targetId),
      );
      respond(true, { authority });
    } catch (error) {
      respondGovernanceError(respond, error);
    }
  },

  "knowledge.governance.expert.upsert": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const expertId = stringParam(record.expertId);
    const domainScope = stringParam(record.domainScope);
    const verificationLevel = stringParam(record.verificationLevel);
    const expertWeight = numberParam(record.expertWeight, 1);
    try {
      const context = await resolveKnowledgeSourceContext(client);
      if (!context.userId) {
        throw new Error("user context required");
      }
      const userId = context.userId;
      const authority = await withUserKnowledgeIndex(client, (db) =>
        upsertExpertAuthority({
          db,
          expertId: expertId ?? userId,
          domainScope: domainScope ?? "*",
          expertWeight,
          verificationLevel: verificationLevel ?? "member",
          grantedBy: userId,
        }),
      );
      respond(true, { authority });
    } catch (error) {
      respondGovernanceError(respond, error);
    }
  },
};
