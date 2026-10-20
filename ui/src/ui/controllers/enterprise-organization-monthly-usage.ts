import type { GatewayBrowserClient } from "../gateway.ts";
import {
  indexOrganizationAgentUsage,
  indexOrganizationUserUsage,
  resolveOrganizationMonthWindow,
  type OrganizationAgentUsageSlice,
  type OrganizationMonthlyUsageLoadState,
} from "../ports/enterprise/semantic/organization-position-usage.ts";

export type OrganizationMonthlySeatUsageRow = {
  seatId: string;
  agentIds: string[];
  totalTokens: number;
  totalCost: number;
  sessionCount: number;
  lastActiveAt: number | null;
  unmatchedAgentIds: string[];
};

export type OrganizationMonthlyUserUsageRow = {
  userId: string;
} & OrganizationAgentUsageSlice;

export type EnterpriseOrganizationMonthlyUsageState = {
  client: GatewayBrowserClient | null;
  connected?: boolean;
  platformAuthState?: {
    session?: { tenantId?: string | null } | null;
    enterprise?: { id?: string | null } | null;
  } | null;
  usageTimeZone?: "local" | "utc";
  enterpriseOrganizationMonthlyUsageLoading: boolean;
  enterpriseOrganizationMonthlyUsageError: string | null;
  enterpriseOrganizationMonthlyUsage: {
    tenantId: string;
    startDate: string;
    endDate: string;
    agents: Array<{ agentId: string } & OrganizationAgentUsageSlice>;
    users: OrganizationMonthlyUserUsageRow[];
    seats: OrganizationMonthlySeatUsageRow[];
    unmatchedAgentIds: string[];
  } | null;
};

type MonthlySeatUsageRpcResult = {
  tenantId: string;
  startDate: string;
  endDate: string;
  agents: Array<{
    agentId: string;
    totalTokens: number;
    totalCost: number;
    sessionCount: number;
    lastActiveAt: number | null;
  }>;
  users?: Array<{
    userId: string;
    totalTokens: number;
    totalCost: number;
    sessionCount: number;
    lastActiveAt: number | null;
  }>;
  seats?: Array<{
    seatId: string;
    agentIds?: string[];
    totalTokens: number;
    totalCost: number;
    sessionCount: number;
    lastActiveAt: number | null;
    unmatchedAgentIds?: string[];
  }>;
  unmatchedAgentIds?: string[];
};

function resolveTenantId(state: EnterpriseOrganizationMonthlyUsageState): string | null {
  return (
    state.platformAuthState?.session?.tenantId?.trim() ??
    state.platformAuthState?.enterprise?.id?.trim() ??
    null
  );
}

