import path from "node:path";
import { resolveMemorySearchConfig } from "../../agents/memory-search.js";
import { resolveDefaultAgentWorkspaceDir } from "../../agents/workspace.js";
import { loadConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import { resolveCommitHash } from "../../infra/git-commit.js";
import { resolveProbeModuleSha } from "../../memory/health-probe-build-info.js";
import { runOpsHealthProbe, type RunOpsHealthProbeResult } from "../../memory/health-probe-run.js";
import type { MemoryHealthProbeAgentInput } from "../../memory/health-probe.js";
import {
  createScopeDeniedReport,
  toSummaryAgentStatus,
  type HealthReport,
  type HealthReportMeta,
  type HealthReportOpsOk,
  type HealthReportSummaryOk,
} from "../../memory/health-report.js";
import { resolveUserPath } from "../../utils.js";
import { VERSION } from "../../version.js";
import { resolveAgentTenant } from "../agent-tenant.js";
import { listAgentsForGateway } from "../session-utils.js";
import { resolveTenantContext } from "../tenant-context.js";
import { tryResolveLiveRobotWriteRoot } from "../workspace-resolver/write-roots.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

export type MemoryHealthRpcMode = "platform" | "tenant" | "summary";

export type MemoryHealthRpcParams = {
  agentIds?: string[];
};

function probeUtcNow(): string {
  return new Date().toISOString();
}

export function buildHealthReportMeta(): HealthReportMeta {
  const instanceSha = resolveCommitHash({ moduleUrl: import.meta.url }) ?? "unknown";
  return {
    schema: "memory-health-report/v2",
    instanceSha,
    probeModuleSha: resolveProbeModuleSha({ moduleUrl: import.meta.url }),
    probeModuleVersion: VERSION,
    probeUtc: probeUtcNow(),
  };
}

export function resolveMemoryHealthCallerScope(
  client: GatewayClient | null,
  mode: MemoryHealthRpcMode,
): HealthReportOpsOk["callerScope"] {
  if (mode === "platform") {
    return "platform";
  }
  const domain = client?.sessionDomain;
  return domain === "employee" ? "steward" : "tenant";
}

function healthProbeAgentWorkspaceRoot(
  cfg: ReturnType<typeof loadConfig>,
  agentId: string,
): string {
  const live = tryResolveLiveRobotWriteRoot({
    agentId,
    configuredDefaultWorkspace: cfg.agents?.defaults?.workspace,
  });
  if (live) {
    return live;
  }
  return resolveDefaultAgentWorkspaceDir(process.env);
}

export function buildMemoryProbeAgentInput(
  cfg: ReturnType<typeof loadConfig>,
  agentId: string,
): MemoryHealthProbeAgentInput {
  const workspaceRoot = healthProbeAgentWorkspaceRoot(cfg, agentId);
  const memorySearch = resolveMemorySearchConfig(cfg, agentId);
  const indexPath = memorySearch
    ? resolveUserPath(memorySearch.store.path)
    : path.join(workspaceRoot, "index.sqlite");
  return {
    agentId,
    workspaceRoot,
    indexPath,
    backend: memorySearch ? "builtin" : "unknown",
  };
}

export async function filterAgentsForMemoryHealth(params: {
  mode: MemoryHealthRpcMode;
  client: GatewayClient | null;
  requestedAgentIds?: string[];
}): Promise<{ allowed: true; agentIds: string[] } | { allowed: false; reason: string }> {
  const cfg = loadConfig();
  const configuredIds = listAgentsForGateway(cfg).agents.map((agent) => agent.id);
  const requested = (params.requestedAgentIds ?? []).map((id) => id.trim()).filter(Boolean);
  let candidateIds = requested.length > 0 ? requested : configuredIds;

  if (params.mode === "platform") {
    const allowed = candidateIds.filter((id) => configuredIds.includes(id));
    if (allowed.length === 0) {
      return { allowed: false, reason: "No authorized agents for platform memory health probe" };
    }
    return { allowed: true, agentIds: allowed };
  }

  const tenantContext = await resolveTenantContext(params.client ?? null);
  if (!tenantContext?.tenantId) {
    return { allowed: false, reason: "Tenant context required for memory health probe" };
  }

  const tenantAgentIds: string[] = [];
  for (const agentId of candidateIds) {
    if (!configuredIds.includes(agentId)) {
      continue;
    }
    const agentTenant = await resolveAgentTenant(agentId);
    if (agentTenant === tenantContext.tenantId) {
      tenantAgentIds.push(agentId);
    }
  }

  if (tenantAgentIds.length === 0) {
    return { allowed: false, reason: "No agents authorized for caller tenant" };
  }
  return { allowed: true, agentIds: tenantAgentIds };
}

export type RunMemoryHealthRpcDeps = {
  runOpsHealthProbe?: typeof runOpsHealthProbe;
};

export async function runMemoryHealthRpc(
  params: {
    mode: MemoryHealthRpcMode;
    client: GatewayClient | null;
    agentIds?: string[];
  },
  deps: RunMemoryHealthRpcDeps = {},
): Promise<HealthReport> {
  const meta = buildHealthReportMeta();
  const callerScope = resolveMemoryHealthCallerScope(params.client, params.mode);
  const selection = await filterAgentsForMemoryHealth({
    mode: params.mode,
    client: params.client,
    requestedAgentIds: params.agentIds,
  });
  if (!selection.allowed) {
    return createScopeDeniedReport(selection.reason, meta.probeUtc);
  }

  const cfg = loadConfig();
  const agents = selection.agentIds.map((agentId) => buildMemoryProbeAgentInput(cfg, agentId));
  const executeProbe = deps.runOpsHealthProbe ?? runOpsHealthProbe;
  const opsReport: RunOpsHealthProbeResult = await executeProbe({
    meta,
    callerScope,
    authorizedAgentIds: selection.agentIds,
    runtime: { stateDir: resolveStateDir() },
    agents,
  });

  if (params.mode !== "summary") {
    return opsReport;
  }

  if (opsReport.status !== "ok") {
    return opsReport;
  }

  const summary: HealthReportSummaryOk = {
    schema: meta.schema,
    instanceSha: meta.instanceSha,
    probeModuleSha: meta.probeModuleSha,
    probeModuleVersion: meta.probeModuleVersion,
    probeUtc: meta.probeUtc,
    reportKind: "summary",
    status: "ok",
    reasonCode: "probe.ok",
    callerScope: callerScope === "platform" ? "tenant" : callerScope,
    authorizedAgentIds: selection.agentIds,
    agents: opsReport.agents.map(toSummaryAgentStatus),
    groups: opsReport.groups.map(({ groupId, memoryMdCount, mirrorDivergence }) => ({
      groupId,
      memoryMdCount,
      mirrorDivergence,
    })),
  };
  return summary;
}

function parseMemoryHealthParams(raw: Record<string, unknown>): MemoryHealthRpcParams {
  const agentIds = Array.isArray(raw.agentIds)
    ? raw.agentIds.filter((value): value is string => typeof value === "string")
    : undefined;
  return { agentIds };
}

async function handleMemoryHealthRequest(params: {
  mode: MemoryHealthRpcMode;
  client: GatewayClient | null;
  rawParams: Record<string, unknown>;
  respond: RespondFn;
}) {
  const parsed = parseMemoryHealthParams(params.rawParams);
  const report = await runMemoryHealthRpc({
    mode: params.mode,
    client: params.client,
    agentIds: parsed.agentIds,
  });
  params.respond(true, report, undefined);
}

export const doctorMemoryHealthHandlers: GatewayRequestHandlers = {
  "doctor.memory.health": async ({ client, params, respond }) => {
    await handleMemoryHealthRequest({
      mode: "platform",
      client: client ?? null,
      rawParams: params,
      respond,
    });
  },
  "doctor.memory.health.tenant": async ({ client, params, respond }) => {
    await handleMemoryHealthRequest({
      mode: "tenant",
      client: client ?? null,
      rawParams: params,
      respond,
    });
  },
  "doctor.memory.health.summary": async ({ client, params, respond }) => {
    await handleMemoryHealthRequest({
      mode: "summary",
      client: client ?? null,
      rawParams: params,
      respond,
    });
  },
};
