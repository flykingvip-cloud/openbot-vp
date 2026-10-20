import { resolveWorkspaceRoot } from "../../agents/workspace-dir.js";
import { loadConfig } from "../../config/config.js";
import {
  transitionMentionState,
  type MentionStateTransition,
} from "../../organization/mention-state-tracker.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { stringValue } from "../records.js";
import type { GatewayRequestHandlers } from "./types.js";

function readRequiredString(params: Record<string, unknown>, key: string): string | null {
  return stringValue(params[key]);
}

async function transitionMention(params: {
  rawParams: Record<string, unknown>;
  transition: MentionStateTransition;
}) {
  const mentionId = readRequiredString(params.rawParams, "mention_id");
  const organizationId = readRequiredString(params.rawParams, "organizationId");
  if (!mentionId || !organizationId) {
    return {
      ok: false as const,
      error: errorShape(ErrorCodes.INVALID_REQUEST, "mention_id and organizationId are required"),
    };
  }

  const state = await transitionMentionState({
    cfg: loadConfig(),
    workspaceDir: resolveWorkspaceRoot(
      typeof params.rawParams.workspaceDir === "string" ? params.rawParams.workspaceDir : undefined,
    ),
    organizationId,
    mention_id: mentionId,
    transition: params.transition,
  });
  if (!state) {
    return {
      ok: false as const,
      error: errorShape(ErrorCodes.INVALID_REQUEST, `mention not found: ${mentionId}`),
    };
  }
  return { ok: true as const, state };
}

export const mentionHandlers: GatewayRequestHandlers = {
  "mention.acknowledge": async ({ params, respond }) => {
    const result = await transitionMention({
      rawParams: params,
      transition: "acknowledge",
    });
    if (!result.ok) {
      respond(false, undefined, result.error);
      return;
    }
    respond(true, result.state);
  },
};
