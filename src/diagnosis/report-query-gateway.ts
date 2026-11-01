import fs from "node:fs";
import path from "node:path";
/**
 * Phase 3.6 — gateway method-pack wiring for diagnosis report query/get.
 * Trusted tenant comes from server membership/auth only.
 * Live handlers read composite projection snapshots from CONFIG_DIR.
 * Grant inspection is injected; this file must not import evolution-control.
 */
import type { OpenBotConfig } from "../config/config.js";
import { ErrorCodes, errorShape } from "../gateway/protocol/index.js";
import type { GatewayClient, GatewayRequestHandlers } from "../gateway/server-methods/types.js";
import { resolveStewardChatCaller } from "../gateway/steward-call-authorization.js";
import { resolveAuthoritativeMembership } from "../gateway/tenant-context.js";
import { normalizeTaskOutcomeSubjectRef } from "../task-outcome/subject-ref.js";
import { CONFIG_DIR } from "../utils.js";
import {
  DIAGNOSIS_ACTION_DISPATCH_METHOD,
  dispatchDiagnoseConversationAction,
} from "./diagnose-action-dispatch.js";
import {
  createDiagnoseConversationInject,
  createOwnershipConversationOwnerResolver,
} from "./diagnose-daibai-inbox-live.js";
import type {
  DiagnoseConversationOwnerResolver,
  DiagnoseConversationSend,
} from "./diagnose-daibai-inbox.js";
import { createDiagnoseGroupExpandDeps } from "./diagnose-group-expand-deps.js";
import {
  isDiagnosisTenantAdmin,
  loadGovernedDiagnoseGrowthReads,
} from "./diagnose-growth-locator.js";
import {
  executeParsedDiagnoseRequest,
  loadStructuralPreviewConfig,
} from "./diagnose-live-request.js";
import { parseDiagnoseRequest } from "./diagnose-policy.js";
import { DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED } from "./diagnose-professional-protocol.js";
import { applyDiagnosisSchedule } from "./diagnose-schedule.js";
import {
  confirmDiagnoseEvolutionPrescription,
  type PrescriptionGrantInspector,
} from "./diagnose-self-evolution.js";
import { resolveDiagnosisJobTenant } from "./diagnosis-job-model.js";
import {
  applyDiagnosisMonitorTask,
  diagnosisMonitorFiltersFromParams,
  isDiagnosisPlatformOperator,
} from "./diagnosis-job.js";
import {
  DIAGNOSIS_DIAGNOSE_METHOD,
  DIAGNOSIS_REPORT_API_METHODS,
  DIAGNOSIS_SCHEDULE_APPLY_METHOD,
  DIAGNOSIS_SELF_EVOLUTION_CONFIRM_METHOD,
  bindDiagnosisReportApiHandlers,
} from "./report-query-api.js";
import {
  createMemoryAuditAppendBackend,
  resolveProductionAdapterDeps,
} from "./report-query-production-adapters.js";
import { evaluateDiagnosisProductionAuth } from "./report-query-production-integration.js";
import {
  createInMemoryProductionQueryAuditSink,
  createInMemoryProductionQueryQuota,
  type ProductionAuthContext,
  type ProductionQueryAdapterDeps,
  type ProductionQueryAuditRecord,
} from "./report-query-production.js";
import {
  createFileProjectionAuthoritySource,
  resolveDiagnosisProjectionsDir,
} from "./report-query-projection-snapshot.js";
import { createInMemoryCompositeReportReader } from "./report-query.js";

const LIVE_READER_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type DiagnosisGatewayMembership = {
  tenantId: string | null;
  userId: string | null;
};

export type DiagnosisGatewayAuthClient = {
  user?: string;
  platformUserId?: string;
  sessionDomain?: "platform" | "enterprise" | "employee";
  sessionKind?: string;
  sessionTenantId?: string;
  connect?: { tenantId?: string | null };
};

export type DiagnosisGatewayAuthDeps = {
  resolveMembership?: (
    client: DiagnosisGatewayAuthClient | null,
  ) => Promise<DiagnosisGatewayMembership>;
};

