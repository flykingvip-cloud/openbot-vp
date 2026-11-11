/**
 * Gateway surface for the first diagnosis handling-loop scenario.
 * Execute stays closed unless the caller constructed this pack with
 * isolation: true or OPENBOT_DIAGNOSIS_HANDLING_ISOLATION=1, and never
 * when OPENBOT_PRODUCTION_EXECUTION_MODE=production.
 *
 * Live pack registration must not pass isolation: true.
 */
import { ErrorCodes, errorShape } from "../gateway/protocol/index.js";
import type { GatewayRequestHandlers } from "../gateway/server-methods/types.js";
import { CONFIG_DIR } from "../utils.js";
import { isDiagnosisPlatformOperator, type DiagnosisJobCaller } from "./diagnosis-job.js";
import {
  DIAGNOSIS_HANDLING_APPROVE_METHOD,
  DIAGNOSIS_HANDLING_CANCEL_METHOD,
  DIAGNOSIS_HANDLING_EXECUTE_METHOD,
  DIAGNOSIS_HANDLING_GET_METHOD,
  DIAGNOSIS_HANDLING_LIST_METHOD,
  DIAGNOSIS_HANDLING_METHODS,
  DIAGNOSIS_HANDLING_PREVIEW_METHOD,
  DIAGNOSIS_HANDLING_RECHECK_METHOD,
  DIAGNOSIS_HANDLING_REJECT_METHOD,
  DIAGNOSIS_HANDLING_SUBMIT_METHOD,
} from "./handling-loop-methods.js";
import { createTenantFileHandlingStore } from "./handling-loop-store.js";
import {
  createDiagnosisHandlingLoop,
  type DiagnosisHandlingLoop,
  type HandlingActor,
  type HandlingCommandResult,
} from "./handling-loop.js";
import {
  resolveDiagnosisProductionAuth,
  type DiagnosisGatewayAuthClient,
  type DiagnosisGatewayAuthDeps,
} from "./report-query-gateway.js";

export {
  DIAGNOSIS_HANDLING_APPROVE_METHOD,
  DIAGNOSIS_HANDLING_APPROVAL_METHODS,
  DIAGNOSIS_HANDLING_CANCEL_METHOD,
  DIAGNOSIS_HANDLING_EXECUTE_METHOD,
  DIAGNOSIS_HANDLING_GET_METHOD,
  DIAGNOSIS_HANDLING_LIST_METHOD,
  DIAGNOSIS_HANDLING_METHODS,
  DIAGNOSIS_HANDLING_PREVIEW_METHOD,
  DIAGNOSIS_HANDLING_READ_METHODS,
  DIAGNOSIS_HANDLING_RECHECK_METHOD,
  DIAGNOSIS_HANDLING_REJECT_METHOD,
  DIAGNOSIS_HANDLING_SUBMIT_METHOD,
  DIAGNOSIS_HANDLING_WRITE_METHODS,
} from "./handling-loop-methods.js";

export type DiagnosisHandlingGatewayOptions = {
  configDir?: string;
  isolation?: boolean;
  env?: NodeJS.ProcessEnv;
  loop?: DiagnosisHandlingLoop;
  resolveScopes?: (client: unknown) => readonly string[];
};

function asSession(client: unknown): DiagnosisGatewayAuthClient | null {
  if (!client || typeof client !== "object") {
    return null;
  }
  return client as DiagnosisGatewayAuthClient;
}

function scopesFrom(
  client: unknown,
  resolveScopes?: (client: unknown) => readonly string[],
): readonly string[] {
  if (resolveScopes) {
    return resolveScopes(client);
  }
  if (client && typeof client === "object" && "scopes" in client) {
    const value = (client as { scopes?: unknown }).scopes;
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      return value;
    }
  }
  return [];
}

