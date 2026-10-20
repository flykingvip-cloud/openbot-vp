/**
 * Phase 5 — Da Bai diagnosis delivery contract.
 * Routes, redacts, and queues DiagnosticSignals. Does not call live Da Bai,
 * write the message transcript, or register gateway packs.
 */
import { PRODUCTION_QUERY_ADMIN_CAPABILITY } from "./report-query-production.js";
import { FORBIDDEN_REPORT_PAYLOAD_KEYS } from "./report-validate.js";
import { isSignalExpired, type DiagnosticSignal } from "./signal.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_DAIBAI_DELIVERY_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_DAIBAI_ROUTES = ["platform", "enterprise", "employee"] as const;
export type DiagnosisDaibaiRoute = (typeof DIAGNOSIS_DAIBAI_ROUTES)[number];

export const DIAGNOSIS_DAIBAI_ROUTE_REJECTIONS = ["unauthorized", "no_recipient"] as const;
export type DiagnosisDaibaiRouteRejection = (typeof DIAGNOSIS_DAIBAI_ROUTE_REJECTIONS)[number];
export type DiagnosisDaibaiRouteDecision = DiagnosisDaibaiRoute | DiagnosisDaibaiRouteRejection;

export function isDiagnosisDaibaiRoute(value: string): value is DiagnosisDaibaiRoute {
  return (DIAGNOSIS_DAIBAI_ROUTES as readonly string[]).includes(value);
}

export const DIAGNOSIS_DAIBAI_RECEIPT_STATUSES = [
  "accepted",
  "queued",
  "retried",
  "expired",
  "rejected",
] as const;
export type DiagnosisDaibaiReceiptStatus = (typeof DIAGNOSIS_DAIBAI_RECEIPT_STATUSES)[number];

export const DIAGNOSIS_DAIBAI_DELIVERY_MAX_RETRIES = 3;
export const DIAGNOSIS_DAIBAI_DELIVERY_TTL_MS = 60 * 60 * 1000;

export type DiagnosisDaibaiDeliveryAuth = {
  sessionDomain?: "platform" | "enterprise" | "employee";
  sessionKind?: string;
  capabilities?: readonly string[];
  principalId?: string;
  delegationGrantId?: string;
};

export type DiagnosisDaibaiDelegationGuard = {
  assertDeliverable(input: {
    signal: DiagnosticSignal;
    auth?: DiagnosisDaibaiDeliveryAuth;
    route: DiagnosisDaibaiRoute;
  }): { ok: true } | { ok: false; reason: string };
};

export type DiagnosisDaibaiDeliveryProjection = {
  schemaVersion: 1;
  signalId: string;
  kind: DiagnosticSignal["kind"];
  tenantId: string | null;
  route: DiagnosisDaibaiRoute;
  reasonCode: string;
  completion: DiagnosticSignal["completion"];
  findingCount: number;
  evidenceCount: number;
  observedAt: string;
  expiresAt: string;
  caseId?: string;
  targetType?: string;
  targetId?: string;
  findingIds?: string[];
  evidenceIds?: string[];
};

export type DiagnosisDaibaiReceipt = {
  deliveryId: string;
  signalId: string;
  route: DiagnosisDaibaiRouteDecision;
  status: DiagnosisDaibaiReceiptStatus;
  attempt: number;
  queuedAt: string;
  expiresAt: string;
  deliveredAt?: string;
  reason?: string;
};

export type DiagnosisDaibaiTransport = {
  deliver(projection: DiagnosisDaibaiDeliveryProjection): Promise<"accepted" | "unavailable">;
};

export function computeDiagnosisDaibaiDeliveryId(
  signalId: string,
  route: DiagnosisDaibaiRouteDecision,
): string {
  return `dlv:${signalId}:${route}`;
}

function isPlatformAuth(auth?: DiagnosisDaibaiDeliveryAuth): boolean {
  return (
    auth?.sessionDomain === "platform" ||
    auth?.sessionKind === "platform-admin" ||
    auth?.sessionKind === "platform-super-admin"
  );
}

function isEnterpriseAuth(auth?: DiagnosisDaibaiDeliveryAuth): boolean {
  return (
    auth?.sessionDomain === "enterprise" ||
    Boolean(auth?.capabilities?.includes(PRODUCTION_QUERY_ADMIN_CAPABILITY))
  );
}

