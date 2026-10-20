/**
 * OpenBot Data Space configuration (see docs/design/openbot-data-space-model-v1-2026-07-10.md
 * and docs/design/openbot-data-directory-product-spec-2026-07-10.md).
 *
 * `data.*` is the first-class, user-visible data model introduced in Phase 1. It is
 * intentionally separate from the system state dir (`~/.openbot`, credentials/identity/
 * runtime sessions) which is never user-migratable. Phase 1 does NOT change
 * `resolveAgentWorkspaceDir`; `data.root` is written at install/onboard time and consumed
 * by the data-directory UI, doctor, and (Phase 2) the migration engine.
 */

/** Where the user's Data Space physically lives. */
export type DataMode =
  /** Local disk (Mac App / local gateway). Physical path is user-visible. */
  | "local"
  /** SaaS-hosted (openbot.love). Disk is never exposed to the employee surface. */
  | "managed";

export type DataConfig = {
  /** User-visible data root ("OpenBot 数据"). Default: `~/OpenBot`. */
  root?: string;
  /** Storage mode. Default (unset) is treated as "local". */
  mode?: DataMode;
  /** Rebuildable cache directory. Default: `{root}/cache`. */
  cacheDir?: string;
  /** Data Space layout version. Current: 1. */
  schemaVersion?: number;
  /** Previous data root, retained for migration rollback (Phase 2). */
  previousRoot?: string;
  /** ISO8601 timestamp after which `previousRoot` can be cleaned up. */
  previousRootExpiresAt?: string;
  /** SaaS only: tenant identifier (server-side; never surfaced to employees). */
  tenantId?: string;
  /** SaaS only: user identifier within the tenant (server-side). */
  userId?: string;
};
