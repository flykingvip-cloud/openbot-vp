import type { GatewayTrustedProxyConfig } from "../config/types.gateway.js";
import type { OpenBotConfig } from "../config/types.openbot.js";
import { readJsonFile } from "../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../utils.js";
import {
  createBinding,
  listAgents,
  listBindings,
  recordTelemetry,
  upsertAgent,
  type RuntimeAgent,
  type RuntimeTelemetry,
} from "./agent-runtime-store.js";
import { listRegistry } from "./capability-governance-store.js";
import { stringValue } from "./records.js";
import { canonicalizeTenantId, findCanonicalTenantIdBySlug } from "./tenant-canonicalization.js";

type SeedEnterpriseStatus = "trial" | "paid" | "suspended" | "expired";

type SeedEnterprise = {
  id: string;
  name: string;
  status: SeedEnterpriseStatus;
};

type PlatformAuthSeedConfig = {
  storePath: string;
};

type PlatformAuthSeedStore = {
  enterprises?: Record<string, { id?: unknown; name?: unknown; slug?: unknown; status?: unknown }>;
  tenants?: Record<string, { id?: unknown; name?: unknown }>;
};

function resolveDefaultPlatformAuthStorePath(): string {
  return `${CONFIG_DIR}/openbot-platform-auth.json`;
}

function resolvePlatformAuthSeedConfig(
  trustedProxy: GatewayTrustedProxyConfig | undefined,
): PlatformAuthSeedConfig | null {
  const platformAuth = trustedProxy?.platformAuth;
  if (!platformAuth || platformAuth.enabled === false) {
    return null;
  }
  return {
    storePath: resolveUserPath(platformAuth.store?.trim() || resolveDefaultPlatformAuthStorePath()),
  };
}

function normalizeEnterpriseStatus(raw: unknown): SeedEnterpriseStatus {
  return raw === "paid" || raw === "suspended" || raw === "expired" ? raw : "trial";
}

async function loadSeedEnterprises(config: PlatformAuthSeedConfig): Promise<SeedEnterprise[]> {
  const store = await readJsonFile<PlatformAuthSeedStore>(config.storePath);
  if (!store || typeof store !== "object") {
    return [];
  }
  const enterprises = Object.entries(store.enterprises ?? {}).map(([fallbackId, entry]) => ({
    id:
      canonicalizeTenantId(stringValue(entry.id) ?? fallbackId) ??
      findCanonicalTenantIdBySlug({ slug: stringValue(entry.slug) }) ??
      stringValue(entry.id) ??
      fallbackId,
    name: stringValue(entry.name) ?? fallbackId,
    status: normalizeEnterpriseStatus(entry.status),
  }));
  if (enterprises.length > 0) {
    return enterprises;
  }
  return Object.entries(store.tenants ?? {}).map(([fallbackId, entry]) => ({
    id: stringValue(entry.id) ?? fallbackId,
    name: stringValue(entry.name) ?? fallbackId,
    status: "paid",
  }));
}

function normalizeRuntimeAgentId(tenantId: string): string {
  return `rt-${tenantId}`;
}

function defaultRuntimeVersion(cfg: OpenBotConfig): string {
  const appVersion = cfg.meta?.lastTouchedVersion;
  return typeof appVersion === "string" && appVersion.trim() ? appVersion.trim() : "2026.3.9";
}

function buildSeedAgent(params: {
  tenantId: string;
  tenantLabel: string;
  tenantStatus: "trial" | "paid" | "suspended" | "expired";
  runtimeVersion: string;
  now: number;
}): RuntimeAgent {
  return {
    runtimeAgentId: normalizeRuntimeAgentId(params.tenantId),
    name: `${params.tenantLabel} Runtime`,
    runtimeVersion: params.runtimeVersion,
    lifecycle:
      params.tenantStatus === "suspended" || params.tenantStatus === "expired"
        ? "suspended"
        : "deployed",
    health: "healthy",
    tenantCoverage: [params.tenantId],
    boundCapabilityCount: 0,
    activeSessionCount: 0,
    resourceUsage: {
      cpuPercent: 0,
      memoryPercent: 0,
      tokenBudgetUsedPercent: 0,
    },
    deployedAt: params.now,
    lastActiveAt: params.now,
  };
}

