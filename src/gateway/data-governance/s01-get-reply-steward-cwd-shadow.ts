/**
 * S01 Stage B: no-side-effect steward cwd shadow for get-reply.
 *
 * Default off. When enabled, evaluates Stage A adapters and records a
 * receipt. Never changes the production cwd, return value, path, or
 * authorization. Does not write Catalog, mkdir, migrate, or delete.
 * Missing identity, authorization, or Catalog binding fail-closed only;
 * this module never guesses a managed path.
 */
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import type { PlatformAuthStore } from "../platform-auth/store-types.js";
import type { WorkspaceResourceCatalog } from "../workspace-resolver/catalog.js";
import {
  evaluateS01AuthorizedToolCwd,
  type S01MembershipPort,
  type S01TrustedPrincipal,
} from "./s01-authorized-tool-cwd.js";
import {
  loadS01StageBShadowProductionDeps,
  type S01StageBShadowProductionDeps,
} from "./s01-stage-b-shadow-production-ports.js";
import {
  resolveS01StewardWorkspaceIdentity,
  type S01IdentityErrorCode,
  type S01StewardRegistryPort,
} from "./s01-steward-workspace-identity.js";
import type { CatalogRecord } from "./types.js";

export const S01_STAGE_B_STEWARD_CWD_SHADOW_ENV = [
  "OPENBOT_S01_STAGE_B_STEWARD_CWD_SHADOW",
  "OPENCLAW_S01_STAGE_B_STEWARD_CWD_SHADOW",
] as const;

const log = createSubsystemLogger("s01-stage-b-steward-cwd-shadow");

export type S01StewardCwdShadowReceipt =
  | "not_steward"
  | "fail_closed_missing_identity"
  | "fail_closed_missing_catalog"
  | "fail_closed_missing_authorization"
  | "authorization_denied"
  | "identity_and_authorization_match"
  | "catalog_miss"
  | "tenant_mismatch"
  | "fencing_stale"
  | "identity_denied";

export type S01StewardCwdShadowResult = {
  enabled: true;
  receipt: S01StewardCwdShadowReceipt;
  identityCode?: S01IdentityErrorCode;
  cwdCode?: string;
  helperCwdPresent: boolean;
  shadowLocatorPresent: boolean;
  locatorMatchesHelper: boolean | null;
  productionCwdUnchanged: true;
  usedShadowPathForProduction: false;
};

export type EvaluateS01StewardCwdShadowInput = {
  stewardException: boolean;
  employeeOwnerId?: string | null;
  stewardAgentId: string;
  tenantId?: string | null;
  helperCwd: string;
  catalog?: WorkspaceResourceCatalog | null;
  registry?: S01StewardRegistryPort | null;
  principal?: S01TrustedPrincipal | null;
  memberships?: S01MembershipPort | null;
  attestationSecret?: string;
  expectedFencing?: { contentVersion: string; bindingId: string };
};

function hasText(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isS01StageBStewardCwdShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  for (const key of S01_STAGE_B_STEWARD_CWD_SHADOW_ENV) {
    const raw = env[key];
    if (typeof raw === "string") {
      const normalized = raw.trim().toLowerCase();
      if (normalized === "1" || normalized === "true" || normalized === "yes") {
        return true;
      }
    }
  }
  return false;
}

function receiptForIdentityCode(code: S01IdentityErrorCode): S01StewardCwdShadowReceipt {
  if (code === "ERR_WORKSPACE_NOT_FOUND" || code === "ERR_CATALOG_UNAVAILABLE") {
    return "catalog_miss";
  }
  if (code === "ERR_TENANT_MISMATCH") {
    return "tenant_mismatch";
  }
  if (code === "ERR_WORKSPACE_ARCHIVED") {
    return "fencing_stale";
  }
  return "identity_denied";
}

function baseResult(
  receipt: S01StewardCwdShadowReceipt,
  helperCwd: string,
): S01StewardCwdShadowResult {
  return {
    enabled: true,
    receipt,
    helperCwdPresent: hasText(helperCwd),
    shadowLocatorPresent: false,
    locatorMatchesHelper: null,
    productionCwdUnchanged: true,
    usedShadowPathForProduction: false,
  };
}

/**
 * Pure shadow evaluation. Callers must ignore locator for production cwd.
 */
