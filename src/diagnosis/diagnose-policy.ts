/**
 * Enterprise diagnose policy: observation window, mode, all-scope cap,
 * schedule cadence, and Da Bai delivery intent. Does not open production gates.
 */
import type { DiagnosticBudget, DiagnosticRunMode } from "./types.js";

export const DIAGNOSIS_OBSERVATION_WINDOW_IDS = ["24h", "7d"] as const;
export type DiagnosisObservationWindowId = (typeof DIAGNOSIS_OBSERVATION_WINDOW_IDS)[number];

export const DIAGNOSIS_ENTERPRISE_MODES = ["TARGETED", "FULL"] as const;
export type DiagnosisEnterpriseMode = (typeof DIAGNOSIS_ENTERPRISE_MODES)[number];

export const DIAGNOSIS_SCHEDULE_CADENCES = ["off", "daily", "tick"] as const;
export type DiagnosisScheduleCadence = (typeof DIAGNOSIS_SCHEDULE_CADENCES)[number];

export const DIAGNOSIS_ALL_SCOPE = "all" as const;
export const DIAGNOSIS_ALL_TARGET_CAP = 8;
export const DIAGNOSIS_BASELINE_WINDOW_MULTIPLIER = 4;

const WINDOW_MS: Record<DiagnosisObservationWindowId, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export type DiagnosisDeliverTo = {
  enterpriseAdmin: boolean;
  owners: boolean;
};

export type DiagnosisLocator = {
  agentId: string;
  sessionKey: string;
  runId?: string | null;
};

export type DiagnosisDeliveryReason =
  | "not_requested"
  | "daibai_delivery_gate_closed"
  | "conversation_accepted"
  | "conversation_unavailable"
  | "tick_suppressed";

export type DiagnosisDeliveryPlan = {
  requested: DiagnosisDeliverTo;
  delivered: boolean;
  reason: DiagnosisDeliveryReason;
  routes: Array<"enterprise" | "employee">;
  sessions: string[];
};

export type ParsedDiagnoseRequest = {
  scope: "target" | "all";
  windowId: DiagnosisObservationWindowId;
  windowMs: number;
  baselineMs: number;
  mode: DiagnosisEnterpriseMode;
  cadence: DiagnosisScheduleCadence;
  deliverTo: DiagnosisDeliverTo;
  locators: DiagnosisLocator[];
  requestedCount: number;
  skipped: number;
};

export function observationWindowMs(id: DiagnosisObservationWindowId): number {
  return WINDOW_MS[id];
}

export function baselineWindowMs(id: DiagnosisObservationWindowId): number {
  return WINDOW_MS[id] * DIAGNOSIS_BASELINE_WINDOW_MULTIPLIER;
}

export function budgetForEnterpriseMode(mode: DiagnosisEnterpriseMode): DiagnosticBudget {
  if (mode === "FULL") {
    return { timeoutMs: 20_000, maxDiagnosers: 6, modelCalls: 0 };
  }
  return { timeoutMs: 8_000, maxDiagnosers: 4, modelCalls: 0 };
}

export function asEnterpriseDiagnoseMode(mode: DiagnosisEnterpriseMode): DiagnosticRunMode {
  return mode;
}

