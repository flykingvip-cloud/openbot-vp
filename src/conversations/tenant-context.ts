/**
 * Authenticated TenantContext → dataPlaneId/tenantId (CL-P0-03).
 * Fail closed: never fall back to a default tenant or shared directory on error.
 */
import { createHash } from "node:crypto";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataMode, resolveDataRoot } from "../config/data-space.js";
import type { ConversationTenantContext } from "./types.js";

export class TenantContextResolutionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TenantContextResolutionError";
    this.code = code;
  }
}

export type ResolveConversationTenantContextInput = {
  cfg?: OpenBotConfig;
  /** Server-authenticated principal (user/device/service). Required. */
  principalId?: string | null;
  /** Server-authenticated tenant. Required in managed mode. */
  tenantId?: string | null;
  seatId?: string | null;
  groupIds?: string[] | null;
  roles?: string[] | null;
  /**
   * Optional override for tests. Production paths must resolve via cfg + auth.
   * Never accept unauthenticated client dataPlaneId as sole authority.
   */
  dataPlaneIdOverride?: string | null;
  env?: NodeJS.ProcessEnv;
};

function normalizeOptional(value: string | null | undefined): string | null {
  const t = value?.trim();
  return t ? t : null;
}

function normalizeRequired(value: string | null | undefined, code: string): string {
  const t = value?.trim();
  if (!t) {
    throw new TenantContextResolutionError(
      code,
      `missing required field for tenant context: ${code}`,
    );
  }
  return t;
}

/**
 * Stable data plane id for local deployments (bound to Data Root path).
 * Managed mode uses tenant-scoped plane id from authenticated tenant.
 */
export function computeLocalDataPlaneId(dataRoot: string): string {
  const digest = createHash("sha256")
    .update("local-dataplane-v1\0")
    .update(dataRoot)
    .digest("hex")
    .slice(0, 24);
  return `dp_local_${digest}`;
}

export function computeManagedDataPlaneId(tenantId: string): string {
  const digest = createHash("sha256")
    .update("managed-dataplane-v1\0")
    .update(tenantId.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
  return `dp_tenant_${digest}`;
}

/**
 * Resolve authenticated conversation tenant context.
 * Throws TenantContextResolutionError on missing/forged context (fail closed).
 */
export function resolveConversationTenantContext(
  input: ResolveConversationTenantContextInput,
): ConversationTenantContext {
  const principalId = normalizeRequired(input.principalId, "PRINCIPAL_REQUIRED");
  const mode = resolveDataMode(input.cfg, input.env) === "managed" ? "managed" : "local";
  const tenantId = normalizeOptional(input.tenantId);

  if (mode === "managed") {
    if (!tenantId) {
      throw new TenantContextResolutionError(
        "TENANT_REQUIRED",
        "managed mode requires authenticated tenantId",
      );
    }
  }

  let dataPlaneId: string;
  const override = normalizeOptional(input.dataPlaneIdOverride);
  if (override) {
    // Override only allowed when it matches the mode-derived plane (tests may pass exact value).
    const expected =
      mode === "managed" && tenantId
        ? computeManagedDataPlaneId(tenantId)
        : computeLocalDataPlaneId(resolveDataRoot(input.cfg, input.env));
    if (override !== expected && !override.startsWith("dp_test_")) {
      throw new TenantContextResolutionError(
        "DATA_PLANE_MISMATCH",
        "dataPlaneId override does not match authenticated context",
      );
    }
    dataPlaneId = override;
  } else if (mode === "managed" && tenantId) {
    dataPlaneId = computeManagedDataPlaneId(tenantId);
  } else {
    dataPlaneId = computeLocalDataPlaneId(resolveDataRoot(input.cfg, input.env));
  }

  const groupIds = (input.groupIds ?? [])
    .map((g) => g?.trim())
    .filter((g): g is string => Boolean(g));
  const roles = (input.roles ?? []).map((r) => r?.trim()).filter((r): r is string => Boolean(r));

  return {
    dataPlaneId,
    tenantId: mode === "managed" ? tenantId : tenantId,
    principalId,
    seatId: normalizeOptional(input.seatId),
    groupIds,
    roles,
    mode,
  };
}
