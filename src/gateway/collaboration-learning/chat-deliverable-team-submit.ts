/**
 * Force group agent DELIVERABLE finals through submitTeamDeliverable (product wiring).
 *
 * prepareChatDeliverablePublish remains the chat settle/ledger path; this helper
 * additionally writes the trusted team SoT object+file when groupId+taskId+body exist.
 * Failures are returned, never thrown into the chat final path.
 */
import type { OpenBotConfig } from "../../config/types.js";
import { extractDeliverableEnvelope } from "../../shared/preview-artifact/deliverable-envelope.js";
import type { GatewayClient } from "../server-methods/types.js";
import {
  submitTeamDeliverable,
  type TeamDeliverableSubmitResult,
} from "./team-deliverable-submit.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export async function maybeSubmitTeamDeliverableFromChatFinal(params: {
  text: string;
  groupId?: string | null;
  taskId?: string | null;
  agentId: string;
  client?: GatewayClient | null;
  tenant?: CollaborationTenantResolution | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  cfg?: OpenBotConfig;
}): Promise<TeamDeliverableSubmitResult | { ok: false; reason: string }> {
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  const agentId = compact(params.agentId);
  if (!groupId || !taskId || !agentId) {
    return { ok: false, reason: "group_task_or_agent_required" };
  }
  if (!params.text.includes("DELIVERABLE")) {
    return { ok: false, reason: "no_deliverable_envelope" };
  }
  const declared = extractDeliverableEnvelope(params.text);
  if (!declared?.file) {
    return { ok: false, reason: "deliverable_missing_file" };
  }
  const content = compact(declared.body) || compact(params.text);
  if (!content) {
    return { ok: false, reason: "deliverable_empty_body" };
  }
  const relativePath = declared.file.startsWith("deliverables/")
    ? declared.file
    : `deliverables/${declared.file.replace(/^\/+/, "")}`;

  return submitTeamDeliverable({
    groupId,
    taskId,
    actor: agentId,
    title: compact(declared.title) || relativePath,
    content,
    relativePath,
    tenant: params.tenant,
    client: params.client,
    trusted: params.trusted,
    cfg: params.cfg,
  });
}
