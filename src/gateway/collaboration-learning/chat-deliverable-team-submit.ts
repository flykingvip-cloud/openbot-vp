import path from "node:path";
/**
 * Force group agent DELIVERABLE finals through submitTeamDeliverable (product wiring).
 *
 * Unique formal team delivery point: submitTeamDeliverable writes trusted team SoT.
 * prepareChatDeliverablePublish remains chat settle/ledger only — callers must await
 * this helper and surface ok/failure; never treat settle alone as team delivery success.
 *
 * Empty declared body does NOT fall back to the whole chat text.
 * This PR supports text deliverables only — binary declarations are refused
 * (no UTF-8 round-trip of PDF/images/archives).
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

const BINARY_EXT = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".zip",
  ".gz",
  ".tgz",
  ".7z",
]);

function looksBinaryPath(relativePath: string): boolean {
  const ext = path.extname(relativePath).toLowerCase();
  return BINARY_EXT.has(ext);
}

export type ChatTeamDeliverableSubmitOutcome =
  | TeamDeliverableSubmitResult
  | { ok: false; reason: string; detail?: string };

export async function maybeSubmitTeamDeliverableFromChatFinal(params: {
  text: string;
  groupId?: string | null;
  /** Must come from execution bag / round binding — never OS currentTaskId alone. */
  taskId?: string | null;
  agentId: string;
  client?: GatewayClient | null;
  /** Pass-through original trust; never invent membership from a bare tenantId. */
  tenant?: CollaborationTenantResolution | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  cfg?: OpenBotConfig;
  /**
   * @deprecated R2: this PR is text-only. Ignored; binary paths are always refused.
   * Kept so call sites compile until authorized bytes submit lands in a later PR.
   */
  contentFromFile?: string | null;
  /** Tests / trusted composition roots may disable ACL when already authorized. */
  enforceAcl?: boolean;
}): Promise<ChatTeamDeliverableSubmitOutcome> {
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
  const relativePath = declared.file.startsWith("deliverables/")
    ? declared.file
    : `deliverables/${declared.file.replace(/^\/+/, "")}`;

  // R2: text-only — refuse all binary declarations (do not UTF-8-corrupt bytes).
  if (looksBinaryPath(relativePath)) {
    return {
      ok: false,
      reason: "deliverable_binary_not_supported_in_this_pr",
      detail: relativePath,
    };
  }
  void params.contentFromFile;

  const content = compact(declared.body);
  if (!content) {
    // Refuse: empty body must not fall back to whole chat text or file UTF-8.
    return { ok: false, reason: "deliverable_empty_body" };
  }

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
    enforceAcl: params.enforceAcl,
  });
}

/** Format user-visible success/failure for team delivery (not chat settle alone). */
export function formatTeamDeliverableUserMessage(
  outcome: ChatTeamDeliverableSubmitOutcome,
): string {
  if (outcome.ok) {
    return (
      `团队成果已提交 id=${outcome.deliverableId} v${outcome.version}` +
      ` @ ${outcome.locator} (${outcome.relativePath})。`
    );
  }
  const detail = "detail" in outcome && outcome.detail ? `: ${outcome.detail}` : "";
  return `团队成果未完成（${outcome.reason}${detail}）。`;
}
