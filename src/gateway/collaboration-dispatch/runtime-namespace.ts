/**
 * P0.0a — tenant runtime namespace for collaboration runtime facts
 * (Floor Runtime v2.1 §3.4 / §5.2, MUST 5).
 *
 * `<ns> = <groupLocator>/runtime` where `<groupLocator>` comes from the existing
 * tenant-aware `resolveTrustedGroupLocator` (workspace/group-locator.ts):
 *   managed_enterprise: <tenantsRoot>/<tenantId>/collaboration/groups/<enc(groupId)>
 *   personal_local:     <collaborationRoot>/groups/<enc(groupId)>   (tenantKey "_local")
 *
 * Gated by `collaboration.runtimeNamespace` (plan name `collab.runtimeNamespace`),
 * default OFF. With the flag off every path below resolves to the legacy
 * (pre-P0.0a) location byte-for-byte; nothing reads or writes `<ns>`.
 * With the flag on, managed_enterprise never falls back to host legacy paths
 * (group-locator.ts frozen SoT) and a missing tenant fails closed.
 *
 * P0 G7 locks that gate in code. N2 production cutover is not signed: this
 * module does not default the flag on, and it does not treat a host legacy
 * root as a fallback once the flag is on.
 */
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { resolveLegacyGroupRuntimeFactPaths } from "../collaboration-learning/collaboration-paths.js";
import type { CollaborationTenantTrustLevel } from "../collaboration-learning/trusted-tenant.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { assertSafeTenantId } from "../tenant-store-paths.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";

export type RuntimeNamespaceProfile = "personal_local" | "managed_enterprise";

export const PERSONAL_LOCAL_TENANT_KEY = "_local";

export type RuntimeNamespace = {
  profile: RuntimeNamespaceProfile;
  /** Trusted tenant id (managed_enterprise) or null (personal_local). */
  tenantId: string | null;
  /** Directory-safe tenant key: tenantId, or "_local" for personal_local. */
  tenantKey: string;
  groupId: string;
  groupLocator: string;
  /** `<groupLocator>/runtime` */
  root: string;
  roundsDir: string;
  ledgerFile: string;
  policySnapshotsDir: string;
  episodesDir: string;
  handoffsDir: string;
  shadowDir: string;
};

export class RuntimeNamespaceTenantRequiredError extends Error {
  readonly code = "COLLAB_RUNTIME_NAMESPACE_TENANT_REQUIRED";
  constructor(groupId: string) {
    super(
      `collaboration runtime namespace: trusted tenant required for managed_enterprise group "${groupId}" (fail-closed)`,
    );
    this.name = "RuntimeNamespaceTenantRequiredError";
  }
}

export class CollaborationRuntimeWriteFrozenError extends Error {
  readonly code = "COLLAB_RUNTIME_WRITE_FROZEN";
  constructor(target: string) {
    super(
      `collaboration runtime writes are frozen (collaboration.runtimeWriteFreeze=true); rejected write to ${target}`,
    );
    this.name = "CollaborationRuntimeWriteFrozenError";
  }
}

/**
 * P0 G7. N2 production cutover is unsigned. Omitted config stays off because
 * of this constant. Do not set it to true in this module or in committed config.
 */
export const RUNTIME_NAMESPACE_CUTOVER_DEFAULT = false;

/** Plan flag `collab.runtimeNamespace` → config `collaboration.runtimeNamespace` (default false). */
export function isCollabRuntimeNamespaceEnabled(cfg?: OpenBotConfig): boolean {
  const configured = (cfg ?? loadConfig()).collaboration?.runtimeNamespace;
  if (configured === undefined) {
    return RUNTIME_NAMESPACE_CUTOVER_DEFAULT;
  }
  return configured;
}

/** Cutover maintenance window: `collaboration.runtimeWriteFreeze` (default false). */
export function isCollabRuntimeWriteFrozen(cfg?: OpenBotConfig): boolean {
  return (cfg ?? loadConfig()).collaboration?.runtimeWriteFreeze === true;
}

