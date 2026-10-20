/**
 * group.sharedDoc.* — agent/workbench RPCs for the shared group document SoT.
 */
import { loadConfig } from "../../config/config.js";
import {
  appendSharedDocReview,
  claimSharedDocSection,
  listSharedDocReviews,
  openOrCreateSharedDoc,
  upsertSharedDocSection,
  writeSharedDocBody,
  type SharedDocReviewComment,
} from "../collaboration-learning/shared-group-doc.js";
import { resolveKnowledgeSourceContext } from "../knowledge/context.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { resolveTenantContext } from "../tenant-context.js";
import { assertGroupMemberAccess } from "../workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import type { GatewayRequestHandlerOptions, GatewayRequestHandlers } from "./types.js";

async function resolveSharedDocAccess(params: {
  client: GatewayRequestHandlerOptions["client"];
  respond: GatewayRequestHandlerOptions["respond"];
  groupId: string;
}): Promise<{ ok: true; workspaceRoot: string } | { ok: false }> {
  const context = await resolveKnowledgeSourceContext(params.client);
  if (!context.userId) {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "user context required for group.sharedDoc"),
    );
    return { ok: false };
  }
  const groupId = params.groupId.trim();
  if (!groupId) {
    params.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "groupId required"));
    return { ok: false };
  }
  const cfg = loadConfig();
  const profile = resolveSecurityProfile(cfg, process.env);
  let tenantId: string | null = null;
  if (profile.profile === "managed_enterprise") {
    const tenantCtx = await resolveTenantContext(params.client);
    tenantId = tenantCtx?.tenantId ?? null;
    if (!tenantId) {
      params.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "trusted tenant context required"),
      );
      return { ok: false };
    }
  }
  const denied = await assertGroupMemberAccess({
    groupId,
    userId: context.userId,
    tenantId,
    profile: profile.profile,
    cfg,
    identityAliases: [params.client?.user ?? ""].map((entry) => entry.trim()).filter(Boolean),
  });
  if (denied) {
    params.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, denied));
    return { ok: false };
  }
  try {
    const workspaceRoot = resolveTrustedGroupLocator({
      groupId,
      tenantId,
      profile: profile.profile,
      cfg,
    });
    return { ok: true, workspaceRoot };
  } catch (error) {
    params.respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        error instanceof Error ? error.message : "failed to resolve group workspace",
      ),
    );
    return { ok: false };
  }
}

function asRecord(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" ? (params as Record<string, unknown>) : {};
}