function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes <= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return minutes === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}`;
}

function buildDateInterpretationParams(
  timeZone: "local" | "utc",
): { mode: "utc" } | { mode: "specific"; utcOffset: string } {
  if (timeZone === "utc") {
    return { mode: "utc" };
  }
  return {
    mode: "specific",
    utcOffset: formatUtcOffset(new Date().getTimezoneOffset()),
  };
}

export function readOrganizationMonthlyUsageLoadState(
  state: Pick<
    EnterpriseOrganizationMonthlyUsageState,
    | "enterpriseOrganizationMonthlyUsageLoading"
    | "enterpriseOrganizationMonthlyUsageError"
    | "enterpriseOrganizationMonthlyUsage"
  >,
): OrganizationMonthlyUsageLoadState {
  if (state.enterpriseOrganizationMonthlyUsageLoading) {
    return { status: "loading" };
  }
  if (state.enterpriseOrganizationMonthlyUsageError) {
    return {
      status: "error",
      message: state.enterpriseOrganizationMonthlyUsageError,
    };
  }
  const result = state.enterpriseOrganizationMonthlyUsage;
  if (!result) {
    return { status: "unloaded" };
  }
  const usageBySeat = new Map(
    result.seats.map(
      (seat) =>
        [
          seat.seatId,
          {
            totalTokens: seat.totalTokens,
            totalCost: seat.totalCost,
            sessionCount: seat.sessionCount,
            lastActiveAt: seat.lastActiveAt,
            unmatchedAgentIds: seat.unmatchedAgentIds,
          },
        ] as const,
    ),
  );
  return {
    status: "ready",
    startDate: result.startDate,
    endDate: result.endDate,
    tenantId: result.tenantId,
    usageByAgent: indexOrganizationAgentUsage(result.agents),
    usageByUser: indexOrganizationUserUsage(result.users ?? []),
    usageBySeat,
    unmatchedAgentIds: result.unmatchedAgentIds,
  };
}

/**
 * 加载组织页独立月度用量。不修改共享 usageStartDate / usageEndDate / usageResult。
 */
export async function loadEnterpriseOrganizationMonthlyUsage(
  state: EnterpriseOrganizationMonthlyUsageState,
  options: { force?: boolean; now?: Date } = {},
): Promise<void> {
  if (!state.client || state.connected === false) {
    return;
  }
  const tenantId = resolveTenantId(state);
  if (!tenantId) {
    return;
  }
  if (state.enterpriseOrganizationMonthlyUsageLoading) {
    return;
  }

  const { startDate, endDate } = resolveOrganizationMonthWindow(options.now ?? new Date());
  if (
    !options.force &&
    state.enterpriseOrganizationMonthlyUsage &&
    state.enterpriseOrganizationMonthlyUsage.tenantId === tenantId &&
    state.enterpriseOrganizationMonthlyUsage.startDate === startDate &&
    state.enterpriseOrganizationMonthlyUsage.endDate === endDate &&
    !state.enterpriseOrganizationMonthlyUsageError
  ) {
    return;
  }

  const dateInterpretation = buildDateInterpretationParams(state.usageTimeZone ?? "local");

  state.enterpriseOrganizationMonthlyUsageLoading = true;
  state.enterpriseOrganizationMonthlyUsageError = null;
  try {
    const result = await state.client.request<MonthlySeatUsageRpcResult>(
      "enterprise.organization.monthly-seat-usage",
      {
        tenantId,
        startDate,
        endDate,
        ...dateInterpretation,
      },
    );
    state.enterpriseOrganizationMonthlyUsage = {
      tenantId: result?.tenantId ?? tenantId,
      startDate: result?.startDate ?? startDate,
      endDate: result?.endDate ?? endDate,
      agents: (result?.agents ?? []).map((agent) => ({
        agentId: agent.agentId,
        totalTokens: agent.totalTokens ?? 0,
        totalCost: agent.totalCost ?? 0,
        sessionCount: agent.sessionCount ?? 0,
        lastActiveAt: agent.lastActiveAt ?? null,
      })),
      users: (result?.users ?? []).map((user) => ({
        userId: user.userId,
        totalTokens: user.totalTokens ?? 0,
        totalCost: user.totalCost ?? 0,
        sessionCount: user.sessionCount ?? 0,
        lastActiveAt: user.lastActiveAt ?? null,
      })),
      seats: (result?.seats ?? []).map((seat) => ({
        seatId: seat.seatId,
        agentIds: [...(seat.agentIds ?? [])],
        totalTokens: seat.totalTokens ?? 0,
        totalCost: seat.totalCost ?? 0,
        sessionCount: seat.sessionCount ?? 0,
        lastActiveAt: seat.lastActiveAt ?? null,
        unmatchedAgentIds: [...(seat.unmatchedAgentIds ?? [])],
      })),
      unmatchedAgentIds: [...(result?.unmatchedAgentIds ?? [])],
    };
  } catch (error) {
    state.enterpriseOrganizationMonthlyUsageError =
      error instanceof Error ? error.message : String(error);
    // 保留上次成功结果供诊断，但不把错误伪装成 0。
  } finally {
    state.enterpriseOrganizationMonthlyUsageLoading = false;
  }
}

export const __test = {
  formatUtcOffset,
  buildDateInterpretationParams,
  resolveOrganizationMonthWindow,
};