export function evaluateS01StewardCwdShadow(
  input: EvaluateS01StewardCwdShadowInput,
): S01StewardCwdShadowResult {
  const helperCwd = input.helperCwd;
  if (!input.stewardException || !hasText(input.employeeOwnerId)) {
    return baseResult("not_steward", helperCwd);
  }
  if (!hasText(input.tenantId) || !input.registry) {
    return baseResult("fail_closed_missing_identity", helperCwd);
  }
  if (!input.catalog) {
    return baseResult("fail_closed_missing_catalog", helperCwd);
  }

  const identity = resolveS01StewardWorkspaceIdentity({
    tenantId: input.tenantId,
    employeeOwnerId: input.employeeOwnerId,
    stewardAgentId: input.stewardAgentId,
    registry: input.registry,
    catalog: input.catalog,
    expectedFencing: input.expectedFencing,
  });
  if (!identity.ok) {
    return {
      ...baseResult(receiptForIdentityCode(identity.code), helperCwd),
      identityCode: identity.code,
    };
  }

  if (!input.principal || !input.memberships || !hasText(input.attestationSecret)) {
    return {
      ...baseResult("fail_closed_missing_authorization", helperCwd),
      shadowLocatorPresent: true,
      locatorMatchesHelper: identity.locator === helperCwd,
    };
  }

  const cwd = evaluateS01AuthorizedToolCwd({
    catalog: input.catalog,
    principal: input.principal,
    requestedCwd: identity.locator,
    operation: "list",
    memberships: input.memberships,
    attestationSecret: input.attestationSecret,
    targetIdentity: identity.targetIdentity,
  });
  if (!cwd.ok) {
    return {
      ...baseResult("authorization_denied", helperCwd),
      cwdCode: cwd.code,
      shadowLocatorPresent: true,
      locatorMatchesHelper: identity.locator === helperCwd,
    };
  }

  return {
    enabled: true,
    receipt: "identity_and_authorization_match",
    helperCwdPresent: hasText(helperCwd),
    shadowLocatorPresent: true,
    locatorMatchesHelper: identity.locator === helperCwd,
    productionCwdUnchanged: true,
    usedShadowPathForProduction: false,
  };
}

export function swallowS01StewardCwdShadowRejection(err: unknown): null {
  log.warn?.("s01_stage_b_steward_cwd_shadow_error", {
    error: err instanceof Error ? err.message : "shadow_failed",
  });
  return null;
}

export function scheduleS01StewardCwdShadow(run: () => Promise<unknown>): void {
  void Promise.resolve().then(run).catch(swallowS01StewardCwdShadowRejection);
}

export async function runS01GetReplyStewardCwdShadowFromEntry(params: {
  stewardException: boolean;
  employeeOwnerId?: string | null;
  stewardAgentId: string;
  tenantId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  helperCwd: string;
  env?: NodeJS.ProcessEnv;
  durableWorkspaceRecords?: readonly CatalogRecord[];
  catalogUnavailable?: boolean;
  registryStore?: AgentRegistryStore;
  platformStore?: PlatformAuthStore;
  expectedFencing?: { contentVersion: string; bindingId: string };
  loadProductionDeps?: (input: {
    tenantId?: string | null;
    userId?: string | null;
    sessionId?: string | null;
    env?: NodeJS.ProcessEnv;
    durableWorkspaceRecords?: readonly CatalogRecord[];
    catalogUnavailable?: boolean;
    registryStore?: AgentRegistryStore;
    platformStore?: PlatformAuthStore;
  }) => Promise<S01StageBShadowProductionDeps>;
}): Promise<S01StewardCwdShadowResult | null> {
  if (!isS01StageBStewardCwdShadowEnabled(params.env)) {
    return null;
  }
  const loadDeps = params.loadProductionDeps ?? loadS01StageBShadowProductionDeps;
  const deps = await loadDeps({
    tenantId: params.tenantId,
    userId: params.userId,
    sessionId: params.sessionId,
    env: params.env,
    durableWorkspaceRecords: params.durableWorkspaceRecords,
    catalogUnavailable: params.catalogUnavailable,
    registryStore: params.registryStore,
    platformStore: params.platformStore,
  });
  return runS01StewardCwdShadowIfEnabled({
    stewardException: params.stewardException,
    employeeOwnerId: params.employeeOwnerId,
    stewardAgentId: params.stewardAgentId,
    tenantId: params.tenantId,
    helperCwd: params.helperCwd,
    catalog: deps.catalog,
    registry: deps.registry,
    principal: deps.principal,
    memberships: deps.memberships,
    attestationSecret: deps.attestationSecret,
    expectedFencing: params.expectedFencing,
    env: params.env,
  });
}

export async function runS01StewardCwdShadowIfEnabled(params: {
  stewardException: boolean;
  employeeOwnerId?: string | null;
  stewardAgentId: string;
  tenantId?: string | null;
  helperCwd: string;
  catalog?: WorkspaceResourceCatalog | null;
  registry?: S01StewardRegistryPort | null;
  principal?: S01TrustedPrincipal | null;
  memberships?: S01MembershipPort | null;
  attestationSecret?: string;
  expectedFencing?: { contentVersion: string; bindingId: string };
  env?: NodeJS.ProcessEnv;
}): Promise<S01StewardCwdShadowResult | null> {
  if (!isS01StageBStewardCwdShadowEnabled(params.env)) {
    return null;
  }
  try {
    const result = evaluateS01StewardCwdShadow(params);
    log.info?.("s01_stage_b_steward_cwd_shadow", {
      receipt: result.receipt,
      identityCode: result.identityCode,
      cwdCode: result.cwdCode,
      helperCwdPresent: result.helperCwdPresent,
      shadowLocatorPresent: result.shadowLocatorPresent,
      locatorMatchesHelper: result.locatorMatchesHelper,
      productionCwdUnchanged: true,
    });
    return result;
  } catch (err) {
    log.warn?.("s01_stage_b_steward_cwd_shadow_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
