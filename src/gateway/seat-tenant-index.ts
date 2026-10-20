/**
 * seat id → owning tenant, for agents whose config entry records SEAT ownership
 * (`ownerType: "position"`, `ownerId` = a seat id) rather than user ownership.
 *
 * Why this exists: `resolveAgentTenant` only understood `ownerId` as a platform
 * user id (ownerId → membership → enterpriseId). Production, however, owns most
 * agents through seats: of 25 configured agents, 20 carry `ownerType: "position"`
 * with a seat id in `ownerId`. For those, membership lookup finds nothing, so
 * `resolveAgentOwnershipTenants` came back empty and every tenant-scoped operator
 * action on them was refused with "agent has no tenant ownership proof"
 * (observed continuously on `pattern-detection.ingest-sample`).
 *
 * A seat record already carries its own `tenantId`, so the mapping is a lookup —
 * the only difficulty is that seats live in two layouts: the process-global
 * seat-assets store (legacy / pre-MULTITENANT tenants) and, when shared tenant
 * addressing is on, one store per tenant. This module indexes both, lazily, and
 * caches the result because the callers sit on an authorization path.
 */

import { loadConfig } from "../config/config.js";
import { isSharedTenantAddressingEnabled } from "../config/data-space.js";
import { listTenantIdsFromVolume } from "../conversations/managed-planes.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { loadEnterpriseSeatAssetsStore } from "./enterprise-seat-assets-store.js";
import { loadSeatAssetsStoreForTenantId } from "./platform-auth/seat-store-loader.js";
import { canonicalizeTenantId } from "./tenant-canonicalization.js";

const log = createSubsystemLogger("seat-tenant-index");

/** Rebuild at most this often; a miss may rebuild once to pick up a new seat. */
const INDEX_TTL_MS = 60_000;

type SeatTenantIndex = {
  bySeatId: Map<string, string>;
  builtAtMs: number;
};

let cached: SeatTenantIndex | null = null;
let inFlight: Promise<SeatTenantIndex> | null = null;

function indexSeats(
  target: Map<string, string>,
  seats: Record<string, { seatId?: string; tenantId?: string }> | undefined,
): void {
  for (const [key, seat] of Object.entries(seats ?? {})) {
    const seatId = (seat?.seatId ?? key).trim();
    const tenantId = canonicalizeTenantId(seat?.tenantId) ?? seat?.tenantId?.trim();
    if (!seatId || !tenantId) {
      continue;
    }
    // First writer wins: a seat id is owned by exactly one tenant. A duplicate
    // across stores means the data is inconsistent; keep the first and warn
    // rather than silently reassigning ownership.
    const existing = target.get(seatId);
    if (existing && existing !== tenantId) {
      log.warn(
        `seat ${seatId} appears under two tenants (${existing}, ${tenantId}); keeping ${existing}`,
      );
      continue;
    }
    target.set(seatId, tenantId);
  }
}

async function buildIndex(): Promise<SeatTenantIndex> {
  const bySeatId = new Map<string, string>();

  // 1. Process-global store. Tenants that predate shared addressing (including
  //    the current production tenant) keep all their seats here.
  try {
    const global = await loadEnterpriseSeatAssetsStore();
    indexSeats(bySeatId, global.seats);
  } catch (err) {
    log.warn(`global seat-assets store unreadable: ${String(err)}`);
  }

  // 2. Per-tenant stores, when shared tenant addressing is on.
  const cfg = (() => {
    try {
      return loadConfig();
    } catch {
      return undefined;
    }
  })();
  if (cfg && isSharedTenantAddressingEnabled(cfg)) {
    for (const tenantId of listTenantIdsFromVolume()) {
      try {
        const store = await loadSeatAssetsStoreForTenantId(tenantId, cfg);
        indexSeats(bySeatId, store.seats);
      } catch {
        // A tenant without a seat-assets store is normal; skip it.
      }
    }
  }

  return { bySeatId, builtAtMs: Date.now() };
}

async function getIndex(forceRebuild: boolean): Promise<SeatTenantIndex> {
  const fresh = cached && Date.now() - cached.builtAtMs < INDEX_TTL_MS;
  if (cached && fresh && !forceRebuild) {
    return cached;
  }
  // Collapse concurrent rebuilds: this runs on an authorization path.
  if (!inFlight) {
    inFlight = buildIndex()
      .then((index) => {
        cached = index;
        return index;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return await inFlight;
}

/**
 * Owning tenant for a seat id, or `null` when the seat is unknown.
 *
 * Fail-closed: an unreadable store yields `null` (no ownership proof), never a
 * guess. A miss against a warm index triggers exactly one rebuild, so a seat
 * created moments ago is still resolvable without waiting out the TTL.
 */
export async function resolveTenantForSeatId(
  seatId: string | null | undefined,
): Promise<string | null> {
  const trimmed = seatId?.trim();
  if (!trimmed) {
    return null;
  }
  const index = await getIndex(false);
  const hit = index.bySeatId.get(trimmed);
  if (hit) {
    return hit;
  }
  // Unknown seat: the index may simply be stale.
  const rebuilt = await getIndex(true);
  return rebuilt.bySeatId.get(trimmed) ?? null;
}

export function resetSeatTenantIndexForTest(): void {
  cached = null;
  inFlight = null;
}