function isEmployeeAuth(auth?: DiagnosisDaibaiDeliveryAuth): boolean {
  return auth?.sessionDomain === "employee";
}

function hasPresentedAuth(auth?: DiagnosisDaibaiDeliveryAuth): boolean {
  return Boolean(
    auth &&
    (auth.sessionDomain ||
      auth.sessionKind ||
      auth.principalId ||
      (auth.capabilities && auth.capabilities.length > 0)),
  );
}

export function routeDiagnosisDaibaiDelivery(
  signal: DiagnosticSignal,
  auth?: DiagnosisDaibaiDeliveryAuth,
): DiagnosisDaibaiRouteDecision {
  if (isPlatformAuth(auth)) {
    return "platform";
  }
  // System tenant is the only implicit platform audience. Gateway/host
  // targets with a tenant still require explicit platform auth.
  if (signal.tenantId === null) {
    return "platform";
  }
  if (isEnterpriseAuth(auth)) {
    return "enterprise";
  }
  if (isEmployeeAuth(auth)) {
    return "employee";
  }
  return hasPresentedAuth(auth) ? "unauthorized" : "no_recipient";
}

export function redactDiagnosisDaibaiDelivery(
  signal: DiagnosticSignal,
  route: DiagnosisDaibaiRoute,
): DiagnosisDaibaiDeliveryProjection {
  const projection: DiagnosisDaibaiDeliveryProjection = {
    schemaVersion: DIAGNOSIS_DAIBAI_DELIVERY_SCHEMA_VERSION,
    signalId: signal.signalId,
    kind: signal.kind,
    tenantId: signal.tenantId,
    route,
    reasonCode: signal.reasonCode,
    completion: signal.completion,
    findingCount: signal.findingIds.length,
    evidenceCount: signal.evidenceIds.length,
    observedAt: signal.observedAt,
    expiresAt: signal.expiresAt,
    targetType: signal.target.targetType,
  };
  if (route !== "employee") {
    if (signal.caseId) {
      projection.caseId = signal.caseId;
    }
    projection.targetId = signal.target.targetId;
  }
  if (route === "platform") {
    projection.findingIds = [...signal.findingIds];
    projection.evidenceIds = [...signal.evidenceIds];
  }
  assertDeliveryProjectionSafe(projection);
  return projection;
}

export function assertDeliveryProjectionSafe(projection: DiagnosisDaibaiDeliveryProjection): void {
  const record = projection as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if ((FORBIDDEN_REPORT_PAYLOAD_KEYS as readonly string[]).includes(key)) {
      throw new DiagnosisContractError(
        "delivery_payload_forbidden",
        `Da Bai delivery must not include ${key}`,
        key,
      );
    }
  }
  if ("sessionKeyHash" in record || "authority" in record || "scope" in record) {
    throw new DiagnosisContractError(
      "delivery_redaction_required",
      "Da Bai delivery must not include session scope or authority",
      "target",
    );
  }
}

export function createUnavailableDaibaiTransport(): DiagnosisDaibaiTransport {
  return {
    async deliver() {
      return "unavailable";
    },
  };
}

export function createMemoryDaibaiTransport(): DiagnosisDaibaiTransport & {
  projections: DiagnosisDaibaiDeliveryProjection[];
} {
  const projections: DiagnosisDaibaiDeliveryProjection[] = [];
  return {
    projections,
    async deliver(projection) {
      assertDeliveryProjectionSafe(projection);
      projections.push(projection);
      return "accepted";
    },
  };
}

export type DiagnosisDaibaiDeliveryQueue = {
  enqueue(
    signal: DiagnosticSignal,
    auth?: DiagnosisDaibaiDeliveryAuth,
  ): Promise<DiagnosisDaibaiReceipt>;
  flush(): Promise<DiagnosisDaibaiReceipt[]>;
  getReceipt(deliveryId: string): DiagnosisDaibaiReceipt | undefined;
  listPending(tenantId?: string | null): DiagnosisDaibaiReceipt[];
};