function actorFrom(
  caller: Extract<DiagnosisJobCaller, { membershipTenantId: string } | object> & {
    membershipTenantId: string;
    claimedTenantId: string | null;
    platformOperator?: boolean;
  },
  client: unknown,
  params: Record<string, unknown>,
  resolveScopes?: (client: unknown) => readonly string[],
): HandlingActor | null {
  const session = asSession(client);
  const operatorId =
    (typeof session?.user === "string" && session.user.trim()) ||
    (typeof session?.platformUserId === "string" && session.platformUserId.trim()) ||
    "unknown-operator";
  const tenantId = caller.platformOperator
    ? (typeof params.tenantId === "string" && params.tenantId.trim()) ||
      caller.claimedTenantId ||
      ""
    : caller.membershipTenantId;
  if (!tenantId) {
    return null;
  }
  return {
    operatorId,
    tenantId,
    claimedTenantId: caller.claimedTenantId,
    platformOperator: caller.platformOperator === true,
    scopes: scopesFrom(client, resolveScopes),
  };
}

function respondHandling(
  respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void,
  result: HandlingCommandResult & { records?: unknown },
): void {
  if (result.ok) {
    respond(true, result);
    return;
  }
  const message = result.reason ?? "rejected";
  const code =
    message === "unauthorized" || message === "authorization_revoked"
      ? ErrorCodes.INVALID_REQUEST
      : ErrorCodes.INVALID_REQUEST;
  respond(false, result, errorShape(code, message));
}

export function createDiagnosisHandlingGatewayHandlers(
  authDeps: DiagnosisGatewayAuthDeps = {},
  options: DiagnosisHandlingGatewayOptions = {},
): GatewayRequestHandlers {
  const configDir = options.configDir ?? CONFIG_DIR;
  const loop =
    options.loop ??
    createDiagnosisHandlingLoop({
      configDir,
      isolation: options.isolation === true,
      env: options.env,
      store: createTenantFileHandlingStore(configDir),
    });

  const callerFor = async (
    client: unknown,
    params: Record<string, unknown>,
  ): Promise<HandlingActor | null> => {
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
    return actorFrom(
      {
        membershipTenantId,
        claimedTenantId: typeof params.tenantId === "string" ? params.tenantId : null,
        platformOperator,
      },
      client,
      params,
      options.resolveScopes,
    );
  };

  const withActor = (
    fn: (actor: HandlingActor, params: Record<string, unknown>) => HandlingCommandResult,
  ) => {
    return async ({
      params,
      client,
      respond,
    }: {
      params: Record<string, unknown>;
      client: unknown;
      respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void;
    }) => {
      const actor = await callerFor(client, params);
      if (!actor) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unauthorized"));
        return;
      }
      respondHandling(respond, fn(actor, params));
    };
  };

  const handlingIdOf = (params: Record<string, unknown>) =>
    typeof params.handlingId === "string" ? params.handlingId : "";

  return {
    [DIAGNOSIS_HANDLING_PREVIEW_METHOD]: withActor((actor) => loop.preview(actor)),
    [DIAGNOSIS_HANDLING_SUBMIT_METHOD]: withActor((actor, params) =>
      loop.submit({
        actor,
        idempotencyKey:
          typeof params.idempotencyKey === "string" ? params.idempotencyKey : undefined,
        reportId: typeof params.reportId === "string" ? params.reportId : null,
      }),
    ),
    [DIAGNOSIS_HANDLING_APPROVE_METHOD]: withActor((actor, params) =>
      loop.approve({ actor, handlingId: handlingIdOf(params) }),
    ),
    [DIAGNOSIS_HANDLING_REJECT_METHOD]: withActor((actor, params) =>
      loop.reject({ actor, handlingId: handlingIdOf(params) }),
    ),
    [DIAGNOSIS_HANDLING_CANCEL_METHOD]: withActor((actor, params) =>
      loop.cancel({ actor, handlingId: handlingIdOf(params) }),
    ),
    [DIAGNOSIS_HANDLING_EXECUTE_METHOD]: withActor((actor, params) =>
      loop.execute({ actor, handlingId: handlingIdOf(params) }),
    ),
    [DIAGNOSIS_HANDLING_RECHECK_METHOD]: withActor((actor, params) =>
      loop.recheck({ actor, handlingId: handlingIdOf(params) }),
    ),
    [DIAGNOSIS_HANDLING_GET_METHOD]: withActor((actor, params) =>
      loop.get({ actor, handlingId: handlingIdOf(params) }),
    ),
    [DIAGNOSIS_HANDLING_LIST_METHOD]: withActor((actor) => loop.list({ actor })),
  };
}
