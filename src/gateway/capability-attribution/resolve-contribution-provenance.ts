import type {
  EnterprisePositionSeat,
  EnterpriseSeatAssetsStore,
  EnterpriseSeatBinding,
} from "../enterprise-seat-assets-store.js";
import { findUserByEmail, type PlatformAuthUser } from "../platform-auth.js";
import { listAgentsForGateway } from "../session-utils.js";

export const PLATFORM_IMPORT_SOURCE_IDS: ReadonlySet<string> = new Set([
  "preset-catalog",
  "local-upload",
  "local-zip",
  "github-url",
  "github-topic",
  "github",
  "npm",
  "remote",
  "unknown",
  "employee-capability",
  "platform",
  "openclaw-managed",
  "openclaw-bundled",
  "openclaw-workspace",
  "openclaw-extra",
  "skill-catalog",
]);

export const PLATFORM_IMPORT_SOURCE_LABELS: Record<string, string> = {
  "preset-catalog": "平台导入 · 预置目录",
  "local-upload": "平台导入 · 本地上传",
  "local-zip": "平台导入 · 本地压缩包",
  "github-url": "平台导入 · GitHub",
  "github-topic": "平台导入 · GitHub",
  github: "平台导入 · GitHub",
  npm: "平台导入 · npm",
  remote: "平台导入 · 远程源",
  unknown: "平台导入",
  "employee-capability": "平台导入",
  platform: "平台导入",
  "openclaw-managed": "平台导入",
  "openclaw-bundled": "平台导入",
  "openclaw-workspace": "平台导入",
  "openclaw-extra": "平台导入",
  "skill-catalog": "平台导入",
};

export const PLATFORM_IMPORT_DEPARTMENT = "平台导入";

/** Seat team label, or this literal. Never the viewing tenant's display name. */
export const UNASSIGNED_DEPARTMENT = "未分配";

export type AttributionScope = {
  cfg: import("../../config/config.js").OpenBotConfig;
  platformStore: import("../platform-auth.js").PlatformAuthStore | null;
  tenantId: string | null;
  tenantName: string | null;
  employeeCount: number;
};

export type AttributionBinding = {
  runtimeAgentId: string;
};

export type AttributionRuntimeAgent = {
  runtimeAgentId: string;
  name: string;
};

export type ContributionProvenance = {
  employeeId: string;
  employeeName: string;
  department: string;
  sourceRobotName: string;
  isEmployee: boolean;
};

export type ContributionAttributionContext = {
  scope: AttributionScope;
  seatStore: EnterpriseSeatAssetsStore | null;
  agents: AttributionRuntimeAgent[];
};

export function departmentForEmployee(
  ctx: ContributionAttributionContext,
  userId: string,
): string | null {
  if (!ctx.seatStore || !ctx.scope.tenantId) {
    return null;
  }
  const seat = Object.values(ctx.seatStore.seats).find(
    (entry) => entry.tenantId === ctx.scope.tenantId && entry.currentEmployeeId === userId,
  );
  return seat?.teamLabel?.trim() || null;
}

function userBelongsToTenant(ctx: ContributionAttributionContext, userId: string): boolean {
  const store = ctx.scope.platformStore;
  const tenantId = ctx.scope.tenantId?.trim();
  if (!store || !tenantId || !userId) {
    return false;
  }
  return Object.values(store.memberships).some(
    (membership) => membership.userId === userId && membership.enterpriseId === tenantId,
  );
}

type ResolvedContributor = {
  employeeId: string;
  employeeName: string;
  department: string;
  isEmployee: boolean;
};

export function resolveContributor(
  ctx: ContributionAttributionContext,
  submittedBy: string | undefined,
): ResolvedContributor {
  const raw = submittedBy?.trim() ?? "";
  const store = ctx.scope.platformStore;
  if (store && raw) {
    const user =
      store.users[raw] ?? (raw.includes("@") ? (findUserByEmail(store, raw) ?? null) : null);
    if (user) {
      if (!userBelongsToTenant(ctx, user.id)) {
        return {
          employeeId: raw,
          employeeName: user.displayName?.trim() || user.email || user.id,
          department: UNASSIGNED_DEPARTMENT,
          isEmployee: false,
        };
      }
      return {
        employeeId: raw,
        employeeName: user.displayName?.trim() || user.email || user.id,
        department: departmentForEmployee(ctx, user.id) ?? UNASSIGNED_DEPARTMENT,
        isEmployee: true,
      };
    }
  }
  const key = raw.toLowerCase();
  if (PLATFORM_IMPORT_SOURCE_IDS.has(key)) {
    return {
      employeeId: raw,
      employeeName: PLATFORM_IMPORT_SOURCE_LABELS[key] ?? "平台导入",
      department: PLATFORM_IMPORT_DEPARTMENT,
      isEmployee: false,
    };
  }
  return {
    employeeId: raw || "unknown",
    employeeName: raw || "未具名贡献者",
    department: UNASSIGNED_DEPARTMENT,
    isEmployee: true,
  };
}

export function soleEnterpriseEmployee(
  ctx: ContributionAttributionContext,
): PlatformAuthUser | null {
  const store = ctx.scope.platformStore;
  if (!store || !ctx.scope.tenantId) {
    return null;
  }
  const userIds = [
    ...new Set(
      Object.values(store.memberships)
        .filter((membership) => membership.enterpriseId === ctx.scope.tenantId)
        .map((membership) => membership.userId),
    ),
  ];
  if (userIds.length !== 1) {
    return null;
  }
  return store.users[userIds[0]] ?? null;
}

