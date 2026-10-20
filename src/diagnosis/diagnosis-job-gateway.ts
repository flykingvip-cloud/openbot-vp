/**
 * Gateway surface for M1 Diagnosis Job.
 * Enterprise tenant comes from membership. A platform session may name the
 * selected tenant; that flag is taken from the session, not from params.
 * A mismatched enterprise claim is rejected.
 */
import { ErrorCodes, errorShape } from "../gateway/protocol/index.js";
import type { GatewayRequestHandlers } from "../gateway/server-methods/types.js";
import { CONFIG_DIR } from "../utils.js";
import {
  cancelDiagnosisJobRun,
  describeDiagnosisJob,
  diagnosisMonitorFiltersFromParams,
  getDiagnosisJobReport,
  isDiagnosisPlatformOperator,
  pauseDiagnosisJob,
  resumeDiagnosisJob,
  startDiagnosisJobRun,
  type DiagnosisJobCaller,
} from "./diagnosis-job.js";
import {
  resolveDiagnosisProductionAuth,
  type DiagnosisGatewayAuthClient,
  type DiagnosisGatewayAuthDeps,
} from "./report-query-gateway.js";

export const DIAGNOSIS_JOB_PAUSE_METHOD = "diagnosis.job.pause" as const;
export const DIAGNOSIS_JOB_RESUME_METHOD = "diagnosis.job.resume" as const;
export const DIAGNOSIS_JOB_RUN_METHOD = "diagnosis.job.run" as const;
export const DIAGNOSIS_JOB_REPORT_GET_METHOD = "diagnosis.job.report.get" as const;
export const DIAGNOSIS_JOB_DESCRIBE_METHOD = "diagnosis.job.describe" as const;
export const DIAGNOSIS_JOB_CANCEL_METHOD = "diagnosis.job.cancel" as const;

export const DIAGNOSIS_JOB_METHODS = [
  DIAGNOSIS_JOB_PAUSE_METHOD,
  DIAGNOSIS_JOB_RESUME_METHOD,
  DIAGNOSIS_JOB_RUN_METHOD,
  DIAGNOSIS_JOB_REPORT_GET_METHOD,
  DIAGNOSIS_JOB_DESCRIBE_METHOD,
  DIAGNOSIS_JOB_CANCEL_METHOD,
] as const;

export function createDiagnosisJobGatewayHandlers(
  authDeps: DiagnosisGatewayAuthDeps = {},
  options: { configDir?: string } = {},
): GatewayRequestHandlers {
  const configDir = options.configDir ?? CONFIG_DIR;
  const callerFor = async (
    client: unknown,
    params: Record<string, unknown>,
  ): Promise<DiagnosisJobCaller | null> => {
    const auth = await resolveDiagnosisProductionAuth(
      client && typeof client === "object" ? client : null,
      authDeps,
    );
    if (!auth) {
      return null;
    }
    const session = asSession(client);
    const platformOperator = isDiagnosisPlatformOperator({
      sessionDomain: session?.sessionDomain,
      sessionKind: session?.sessionKind,
    });
    const membershipTenantId = auth.trusted.tenantId?.trim() ?? "";
    if (!platformOperator && !membershipTenantId) {
      return null;
    }
    return {
      membershipTenantId,
      claimedTenantId: typeof params.tenantId === "string" ? params.tenantId : null,
      platformOperator,
    };
  };

  return {
    [DIAGNOSIS_JOB_PAUSE_METHOD]: async ({ params, client, respond }) => {
      const caller = await callerFor(client, params);
      if (!caller) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const result = pauseDiagnosisJob({ caller, configDir });
      respondJob(respond, result);
    },
    [DIAGNOSIS_JOB_RESUME_METHOD]: async ({ params, client, respond }) => {
      const caller = await callerFor(client, params);
      if (!caller) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const result = resumeDiagnosisJob({ caller, configDir });
      respondJob(respond, result);
    },
    [DIAGNOSIS_JOB_RUN_METHOD]: async ({ params, client, respond }) => {
      const caller = await callerFor(client, params);
      if (!caller) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const result = startDiagnosisJobRun({
        caller,
        configDir,
        filters: diagnosisMonitorFiltersFromParams(params),
        repair: params.repair === true,
        fix: params.fix === true,
      });
      respondJob(respond, result);
    },
    [DIAGNOSIS_JOB_REPORT_GET_METHOD]: async ({ params, client, respond }) => {
      const caller = await callerFor(client, params);
      if (!caller) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const reportId = typeof params.reportId === "string" ? params.reportId : "";
      const result = getDiagnosisJobReport({ caller, reportId, configDir });
      respondJob(respond, result);
    },
    [DIAGNOSIS_JOB_DESCRIBE_METHOD]: async ({ params, client, respond }) => {
      const caller = await callerFor(client, params);
      if (!caller) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const result = describeDiagnosisJob({ caller, configDir });
      respondJob(respond, result);
    },
    [DIAGNOSIS_JOB_CANCEL_METHOD]: async ({ params, client, respond }) => {
      const caller = await callerFor(client, params);
      if (!caller) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const result = cancelDiagnosisJobRun({
        caller,
        runId: typeof params.runId === "string" ? params.runId : null,
      });
      respondJob(respond, result);
    },
  };
}

function asSession(client: unknown): DiagnosisGatewayAuthClient | null {
  if (!client || typeof client !== "object") {
    return null;
  }
  return client as DiagnosisGatewayAuthClient;
}

function respondJob(
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void,
  result: { ok: boolean; reason?: string },
): void {
  if (result.ok) {
    respond(true, result);
    return;
  }
  respond(false, result, errorShape(ErrorCodes.INVALID_REQUEST, result.reason ?? "rejected"));
}