function str(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

export const groupSharedDocHandlers: GatewayRequestHandlers = {
  "group.sharedDoc.open": async ({ params, respond, client }) => {
    const record = asRecord(params);
    const groupId = str(record, "groupId");
    const logicalId = str(record, "logicalId");
    const title = str(record, "title") || logicalId;
    const taskId = str(record, "taskId") || undefined;
    const initialBody = typeof record.initialBody === "string" ? record.initialBody : undefined;
    if (!logicalId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "logicalId required"));
      return;
    }
    const access = await resolveSharedDocAccess({ client, respond, groupId });
    if (!access.ok) {
      return;
    }
    try {
      const opened = await openOrCreateSharedDoc({
        groupWorkspaceRoot: access.workspaceRoot,
        groupId,
        logicalId,
        title,
        taskId,
        initialBody,
      });
      respond(true, {
        ok: true,
        groupId,
        relativePath: opened.relativePath,
        absolutePath: opened.absolutePath,
        meta: opened.meta,
        body: opened.body,
      });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : "open failed"),
      );
    }
  },

  "group.sharedDoc.claimSection": async ({ params, respond, client }) => {
    const record = asRecord(params);
    const groupId = str(record, "groupId");
    const logicalId = str(record, "logicalId");
    const sectionId = str(record, "sectionId");
    const actorAgentId = str(record, "actorAgentId");
    const title = str(record, "title") || sectionId;
    if (!logicalId || !sectionId || !actorAgentId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "logicalId, sectionId, actorAgentId required"),
      );
      return;
    }
    const access = await resolveSharedDocAccess({ client, respond, groupId });
    if (!access.ok) {
      return;
    }
    try {
      await openOrCreateSharedDoc({
        groupWorkspaceRoot: access.workspaceRoot,
        groupId,
        logicalId,
        title: title || logicalId,
      });
      try {
        const meta = await claimSharedDocSection({
          groupWorkspaceRoot: access.workspaceRoot,
          logicalId,
          sectionId,
          agentId: actorAgentId,
        });
        respond(true, { ok: true, groupId, logicalId, meta });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("section not found")) {
          throw error;
        }
      }
      await upsertSharedDocSection({
        groupWorkspaceRoot: access.workspaceRoot,
        logicalId,
        actorAgentId,
        section: {
          id: sectionId,
          title,
          ownerAgentId: null,
          status: "todo",
        },
      });
      const meta = await claimSharedDocSection({
        groupWorkspaceRoot: access.workspaceRoot,
        logicalId,
        sectionId,
        agentId: actorAgentId,
      });
      respond(true, { ok: true, groupId, logicalId, meta });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "claimSection failed",
        ),
      );
    }
  },

  "group.sharedDoc.writeBody": async ({ params, respond, client }) => {
    const record = asRecord(params);
    const groupId = str(record, "groupId");
    const logicalId = str(record, "logicalId");
    const actorAgentId = str(record, "actorAgentId");
    const content = typeof record.content === "string" ? record.content : null;
    const requireSectionOwner = str(record, "requireSectionOwner") || undefined;
    const title = str(record, "title") || logicalId;
    if (!logicalId || !actorAgentId || content === null) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "logicalId, actorAgentId, content required"),
      );
      return;
    }
    const access = await resolveSharedDocAccess({ client, respond, groupId });
    if (!access.ok) {
      return;
    }
    try {
      await openOrCreateSharedDoc({
        groupWorkspaceRoot: access.workspaceRoot,
        groupId,
        logicalId,
        title,
      });
      const written = await writeSharedDocBody({
        groupWorkspaceRoot: access.workspaceRoot,
        logicalId,
        content,
        actorAgentId,
        requireSectionOwner,
      });
      respond(true, { ok: true, groupId, ...written });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "writeBody failed",
        ),
      );
    }
  },

  "group.sharedDoc.appendReview": async ({ params, respond, client }) => {
    const record = asRecord(params);
    const groupId = str(record, "groupId");
    const logicalId = str(record, "logicalId");
    const byAgentId = str(record, "actorAgentId") || str(record, "byAgentId");
    const body = typeof record.body === "string" ? record.body : "";
    const sectionId = str(record, "sectionId") || undefined;
    const kindRaw = str(record, "kind");
    const kind =
      kindRaw === "request_changes" || kindRaw === "approve" || kindRaw === "comment"
        ? kindRaw
        : "comment";
    if (!logicalId || !byAgentId || !body.trim()) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "logicalId, actorAgentId, body required"),
      );
      return;
    }
    const access = await resolveSharedDocAccess({ client, respond, groupId });
    if (!access.ok) {
      return;
    }
    try {
      const comment = await appendSharedDocReview({
        groupWorkspaceRoot: access.workspaceRoot,
        logicalId,
        byAgentId,
        body,
        kind,
        sectionId,
      });
      respond(true, { ok: true, groupId, logicalId, comment });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "appendReview failed",
        ),
      );
    }
  },

  "group.sharedDoc.listReviews": async ({ params, respond, client }) => {
    const record = asRecord(params);
    const groupId = str(record, "groupId");
    const logicalId = str(record, "logicalId");
    if (!logicalId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "logicalId required"));
      return;
    }
    const access = await resolveSharedDocAccess({ client, respond, groupId });
    if (!access.ok) {
      return;
    }
    try {
      const reviews = await listSharedDocReviews({
        groupWorkspaceRoot: access.workspaceRoot,
        logicalId,
      });
      respond(true, { ok: true, groupId, logicalId, reviews });
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.UNAVAILABLE,
          error instanceof Error ? error.message : "listReviews failed",
        ),
      );
    }
  },
};
