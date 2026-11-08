/**
 * Display rules for E2 asset linkage.
 * Unknown is not healthy. A live query is not a sync and not an ingest.
 */

export type DataAssetConnectionHealth = "healthy" | "unhealthy" | "unknown";

export type DataAssetVerificationStatus = "passed" | "failed" | "unverified" | "stale" | "unknown";

export type DataAssetFreshnessStatus = "fresh" | "stale" | "live_query" | "unknown";

export type DataAssetLinkedCapabilityView = {
  capabilityId: string;
  version: string;
  verification: Exclude<DataAssetVerificationStatus, "unknown">;
  skillId?: string;
  dataCapabilityId?: string;
  demoCapability?: boolean;
};

export type DataAssetLinkedProductView = {
  capabilityId: string;
  displayName: string;
};

export type DataAssetLinkageView = {
  sourceId: string;
  accessMethod: "credential" | "website_session";
  demo: boolean;
  /** Data products linked by sourceIds. Empty when the payload predates this field. */
  products: DataAssetLinkedProductView[];
  connection: {
    status: string;
    health: DataAssetConnectionHealth;
    lastCheckedAt?: string;
  };
  verification: {
    status: DataAssetVerificationStatus;
    healthy: boolean;
    productionVerificationCount: number;
    capabilities: DataAssetLinkedCapabilityView[];
  };
  freshness: {
    status: DataAssetFreshnessStatus;
    healthy: boolean;
    lastSucceededAt?: string;
    lastMaterializedAt?: string;
    materializationCount: number;
    claimsSynced: boolean;
    claimsIngested: boolean;
  };
  scope: {
    supportedScopeTypes: string[];
    known: boolean;
  };
  account: {
    bindingId?: string;
    selectable: boolean;
  };
  links: {
    capabilityCenter: {
      capabilityId: string;
      version: string;
      skillId?: string;
    } | null;
  };
};

export type DataAssetStatsView = {
  connection: { healthy: number; unhealthy: number; unknown: number };
  verification: {
    passed: number;
    failed: number;
    unverified: number;
    stale: number;
    unknown: number;
  };
  freshness: { fresh: number; stale: number; liveQuery: number; unknown: number };
  demo: number;
};

const CONNECTION = new Set<DataAssetConnectionHealth>(["healthy", "unhealthy", "unknown"]);
const VERIFICATION = new Set<DataAssetVerificationStatus>([
  "passed",
  "failed",
  "unverified",
  "stale",
  "unknown",
]);
const FRESHNESS = new Set<DataAssetFreshnessStatus>(["fresh", "stale", "live_query", "unknown"]);

export function isCountedConnectionHealthy(health: DataAssetConnectionHealth): boolean {
  return health === "healthy";
}

export function isCountedVerificationHealthy(status: DataAssetVerificationStatus): boolean {
  return status === "passed";
}

export function isCountedFreshnessHealthy(status: DataAssetFreshnessStatus): boolean {
  return status === "fresh";
}

export function accessMethodLabel(method: string): string {
  return method === "website_session" ? "网站会话" : "凭证";
}

export function connectionHealthLabel(health: DataAssetConnectionHealth): string {
  if (health === "healthy") {
    return "连接健康";
  }
  if (health === "unhealthy") {
    return "连接异常";
  }
  return "连接未知";
}

export function verificationLabel(status: DataAssetVerificationStatus): string {
  switch (status) {
    case "passed":
      return "验证通过";
    case "failed":
      return "验证失败";
    case "unverified":
      return "未验证";
    case "stale":
      return "验证过期";
    default:
      return "验证未知";
  }
}

export function freshnessLabel(status: DataAssetFreshnessStatus): string {
  switch (status) {
    case "fresh":
      return "已入库";
    case "stale":
      return "入库已过期";
    case "live_query":
      return "实时查询，未入库";
    default:
      return "新鲜度未知";
  }
}

