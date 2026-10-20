/**
 * tenant-import manifest (SaaS tenant data architecture §9.3, acceptance SAAS-P-01 / SAAS-P-02).
 *
 * The manifest drives the platform-side import job: it declares the source, the target tenant,
 * the ID remap policy, and what the package contains. `packageKind` distinguishes it from the
 * single-user `openbot-export-manifest.json` (§9.4) so the two flows never mix.
 */

export const TENANT_IMPORT_MANIFEST_NAME = "tenant-import-manifest.json";
export const TENANT_IMPORT_SCHEMA_VERSION = 1 as const;
export const TENANT_IMPORT_PACKAGE_KIND = "tenant-import" as const;
export const TENANT_IMPORT_ID_REMAP_POLICY = "deterministic-v1" as const;

/** Categories never included in a tenant-import package (§9.2 / §10.2 / §11). */
export const TENANT_IMPORT_EXCLUDED_CATEGORIES = [
  "credentials",
  "identity",
  "runtime-sessions",
  "auth-profiles",
  "platform-global-billing",
] as const;

export type TenantImportManifest = {
  schemaVersion: typeof TENANT_IMPORT_SCHEMA_VERSION;
  packageKind: typeof TENANT_IMPORT_PACKAGE_KIND;
  exportedAt: string;
  source: {
    environment: string;
    openbotVersion?: string;
    sourceTenantId: string;
    sourceStateDirHint?: string;
    sourceDataRootHint?: string;
  };
  target: {
    targetTenantId: string;
    targetRegion?: string;
    idRemapPolicy: string;
  };
  contents: {
    controlPlane: boolean;
    userDataSpaces: string[];
    tenantShared: boolean;
    includedPaths: string[];
    excludedCategories: string[];
  };
  stats: {
    fileCount: number;
    bytes: number;
    userCount: number;
    agentCount: number;
  };
  checksums?: {
    algorithm: "sha256";
    manifestSha256?: string;
  };
};

export type BuildTenantImportManifestParams = {
  environment: string;
  sourceTenantId: string;
  targetTenantId: string;
  userDataSpaces: string[];
  openbotVersion?: string;
  targetRegion?: string;
  sourceStateDirHint?: string;
  sourceDataRootHint?: string;
  controlPlane?: boolean;
  tenantShared?: boolean;
  includedPaths?: string[];
  stats?: Partial<TenantImportManifest["stats"]>;
  now?: () => Date;
};

export function buildTenantImportManifest(
  params: BuildTenantImportManifestParams,
): TenantImportManifest {
  const now = params.now ?? (() => new Date());
  const controlPlane = params.controlPlane !== false;
  const tenantShared = params.tenantShared === true;
  const includedPaths =
    params.includedPaths ??
    [
      controlPlane ? "control-plane/" : null,
      "users/",
      tenantShared ? "tenant-shared/" : null,
    ].filter((p): p is string => p !== null);
  return {
    schemaVersion: TENANT_IMPORT_SCHEMA_VERSION,
    packageKind: TENANT_IMPORT_PACKAGE_KIND,
    exportedAt: now().toISOString(),
    source: {
      environment: params.environment,
      openbotVersion: params.openbotVersion,
      sourceTenantId: params.sourceTenantId,
      sourceStateDirHint: params.sourceStateDirHint,
      sourceDataRootHint: params.sourceDataRootHint,
    },
    target: {
      targetTenantId: params.targetTenantId,
      targetRegion: params.targetRegion,
      idRemapPolicy: TENANT_IMPORT_ID_REMAP_POLICY,
    },
    contents: {
      controlPlane,
      userDataSpaces: params.userDataSpaces,
      tenantShared,
      includedPaths,
      excludedCategories: [...TENANT_IMPORT_EXCLUDED_CATEGORIES],
    },
    stats: {
      fileCount: params.stats?.fileCount ?? 0,
      bytes: params.stats?.bytes ?? 0,
      userCount: params.stats?.userCount ?? params.userDataSpaces.length,
      agentCount: params.stats?.agentCount ?? 0,
    },
  };
}

export type ManifestValidation =
  | { ok: true; manifest: TenantImportManifest }
  | { ok: false; errors: string[] };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Validate untrusted manifest JSON (§9.3 required fields) before an import job proceeds. */
export function validateTenantImportManifest(raw: unknown): ManifestValidation {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { ok: false, errors: ["manifest 不是对象"] };
  }
  const m = raw as Record<string, unknown>;

  if (m.schemaVersion !== TENANT_IMPORT_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须为 ${TENANT_IMPORT_SCHEMA_VERSION}`);
  }
  if (m.packageKind !== TENANT_IMPORT_PACKAGE_KIND) {
    errors.push(`packageKind 必须为 "${TENANT_IMPORT_PACKAGE_KIND}"（区分单用户 export 包）`);
  }

  const source = m.source as Record<string, unknown> | undefined;
  if (!source || !isNonEmptyString(source.sourceTenantId)) {
    errors.push("source.sourceTenantId 必填");
  }

  const target = m.target as Record<string, unknown> | undefined;
  if (!target || !isNonEmptyString(target.targetTenantId)) {
    errors.push("target.targetTenantId 必填");
  }

  const contents = m.contents as Record<string, unknown> | undefined;
  if (!contents || !Array.isArray(contents.userDataSpaces)) {
    errors.push("contents.userDataSpaces 必须为数组");
  } else if (!contents.userDataSpaces.every((u) => typeof u === "string")) {
    errors.push("contents.userDataSpaces 必须为字符串数组");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, manifest: raw as TenantImportManifest };
}

/**
 * Enforce §4.1: the manifest's target tenant must equal the import job's tenant, otherwise the
 * job is rejected and audited (prevents cross-tenant misdelivery).
 */
export function assertManifestTargetsTenant(
  manifest: TenantImportManifest,
  jobTargetTenantId: string,
): { ok: true } | { ok: false; error: string } {
  if (manifest.target.targetTenantId !== jobTargetTenantId) {
    return {
      ok: false,
      error: `manifest targetTenantId(${manifest.target.targetTenantId}) 与作业租户(${jobTargetTenantId}) 不一致`,
    };
  }
  return { ok: true };
}
