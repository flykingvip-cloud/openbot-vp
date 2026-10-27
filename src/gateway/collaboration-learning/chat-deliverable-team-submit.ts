/**
 * Force group agent DELIVERABLE finals through submitTeamDeliverable (product wiring).
 *
 * Unique formal team delivery point: submitTeamDeliverable writes trusted team SoT.
 * prepareChatDeliverablePublish remains chat settle/ledger only — callers must await
 * this helper and surface ok/failure; never treat settle alone as team delivery success.
 *
 * Empty declared body does NOT fall back to the whole chat text.
 * Binary-looking file declarations require real file bytes (contentFromFile), not prose.
 */
import fs from "node:fs/promises";
import path from "node:path";
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
   * When declared file looks binary, read bytes from this absolute path instead of
   * writing chat prose as the file body.
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

  let content = compact(declared.body);
  if (!content) {
    const fromFile = compact(params.contentFromFile);
    if (fromFile) {
      try {
        content = await fs.readFile(fromFile, "utf8");
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, reason: "deliverable_file_unreadable", detail };
      }
      content = compact(content);
    }
  }
  if (!content) {
    // Refuse: empty body must not fall back to whole chat text.
    return { ok: false, reason: "deliverable_empty_body" };
  }
  if (looksBinaryPath(relativePath) && !compact(params.contentFromFile)) {
    return {
      ok: false,
      reason: "deliverable_binary_requires_file_bytes",
      detail: relativePath,
    };
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
