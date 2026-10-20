import { loadConfig } from "../../config/config.js";
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import {
  assembleMonthlySeatUsageResult,
  collectUniqueSeatAgentIds,
  loadUsageByAgentIds,
  normalizeSeatAgentId,
  type SeatUsageBinding,
} from "../../organization/monthly-seat-usage.js";
import { requireResolvedEnterpriseTenantId } from "../enterprise-data/enterprise-data-seat-context.js";
import { listTenantSeats } from "../enterprise-seat-assets-store.js";
import { resolvePlatformAuthConfig } from "../platform-auth/config.js";
import { loadSeatAssetsStoreForTenantId } from "../platform-auth/seat-store-loader.js";
import { loadStore as loadPlatformAuthStore } from "../platform-auth/store.js";
import { listTenantAgentSessionsDirs } from "../tenant-store-paths.js";
import { respondInvalid, respondUnavailable, stringValue } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";
import { __test as usageDateTest } from "./usage.js";

function collectSeatAgentIds(params: {
  seatId: string;
  tenantId: string;
  defaultAgentAssetIds: readonly string[];
  assetBindings: Record<
    string,
    {
      tenantId: string;
      seatId: string;
      assetType: string;
      assetId: string;
      status: string;
    }
  >;
}): string[] {
  const ids: string[] = [...params.defaultAgentAssetIds];
  for (const binding of Object.values(params.assetBindings ?? {})) {
    if (
      binding.tenantId === params.tenantId &&
      binding.seatId === params.seatId &&
      binding.status === "active" &&
      binding.assetType === "agent"
    ) {
      const assetId = binding.assetId?.trim();
      if (assetId) {
        ids.push(assetId);
      }
    }
  }
  return collectUniqueSeatAgentIds({ agentIds: ids, defaultAgentId: ids[0] ?? null });
}

async function resolveMemberEmailsByUserId(tenantId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig) {
    return map;
  }
  try {
    const store = await loadPlatformAuthStore(authConfig);
    for (const membership of Object.values(store.memberships ?? {})) {
      if (membership.enterpriseId !== tenantId) {
        continue;
      }
      const user = store.users?.[membership.userId];
      const email = user?.email?.trim() || user?.normalizedEmail?.trim();
      if (email) {
        map.set(membership.userId, email);
      }
    }
    for (const [userId, user] of Object.entries(store.users ?? {})) {
      if (map.has(userId)) {
        continue;
      }
      const email = user?.email?.trim() || user?.normalizedEmail?.trim();
      if (email) {
        map.set(userId, email);
      }
    }
  } catch {
    // Auth store unavailable — fall back to raw currentEmployeeId.
  }
  return map;
}

export const enterpriseOrganizationMonthlyUsageHandlers: GatewayRequestHandlers = {
  "enterprise.organization.monthly-seat-usage": async ({ client, params, respond }) => {
    const tenantId = await requireResolvedEnterpriseTenantId({ client, params, respond });
    if (!tenantId) {
      return;
    }
    const startDate = stringValue(params?.startDate);
    const endDate = stringValue(params?.endDate);
    if (!startDate || !endDate) {
      respondInvalid(respond, "startDate and endDate are required (YYYY-MM-DD)");
      return;
    }

    try {
      const { startMs, endMs } = usageDateTest.parseDateRange({
        startDate,
        endDate,
        mode: params?.mode,
        utcOffset: params?.utcOffset,
      });

      const seatStore = await loadSeatAssetsStoreForTenantId(tenantId);
      const tenantSeats = listTenantSeats(seatStore, tenantId);
      const memberEmails = await resolveMemberEmailsByUserId(tenantId);
      const seatBindings: SeatUsageBinding[] = tenantSeats.map((seat) => {
        const agentIds = collectSeatAgentIds({
          seatId: seat.seatId,
          tenantId,
          defaultAgentAssetIds: seat.defaultAgentAssetIds ?? [],
          assetBindings: seatStore.assetBindings ?? {},
        });
        const employeeId = seat.currentEmployeeId?.trim() || null;
        const memberEmail = employeeId ? (memberEmails.get(employeeId) ?? null) : null;
        // UI looks up usageByUser via seat.currentEmployeeUser (email). Prefer email;
        // keep raw id as fallback so either key can match.
        const memberUserId = memberEmail ?? employeeId;
        return {
          seatId: seat.seatId,
          agentIds,
          defaultAgentId: agentIds[0] ?? null,
          memberUserId,
        };
      });

      const allAgentIds = [
        ...new Set(seatBindings.flatMap((seat) => collectUniqueSeatAgentIds(seat))),
      ].filter((agentId) => Boolean(normalizeSeatAgentId(agentId)));
      const cfg = loadConfig();

      const resolveSessionsDirs = isSharedTenantAddressingEnabled(cfg)
        ? (agentId: string) => listTenantAgentSessionsDirs({ tenantId, agentId })
        : undefined;

      const loaded = await loadUsageByAgentIds({
        agentIds: allAgentIds,
        startMs,
        endMs,
        resolveSessionsDirs,
      });

      const assembled = assembleMonthlySeatUsageResult({
        tenantId,
        startDate,
        endDate,
        seats: seatBindings,
        usageByAgent: loaded.usageByAgent,
        discoverableAgentIds: loaded.discoverableAgentIds,
        agents: loaded.agents,
      });

      // Also index users by employee UUID when email was used as the primary key,
      // so older clients that look up currentEmployeeId still resolve.
      const users = [...assembled.users];
      const seenUserKeys = new Set(users.map((row) => row.userId.trim().toLowerCase()));
      for (const seat of tenantSeats) {
        const employeeId = seat.currentEmployeeId?.trim();
        if (!employeeId) {
          continue;
        }
        const email = memberEmails.get(employeeId);
        if (!email) {
          continue;
        }
        const emailKey = email.trim().toLowerCase();
        const idKey = employeeId.toLowerCase();
        if (seenUserKeys.has(idKey)) {
          continue;
        }
        const emailRow = users.find((row) => row.userId.trim().toLowerCase() === emailKey);
        if (!emailRow) {
          continue;
        }
        users.push({ ...emailRow, userId: employeeId });
        seenUserKeys.add(idKey);
      }

      respond(
        true,
        {
          ...assembled,
          users,
        },
        undefined,
      );
    } catch (error) {
      respondUnavailable(respond, error);
    }
  },
};