function optionalString(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean {
  return params[key] === true;
}

function parseWindowId(raw: string | null): DiagnosisObservationWindowId {
  return raw === "7d" ? "7d" : "24h";
}

function parseMode(raw: string | null): DiagnosisEnterpriseMode {
  return raw === "FULL" ? "FULL" : "TARGETED";
}

function parseCadence(raw: string | null): DiagnosisScheduleCadence {
  if (raw === "daily" || raw === "tick") {
    return raw;
  }
  return "off";
}

export function extractDiagnoseSpaceGroupId(sessionKey: string): string | null {
  const match = sessionKey.trim().match(/:space:([^:]+)$/);
  const groupId = match?.[1]?.trim();
  return groupId || null;
}

export function defaultDiagnoseSessionKey(agentId: string): string {
  return `agent:${agentId.trim()}:main`;
}

export function groupDiagnoseLocator(input: {
  groupId: string;
  coordinatorAgentId?: string | null;
  runId?: string | null;
}): DiagnosisLocator | null {
  const groupId = input.groupId.trim();
  if (!groupId) {
    return null;
  }
  const agentId = input.coordinatorAgentId?.trim() || "main";
  return {
    agentId,
    sessionKey: `agent:${agentId}:space:${groupId}`,
    runId: input.runId,
  };
}

function pushLocator(locators: DiagnosisLocator[], locator: DiagnosisLocator): void {
  if (locators.some((row) => row.sessionKey === locator.sessionKey)) {
    return;
  }
  locators.push(locator);
}

function locatorFromRecord(row: Record<string, unknown>): DiagnosisLocator | null {
  const groupId = optionalString(row, "groupId");
  const agentId = optionalString(row, "agentId");
  const sessionKey = optionalString(row, "sessionKey");
  const runId = optionalString(row, "runId");
  if (groupId) {
    return groupDiagnoseLocator({
      groupId,
      coordinatorAgentId: agentId,
      runId,
    });
  }
  if (agentId) {
    return {
      agentId,
      sessionKey: sessionKey || defaultDiagnoseSessionKey(agentId),
      runId,
    };
  }
  if (sessionKey) {
    const fromKey = sessionKey.match(/^agent:([^:]+):/);
    const inferred = fromKey?.[1]?.trim();
    if (!inferred) {
      return null;
    }
    return { agentId: inferred, sessionKey, runId };
  }
  return null;
}

function parseLocators(params: Record<string, unknown>): DiagnosisLocator[] {
  const locators: DiagnosisLocator[] = [];
  const nested = params.targets;
  if (Array.isArray(nested)) {
    for (const row of nested) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const locator = locatorFromRecord(row as Record<string, unknown>);
      if (locator) {
        pushLocator(locators, locator);
      }
    }
  }
  const locator = locatorFromRecord(params);
  if (locator) {
    pushLocator(locators, locator);
  }
  return locators;
}

function parseDeliverTo(params: Record<string, unknown>): DiagnosisDeliverTo {
  const nested =
    params.deliverTo && typeof params.deliverTo === "object"
      ? (params.deliverTo as Record<string, unknown>)
      : params;
  return {
    enterpriseAdmin: optionalBoolean(nested, "enterpriseAdmin"),
    owners: optionalBoolean(nested, "owners"),
  };
}

export function parseDiagnoseRequest(params: unknown): ParsedDiagnoseRequest {
  const record = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
  const scope = optionalString(record, "scope") === DIAGNOSIS_ALL_SCOPE ? "all" : "target";
  const windowId = parseWindowId(optionalString(record, "window"));
  const mode = parseMode(optionalString(record, "mode"));
  const cadence = parseCadence(optionalString(record, "cadence"));
  const allLocators = parseLocators(record);
  const locators = allLocators.slice(0, DIAGNOSIS_ALL_TARGET_CAP);
  return {
    scope,
    windowId,
    windowMs: observationWindowMs(windowId),
    baselineMs: baselineWindowMs(windowId),
    mode,
    cadence,
    deliverTo: parseDeliverTo(record),
    locators,
    requestedCount: allLocators.length,
    skipped: Math.max(0, allLocators.length - locators.length),
  };
}

export function planDiagnosisDaibaiDelivery(deliverTo: DiagnosisDeliverTo): DiagnosisDeliveryPlan {
  const routes: Array<"enterprise" | "employee"> = [];
  if (deliverTo.enterpriseAdmin) {
    routes.push("enterprise");
  }
  if (deliverTo.owners) {
    routes.push("employee");
  }
  if (routes.length === 0) {
    return {
      requested: deliverTo,
      delivered: false,
      reason: "not_requested",
      routes,
      sessions: [],
    };
  }
  return {
    requested: deliverTo,
    delivered: false,
    reason: "daibai_delivery_gate_closed",
    routes,
    sessions: [],
  };
}