function seedTelemetrySample(params: {
  runtimeAgentId: string;
  capabilityId: string;
  now: number;
}): RuntimeTelemetry {
  return {
    runtimeAgentId: params.runtimeAgentId,
    capabilityId: params.capabilityId,
    calls7d: 0,
    successRate7d: 1,
    avgLatencyMs: 0,
    p95LatencyMs: 0,
    tokenConsumption7d: 0,
    errorCount7d: 0,
    queueDepth: 0,
    memoryPressure: 0,
    lastSampleAt: params.now,
  };
}

export async function maybeSeedAgentRuntimeFromPlatformState(params: {
  cfg: OpenBotConfig;
  trustedProxy: GatewayTrustedProxyConfig | undefined;
  log?: { info?: (message: string) => void; warn?: (message: string) => void };
}): Promise<{
  seeded: boolean;
  agentCount: number;
  bindingCount: number;
  tenantCount: number;
  reason?: string;
}> {
  const platformAuthConfig = resolvePlatformAuthSeedConfig(params.trustedProxy);
  if (!platformAuthConfig) {
    return {
      seeded: false,
      agentCount: 0,
      bindingCount: 0,
      tenantCount: 0,
      reason: "platform-auth-disabled",
    };
  }

  const enterprises = await loadSeedEnterprises(platformAuthConfig);
  const registry = listRegistry().filter((entry) => entry.lifecycleState === "active");
  if (enterprises.length === 0 || registry.length === 0) {
    return {
      seeded: false,
      agentCount: 0,
      bindingCount: 0,
      tenantCount: enterprises.length,
      reason: enterprises.length === 0 ? "no-enterprises" : "no-registry",
    };
  }

  const now = Date.now();
  const runtimeVersion = defaultRuntimeVersion(params.cfg);
  let seededAgents = 0;
  let seededBindings = 0;
  const existingAgents = new Map(
    listAgents({ lifecycle: null, health: null, tenantId: null, searchQuery: "" }).map((agent) => [
      agent.runtimeAgentId,
      agent,
    ]),
  );
  const existingBindings = new Set(
    listBindings({
      runtimeAgentId: null,
      capabilityId: null,
      bindingType: null,
      bindingState: null,
      health: null,
    }).map((binding) => `${binding.runtimeAgentId}::${binding.capabilityId}`),
  );

  for (const enterprise of enterprises) {
    const runtimeAgentId = normalizeRuntimeAgentId(enterprise.id);
    if (!existingAgents.has(runtimeAgentId)) {
      const agent = buildSeedAgent({
        tenantId: enterprise.id,
        tenantLabel: enterprise.name,
        tenantStatus: enterprise.status,
        runtimeVersion,
        now,
      });
      upsertAgent(agent);
      existingAgents.set(runtimeAgentId, agent);
      seededAgents += 1;
    }

    for (const entry of registry) {
      const scopeTenantIds = entry.distribution.scope.tenantIds;
      const shouldBind =
        !scopeTenantIds || scopeTenantIds.length === 0
          ? entry.distribution.defaultEnabled
          : scopeTenantIds.includes(enterprise.id);
      if (!shouldBind) {
        continue;
      }
      const bindingKey = `${runtimeAgentId}::${entry.manifest.id}`;
      if (existingBindings.has(bindingKey)) {
        continue;
      }
      const created = createBinding({
        runtimeAgentId,
        capabilityId: entry.manifest.id,
        capabilityVersion: entry.manifest.version,
        bindingType: "platform-default",
        loadStrategy: "lazy",
        routingPriority: null,
        policy: null,
        fallbackBindingId: null,
      });
      recordTelemetry(
        seedTelemetrySample({
          runtimeAgentId: created.runtimeAgentId,
          capabilityId: created.capabilityId,
          now,
        }),
      );
      existingBindings.add(bindingKey);
      seededBindings += 1;
    }
  }

  if (seededAgents > 0 || seededBindings > 0) {
    params.log?.info?.(
      `agent-runtime: seeded ${seededAgents} runtime agent(s) and ${seededBindings} binding(s) from ${enterprises.length} enterprise(s) and ${registry.length} registry capability(ies)`,
    );
  }

  return {
    seeded: seededAgents > 0 || seededBindings > 0,
    agentCount: seededAgents,
    bindingCount: seededBindings,
    tenantCount: enterprises.length,
    reason: seededAgents > 0 || seededBindings > 0 ? undefined : "up-to-date",
  };
}
