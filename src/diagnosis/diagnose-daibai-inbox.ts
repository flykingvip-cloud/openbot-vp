/**
 * Path A: system self-check delivery into the designated Da Bai conversation,
 * same write point as scheduled/cron workbench results (`chat.inject`).
 * Recipients are people; each maps to that person's steward conversation.
 * Does not open DIAGNOSIS_DAIBAI_DELIVERY_ENABLED and never calls
 * user.daibai.ask/execute or chat.send.
 */
import { buildEmployeeBuiltinStewardSessionKey } from "../agents/builtin-steward/employee-isolation.js";
import { isBuiltinStewardAgent } from "../agents/builtin-steward/identity.js";
import {
  planDiagnosisDaibaiDelivery,
  type DiagnosisDeliveryPlan,
  type DiagnosisLocator,
  type ParsedDiagnoseRequest,
} from "./diagnose-policy.js";

export type DiagnoseConversationSend = (input: {
  sessionKey: string;
  userId: string;
  tenantId: string;
  text: string;
  route: "enterprise" | "employee";
}) => Promise<"accepted" | "unavailable">;

export type DiagnoseConversationTarget = {
  sessionKey: string;
  userId: string;
  route: "enterprise" | "employee";
};

export type DiagnoseConversationOwnerResolver = (input: {
  locator: DiagnosisLocator;
  tenantId: string | null;
}) => DiagnoseConversationTarget[];

/** @deprecated Use DiagnoseConversationSend. */
export type DiagnoseDaibaiInboxSend = DiagnoseConversationSend;
/** @deprecated Use DiagnoseConversationTarget. */
export type DiagnoseInboxTarget = DiagnoseConversationTarget;
/** @deprecated Use DiagnoseConversationOwnerResolver. */
export type DiagnoseInboxOwnerResolver = DiagnoseConversationOwnerResolver;

export function stewardConversationTarget(input: {
  userId: string;
  route: "enterprise" | "employee";
}): DiagnoseConversationTarget {
  const userId = input.userId.trim();
  return {
    userId,
    route: input.route,
    sessionKey: buildEmployeeBuiltinStewardSessionKey(userId),
  };
}

export function enterpriseAdminInboxTarget(input: {
  tenantId?: string | null;
  userId: string;
}): DiagnoseConversationTarget {
  void input.tenantId;
  return stewardConversationTarget({ userId: input.userId, route: "enterprise" });
}

export function ownerStewardInboxRecipient(input: {
  tenantId?: string | null;
  userId: string;
}): DiagnoseConversationTarget {
  void input.tenantId;
  return stewardConversationTarget({ userId: input.userId, route: "employee" });
}

export function extractSpaceGroupId(sessionKey: string): string | null {
  const match = sessionKey.trim().match(/:space:([^:]+)$/);
  const groupId = match?.[1]?.trim();
  return groupId || null;
}

export function resolveDiagnoseConversationTargets(input: {
  request: ParsedDiagnoseRequest;
  tenantId?: string | null;
  requesterUserId?: string | null;
  resolveOwners?: DiagnoseConversationOwnerResolver;
}): DiagnoseConversationTarget[] {
  const out: DiagnoseConversationTarget[] = [];
  const seen = new Set<string>();
  const push = (target: DiagnoseConversationTarget) => {
    if (!target.sessionKey || !target.userId || seen.has(target.sessionKey)) {
      return;
    }
    seen.add(target.sessionKey);
    out.push(target);
  };
  if (input.request.deliverTo.enterpriseAdmin && input.requesterUserId?.trim()) {
    push(
      stewardConversationTarget({
        userId: input.requesterUserId,
        route: "enterprise",
      }),
    );
  }
  if (input.request.deliverTo.owners) {
    for (const locator of input.request.locators) {
      if (isBuiltinStewardAgent(locator.agentId)) {
        continue;
      }
      const owners = input.resolveOwners?.({
        locator,
        tenantId: input.tenantId ?? null,
      });
      for (const owner of owners ?? []) {
        push({ ...owner, route: "employee" });
      }
    }
  }
  return out;
}

/** @deprecated Use resolveDiagnoseConversationTargets. */
export const resolveDiagnoseInboxTargets = resolveDiagnoseConversationTargets;

export async function deliverDiagnoseReportToConversation(input: {
  request: ParsedDiagnoseRequest;
  reportText: string;
  send: DiagnoseConversationSend;
  tenantId?: string | null;
  requesterUserId?: string | null;
  resolveOwners?: DiagnoseConversationOwnerResolver;
}): Promise<DiagnosisDeliveryPlan> {
  const planned = planDiagnosisDaibaiDelivery(input.request.deliverTo);
  if (planned.routes.length === 0) {
    return planned;
  }
  const tenantId = input.tenantId?.trim();
  const text = input.reportText.trim();
  if (!tenantId || !text) {
    return { ...planned, reason: "conversation_unavailable" };
  }
  const targets = resolveDiagnoseConversationTargets({
    request: input.request,
    tenantId,
    requesterUserId: input.requesterUserId,
    resolveOwners: input.resolveOwners,
  });
  if (targets.length === 0) {
    return { ...planned, reason: "conversation_unavailable" };
  }
  const accepted: string[] = [];
  for (const target of targets) {
    const result = await input.send({
      sessionKey: target.sessionKey,
      userId: target.userId,
      tenantId,
      text,
      route: target.route,
    });
    if (result === "accepted") {
      accepted.push(target.sessionKey);
    }
  }
  if (accepted.length === targets.length) {
    return {
      requested: input.request.deliverTo,
      delivered: true,
      reason: "conversation_accepted",
      routes: planned.routes,
      sessions: accepted,
    };
  }
  return {
    requested: input.request.deliverTo,
    delivered: false,
    reason: "conversation_unavailable",
    routes: planned.routes,
    sessions: accepted,
  };
}

/** @deprecated Use deliverDiagnoseReportToConversation. */
export const deliverDiagnoseReportToInbox = deliverDiagnoseReportToConversation;
