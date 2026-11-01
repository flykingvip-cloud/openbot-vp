/**
 * Read-only diagnosis report API client (diagnosis.reports.query / get).
 */
import { GatewayRequestError, type GatewayBrowserClient } from "../../gateway.ts";
import type { DiagnosisApprovalBody } from "./diagnosis-approval-result.ts";

export type DiagnosisReportQueryParams = {
  schemaVersion: 1;
  mode: "report";
  limit?: number;
  cursor?: string;
  redactionProfile?: "administrator" | "user" | "system_local";
};

export type DiagnosisReportGetParams = {
  schemaVersion: 1;
  reportId: string;
  redactionProfile?: "administrator" | "user" | "system_local";
};

export type DiagnosisReportProjection = {
  reportId: string;
  generatedAt: string;
  tenantId: string | null;
  completion: string;
  cases: Array<{
    caseId: string;
    status: string;
    completion: string;
    sessionKeyHash?: string;
  }>;
  findings: Array<{
    findingId: string;
    severity: "P0" | "P1" | "P2" | "P3" | "P4";
    status: string;
    code?: string;
  }>;
  impactScope: string[];
  confidence: {
    findingCount: number;
    acceptedCauseCount: number;
    candidateCauseCount: number;
  };
  evidenceRefIds?: string[];
};

export type DiagnosisReportQueryResponse = {
  schemaVersion: 1;
  authorization: { outcome: "allow" | "deny"; reason: string };
  items: DiagnosisReportProjection[];
  nextCursor: string | null;
  redactionProfile: string;
  audit: { decision: "allow" | "deny"; denyReason?: string };
};

export type DiagnosisReportGetResponse = {
  schemaVersion: 1;
  authorization: { outcome: "allow" | "deny"; reason: string };
  report: Record<string, unknown>;
  redactionProfile: string;
  audit: { decision: "allow" | "deny"; denyReason?: string };
};

let diagnosisClient: GatewayBrowserClient | null = null;

export function setDiagnosisApiClient(client: GatewayBrowserClient | null | undefined) {
  diagnosisClient = client ?? null;
}

export function isDiagnosisGatewayReady() {
  return Boolean(diagnosisClient?.connected);
}

function isAuthDenied(err: unknown): boolean {
  if (!(err instanceof GatewayRequestError)) {
    return false;
  }
  return err.gatewayCode === "401" || err.gatewayCode === "403" || err.gatewayCode === "forbidden";
}

function deniedQueryResponse(reason: string): DiagnosisReportQueryResponse {
  return {
    schemaVersion: 1,
    authorization: { outcome: "deny", reason },
    items: [],
    nextCursor: null,
    redactionProfile: "user",
    audit: { decision: "deny", denyReason: reason },
  };
}

async function requestGateway<T>(method: string, params: unknown): Promise<T | null> {
  if (!diagnosisClient?.connected) {
    return null;
  }
  try {
    return await diagnosisClient.request<T>(method, params);
  } catch (err) {
    if (isAuthDenied(err) && method === "diagnosis.reports.query") {
      const reason = err instanceof GatewayRequestError ? err.message || "forbidden" : "forbidden";
      return deniedQueryResponse(reason) as T;
    }
    console.warn(`[diagnosis] ${method} unavailable`, err);
    return null;
  }
}

export async function queryDiagnosisReports(
  params: DiagnosisReportQueryParams,
): Promise<DiagnosisReportQueryResponse | null> {
  return requestGateway<DiagnosisReportQueryResponse>("diagnosis.reports.query", params);
}

export async function getDiagnosisReport(
  params: DiagnosisReportGetParams,
): Promise<DiagnosisReportGetResponse | null> {
  return requestGateway<DiagnosisReportGetResponse>("diagnosis.reports.get", params);
}

export type DiagnosisDiagnoseResponse = {
  reportId: string | null;
  completion: string;
  findingCount: number;
  findings: Array<{ findingId: string; severity: string; status: string; code?: string }>;
  reason?: string;
  windowId?: string;
  mode?: string;
  scope?: string;
  scanned?: number;
  skipped?: number;
  requestedCount?: number;
  cadence?: string;
  delivery?: {
    requested: { enterpriseAdmin: boolean; owners: boolean };
    delivered: boolean;
    reason: string;
    routes: string[];
  };
  reportText?: string;
  evolutionProjections?: DiagnosisEvolutionProjection[];
  taskOutcomeEvidence?: {
    ok?: boolean;
    code?: string;
    taskId?: string;
    outcomeVersion?: number;
    judgement?: string;
    reasonCode?: string;
    revisionKind?: string;
  };
};

