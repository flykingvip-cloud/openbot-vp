import type { OpenBotConfig } from "../config/config.js";
import { broadcastWorkbenchSignalsInvalidate } from "../gateway/workbench/signals-invalidate.js";
import type { MentionMetadata } from "./mention-types.js";
import {
  createTaskAssignment,
  upsertOrganizationTaskAssignment,
  type TaskAssignment,
} from "./task-assignment.js";

export interface MentionTaskConverterParams {
  cfg: OpenBotConfig;
  workspaceDir: string;
  organizationId: string;
  mention: MentionMetadata;
  messageText: string;
  sourceAgentId: string;
  confirmedBy?: "coordinator" | "user";
  title?: string;
  now?: Date | string;
}

export interface MentionTaskConversionResult {
  assignment: TaskAssignment;
  mention_id: string;
  linked_task_id: string;
}

function deriveTitle(params: MentionTaskConverterParams): string {
  const explicit = params.title?.trim();
  if (explicit) {
    return explicit;
  }
  const cleaned = params.messageText.replace(/\s+/g, " ").trim();
  return cleaned.length > 96
    ? `${cleaned.slice(0, 93)}...`
    : cleaned || `Mention ${params.mention.mention_id}`;
}

export async function convert(
  params: MentionTaskConverterParams,
): Promise<MentionTaskConversionResult> {
  if (!params.confirmedBy) {
    throw new Error("Mention task conversion requires confirmation by coordinator or user.");
  }

  const assignment = createTaskAssignment({
    organizationId: params.organizationId,
    title: deriveTitle(params),
    ownerAgentId:
      params.mention.agentId?.trim() ||
      (params.mention.target?.kind === "agent"
        ? params.mention.target.agentId
        : params.sourceAgentId),
    createdByAgentId: params.sourceAgentId,
    now: params.now,
    notes: [
      `Converted from mention ${params.mention.mention_id}.`,
      `Confirmed by ${params.confirmedBy}.`,
    ].join(" "),
  });
  await upsertOrganizationTaskAssignment({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    assignment,
  });
  broadcastWorkbenchSignalsInvalidate({ reason: "mention" });
  return {
    assignment,
    mention_id: params.mention.mention_id,
    linked_task_id: assignment.id,
  };
}

export const TaskConverter = { convert };
