import type { FeishuEmployeeChannelGate } from "./enterprise-im-employee-connection.js";
import { loadFeishuEmployeeChannelGate } from "./enterprise-im-employee-connection.js";
/**
 * Server-trusted seat and robot/action policy for the Feishu employee proxy.
 *
 * This is not `resolveEmployeeOperationalAuthorization`. That helper allows an
 * enterprise employee who has no seat. Enterprise IM must not reuse that allow.
 * A policy row must name this employee, this seat, this robot, and this action.
 * "A policy exists" is not enough. Rows come from the tenant override
 * `enterpriseImEmployeeProxy.policies`. A missing config stays a deny.
 * Do not add a default allow for a pilot.
 */
import { FEISHU_USER_DOCX_RAW_CONTENT_API } from "./enterprise-im-feishu-doc-reader.js";
import {
  loadEnterpriseSeatAssetsStore,
  type EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";
import { resolveQueryScope } from "./scope-attribution.js";
import type { GatewayClient } from "./server-methods/types.js";
import { getTenantConfigOverride, loadTenantConfigStore } from "./tenant-config.js";
import {
  resolveControlPlaneStorePathForClient,
  resolveUserOperationalIdentitySecretsStorePathForClient,
} from "./tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "./tenant-store-paths.js";
import { loadUserOperationalIdentityCredentialSecretStore } from "./user-operational-identity-secrets-persistence.js";
import type { UserOperationalIdentityCredentialSecretStore } from "./user-operational-identity-types.js";

export const ENTERPRISE_IM_PROXY_ACTIONS = ["read", "draft", "send"] as const;
export type EnterpriseImProxyAction = (typeof ENTERPRISE_IM_PROXY_ACTIONS)[number];

export type EnterpriseImRobotPolicy = {
  policyId: string;
  employeeId: string;
  seatId: string;
  agentId: string;
  actions: EnterpriseImProxyAction[];
  revokedAt?: string;
};

export type EnterpriseImAuthorizationJudgment =
  | {
      ok: false;
      code:
        | "SEAT_MISSING"
        | "SEAT_BINDING_AMBIGUOUS"
        | "ENTERPRISE_POLICY_MISSING"
        | "ENTERPRISE_POLICY_DENIED";
      message: string;
    }
  | {
      ok: true;
      tenantId: string;
      seatId: string;
      policyId: string;
    };

const JUDGMENT_MESSAGE = {
  SEAT_MISSING: "缺少企业席位，不能放行。",
  SEAT_BINDING_AMBIGUOUS: "席位绑定不唯一，不能放行。",
  ENTERPRISE_POLICY_MISSING: "缺少企业策略，不能放行。",
  ENTERPRISE_POLICY_DENIED: "企业策略不允许这个机器人执行这个动作。",
} as const;

function deny(
  code: Exclude<EnterpriseImAuthorizationJudgment, { ok: true }>["code"],
  message?: string,
): EnterpriseImAuthorizationJudgment {
  return { ok: false, code, message: message ?? JUDGMENT_MESSAGE[code] };
}

function isProxyAction(value: string): value is EnterpriseImProxyAction {
  return (ENTERPRISE_IM_PROXY_ACTIONS as readonly string[]).includes(value);
}

export function readEnterpriseImRobotPolicies(override: unknown): EnterpriseImRobotPolicy[] {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return [];
  }
  const root = (override as { enterpriseImEmployeeProxy?: unknown }).enterpriseImEmployeeProxy;
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return [];
  }
  const rows = (root as { policies?: unknown }).policies;
  if (!Array.isArray(rows)) {
    return [];
  }
  const policies: EnterpriseImRobotPolicy[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const record = row as Record<string, unknown>;
    const policyId = typeof record.policyId === "string" ? record.policyId.trim() : "";
    const employeeId = typeof record.employeeId === "string" ? record.employeeId.trim() : "";
    const seatId = typeof record.seatId === "string" ? record.seatId.trim() : "";
    const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
    const actions = Array.isArray(record.actions)
      ? record.actions
          .filter((action): action is string => typeof action === "string")
          .map((action) => action.trim())
          .filter(isProxyAction)
      : [];
    if (!policyId || !employeeId || !seatId || !agentId || actions.length === 0) {
      continue;
    }
    const revokedAt = typeof record.revokedAt === "string" ? record.revokedAt : undefined;
    policies.push({ policyId, employeeId, seatId, agentId, actions, revokedAt });
  }
  return policies;
}

export type EnterpriseImMeasuredChecklist = {
  /** Explicit admin record. App capabilityStatus "granted" is not Measured. */
  projectDocs: boolean;
  projectGroupRead: boolean;
};

function proxyRoot(override: unknown): Record<string, unknown> | null {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return null;
  }
  const root = (override as { enterpriseImEmployeeProxy?: unknown }).enterpriseImEmployeeProxy;
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return null;
  }
  return root as Record<string, unknown>;
}

function isRecordedDocMeasurement(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  if (row.status !== "measured") {
    return false;
  }
  if (row.api !== FEISHU_USER_DOCX_RAW_CONTENT_API) {
    return false;
  }
  if (row.tokenType !== "user_access_token") {
    return false;
  }
  if (typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt))) {
    return false;
  }
  const scopes = Array.isArray(row.scopes) ? row.scopes : [];
  return scopes.includes("docx:document:readonly") || scopes.includes("docx:document");
}

/**
 * A boolean `true` is not a measurement. projectDocs counts only when the
 * tenant stores an observation of the wired user-token docx API. This tree
 * does not ship that observation. Group history stays unmeasured in this slice.
 */
