/**
 * Gateway surface for the M2 issue queue.
 * Tenant comes from membership. A client-supplied enabled flag is ignored.
 * Confirm, prescribe-apply, recheck, and writeback stay closed while
 * DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED is false.
 */
import { ErrorCodes, errorShape } from "../gateway/protocol/index.js";
import type { GatewayRequestHandlers } from "../gateway/server-methods/types.js";
import { CONFIG_DIR } from "../utils.js";
import { DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED } from "./diagnose-professional-protocol.js";
import {
  DIAGNOSIS_FINDING_KIND,
  DIAGNOSIS_ISSUE_KIND,
  attachDiagnosisRootCause,
  listDiagnosisIssues,
  openDiagnosisIssue,
  transitionOpsQueue,
  type DiagnosisIssueEvaluationRef,
} from "./diagnosis-issue-queue.js";
import {
  resolveDiagnosisProductionAuth,
  type DiagnosisGatewayAuthClient,
  type DiagnosisGatewayAuthDeps,
} from "./report-query-gateway.js";

export const DIAGNOSIS_ISSUES_LIST_METHOD = "diagnosis.issues.list" as const;
export const DIAGNOSIS_ISSUES_ADVANCE_METHOD = "diagnosis.issues.advance" as const;

export const DIAGNOSIS_ISSUE_QUEUE_METHODS = [
  DIAGNOSIS_ISSUES_LIST_METHOD,
  DIAGNOSIS_ISSUES_ADVANCE_METHOD,
] as const;

const CLOSED_ACTIONS = new Set(["confirm", "prescribe", "apply", "recheck", "writeback"]);

export function createDiagnosisIssueQueueHandlers(
  authDeps: DiagnosisGatewayAuthDeps = {},
  options: { configDir?: string } = {},
): GatewayRequestHandlers {
  const configDir = options.configDir ?? CONFIG_DIR;
  return {
    [DIAGNOSIS_ISSUES_LIST_METHOD]: async ({ client, respond }) => {
      const auth = await resolveDiagnosisProductionAuth(asAuthClient(client), authDeps);
      if (!auth?.trusted.tenantId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const issues = listDiagnosisIssues(auth.trusted.tenantId, configDir);
      respond(true, { ok: true, queue: "issue", issues });
    },
    [DIAGNOSIS_ISSUES_ADVANCE_METHOD]: async ({ params, client, respond }) => {
      const auth = await resolveDiagnosisProductionAuth(asAuthClient(client), authDeps);
      if (!auth?.trusted.tenantId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const tenantId = auth.trusted.tenantId;
      const record = params && typeof params === "object" ? params : {};
      const kind = typeof record.kind === "string" ? record.kind : DIAGNOSIS_ISSUE_KIND;
      const findingId = typeof record.findingId === "string" ? record.findingId.trim() : "";
      const issueId = typeof record.issueId === "string" ? record.issueId.trim() : "";
      if (kind === DIAGNOSIS_FINDING_KIND || (findingId && kind !== DIAGNOSIS_ISSUE_KIND)) {
        respond(true, { ok: false, reason: "finding_not_queue" });
        return;
      }
      if (findingId) {
        const queued = transitionOpsQueue({
          tenantId,
          configDir,
          targetKind: DIAGNOSIS_FINDING_KIND,
          targetId: findingId,
        });
        respond(true, queued);
        return;
      }
      const action = typeof record.action === "string" ? record.action : "";
      // Gateway never applies evolution. The library test path is the only
      // place that may pass enabled: true. The production latch stays false.
      if (CLOSED_ACTIONS.has(action)) {
        respond(true, {
          ok: false,
          reason: "confirm_not_enabled",
          enabled: DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED,
        });
        return;
      }
      if (action === "open") {
        const evaluation = readEvaluation(record.evaluation, tenantId);
        if (!evaluation) {
          respond(true, { ok: false, reason: "evaluation_required" });
          return;
        }
        const opened = openDiagnosisIssue({
          tenantId,
          configDir,
          evaluations: [evaluation],
        });
        respond(true, opened);
        return;
      }
      if (action === "triage") {
        if (!issueId) {
          respond(true, { ok: false, reason: "issue_required" });
          return;
        }
        const summary = typeof record.summary === "string" ? record.summary : "";
        const triaged = attachDiagnosisRootCause({
          tenantId,
          configDir,
          issueId,
          summary,
        });
        respond(true, triaged);
        return;
      }
      if (issueId) {
        const queued = transitionOpsQueue({
          tenantId,
          configDir,
          targetKind: kind,
          targetId: issueId,
        });
        respond(true, queued.ok ? { ok: false, reason: "confirm_not_enabled" } : queued);
        return;
      }
      respond(true, { ok: false, reason: "issue_required" });
    },
  };
}

function readEvaluation(value: unknown, tenantId: string): DiagnosisIssueEvaluationRef | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const conversationId =
    typeof record.conversationId === "string" ? record.conversationId.trim() : "";
  const eventId = typeof record.eventId === "string" ? record.eventId.trim() : "";
  if (!conversationId || !eventId) {
    return null;
  }
  // Ignore a client-supplied tenant. Membership is the only tenant.
  return {
    tenantId,
    conversationId,
    eventId,
    agentId: typeof record.agentId === "string" ? record.agentId : null,
    failureAttribution:
      typeof record.failureAttribution === "string" ? record.failureAttribution : undefined,
    correctness: typeof record.correctness === "string" ? record.correctness : undefined,
    usability: typeof record.usability === "string" ? record.usability : undefined,
  };
}

function asAuthClient(client: unknown): DiagnosisGatewayAuthClient | null {
  if (!client || typeof client !== "object") {
    return null;
  }
  return client as DiagnosisGatewayAuthClient;
}