export function enterpriseRobotNames(ctx: ContributionAttributionContext): string[] {
  const configured = (ctx.scope.cfg.agents?.list ?? [])
    .map((agent) => agent.identity?.name?.trim() || agent.name?.trim() || agent.id?.trim() || "")
    .filter((name) => name.length > 0);
  if (configured.length > 0) {
    return configured;
  }
  return ctx.agents
    .map((agent) => agent.name?.trim() || agent.runtimeAgentId)
    .filter((name) => name.length > 0);
}

export function pickDeterministic<T>(list: readonly T[], key: string): T | null {
  if (list.length === 0) {
    return null;
  }
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return list[hash % list.length];
}

export function findSeatForAgent(
  ctx: ContributionAttributionContext,
  runtimeAgentId: string,
): {
  seat: EnterprisePositionSeat;
  binding: EnterpriseSeatBinding | null;
  user: PlatformAuthUser | null;
} | null {
  if (!ctx.seatStore || !ctx.scope.tenantId) {
    return null;
  }
  const seat =
    Object.values(ctx.seatStore.seats).find(
      (entry) =>
        entry.tenantId === ctx.scope.tenantId &&
        entry.defaultAgentAssetIds.includes(runtimeAgentId),
    ) ?? null;
  if (!seat) {
    return null;
  }
  const binding =
    Object.values(ctx.seatStore.bindings).find(
      (entry) =>
        entry.tenantId === ctx.scope.tenantId &&
        entry.seatId === seat.seatId &&
        entry.bindingStatus === "active",
    ) ?? null;
  const user =
    binding && ctx.scope.platformStore
      ? (ctx.scope.platformStore.users[binding.employeeId] ?? null)
      : null;
  return { seat, binding, user };
}

export function resolveDisplayRobotNameForSeat(params: {
  ctx: ContributionAttributionContext;
  runtimeRobotName: string;
  seat: EnterprisePositionSeat | null;
}): string {
  if (!params.seat) {
    return params.runtimeRobotName;
  }
  const cfgAgents = listAgentsForGateway(params.ctx.scope.cfg).agents;
  const candidate = (params.seat.defaultAgentAssetIds ?? [])
    .map((agentId) => cfgAgents.find((entry) => entry.id === agentId) ?? null)
    .find((entry) => Boolean(entry?.identity?.name?.trim() || entry?.name?.trim()));
  return candidate?.identity?.name?.trim() || candidate?.name?.trim() || params.runtimeRobotName;
}

export function resolveContributionProvenance(params: {
  ctx: ContributionAttributionContext;
  submittedBy: string | undefined;
  proposalStableKey: string;
  bindings: AttributionBinding[];
  /**
   * Proposal's own enterprise id. Sole-employee reassignment runs only when this
   * equals the viewing tenant. Missing or foreign ids stay platform/non-employee.
   */
  proposalEnterpriseId?: string | null;
}): ContributionProvenance {
  const agentById = new Map(
    params.ctx.agents.map((agent) => [agent.runtimeAgentId, agent] as const),
  );
  let fallbackRobotName: string | null = null;
  for (const binding of params.bindings) {
    const agent = agentById.get(binding.runtimeAgentId);
    const runtimeRobotName = agent?.name ?? binding.runtimeAgentId;
    const seatInfo = findSeatForAgent(params.ctx, binding.runtimeAgentId);
    const robotName = resolveDisplayRobotNameForSeat({
      ctx: params.ctx,
      runtimeRobotName,
      seat: seatInfo?.seat ?? null,
    });
    if (fallbackRobotName === null && seatInfo?.seat) {
      fallbackRobotName = robotName;
    }
    if (seatInfo?.user) {
      return {
        employeeId: seatInfo.user.email || seatInfo.user.id,
        employeeName: seatInfo.user.displayName?.trim() || seatInfo.user.email || seatInfo.user.id,
        department: seatInfo.seat.teamLabel?.trim() || UNASSIGNED_DEPARTMENT,
        sourceRobotName: robotName,
        isEmployee: true,
      };
    }
  }

  const fallback = resolveContributor(params.ctx, params.submittedBy);
  if (fallback.isEmployee) {
    return {
      employeeId: fallback.employeeId,
      employeeName: fallback.employeeName,
      department: fallback.department,
      sourceRobotName: fallbackRobotName ?? "员工工作台",
      isEmployee: true,
    };
  }

  const proposalTenant = params.proposalEnterpriseId?.trim() || "";
  const scopeTenant = params.ctx.scope.tenantId?.trim() || "";
  const sole =
    proposalTenant && scopeTenant && proposalTenant === scopeTenant
      ? soleEnterpriseEmployee(params.ctx)
      : null;
  if (sole) {
    const robotName =
      fallbackRobotName ??
      pickDeterministic(enterpriseRobotNames(params.ctx), params.proposalStableKey) ??
      "员工工作台";
    return {
      employeeId: sole.email || sole.id,
      employeeName: sole.displayName?.trim() || sole.email || sole.id,
      department: departmentForEmployee(params.ctx, sole.id) ?? UNASSIGNED_DEPARTMENT,
      sourceRobotName: robotName,
      isEmployee: true,
    };
  }

  return {
    employeeId: fallback.employeeId,
    employeeName: fallback.employeeName,
    department: fallback.department,
    sourceRobotName: PLATFORM_IMPORT_DEPARTMENT,
    isEmployee: false,
  };
}