export function createDefaultDiagnosisReportApiDeps(): ProductionQueryAdapterDeps {
  return {
    reader: createInMemoryCompositeReportReader([]),
    audit: createInMemoryProductionQueryAuditSink(),
    quota: createInMemoryProductionQueryQuota(),
  };
}

export async function resolveDiagnosisProductionAuth(
  client: DiagnosisGatewayAuthClient | null,
  deps: DiagnosisGatewayAuthDeps = {},
): Promise<ProductionAuthContext | null> {
  if (!client) {
    return evaluateDiagnosisProductionAuth({
      client: null,
      membership: { tenantId: null, userId: null },
    });
  }
  try {
    const membership = await (deps.resolveMembership ?? defaultResolveMembership)(client);
    return evaluateDiagnosisProductionAuth({ client, membership });
  } catch {
    return evaluateDiagnosisProductionAuth({ client, membership: "unavailable" });
  }
}

function createFileAuditAppendBackend(auditDir: string) {
  const auditFile = path.join(auditDir, "audit.jsonl");
  return {
    async append(record: ProductionQueryAuditRecord) {
      try {
        if (!fs.existsSync(auditDir)) {
          return "unavailable" as const;
        }
        fs.mkdirSync(auditDir, { recursive: true });
        fs.appendFileSync(auditFile, `${JSON.stringify(record)}\n`, "utf8");
        return "appended" as const;
      } catch {
        return "unavailable" as const;
      }
    },
  };
}

export function createLiveDiagnosisReportApiDeps(
  options: { projectionsDir?: string; auditDir?: string; now?: () => number } = {},
): ProductionQueryAdapterDeps {
  const projectionsDir = options.projectionsDir ?? resolveDiagnosisProjectionsDir();
  const auditDir = options.auditDir ?? path.join(CONFIG_DIR, "diagnosis-audit");
  const auditBackend = createFileAuditAppendBackend(auditDir);
  const memoryAudit = createMemoryAuditAppendBackend();
  return resolveProductionAdapterDeps({
    enabled: true,
    backends: {
      reportSource: createFileProjectionAuthoritySource(projectionsDir),
      auditAppend: {
        async append(record) {
          const persisted = await auditBackend.append(record);
          if (persisted === "appended") {
            return persisted;
          }
          return memoryAudit.append(record);
        },
      },
    },
    readerPolicy: {
      maxAgeMs: LIVE_READER_MAX_AGE_MS,
      ...(options.now ? { now: options.now } : {}),
    },
    ...(options.now ? { now: options.now } : {}),
  });
}

export type DiagnosisDiagnoseHandlerOptions = {
  conversationSend?: DiagnoseConversationSend;
  resolveOwners?: DiagnoseConversationOwnerResolver;
  configDir?: string;
  inspectGrant?: PrescriptionGrantInspector;
  confirmEnabled?: boolean;
  /** Test seam. Production omits this and uses the loaded agent config. */
  taskOutcomeCfg?: OpenBotConfig;
};

export function createLiveDiagnosisReportGatewayHandlers(
  authDeps: DiagnosisGatewayAuthDeps = {},
  deps: ProductionQueryAdapterDeps = createLiveDiagnosisReportApiDeps(),
  options: DiagnosisDiagnoseHandlerOptions = {},
): GatewayRequestHandlers {
  return createDiagnosisReportGatewayHandlers(deps, authDeps, {
    conversationSend: options.conversationSend ?? createDiagnoseConversationInject(),
    resolveOwners: options.resolveOwners ?? createOwnershipConversationOwnerResolver(),
    ...(options.configDir ? { configDir: options.configDir } : {}),
    ...(options.inspectGrant ? { inspectGrant: options.inspectGrant } : {}),
    ...(options.confirmEnabled !== undefined ? { confirmEnabled: options.confirmEnabled } : {}),
    ...(options.taskOutcomeCfg ? { taskOutcomeCfg: options.taskOutcomeCfg } : {}),
  });
}