export type DiagnosisEvolutionProjection = {
  candidateVersion: string;
  found: boolean;
  liveStatus: string | null;
  experimentId: string | null;
  canRequestExperiment: boolean;
  requestExperimentHint: "申请开实验";
};

export async function getDiagnosisEvolutionStatus(
  candidateVersion: string,
): Promise<{ projection: DiagnosisEvolutionProjection } | null> {
  if (!diagnosisClient?.connected) {
    return null;
  }
  try {
    return await diagnosisClient.request<{ projection: DiagnosisEvolutionProjection }>(
      "evolution.diagnosis.status",
      { candidateVersion },
    );
  } catch (err) {
    if (isAuthDenied(err)) {
      return null;
    }
    console.warn("[diagnosis] evolution.diagnosis.status unavailable", err);
    return null;
  }
}

export type DiagnosisActionDispatchResponse = {
  ok: boolean;
  reason: string;
  channel?: "diagnosed_agent_session" | "steward";
  targetSessionKey?: string;
  requesterSessionKey?: string;
  runId?: string;
};

export async function runDiagnosisActionDispatch(params: {
  title: string;
  agentPrompt: string;
  targetAgentId: string;
  targetSessionKey: string;
}): Promise<DiagnosisActionDispatchResponse | null> {
  if (!diagnosisClient?.connected) {
    return null;
  }
  try {
    return await diagnosisClient.request<DiagnosisActionDispatchResponse>(
      "diagnosis.action.dispatch",
      params,
    );
  } catch (err) {
    if (isAuthDenied(err)) {
      return { ok: false, reason: "forbidden" };
    }
    console.warn("[diagnosis] diagnosis.action.dispatch unavailable", err);
    return { ok: false, reason: "unavailable" };
  }
}

export async function runDiagnosisDiagnose(params?: {
  sessionKey?: string;
  agentId?: string;
  runId?: string;
  scope?: "target" | "all";
  window?: "24h" | "7d";
  mode?: "TARGETED" | "FULL";
  cadence?: "off" | "daily" | "tick";
  deliverTo?: { enterpriseAdmin?: boolean; owners?: boolean };
  targets?: Array<{ agentId: string; sessionKey: string; runId?: string | null }>;
  taskOutcome?: { taskId: string; agentId: string; outcomeVersion: number };
}): Promise<DiagnosisDiagnoseResponse | null> {
  if (!diagnosisClient?.connected) {
    return null;
  }
  try {
    return await diagnosisClient.request<DiagnosisDiagnoseResponse>(
      "diagnosis.diagnose",
      params ?? {},
    );
  } catch (err) {
    if (isAuthDenied(err)) {
      return {
        reportId: null,
        completion: "INCONCLUSIVE",
        findingCount: 0,
        findings: [],
        reason: "forbidden",
      };
    }
    console.warn("[diagnosis] diagnosis.diagnose unavailable", err);
    return null;
  }
}

export type EnterpriseDiagnosisApprovalRequest = {
  schemaVersion: 1;
  idempotencyKey: string;
  subject:
    | { kind: "authorization"; grantId: string }
    | {
        kind: "conversation";
        signalId?: string;
        caseId?: string;
        tenantId?: string | null;
        targetRef?: { targetType: string; targetId: string; tenantId: string | null };
      };
  decision: "approve" | "deny";
  reason: string | null;
};

export async function decideEnterpriseDiagnosisApproval(
  params: EnterpriseDiagnosisApprovalRequest,
): Promise<
  | { transport: "ok"; body: DiagnosisApprovalBody }
  | { transport: "error"; message: string }
  | { transport: "disconnected" }
> {
  if (!diagnosisClient?.connected) {
    return { transport: "disconnected" };
  }
  try {
    const body = await diagnosisClient.request<DiagnosisApprovalBody>(
      "enterprise.diagnosis.approval.decide",
      params,
    );
    return { transport: "ok", body };
  } catch (err) {
    const message = err instanceof Error ? err.message : "审批请求失败。";
    return { transport: "error", message };
  }
}
