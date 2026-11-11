/**
 * Diagnosis report query/get + governed diagnose() — gateway method pack.
 * Handlers bind P3.5 dispatch only. Live registration is gated by
 * DIAGNOSIS_REPORT_API_DEPLOYED in packs/registry.ts and packs/manifest.ts.
 * Not a production cutover: no build, publish, restart, or traffic switch.
 */

import { prescriptionGrantViewFromAuthorization } from "../../diagnosis/diagnose-evolution-prescription.js";
import { createDiagnoseGroupExpandDeps } from "../../diagnosis/diagnose-group-expand-deps.js";
import {
  DIAGNOSIS_JOB_CANCEL_METHOD,
  DIAGNOSIS_JOB_DESCRIBE_METHOD,
  DIAGNOSIS_JOB_METHODS,
  DIAGNOSIS_JOB_PAUSE_METHOD,
  DIAGNOSIS_JOB_REPORT_GET_METHOD,
  DIAGNOSIS_JOB_RESUME_METHOD,
  DIAGNOSIS_JOB_RUN_METHOD,
  createDiagnosisJobGatewayHandlers,
} from "../../diagnosis/diagnosis-job-gateway.js";
import {
  DIAGNOSIS_HANDLING_METHODS,
  DIAGNOSIS_HANDLING_APPROVAL_METHODS,
  DIAGNOSIS_HANDLING_READ_METHODS,
  DIAGNOSIS_HANDLING_WRITE_METHODS,
  createDiagnosisHandlingGatewayHandlers,
} from "../../diagnosis/handling-loop-gateway.js";
import { createInterventionGatewayHandlers } from "../../diagnosis/intervention-gateway.js";
import {
  DIAGNOSIS_ACTION_DISPATCH_METHOD,
  DIAGNOSIS_DIAGNOSE_METHOD,
  DIAGNOSIS_INTERVENTION_METHODS,
  DIAGNOSIS_INTERVENTION_LIST_METHOD,
  DIAGNOSIS_INTERVENTION_GET_METHOD,
  DIAGNOSIS_INTERVENTION_DISPATCH_METHOD,
  DIAGNOSIS_INTERVENTION_EXPAND_METHOD,
  DIAGNOSIS_INTERVENTION_MATERIALIZE_METHOD,
  DIAGNOSIS_REPORT_API_METHODS,
  DIAGNOSIS_SCHEDULE_APPLY_METHOD,
  DIAGNOSIS_SELF_EVOLUTION_CONFIRM_METHOD,
} from "../../diagnosis/report-query-api.js";
import { createLiveDiagnosisReportGatewayHandlers } from "../../diagnosis/report-query-gateway.js";
import {
  createObservationQueryHandlers,
  OBSERVATION_QUERY_METHOD,
} from "../../observation/query-gateway.js";
import { getSharedDiagnosisDelegationMachine } from "../evolution-control/delegation-service.js";
import {
  attachDiagnosisEvolutionProjection,
  resolveDiagnosisCandidateStatusPorts,
} from "../evolution-control/project-diagnosis-candidate.js";
import { resolveAuthoritativeMembership } from "../tenant-context.js";
import { defineGatewayMethodPack } from "./pack-types.js";
import type { GatewayRequestHandlers } from "./types.js";

function inspectLivePrescriptionGrant(grantId: string) {
  return prescriptionGrantViewFromAuthorization(
    getSharedDiagnosisDelegationMachine().getGrant(grantId),
  );
}

const METHODS = [
  OBSERVATION_QUERY_METHOD,
  ...DIAGNOSIS_REPORT_API_METHODS,
  DIAGNOSIS_DIAGNOSE_METHOD,
  DIAGNOSIS_ACTION_DISPATCH_METHOD,
  ...DIAGNOSIS_INTERVENTION_METHODS,
  DIAGNOSIS_SCHEDULE_APPLY_METHOD,
  DIAGNOSIS_SELF_EVOLUTION_CONFIRM_METHOD,
  ...DIAGNOSIS_JOB_METHODS,
  ...DIAGNOSIS_HANDLING_METHODS,
] as const;

export const diagnosisReportsPack = defineGatewayMethodPack({
  id: "diagnosis-reports",
  methods: METHODS,
  scopes: {
    "operator.read": [
      OBSERVATION_QUERY_METHOD,
      "diagnosis.reports.query",
      "diagnosis.reports.get",
      "diagnosis.diagnose",
      DIAGNOSIS_INTERVENTION_LIST_METHOD,
      DIAGNOSIS_INTERVENTION_GET_METHOD,
      DIAGNOSIS_JOB_REPORT_GET_METHOD,
      DIAGNOSIS_JOB_DESCRIBE_METHOD,
      ...DIAGNOSIS_HANDLING_READ_METHODS,
    ],
    // diagnosis.action.dispatch is a write/action trigger. It stays only in operator.write.
    "operator.write": [
      "diagnosis.schedule.apply",
      "diagnosis.action.dispatch",
      DIAGNOSIS_INTERVENTION_DISPATCH_METHOD,
      DIAGNOSIS_INTERVENTION_EXPAND_METHOD,
      DIAGNOSIS_INTERVENTION_MATERIALIZE_METHOD,
      DIAGNOSIS_JOB_PAUSE_METHOD,
      DIAGNOSIS_JOB_RESUME_METHOD,
      DIAGNOSIS_JOB_RUN_METHOD,
      DIAGNOSIS_JOB_CANCEL_METHOD,
      ...DIAGNOSIS_HANDLING_WRITE_METHODS,
    ],
    "operator.approvals": [
      "diagnosis.self-evolution.confirm",
      ...DIAGNOSIS_HANDLING_APPROVAL_METHODS,
    ],
  },
  handlers: withDiagnosisEvolutionProjection({
    ...createObservationQueryHandlers(),
    ...createLiveDiagnosisReportGatewayHandlers({}, undefined, {
      inspectGrant: inspectLivePrescriptionGrant,
    }),
    ...createInterventionGatewayHandlers({
      resolveExpandInput: async ({ tenantId, groupId }) => {
        const d = await createDiagnoseGroupExpandDeps();
        return {
          tenantId: (tenantId ?? "").trim(),
          groupId,
          registry: d.registry,
          loadMembers: d.loadGroupMembers, // rename: factory uses loadGroupMembers
          sessionKeyExists: d.sessionKeyExists,
        };
      },
    }),
    ...createDiagnosisJobGatewayHandlers(),
    // isolation defaults to false: execute stays closed on the live pack.
    ...createDiagnosisHandlingGatewayHandlers(),
  }),
});

function withDiagnosisEvolutionProjection(
  handlers: GatewayRequestHandlers,
): GatewayRequestHandlers {
  const diagnose = handlers[DIAGNOSIS_DIAGNOSE_METHOD];
  return {
    ...handlers,
    [DIAGNOSIS_DIAGNOSE_METHOD]: async (ctx) => {
      const membership = await resolveAuthoritativeMembership(ctx.client);
      const tenantId = membership.tenantId?.trim() ?? "";
      await diagnose({
        ...ctx,
        respond: (ok, payload, error, meta) => {
          if (!ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
            ctx.respond(ok, payload, error, meta);
            return;
          }
          ctx.respond(
            true,
            attachDiagnosisEvolutionProjection({
              tenantId,
              payload: payload as Record<string, unknown>,
              ports: resolveDiagnosisCandidateStatusPorts(),
            }),
            error,
            meta,
          );
        },
      });
    },
  };
}
