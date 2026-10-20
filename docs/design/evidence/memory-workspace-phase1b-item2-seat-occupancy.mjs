#!/usr/bin/env node
/**
 * Phase 1B item 2: measure seat occupancy from the production dump.
 * Occupancy is not a user-owned agent resourceId and does not cover item 2/5.
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(import.meta.filename);
const PRODUCTION_DUMP = path.join(DIR, "memory-workspace-phase1b-production-authority-dump.json");
const SNAPSHOT = path.join(DIR, "memory-workspace-phase1b-item2-seat-occupancy.json");

const FORBIDDEN = [
  "invent resourceId from membership alone",
  "treat occupancy mint as item 2 met",
  "treat occupancy mint as item 5 met",
  "treat occupancy dump as item 2 met",
  "treat occupancy dump as item 5 met",
  "wiredToProductionResolver=true",
];

export function measureSeatOccupancy(dump) {
  const occupancies = Array.isArray(dump?.seatOccupancies) ? dump.seatOccupancies : [];
  const assets = Array.isArray(dump?.agentAssets) ? dump.agentAssets : [];

  const userToSeats = new Map();
  let registryBoundOccupancies = 0;
  for (const row of occupancies) {
    const userId = typeof row?.userId === "string" ? row.userId.trim() : "";
    const seatId = typeof row?.seatId === "string" ? row.seatId.trim() : "";
    const enterpriseId = typeof row?.enterpriseId === "string" ? row.enterpriseId.trim() : "";
    if (!userId || !seatId || !enterpriseId) {
      continue;
    }
    const userKey = `${enterpriseId}:${userId}`;
    const seats = userToSeats.get(userKey) ?? new Set();
    seats.add(`${enterpriseId}:${seatId}`);
    userToSeats.set(userKey, seats);
    if (row.registrySeatBound === true) {
      registryBoundOccupancies += 1;
    }
  }

  const uniqueUserToSeat = [...userToSeats.values()].filter((seats) => seats.size === 1).length;
  const multiUserToSeat = [...userToSeats.values()].filter((seats) => seats.size > 1).length;

  const seatToUsers = new Map();
  for (const row of occupancies) {
    const userId = typeof row?.userId === "string" ? row.userId.trim() : "";
    const seatId = typeof row?.seatId === "string" ? row.seatId.trim() : "";
    const enterpriseId = typeof row?.enterpriseId === "string" ? row.enterpriseId.trim() : "";
    if (!userId || !seatId || !enterpriseId || row?.registrySeatBound === false) {
      continue;
    }
    const seatKey = `${enterpriseId}:${seatId}`;
    const users = seatToUsers.get(seatKey) ?? new Set();
    users.add(`${enterpriseId}:${userId}`);
    seatToUsers.set(seatKey, users);
  }

  const seatToAssets = new Map();
  for (const asset of assets) {
    if (asset?.ownerType !== "seat") {
      continue;
    }
    if (asset.status && asset.status !== "active") {
      continue;
    }
    const ownerId = typeof asset?.ownerId === "string" ? asset.ownerId.trim() : "";
    const enterpriseId = typeof asset?.enterpriseId === "string" ? asset.enterpriseId.trim() : "";
    const agentAssetId = typeof asset?.agentAssetId === "string" ? asset.agentAssetId.trim() : "";
    if (!ownerId || !enterpriseId || !agentAssetId) {
      continue;
    }
    const seatKey = `${enterpriseId}:${ownerId}`;
    const ids = seatToAssets.get(seatKey) ?? new Set();
    ids.add(agentAssetId);
    seatToAssets.set(seatKey, ids);
  }

  const uniqueSeatToAsset = [...seatToAssets.values()].filter((ids) => ids.size === 1).length;
  const multiSeatToAsset = [...seatToAssets.values()].filter((ids) => ids.size > 1).length;

  let uniqueUserOwnedEquivalent = 0;
  let occupancyMintableAssetCount = 0;
  for (const seats of userToSeats.values()) {
    if (seats.size !== 1) {
      continue;
    }
    const seatKey = [...seats][0];
    if ((seatToUsers.get(seatKey)?.size ?? 0) !== 1) {
      continue;
    }
    const assetsForSeat = seatToAssets.get(seatKey);
    if (!assetsForSeat || assetsForSeat.size === 0) {
      continue;
    }
    occupancyMintableAssetCount += assetsForSeat.size;
    if (assetsForSeat.size === 1) {
      uniqueUserOwnedEquivalent += 1;
    }
  }

  let reason = "seat_occupancy_missing";
  if (occupancies.length > 0 && uniqueUserOwnedEquivalent > 0) {
    reason = "seat_occupancy_unique_equivalent_not_minted";
  } else if (occupancies.length > 0 && occupancyMintableAssetCount > 0) {
    reason = "seat_occupancy_mintable_without_unique_user_owned_asset";
  } else if (occupancies.length > 0) {
    reason = "seat_occupancy_present_without_unique_user_owned_asset";
  }

  return {
    schema: "memory-workspace-phase1b-item2-seat-occupancy/v1",
    item: 2,
    live: false,
    catalogWrite: false,
    hostCatalogWrite: false,
    mintedUserOwnedAgentAsset: false,
    canMintUserOwnedAgentAsset: occupancyMintableAssetCount > 0,
    occupancyPresent: occupancies.length > 0,
    occupancyCount: occupancies.length,
    occupancyUsers: userToSeats.size,
    uniqueUserToSeat,
    multiUserToSeat,
    registryBoundOccupancies,
    uniqueSeatToAsset,
    multiSeatToAsset,
    uniqueUserOwnedEquivalent,
    occupancyMintableAssetCount,
    reason,
    item2: "not-met",
    item5: "not-met",
    wiredToProductionResolver: false,
    unlock: "not-issued",
    phase1bExecutionBlocked: true,
    deployAuthorized: false,
    explicitlyForbidden: FORBIDDEN,
  };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const dump = JSON.parse(fs.readFileSync(PRODUCTION_DUMP, "utf8"));
  const measured = measureSeatOccupancy(dump);
  fs.writeFileSync(SNAPSHOT, `${JSON.stringify(measured, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(measured, null, 2)}\n`);
}
