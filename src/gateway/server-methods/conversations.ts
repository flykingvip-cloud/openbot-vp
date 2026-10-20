import { loadConfig } from "../../config/config.js";
import { exportConversationTranscript } from "../../conversations/conversation-export.js";
import { runConversationRetentionEnforcement } from "../../conversations/retention-enforcer.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function notImplemented(method: string): GatewayRequestHandlers[string] {
  return async ({ respond }) => {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, `${method} is not yet implemented in this gateway build`),
    );
  };
}

export const conversationHandlers: GatewayRequestHandlers = {
  "conversations.create": notImplemented("conversations.create"),
  "conversations.list": notImplemented("conversations.list"),
  "conversations.get": notImplemented("conversations.get"),
  "conversations.rename": notImplemented("conversations.rename"),
  "conversations.close": notImplemented("conversations.close"),
  "conversations.archive": notImplemented("conversations.archive"),
  "conversations.restore": notImplemented("conversations.restore"),
  "conversations.job": notImplemented("conversations.job"),
  "conversations.bindings.attachExecution": notImplemented(
    "conversations.bindings.attachExecution",
  ),
  "conversations.lineage.get": notImplemented("conversations.lineage.get"),
  "conversations.sharedTask.get": notImplemented("conversations.sharedTask.get"),
  "conversations.sharedTask.update": notImplemented("conversations.sharedTask.update"),
  "conversations.search": notImplemented("conversations.search"),
  "conversations.index.upsert": notImplemented("conversations.index.upsert"),
  "conversations.sourceIdentity.migrate": notImplemented("conversations.sourceIdentity.migrate"),
  "conversations.export": async ({ params, respond }) => {
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
    try {
      const result = await exportConversationTranscript({
        cfg: loadConfig(),
        agentId,
        sessionId,
      });
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "conversations.purge": notImplemented("conversations.purge"),

  "conversations.retention.scan": async ({ params, respond }) => {
    const cfg = loadConfig();
    const agentId = typeof params.agentId === "string" ? params.agentId.trim() : undefined;
    const tenantId = typeof params.tenantId === "string" ? params.tenantId.trim() : undefined;
    const dryRun = params.dryRun !== false;
    try {
      const result = await runConversationRetentionEnforcement({
        cfg,
        tenantId,
        agentId,
        dryRun,
      });
      respond(true, result);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
