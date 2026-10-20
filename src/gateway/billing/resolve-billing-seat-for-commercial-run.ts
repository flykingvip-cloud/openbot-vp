/**
 * 为商业闸口解析计费席位（billing Seat）。
 */

import { loadEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { resolveAgentRunEntitlementScope } from "../model-entitlement/resolve-agent-run-scope.js";
import { resolveBillingSeatForEmployee } from "../model-entitlement/resolve-billing-seat-for-employee.js";
import { findActiveBotById } from "./bot-resources-store.js";
import { findBillingSeatByUserId, listSeats, resolveSeatStatus } from "./seats-store.js";
import type { Seat } from "./types.js";

export type ResolveBillingSeatInput = {
  enterpriseId: string;
  billingSeatId?: string;
  userId?: string;
  botId?: string;
  agentId?: string;
  storePaths?: {
    seats?: string;
    botResources?: string;
    seatAssets?: string;
  };
};

function pickActiveSeat(seats: Seat[], seatId: string): Seat | null {
  const seat = seats.find((row) => row.id === seatId);
  if (!seat || resolveSeatStatus(seat) !== "active") {
    return null;
  }
  return seat;
}

export async function resolveBillingSeatForCommercialRun(
  input: ResolveBillingSeatInput,
): Promise<Seat | null> {
  const billingSeatId = input.billingSeatId?.trim();
  if (billingSeatId) {
    const seats = await listSeats(input.enterpriseId, input.storePaths?.seats);
    return pickActiveSeat(seats, billingSeatId);
  }
  const userId = input.userId?.trim();
  if (userId) {
    return findBillingSeatByUserId(input.enterpriseId, userId, input.storePaths?.seats);
  }
  const botId = input.botId?.trim();
  if (botId) {
    const bot = await findActiveBotById(input.enterpriseId, botId, input.storePaths?.botResources);
    if (!bot) {
      return null;
    }
    if (bot.ownerSeatId?.trim()) {
      const seats = await listSeats(input.enterpriseId, input.storePaths?.seats);
      return pickActiveSeat(seats, bot.ownerSeatId);
    }
    return findBillingSeatByUserId(input.enterpriseId, bot.ownerUserId, input.storePaths?.seats);
  }
  const agentId = input.agentId?.trim();
  if (agentId) {
    const seatAssetsStore = await loadEnterpriseSeatAssetsStore(input.storePaths?.seatAssets);
    const scope = await resolveAgentRunEntitlementScope({
      agentId,
      store: seatAssetsStore,
      tenantId: input.enterpriseId,
    }).catch(() => null);
    if (scope?.employeeId?.trim()) {
      return resolveBillingSeatForEmployee({
        tenantId: input.enterpriseId,
        platformUserId: scope.employeeId,
        billingSeatsStorePath: input.storePaths?.seats,
      });
    }
  }
  return null;
}
