/**
 * Track I / M2 — thin gateway RPC for InterventionCase console.
 * list/get read; dispatch/expand/materialize write. Reuses canDispatchDiagnoseAction auth.
 * Does not require DIAGNOSIS_DAIBAI_DELIVERY_ENABLED.
 */
import { ErrorCodes, errorShape } from "../gateway/protocol/index.js";
import type { GatewayRequestHandlers } from "../gateway/server-methods/types.js";
import type { DataPlaneCase } from "./diagnose-data-plane-cases.js";
import type { ExpandDiagnoseGroupMembersInput } from "./diagnose-group-member-expand.js";
import { isDiagnosisTenantAdmin } from "./diagnose-growth-locator.js";
import type { DiagnoseConversationAction } from "./diagnose-next-actions.js";
import {
  createFileInterventionCaseStore,
  createMemoryInterventionCaseStore,
  resolveInterventionCaseStorePath,
  type InterventionCaseStore,
} from "./intervention-case-store.js";
import type { InterventionCaseId } from "./intervention-case.js";
import { dispatchInterventionCase } from "./intervention-dispatch.js";
import {
  expandGroupInterventionCase,
  materializeInterventionCases,
  materializeInterventionCasesFromDataPlane,
} from "./intervention-from-next-actions.js";
import { resolveDiagnosisProductionAuth } from "./report-query-gateway.js";
import type { ProductionAuthContext } from "./report-query-production.js";

export {
  DIAGNOSIS_INTERVENTION_LIST_METHOD,
  DIAGNOSIS_INTERVENTION_GET_METHOD,
  DIAGNOSIS_INTERVENTION_DISPATCH_METHOD,
  DIAGNOSIS_INTERVENTION_EXPAND_METHOD,
  DIAGNOSIS_INTERVENTION_MATERIALIZE_METHOD,
  DIAGNOSIS_INTERVENTION_METHODS,
} from "./intervention-methods.js";

import {
  DIAGNOSIS_INTERVENTION_LIST_METHOD,
  DIAGNOSIS_INTERVENTION_GET_METHOD,
  DIAGNOSIS_INTERVENTION_DISPATCH_METHOD,
  DIAGNOSIS_INTERVENTION_EXPAND_METHOD,
  DIAGNOSIS_INTERVENTION_MATERIALIZE_METHOD,
} from "./intervention-methods.js";

export type InterventionGatewayOptions = {
  store?: InterventionCaseStore;
  /** Injected Track D expand wiring (registry + loadMembers). */
  resolveExpandInput?: (input: {
    tenantId: string | null;
    groupId: string;
  }) => Promise<ExpandDiagnoseGroupMembersInput | null>;
  resolveAuth?: (client: unknown) => Promise<ProductionAuthContext | null>;
};

type AuthClient = {
  sessionDomain?: string;
  sessionKind?: string;
};

let sharedStore: InterventionCaseStore | null = null;

export function getSharedInterventionCaseStore(): InterventionCaseStore {
  if (!sharedStore) {
    // P1: durable file store under $CONFIG_DIR (restart-safe). Tests may inject memory via setShared…
    try {
      sharedStore = createFileInterventionCaseStore(resolveInterventionCaseStorePath());
    } catch {
      // Fail soft to memory if path unavailable (e.g. read-only sandbox); live GW uses ~/.openbot.
      sharedStore = createMemoryInterventionCaseStore();
    }
  }
  return sharedStore;
}

export function setSharedInterventionCaseStoreForTests(store: InterventionCaseStore | null): void {
  sharedStore = store;
}

