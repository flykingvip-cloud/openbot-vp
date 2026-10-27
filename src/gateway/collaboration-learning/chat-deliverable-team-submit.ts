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
 *
 * R3: finalizeMemberRunTeamDeliverable requires an unconfusable run binding from
 * the real dispatcher (no process Map / no "latest member" fallback). Binding is
 * not consumed so submit failure can retry with the same binding.
 */
import type { OpenBotConfig } from "../../config/types.js";
import { extractDeliverableEnvelope } from "../../shared/preview-artifact/deliverable-envelope.js";
import type { GatewayClient } from "../server-methods/types.js";
import {
  normalizeExecutionDeliverableBinding,
  type ExecutionDeliverableBinding,
} from "./execution-deliverable-binding.js";
import { resolveActorDeliverableTaskBinding } from "./resolve-actor-deliverable-task.js";
import {
  submitTeamDeliverable,
  type TeamDeliverableSubmitResult,
} from "./team-deliverable-submit.js";
import type { TeamResourceAuthOk, TrustedGroupStores } from "./team-resource-auth.js";
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

/**
 * R3/R4: dispatcher → member run final. Binding stays with the caller for retries.
 * Re-normalizes the binding and checks tenant/authority scope before submit.
 */
export async function finalizeMemberRunTeamDeliverable(params: {
  text: string;
  agentId: string;
  binding: ExecutionDeliverableBinding | null | undefined;
  client?: GatewayClient | null;
  tenant?: CollaborationTenantResolution | null;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  stores?: TrustedGroupStores | null;
  cfg?: OpenBotConfig;
  groupCurrentTaskId?: string | null;
  enforceAcl?: boolean;
}): Promise<{ text: string; outcome: ChatTeamDeliverableSubmitOutcome }> {
  if (!params.text.includes("DELIVERABLE")) {
    return { text: params.text, outcome: { ok: false, reason: "no_deliverable_envelope" } };
  }
  const binding = normalizeExecutionDeliverableBinding(params.binding);
  if (!binding) {
    const outcome = {
      ok: false as const,
      reason: params.binding ? "execution_binding_incomplete" : "execution_binding_required",
    };
    return {
      text: `${params.text.trim()}\n\n${formatTeamDeliverableUserMessage(outcome)}`,
      outcome,
    };
  }

  const authTenant = compact(params.auth?.tenantId);
  const labeledTenant = compact(params.tenant?.tenantId);
  const bindingTenant = compact(binding.tenantId);
  // When authority / labeled tenant is present, binding must agree (no cross-tenant final).
  if (authTenant && bindingTenant && authTenant.toLowerCase() !== bindingTenant.toLowerCase()) {
    const outcome = {
      ok: false as const,
      reason: "execution_binding_tenant_mismatch",
      detail: `binding=${bindingTenant} auth=${authTenant}`,
    };
    return {
      text: `${params.text.trim()}\n\n${formatTeamDeliverableUserMessage(outcome)}`,
      outcome,
    };
  }
  if (
    labeledTenant &&
    bindingTenant &&
    labeledTenant.toLowerCase() !== bindingTenant.toLowerCase()
  ) {
    const outcome = {
      ok: false as const,
      reason: "execution_binding_tenant_mismatch",
      detail: `binding=${bindingTenant} tenant=${labeledTenant}`,
    };
    return {
      text: `${params.text.trim()}\n\n${formatTeamDeliverableUserMessage(outcome)}`,
      outcome,
    };
  }
  if ((authTenant || labeledTenant) && !bindingTenant) {
    const outcome = {
      ok: false as const,
      reason: "execution_binding_tenant_required",
      detail: "authorized tenant present but binding.tenantId missing",
    };
    return {
      text: `${params.text.trim()}\n\n${formatTeamDeliverableUserMessage(outcome)}`,
      outcome,
    };
  }

  const resolved = await resolveActorDeliverableTaskBinding({
    groupId: binding.groupId,
    actorId: params.agentId,
    explicitTaskId: binding.taskId,
    explicitBoardItemId: binding.boardItemId,
    explicitTodolistId: binding.todolistId,
    explicitPlanVersion: binding.planVersion,
    explicitStepId: binding.stepId,
    explicitRunId: binding.runId,
    groupCurrentTaskId: params.groupCurrentTaskId,
    auth: params.auth,
    trusted: params.trusted,
    stores: params.stores,
    tenant: params.tenant,
    cfg: params.cfg,
  });
  if (!resolved.ok) {
    const outcome = {
      ok: false as const,
      reason: `task_binding_required:${resolved.reason}`,
    };
    return {
      text: `${params.text.trim()}\n\n${formatTeamDeliverableUserMessage(outcome)}`,
      outcome,
    };
  }
  const outcome = await maybeSubmitTeamDeliverableFromChatFinal({
    text: params.text,
    groupId: binding.groupId,
    taskId: resolved.taskId,
    agentId: params.agentId,
    client: params.client,
    tenant: params.tenant,
    trusted: params.trusted,
    cfg: params.cfg,
    enforceAcl: params.enforceAcl,
  });
  return {
    text: `${params.text.trim()}\n\n${formatTeamDeliverableUserMessage(outcome)}`,
    outcome,
  };
}