export function assertCollaborationRuntimeWritable(target: string, cfg?: OpenBotConfig): void {
  if (isCollabRuntimeWriteFrozen(cfg)) {
    throw new CollaborationRuntimeWriteFrozenError(target);
  }
}

export function buildRuntimeNamespace(params: {
  profile: RuntimeNamespaceProfile;
  tenantId: string | null;
  groupId: string;
  groupLocator: string;
}): RuntimeNamespace {
  const root = path.join(params.groupLocator, "runtime");
  return {
    profile: params.profile,
    tenantId: params.tenantId,
    tenantKey: params.tenantId ?? PERSONAL_LOCAL_TENANT_KEY,
    groupId: params.groupId,
    groupLocator: params.groupLocator,
    root,
    roundsDir: path.join(root, "rounds"),
    ledgerFile: path.join(root, "ledger", "collaboration.jsonl"),
    policySnapshotsDir: path.join(root, "policy-snapshots"),
    episodesDir: path.join(root, "episodes"),
    handoffsDir: path.join(root, "handoffs"),
    shadowDir: path.join(root, "shadow"),
  };
}

/**
 * §3.4 API. managed_enterprise with an empty tenant or `tenantTrust: "none"`
 * throws {@link RuntimeNamespaceTenantRequiredError} (fail-closed).
 */
export function resolveRuntimeNamespace(input: {
  tenantId: string | null;
  tenantTrust: CollaborationTenantTrustLevel;
  groupId: string;
  profile: RuntimeNamespaceProfile;
  cfg: OpenBotConfig;
}): RuntimeNamespace {
  const groupId = input.groupId.trim();
  if (!groupId) {
    throw new Error("collaboration runtime namespace: groupId is required");
  }
  if (input.profile === "managed_enterprise") {
    const tenantId = input.tenantId?.trim();
    if (!tenantId || input.tenantTrust === "none") {
      throw new RuntimeNamespaceTenantRequiredError(groupId);
    }
    assertSafeTenantId(tenantId);
    return buildRuntimeNamespace({
      profile: "managed_enterprise",
      tenantId,
      groupId,
      groupLocator: resolveTrustedGroupLocator({
        groupId,
        tenantId,
        profile: "managed_enterprise",
        cfg: input.cfg,
      }),
    });
  }
  return buildRuntimeNamespace({
    profile: "personal_local",
    tenantId: null,
    groupId,
    groupLocator: resolveTrustedGroupLocator({
      groupId,
      tenantId: null,
      profile: "personal_local",
      cfg: input.cfg,
    }),
  });
}

export type CollaborationRuntimeFactPaths = {
  roundsDir: string;
  ledgerFile: string;
  /** null while `collaboration.runtimeNamespace` is off (legacy layout). */
  namespace: RuntimeNamespace | null;
};

/**
 * Single resolver used by round-store and the collaboration ledger.
 * `tenantId` is the server-resolved scope tenant (never a client param); when the
 * caller does not state its trust level, a present tenant is labeled
 * `actor_fallback` (the weakest level trusted-tenant.ts allows for collaboration
 * I/O) and an absent one `none`.
 */
export function resolveCollaborationRuntimeFactPaths(params: {
  groupId: string;
  tenantId?: string | null;
  tenantTrust?: CollaborationTenantTrustLevel;
  cfg?: OpenBotConfig;
  env?: NodeJS.ProcessEnv;
}): CollaborationRuntimeFactPaths {
  const cfg = params.cfg ?? loadConfig();
  if (!isCollabRuntimeNamespaceEnabled(cfg)) {
    const legacy = resolveLegacyGroupRuntimeFactPaths(params.groupId, params.cfg);
    return { roundsDir: legacy.roundsDir, ledgerFile: legacy.ledgerFile, namespace: null };
  }
  const tenantId = params.tenantId?.trim() || null;
  const namespace = resolveRuntimeNamespace({
    tenantId,
    tenantTrust: params.tenantTrust ?? (tenantId ? "actor_fallback" : "none"),
    groupId: params.groupId,
    profile: resolveSecurityProfile(cfg, params.env ?? process.env).profile,
    cfg,
  });
  return { roundsDir: namespace.roundsDir, ledgerFile: namespace.ledgerFile, namespace };
}