export function createInterventionGatewayHandlers(
  options: InterventionGatewayOptions = {},
): GatewayRequestHandlers {
  const store = options.store ?? getSharedInterventionCaseStore();

  const resolveAuth =
    options.resolveAuth ??
    ((client: unknown) => resolveDiagnosisProductionAuth(client as never, {}));

  return {
    [DIAGNOSIS_INTERVENTION_LIST_METHOD]: async ({ params, client, respond }) => {
      const auth = await resolveAuth(client);
      if (!auth) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const record = params && typeof params === "object" ? params : {};
      const tenantId =
        typeof record.tenantId === "string" ? record.tenantId : auth.trusted.tenantId;
      const status = typeof record.status === "string" ? record.status : undefined;
      const rows = store.list({
        tenantId: tenantId ?? null,
        ...(status ? { status: status as never } : {}),
      });
      respond(true, { cases: rows, count: rows.length });
    },

    [DIAGNOSIS_INTERVENTION_GET_METHOD]: async ({ params, client, respond }) => {
      const auth = await resolveAuth(client);
      if (!auth) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const record = params && typeof params === "object" ? params : {};
      const caseId = typeof record.caseId === "string" ? record.caseId : "";
      const row = store.get(caseId as InterventionCaseId);
      if (!row) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "not_found"));
        return;
      }
      respond(true, { case: row });
    },

    [DIAGNOSIS_INTERVENTION_DISPATCH_METHOD]: async ({ params, client, respond }) => {
      const auth = await resolveAuth(client);
      if (!auth) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const record = params && typeof params === "object" ? params : {};
      const caseId = typeof record.caseId === "string" ? record.caseId : "";
      const row = store.get(caseId as InterventionCaseId);
      if (!row) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "not_found"));
        return;
      }
      const authClient = client as AuthClient;
      const result = await dispatchInterventionCase({
        case: row,
        store,
        requesterUserId: auth.principal.principalId,
        tenantId: auth.trusted.tenantId,
        tenantAdmin: isDiagnosisTenantAdmin({
          sessionDomain: authClient?.sessionDomain,
          sessionKind: authClient?.sessionKind,
        }),
        agentPrompt:
          typeof record.agentPrompt === "string" && record.agentPrompt.trim()
            ? record.agentPrompt
            : row.title,
        ...(typeof record.receiptText === "string" ? { receiptText: record.receiptText } : {}),
      });
      if (!result.ok) {
        respond(false, result, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
        return;
      }
      respond(true, result);
    },

    [DIAGNOSIS_INTERVENTION_EXPAND_METHOD]: async ({ params, client, respond }) => {
      const auth = await resolveAuth(client);
      if (!auth) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const record = params && typeof params === "object" ? params : {};
      const caseId = typeof record.caseId === "string" ? record.caseId : "";
      const row = store.get(caseId as InterventionCaseId);
      if (!row) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "not_found"));
        return;
      }
      if (row.target.kind !== "group_parent") {
        respond(
          false,
          { reason: "not_group_parent" },
          errorShape(ErrorCodes.INVALID_REQUEST, "not_group_parent"),
        );
        return;
      }
      const groupId = row.source.growthGroupId?.trim() ?? "";
      const expandInput = options.resolveExpandInput
        ? await options.resolveExpandInput({ tenantId: auth.trusted.tenantId, groupId })
        : null;
      const result = await expandGroupInterventionCase({
        parent:
          row.status === "blocked" || row.status === "suggested"
            ? { ...row, status: "expanding" }
            : row,
        store,
        ...(expandInput ? { expand: expandInput } : {}),
      });
      if (!result.ok) {
        respond(false, result, errorShape(ErrorCodes.INVALID_REQUEST, result.reason));
        return;
      }
      respond(true, result);
    },

    [DIAGNOSIS_INTERVENTION_MATERIALIZE_METHOD]: async ({ params, client, respond }) => {
      const auth = await resolveAuth(client);
      if (!auth) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      const record = params && typeof params === "object" ? params : {};
      const tenantId =
        typeof record.tenantId === "string" && record.tenantId.trim()
          ? record.tenantId.trim()
          : (auth.trusted.tenantId ?? null);
      const growthGroupId =
        typeof record.growthGroupId === "string" && record.growthGroupId.trim()
          ? record.growthGroupId.trim()
          : null;
      const actions = Array.isArray(record.actions)
        ? (record.actions as DiagnoseConversationAction[])
        : [];
      const dataPlaneCases = Array.isArray(record.dataPlaneCases)
        ? (record.dataPlaneCases as DataPlaneCase[])
        : [];
      if (actions.length === 0 && dataPlaneCases.length === 0) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "actions_or_dataPlaneCases_required"),
        );
        return;
      }
      const fromActions = materializeInterventionCases(actions, {
        tenantId,
        growthGroupId,
        store,
      });
      const fromDataPlane = materializeInterventionCasesFromDataPlane(dataPlaneCases, {
        tenantId,
        growthGroupId: growthGroupId ?? undefined,
        store,
      });
      const cases = [...fromActions, ...fromDataPlane];
      respond(true, { cases, count: cases.length });
    },
  };
}