export function observationTimeLabel(
  iso: string | undefined,
  format: (value: string) => string,
): string {
  return iso ? format(iso) : "无";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asHealth(value: unknown): DataAssetConnectionHealth {
  return typeof value === "string" && CONNECTION.has(value as DataAssetConnectionHealth)
    ? (value as DataAssetConnectionHealth)
    : "unknown";
}

function asVerification(value: unknown): DataAssetVerificationStatus {
  return typeof value === "string" && VERIFICATION.has(value as DataAssetVerificationStatus)
    ? (value as DataAssetVerificationStatus)
    : "unknown";
}

function asFreshness(value: unknown): DataAssetFreshnessStatus {
  return typeof value === "string" && FRESHNESS.has(value as DataAssetFreshnessStatus)
    ? (value as DataAssetFreshnessStatus)
    : "unknown";
}

export function normalizeAssetLinkage(raw: unknown): DataAssetLinkageView | null {
  const record = asRecord(raw);
  const sourceId = typeof record?.sourceId === "string" ? record.sourceId : "";
  if (!sourceId) {
    return null;
  }
  const connection = asRecord(record?.connection);
  const verification = asRecord(record?.verification);
  const freshness = asRecord(record?.freshness);
  const scope = asRecord(record?.scope);
  const account = asRecord(record?.account);
  const links = asRecord(record?.links);
  const capabilityCenter = asRecord(links?.capabilityCenter);
  const health = asHealth(connection?.health);
  const verificationStatus = asVerification(verification?.status);
  const freshnessStatus = asFreshness(freshness?.status);
  const capabilities = Array.isArray(verification?.capabilities)
    ? verification.capabilities.flatMap((entry) => {
        const item = asRecord(entry);
        const capabilityId = typeof item?.capabilityId === "string" ? item.capabilityId : "";
        const version = typeof item?.version === "string" ? item.version : "";
        const status = asVerification(item?.verification);
        if (!capabilityId || !version || status === "unknown") {
          return [];
        }
        return [
          {
            capabilityId,
            version,
            verification: status,
            ...(typeof item?.skillId === "string" ? { skillId: item.skillId } : {}),
            ...(typeof item?.dataCapabilityId === "string"
              ? { dataCapabilityId: item.dataCapabilityId }
              : {}),
            ...(item?.demoCapability === true ? { demoCapability: true } : {}),
          },
        ];
      })
    : [];
  const products = Array.isArray(record?.products)
    ? record.products.flatMap((entry) => {
        const item = asRecord(entry);
        const capabilityId = typeof item?.capabilityId === "string" ? item.capabilityId : "";
        const displayName = typeof item?.displayName === "string" ? item.displayName.trim() : "";
        if (!capabilityId || !displayName) {
          return [];
        }
        return [{ capabilityId, displayName }];
      })
    : [];
  const claimsSynced =
    freshness?.claimsSynced === true &&
    freshnessStatus !== "live_query" &&
    freshnessStatus !== "unknown";
  const claimsIngested =
    freshness?.claimsIngested === true &&
    freshnessStatus !== "live_query" &&
    freshnessStatus !== "unknown";
  return {
    sourceId,
    accessMethod: record?.accessMethod === "website_session" ? "website_session" : "credential",
    demo: record?.demo === true,
    products,
    connection: {
      status: typeof connection?.status === "string" ? connection.status : "unknown",
      health,
      ...(typeof connection?.lastCheckedAt === "string"
        ? { lastCheckedAt: connection.lastCheckedAt }
        : {}),
    },
    verification: {
      status: verificationStatus,
      healthy: verificationStatus === "passed" && verification?.healthy === true,
      productionVerificationCount:
        typeof verification?.productionVerificationCount === "number"
          ? verification.productionVerificationCount
          : 0,
      capabilities,
    },
    freshness: {
      status: freshnessStatus,
      healthy: freshnessStatus === "fresh" && freshness?.healthy === true,
      ...(typeof freshness?.lastSucceededAt === "string"
        ? { lastSucceededAt: freshness.lastSucceededAt }
        : {}),
      ...(typeof freshness?.lastMaterializedAt === "string"
        ? { lastMaterializedAt: freshness.lastMaterializedAt }
        : {}),
      materializationCount:
        typeof freshness?.materializationCount === "number" ? freshness.materializationCount : 0,
      claimsSynced,
      claimsIngested,
    },
    scope: {
      supportedScopeTypes: Array.isArray(scope?.supportedScopeTypes)
        ? scope.supportedScopeTypes.filter((item): item is string => typeof item === "string")
        : [],
      known: scope?.known === true,
    },
    account: {
      ...(typeof account?.bindingId === "string" ? { bindingId: account.bindingId } : {}),
      selectable: account?.selectable === true,
    },
    links: {
      capabilityCenter:
        capabilityCenter && typeof capabilityCenter.capabilityId === "string"
          ? {
              capabilityId: capabilityCenter.capabilityId,
              version: typeof capabilityCenter.version === "string" ? capabilityCenter.version : "",
              ...(typeof capabilityCenter.skillId === "string"
                ? { skillId: capabilityCenter.skillId }
                : {}),
            }
          : null,
    },
  };
}

/** SAR bridge names when present; otherwise linked data-product names. */
export function assetLinkedCapabilityLabel(
  linkage: DataAssetLinkageView | null | undefined,
): string {
  const bridges = linkage?.verification.capabilities ?? [];
  if (bridges.length > 0) {
    return bridges
      .map((capability) => `${capability.capabilityId}@${capability.version}`)
      .join("、");
  }
  const products = linkage?.products ?? [];
  if (products.length > 0) {
    return products.map((product) => product.displayName).join("、");
  }
  return "无";
}

export function normalizeAssetStats(raw: unknown): DataAssetStatsView {
  const record = asRecord(raw);
  const connection = asRecord(record?.connection);
  const verification = asRecord(record?.verification);
  const freshness = asRecord(record?.freshness);
  const count = (source: Record<string, unknown> | null, key: string) =>
    typeof source?.[key] === "number" ? source[key] : 0;
  return {
    connection: {
      healthy: count(connection, "healthy"),
      unhealthy: count(connection, "unhealthy"),
      unknown: count(connection, "unknown"),
    },
    verification: {
      passed: count(verification, "passed"),
      failed: count(verification, "failed"),
      unverified: count(verification, "unverified"),
      stale: count(verification, "stale"),
      unknown: count(verification, "unknown"),
    },
    freshness: {
      fresh: count(freshness, "fresh"),
      stale: count(freshness, "stale"),
      liveQuery: count(freshness, "liveQuery"),
      unknown: count(freshness, "unknown"),
    },
    demo: typeof record?.demo === "number" ? record.demo : 0,
  };
}

export function emptyAssetStats(): DataAssetStatsView {
  return normalizeAssetStats(null);
}