export function createDiagnosisReportGatewayHandlers(
  deps: ProductionQueryAdapterDeps = createDefaultDiagnosisReportApiDeps(),
  authDeps: DiagnosisGatewayAuthDeps = {},
  options: DiagnosisDiagnoseHandlerOptions = {},
): GatewayRequestHandlers {
  const bound = bindDiagnosisReportApiHandlers(deps, ({ client }) =>
    resolveDiagnosisProductionAuth(asAuthClient(client), authDeps),
  );
  return {
    [DIAGNOSIS_REPORT_API_METHODS[0]]: async ({ params, client, respond }) => {
      await bound["diagnosis.reports.query"]({ params, client, respond });
    },
    [DIAGNOSIS_REPORT_API_METHODS[1]]: async ({ params, client, respond }) => {
      await bound["diagnosis.reports.get"]({ params, client, respond });
    },
    [DIAGNOSIS_DIAGNOSE_METHOD]: async ({ params, client, respond, context }) => {
      const auth = await resolveDiagnosisProductionAuth(asAuthClient(client), authDeps);
      if (!auth) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      try {
        const request = parseDiagnoseRequest(params);
        let scopedJobs: Array<{
          id: string;
          name: string;
          agentId?: string;
          tenantId?: string;
          ownerId?: string;
        }> = [];
        try {
          const jobs = context?.cron ? await context.cron.list({ includeDisabled: true }) : [];
          scopedJobs = jobs.map((job) => ({
            id: job.id,
            name: job.name,
            agentId: job.agentId,
            tenantId: job.ownership?.tenantId,
            ownerId: job.ownership?.ownerId,
          }));
        } catch {
          scopedJobs = [];
        }
        const authClient = asAuthClient(client);
        const growthReads = await loadGovernedDiagnoseGrowthReads({
          tenantId: auth.trusted.tenantId,
          actorUserId: auth.principal.principalId,
          locators: request.locators,
          scopedJobs,
          tenantAdmin: isDiagnosisTenantAdmin({
            sessionDomain: authClient?.sessionDomain,
            sessionKind: authClient?.sessionKind,
          }),
        });
        const expandDeps = await createDiagnoseGroupExpandDeps();
        const structuralPreview = loadStructuralPreviewConfig();
        const callerRaw = authClient?.platformUserId?.trim() || auth.principal.principalId;
        const payload = await executeParsedDiagnoseRequest({
          request,
          trusted: auth.trusted,
          requestedBy: auth.principal,
          skillConfigDir: CONFIG_DIR,
          growthReads,
          structuralPreview,
          taskOutcomeCfg: options.taskOutcomeCfg ?? structuralPreview?.cfg,
          callerSubjectRaw: normalizeTaskOutcomeSubjectRef(callerRaw),
          callerTenantId: auth.trusted.tenantId,
          registry: expandDeps.registry,
          loadGroupMembers: expandDeps.loadGroupMembers,
          sessionKeyExists: expandDeps.sessionKeyExists,
          conversationSend: options.conversationSend,
          resolveOwners: options.resolveOwners,
          // Tip-smoke / gray: interactive diagnose follows CONFIRM gate.
          // Tick keeps allowSelfEvolutionConfirm: false (diagnose-tick.ts).
          allowSelfEvolutionConfirm: DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED,
        });
        respond(true, payload);
      } catch {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "diagnose failed"));
      }
    },
    [DIAGNOSIS_ACTION_DISPATCH_METHOD]: async ({ params, client, respond }) => {
      const auth = await resolveDiagnosisProductionAuth(asAuthClient(client), authDeps);
      if (!auth) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const record = params && typeof params === "object" ? params : {};
      const authClient = asAuthClient(client);
      const result = await dispatchDiagnoseConversationAction({
        title: typeof record.title === "string" ? record.title : "",
        agentPrompt: typeof record.agentPrompt === "string" ? record.agentPrompt : "",
        targetAgentId: typeof record.targetAgentId === "string" ? record.targetAgentId : "",
        targetSessionKey:
          typeof record.targetSessionKey === "string" ? record.targetSessionKey : "",
        requesterUserId: auth.principal.principalId,
        tenantId: auth.trusted.tenantId,
        tenantAdmin: isDiagnosisTenantAdmin({
          sessionDomain: authClient?.sessionDomain,
          sessionKind: authClient?.sessionKind,
        }),
        stewardCaller: await resolveDiagnosisStewardCaller(authClient, auth.trusted.tenantId),
      });
      if (!result.ok) {
        respond(false, result, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
        return;
      }
      respond(true, result);
    },
    [DIAGNOSIS_SCHEDULE_APPLY_METHOD]: async ({ params, client, respond }) => {
      const authClient = asAuthClient(client);
      const auth = await resolveDiagnosisProductionAuth(authClient, authDeps);
      if (!auth) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const record = params && typeof params === "object" ? params : {};
      const caller = {
        membershipTenantId: auth.trusted.tenantId,
        claimedTenantId: typeof record.tenantId === "string" ? record.tenantId : null,
        platformOperator: isDiagnosisPlatformOperator({
          sessionDomain: authClient?.sessionDomain,
          sessionKind: authClient?.sessionKind,
        }),
      };
      const access = resolveDiagnosisJobTenant(caller);
      if (!access.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, access.reason));
        return;
      }
      try {
        const schedule = applyDiagnosisSchedule({
          tenantId: access.tenantId,
          request: parseDiagnoseRequest(params),
          ...(options.configDir ? { configDir: options.configDir } : {}),
        });
        const saved = applyDiagnosisMonitorTask({
          caller,
          filters: diagnosisMonitorFiltersFromParams(record),
          ...(options.configDir ? { configDir: options.configDir } : {}),
        });
        if (!saved.ok) {
          respond(false, saved, errorShape(ErrorCodes.INVALID_REQUEST, saved.reason));
          return;
        }
        respond(true, { schedule, definition: saved.definition, binding: saved.binding });
      } catch {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "schedule apply failed"));
      }
    },
    [DIAGNOSIS_SELF_EVOLUTION_CONFIRM_METHOD]: async ({ params, client, respond, context }) => {
      const auth = await resolveDiagnosisProductionAuth(asAuthClient(client), authDeps);
      if (!auth?.trusted.tenantId) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const record = params && typeof params === "object" ? params : {};
      const enabled = options.confirmEnabled ?? DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED;
      if (!enabled) {
        respond(true, { ok: false, reason: "confirm_not_enabled" });
        return;
      }
      const prescriptionId = typeof record.prescriptionId === "string" ? record.prescriptionId : "";
      const professionalReportId =
        typeof record.professionalReportId === "string" ? record.professionalReportId : "";
      const prescriptionContentHash =
        typeof record.prescriptionContentHash === "string" ? record.prescriptionContentHash : "";
      const result = await confirmDiagnoseEvolutionPrescription({
        prescriptionId,
        tenantId: auth.trusted.tenantId,
        professionalReportId,
        callerUserId: auth.principal.principalId,
        ...(prescriptionContentHash ? { prescriptionContentHash } : {}),
        configDir: options.configDir ?? CONFIG_DIR,
        ...(options.inspectGrant ? { inspectGrant: options.inspectGrant } : {}),
        ...(options.confirmEnabled !== undefined ? { enabled: options.confirmEnabled } : {}),
        cron: {
          add: (job) => context.cron.add(job),
          list: async () => {
            const jobs = await context.cron.list({ includeDisabled: true });
            return jobs.map((job) => ({
              id: job.id,
              name: job.name,
              agentId: job.agentId,
              tenantId: job.ownership?.tenantId,
              ownerId: job.ownership?.ownerId,
            }));
          },
        },
      });
      respond(true, result);
    },
  };
}

async function resolveDiagnosisStewardCaller(
  client: DiagnosisGatewayAuthClient | null,
  tenantId: string | null,
) {
  const caller = await resolveStewardChatCaller(client, { tenantId });
  return {
    rank: caller?.rank ?? "member",
    tenantId,
  };
}

async function defaultResolveMembership(
  client: DiagnosisGatewayAuthClient | null,
): Promise<DiagnosisGatewayMembership> {
  return resolveAuthoritativeMembership(client as GatewayClient | null);
}

function asAuthClient(client: unknown): DiagnosisGatewayAuthClient | null {
  if (!client || typeof client !== "object") {
    return null;
  }
  return client as DiagnosisGatewayAuthClient;
}