export function readEnterpriseImMeasuredChecklist(
  override: unknown,
): EnterpriseImMeasuredChecklist {
  const measured = proxyRoot(override)?.measured;
  const record =
    measured && typeof measured === "object" && !Array.isArray(measured)
      ? (measured as Record<string, unknown>)
      : {};
  return {
    projectDocs: isRecordedDocMeasurement(record.projectDocs),
    projectGroupRead: false,
  };
}

export async function loadEnterpriseImMeasuredChecklist(
  tenantId: string | null,
): Promise<EnterpriseImMeasuredChecklist> {
  const id = tenantId?.trim() || "";
  if (!id) {
    return { projectDocs: false, projectGroupRead: false };
  }
  try {
    const configStore = await loadTenantConfigStore();
    return readEnterpriseImMeasuredChecklist(getTenantConfigOverride(configStore, id));
  } catch {
    return { projectDocs: false, projectGroupRead: false };
  }
}

type SeatBindingView = {
  tenantId?: string;
  employeeId?: string;
  seatId?: string;
  bindingStatus?: string;
};

/**
 * Pure over the seat store and the tenant policy rows. Callers load both on
 * the server. A `{ policyPresent: true }` flag is not an input.
 */
export function resolveEnterpriseImSeatAndPolicy(params: {
  tenantId: string | null;
  ownerId: string;
  agentId: string;
  action: string;
  seatStore: Pick<EnterpriseSeatAssetsStore, "bindings"> | null;
  policies: EnterpriseImRobotPolicy[];
}): EnterpriseImAuthorizationJudgment {
  const tenantId = params.tenantId?.trim() || "";
  const ownerId = params.ownerId.trim();
  const agentId = params.agentId.trim();
  const action = params.action.trim();
  if (!tenantId || !ownerId || !agentId || !isProxyAction(action)) {
    return deny("SEAT_MISSING");
  }
  const activeSeatIds = [
    ...new Set(
      Object.values(params.seatStore?.bindings ?? {})
        .filter((binding): binding is SeatBindingView => Boolean(binding))
        .filter(
          (binding) =>
            binding.tenantId === tenantId &&
            binding.employeeId === ownerId &&
            binding.bindingStatus === "active" &&
            Boolean(binding.seatId?.trim()),
        )
        .map((binding) => binding.seatId.trim()),
    ),
  ];
  if (activeSeatIds.length === 0) {
    return deny("SEAT_MISSING");
  }
  if (activeSeatIds.length > 1) {
    return deny("SEAT_BINDING_AMBIGUOUS");
  }
  const seatId = activeSeatIds[0];
  if (!seatId) {
    return deny("SEAT_MISSING");
  }
  const matching = params.policies.filter(
    (policy) =>
      !policy.revokedAt &&
      policy.employeeId === ownerId &&
      policy.seatId === seatId &&
      policy.agentId === agentId,
  );
  if (matching.length === 0) {
    return deny("ENTERPRISE_POLICY_MISSING");
  }
  const allowing = matching.filter((policy) => policy.actions.includes(action));
  if (allowing.length !== 1) {
    return deny(
      "ENTERPRISE_POLICY_DENIED",
      allowing.length > 1
        ? "多个企业策略同时允许这个动作，不能按第一条放行。"
        : JUDGMENT_MESSAGE.ENTERPRISE_POLICY_DENIED,
    );
  }
  const allowed = allowing[0];
  if (!allowed) {
    return deny("ENTERPRISE_POLICY_DENIED");
  }
  return { ok: true, tenantId, seatId, policyId: allowed.policyId };
}

export async function loadEnterpriseImSeatAndPolicy(params: {
  client: GatewayClient | null;
  tenantId: string | null;
  ownerId: string;
  agentId: string;
  action: string;
}): Promise<EnterpriseImAuthorizationJudgment> {
  const tenantId = params.tenantId?.trim() || "";
  if (!tenantId) {
    return deny("SEAT_MISSING");
  }
  let seatStore: EnterpriseSeatAssetsStore | null = null;
  try {
    const storePath = await resolveControlPlaneStorePathForClient(
      params.client,
      TENANT_SEAT_ASSETS_FILE,
    );
    seatStore = await loadEnterpriseSeatAssetsStore(storePath);
  } catch {
    seatStore = null;
  }
  let policies: EnterpriseImRobotPolicy[] = [];
  try {
    const configStore = await loadTenantConfigStore();
    policies = readEnterpriseImRobotPolicies(getTenantConfigOverride(configStore, tenantId));
  } catch {
    policies = [];
  }
  return resolveEnterpriseImSeatAndPolicy({
    tenantId,
    ownerId: params.ownerId,
    agentId: params.agentId,
    action: params.action,
    seatStore,
    policies,
  });
}

export async function loadFeishuEmployeeProxyContext(params: {
  client: GatewayClient | null;
  ownerId: string;
  agentId: string;
  action: string;
}): Promise<{
  tenantId: string | null;
  gate: FeishuEmployeeChannelGate;
  secretStore: UserOperationalIdentityCredentialSecretStore;
  authorization: EnterpriseImAuthorizationJudgment;
}> {
  const scope = await resolveQueryScope(params.client);
  const tenantId = scope.kind === "tenant" ? scope.tenantId : null;
  const secretPath = await resolveUserOperationalIdentitySecretsStorePathForClient(params.client);
  const [gate, secretStore, authorization] = await Promise.all([
    loadFeishuEmployeeChannelGate({ tenantId }),
    loadUserOperationalIdentityCredentialSecretStore(secretPath),
    loadEnterpriseImSeatAndPolicy({
      client: params.client,
      tenantId,
      ownerId: params.ownerId,
      agentId: params.agentId,
      action: params.action,
    }),
  ]);
  return { tenantId, gate, secretStore, authorization };
}