export function createDiagnosisDaibaiDeliveryQueue(
  deps: {
    now?: () => number;
    transport?: DiagnosisDaibaiTransport;
    maxRetries?: number;
    ttlMs?: number;
    delegationGuard?: DiagnosisDaibaiDelegationGuard;
  } = {},
): DiagnosisDaibaiDeliveryQueue {
  const now = deps.now ?? Date.now;
  const transport = deps.transport ?? createUnavailableDaibaiTransport();
  const maxRetries = deps.maxRetries ?? DIAGNOSIS_DAIBAI_DELIVERY_MAX_RETRIES;
  const ttlMs = deps.ttlMs ?? DIAGNOSIS_DAIBAI_DELIVERY_TTL_MS;
  const receipts = new Map<string, DiagnosisDaibaiReceipt>();
  const pending = new Map<
    string,
    { signal: DiagnosticSignal; auth?: DiagnosisDaibaiDeliveryAuth; tenantId: string | null }
  >();

  const expireIfNeeded = (
    receipt: DiagnosisDaibaiReceipt,
    nowMs: number,
  ): DiagnosisDaibaiReceipt => {
    if (
      receipt.status !== "accepted" &&
      receipt.status !== "expired" &&
      receipt.status !== "rejected" &&
      Date.parse(receipt.expiresAt) <= nowMs
    ) {
      const expired: DiagnosisDaibaiReceipt = {
        ...receipt,
        status: "expired",
        reason: "delivery_expired",
      };
      receipts.set(receipt.deliveryId, expired);
      pending.delete(receipt.deliveryId);
      return expired;
    }
    return receipt;
  };

  const rejectUnauthorized = (
    signal: DiagnosticSignal,
    decision: DiagnosisDaibaiRouteRejection,
    nowMs: number,
  ): DiagnosisDaibaiReceipt => {
    const deliveryId = computeDiagnosisDaibaiDeliveryId(signal.signalId, decision);
    const existing = receipts.get(deliveryId);
    if (existing?.status === "rejected") {
      pending.delete(deliveryId);
      return existing;
    }
    const rejected: DiagnosisDaibaiReceipt = {
      deliveryId,
      signalId: signal.signalId,
      route: decision,
      status: "rejected",
      attempt: 0,
      queuedAt: existing?.queuedAt ?? toIso(nowMs),
      expiresAt: existing?.expiresAt ?? latestExpiry(signal, nowMs, ttlMs),
      reason: decision === "unauthorized" ? "unauthorized" : "authorization_required",
    };
    receipts.set(deliveryId, rejected);
    pending.delete(deliveryId);
    return rejected;
  };

  const attemptDeliver = async (
    signal: DiagnosticSignal,
    auth: DiagnosisDaibaiDeliveryAuth | undefined,
    previous?: DiagnosisDaibaiReceipt,
  ): Promise<DiagnosisDaibaiReceipt> => {
    const nowMs = now();
    const route = routeDiagnosisDaibaiDelivery(signal, auth);
    if (!isDiagnosisDaibaiRoute(route)) {
      return rejectUnauthorized(signal, route, nowMs);
    }
    if (deps.delegationGuard) {
      const verdict = deps.delegationGuard.assertDeliverable({ signal, auth, route });
      if (!verdict.ok) {
        const deliveryId = computeDiagnosisDaibaiDeliveryId(signal.signalId, route);
        const existing = receipts.get(deliveryId);
        if (existing?.status === "rejected") {
          pending.delete(deliveryId);
          return existing;
        }
        const rejected: DiagnosisDaibaiReceipt = {
          deliveryId,
          signalId: signal.signalId,
          route,
          status: "rejected",
          attempt: 0,
          queuedAt: existing?.queuedAt ?? toIso(nowMs),
          expiresAt: existing?.expiresAt ?? latestExpiry(signal, nowMs, ttlMs),
          reason: verdict.reason,
        };
        receipts.set(deliveryId, rejected);
        pending.delete(deliveryId);
        return rejected;
      }
    }
    const deliveryId = computeDiagnosisDaibaiDeliveryId(signal.signalId, route);
    const queuedAt = previous?.queuedAt ?? toIso(nowMs);
    const expiresAt = previous?.expiresAt ?? latestExpiry(signal, nowMs, ttlMs);
    const attempt = (previous?.attempt ?? 0) + 1;
    if (isSignalExpired(signal, nowMs) || Date.parse(expiresAt) <= nowMs) {
      const expired: DiagnosisDaibaiReceipt = {
        deliveryId,
        signalId: signal.signalId,
        route,
        status: "expired",
        attempt: previous?.attempt ?? 0,
        queuedAt,
        expiresAt,
        reason: "delivery_expired",
      };
      receipts.set(deliveryId, expired);
      pending.delete(deliveryId);
      return expired;
    }
    if (attempt > maxRetries) {
      const rejected: DiagnosisDaibaiReceipt = {
        deliveryId,
        signalId: signal.signalId,
        route,
        status: "rejected",
        attempt: previous?.attempt ?? maxRetries,
        queuedAt,
        expiresAt,
        reason: "retry_exhausted",
      };
      receipts.set(deliveryId, rejected);
      pending.delete(deliveryId);
      return rejected;
    }
    const projection = redactDiagnosisDaibaiDelivery(signal, route);
    let outcome: "accepted" | "unavailable";
    try {
      outcome = await transport.deliver(projection);
    } catch {
      outcome = "unavailable";
    }
    if (outcome === "accepted") {
      const accepted: DiagnosisDaibaiReceipt = {
        deliveryId,
        signalId: signal.signalId,
        route,
        status: "accepted",
        attempt,
        queuedAt,
        expiresAt,
        deliveredAt: toIso(nowMs),
      };
      receipts.set(deliveryId, accepted);
      pending.delete(deliveryId);
      return accepted;
    }
    const queued: DiagnosisDaibaiReceipt = {
      deliveryId,
      signalId: signal.signalId,
      route,
      status: previous ? "retried" : "queued",
      attempt,
      queuedAt,
      expiresAt,
      reason: "daibai_unavailable",
    };
    receipts.set(deliveryId, queued);
    pending.set(deliveryId, { signal, ...(auth ? { auth } : {}), tenantId: signal.tenantId });
    return queued;
  };

  return {
    async enqueue(signal, auth) {
      const route = routeDiagnosisDaibaiDelivery(signal, auth);
      if (!isDiagnosisDaibaiRoute(route)) {
        return rejectUnauthorized(signal, route, now());
      }
      const deliveryId = computeDiagnosisDaibaiDeliveryId(signal.signalId, route);
      const existing = receipts.get(deliveryId);
      if (existing) {
        const current = expireIfNeeded(existing, now());
        if (
          current.status === "rejected" &&
          current.reason === "delegation_required" &&
          auth?.delegationGrantId
        ) {
          receipts.delete(deliveryId);
          return attemptDeliver(signal, auth);
        }
        if (
          current.status === "accepted" ||
          current.status === "expired" ||
          current.status === "rejected"
        ) {
          return current;
        }
        return attemptDeliver(signal, auth, current);
      }
      return attemptDeliver(signal, auth);
    },
    async flush() {
      const flushed: DiagnosisDaibaiReceipt[] = [];
      // Snapshot first: flush mutates `pending` while retrying each held delivery.
      for (const [deliveryId, item] of Array.from(pending.entries())) {
        const previous = receipts.get(deliveryId);
        flushed.push(await attemptDeliver(item.signal, item.auth, previous));
      }
      return flushed;
    },
    getReceipt(deliveryId) {
      const receipt = receipts.get(deliveryId);
      return receipt ? expireIfNeeded(receipt, now()) : undefined;
    },
    listPending(tenantId) {
      const nowMs = now();
      const rows: DiagnosisDaibaiReceipt[] = [];
      for (const [deliveryId, item] of pending.entries()) {
        const receipt = receipts.get(deliveryId);
        if (!receipt) {
          continue;
        }
        const current = expireIfNeeded(receipt, nowMs);
        if (current.status === "queued" || current.status === "retried") {
          if (tenantId === undefined || item.tenantId === tenantId) {
            rows.push(current);
          }
        }
      }
      return rows;
    },
  };
}

function latestExpiry(signal: DiagnosticSignal, nowMs: number, ttlMs: number): string {
  const deliveryExpiry = nowMs + ttlMs;
  const signalExpiry = Date.parse(signal.expiresAt);
  return toIso(Math.min(deliveryExpiry, signalExpiry));
}

function toIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}
