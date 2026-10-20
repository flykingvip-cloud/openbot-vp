#!/usr/bin/env node
/**
 * Phase 1B item 2 Stage A authority extract (offline, read-only).
 *
 * Builds a governed candidate from a local authority dump. It does not read
 * Phase 0 inventory, does not touch LIVE, and does not write Catalog.
 *
 * Dump shape:
 * {
 *   memberships: [{ userId, enterpriseId }],
 *   agentAssets: [{ agentAssetId, enterpriseId, ownerType, ownerId, status }],
 *   groups: [{ groupId, enterpriseId }]
 * }
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(import.meta.filename);
const DEFAULT_OUTPUT = path.join(DIR, "memory-workspace-phase1b-authority-candidate.json");
const PHASE0_CANDIDATE = path.join(DIR, "memory-workspace-phase0-20260814.catalog-candidate.json");

export function buildAuthorityResourceId(row) {
  if (row.workspaceKind === "group_shared") {
    return `ws:${row.tenantId}:group:${row.groupId}`;
  }
  if (row.workspaceKind === "employee_private") {
    if (!row.tenantId || !row.userId) {
      throw new Error("employee_private steward resourceId requires tenantId and userId");
    }
    return `ws:${row.tenantId}:user:${row.userId}:steward`;
  }
  if (row.workspaceKind === "agent_primary" && row.ownerType === "seat") {
    return `ws:${row.tenantId}:seat:${row.seatId}:asset:${row.agentAssetId}`;
  }
  if (row.workspaceKind === "agent_primary") {
    return `ws:${row.tenantId}:user:${row.userId}:asset:${row.agentAssetId}`;
  }
  throw new Error("unsupported workspaceKind for classified resourceId");
}

function isInventoryShaped(dump) {
  return (
    dump &&
    typeof dump === "object" &&
    (dump.schema === "memory-workspace-phase0-catalog-candidate/v2" ||
      (Array.isArray(dump.candidates) &&
        dump.candidates.some((row) => row && (row.pathPattern || row.candidateId))))
  );
}

function reject(rejected, reason, extra = {}) {
  rejected.push({ reason, ...extra });
}

export function extractAuthorityCandidate(dump, options = {}) {
  const rejected = [];
  const candidates = [];

  if (dump == null) {
    return {
      schema: "memory-workspace-phase1b-authority-candidate/v1",
      source: "none",
      live: false,
      writable: false,
      catalogWrite: false,
      candidateCount: 0,
      candidates,
      rejected,
      note: "No local authority dump. Do not copy Phase 0 inventory.",
    };
  }

  if (isInventoryShaped(dump)) {
    reject(rejected, "phase0_inventory_is_not_authority");
    return {
      schema: "memory-workspace-phase1b-authority-candidate/v1",
      source: "rejected-inventory",
      live: false,
      writable: false,
      catalogWrite: false,
      candidateCount: 0,
      candidates,
      rejected,
      note: "Phase 0 inventory was refused as an authority source.",
    };
  }

  const memberships = Array.isArray(dump.memberships) ? dump.memberships : [];
  const assets = Array.isArray(dump.agentAssets) ? dump.agentAssets : [];
  const groups = Array.isArray(dump.groups) ? dump.groups : [];
  const occupancies = Array.isArray(dump.seatOccupancies) ? dump.seatOccupancies : [];
  const membershipKeys = new Set(
    memberships
      .filter((row) => row?.userId && row?.enterpriseId)
      .map((row) => `${row.enterpriseId}:${row.userId}`),
  );

  for (const asset of assets) {
    const agentAssetId = typeof asset?.agentAssetId === "string" ? asset.agentAssetId.trim() : "";
    const tenantId = typeof asset?.enterpriseId === "string" ? asset.enterpriseId.trim() : "";
    const ownerType = asset?.ownerType;
    const ownerId = typeof asset?.ownerId === "string" ? asset.ownerId.trim() : "";
    if (!agentAssetId && asset?.agentId) {
      reject(rejected, "agentId_is_not_agentAssetId", {
        agentId: asset.agentId,
        tenantId,
      });
      continue;
    }
    if (!agentAssetId || !tenantId || !ownerId) {
      reject(rejected, "incomplete_agent_asset", { agentAssetId, tenantId, ownerType });
      continue;
    }
    if (asset.status && asset.status !== "active") {
      reject(rejected, "inactive_agent_asset", { agentAssetId, tenantId, status: asset.status });
      continue;
    }
    if (ownerType === "membership") {
      if (!membershipKeys.has(`${tenantId}:${ownerId}`)) {
        reject(rejected, "membership_missing", { agentAssetId, tenantId, userId: ownerId });
        continue;
      }
      const row = {
        workspaceKind: "agent_primary",
        classification: "classified",
        tenantId,
        userId: ownerId,
        ownerType: "membership",
        agentAssetId,
        proof: "agent-registry owner binding + platform-auth membership",
      };
      candidates.push({
        resourceId: buildAuthorityResourceId(row),
        ...row,
      });
      continue;
    }
    if (ownerType === "seat") {
      const row = {
        workspaceKind: "agent_primary",
        classification: "classified",
        tenantId,
        seatId: ownerId,
        ownerType: "seat",
        agentAssetId,
        proof: "agent-registry seat binding",
      };
      candidates.push({
        resourceId: buildAuthorityResourceId(row),
        ...row,
      });
      continue;
    }
    reject(rejected, "unknown_owner_type", { agentAssetId, tenantId, ownerType });
  }

  const occupancyUsersBySeat = new Map();
  const occupancySeatsByUser = new Map();
  for (const row of occupancies) {
    const userId = typeof row?.userId === "string" ? row.userId.trim() : "";
    const seatId = typeof row?.seatId === "string" ? row.seatId.trim() : "";
    const tenantId = typeof row?.enterpriseId === "string" ? row.enterpriseId.trim() : "";
    if (!userId || !seatId || !tenantId || row?.registrySeatBound === false) {
      continue;
    }
    if (!membershipKeys.has(`${tenantId}:${userId}`)) {
      continue;
    }
    const seatKey = `${tenantId}:${seatId}`;
    const userKey = `${tenantId}:${userId}`;
    const users = occupancyUsersBySeat.get(seatKey) ?? new Set();
    users.add(userId);
    occupancyUsersBySeat.set(seatKey, users);
    const seats = occupancySeatsByUser.get(userKey) ?? new Set();
    seats.add(seatKey);
    occupancySeatsByUser.set(userKey, seats);
  }
  for (const asset of assets) {
    if (asset?.ownerType !== "seat" || (asset.status && asset.status !== "active")) {
      continue;
    }
    const agentAssetId = typeof asset?.agentAssetId === "string" ? asset.agentAssetId.trim() : "";
    const tenantId = typeof asset?.enterpriseId === "string" ? asset.enterpriseId.trim() : "";
    const seatId = typeof asset?.ownerId === "string" ? asset.ownerId.trim() : "";
    if (!agentAssetId || !tenantId || !seatId) {
      continue;
    }
    const seatKey = `${tenantId}:${seatId}`;
    const users = occupancyUsersBySeat.get(seatKey);
    if (!users || users.size !== 1) {
      continue;
    }
    const userId = [...users][0];
    const userSeats = occupancySeatsByUser.get(`${tenantId}:${userId}`);
    if (!userSeats || userSeats.size !== 1) {
      continue;
    }
    const row = {
      workspaceKind: "agent_primary",
      classification: "classified",
      tenantId,
      userId,
      ownerType: "occupancy",
      agentAssetId,
      proof: "seat occupancy + agent-registry seat binding",
    };
    candidates.push({
      resourceId: buildAuthorityResourceId(row),
      ...row,
    });
  }

  for (const group of groups) {
    const groupId = typeof group?.groupId === "string" ? group.groupId.trim() : "";
    const tenantId = typeof group?.enterpriseId === "string" ? group.enterpriseId.trim() : "";
    if (!groupId || !tenantId) {
      reject(rejected, "incomplete_group", { groupId, tenantId });
      continue;
    }
    const row = {
      workspaceKind: "group_shared",
      classification: "classified",
      tenantId,
      groupId,
      proof: "tenant-scoped group registry",
    };
    candidates.push({
      resourceId: buildAuthorityResourceId(row),
      ...row,
    });
  }

  for (const membership of memberships) {
    const userId = typeof membership?.userId === "string" ? membership.userId.trim() : "";
    const tenantId =
      typeof membership?.enterpriseId === "string" ? membership.enterpriseId.trim() : "";
    if (!userId || !tenantId) {
      continue;
    }
    const row = {
      workspaceKind: "employee_private",
      classification: "classified",
      tenantId,
      userId,
      ownerType: "membership",
      proof: "platform-auth membership + employee_private steward resourceId contract",
    };
    candidates.push({
      resourceId: buildAuthorityResourceId(row),
      ...row,
    });
  }

  if (options.forbidAgentIdIdentity) {
    for (const asset of assets) {
      if (asset?.agentId && !asset?.agentAssetId) {
        reject(rejected, "agentId_is_not_agentAssetId", { agentId: asset.agentId });
      }
    }
  }

  return {
    schema: "memory-workspace-phase1b-authority-candidate/v1",
    source: "local-authority-dump",
    live: false,
    writable: false,
    catalogWrite: false,
    candidateCount: candidates.length,
    candidates,
    rejected,
    note: "Shadow-compare input only. Not Catalog SoT.",
  };
}

export function loadAuthorityDump(dumpPath) {
  if (!dumpPath) {
    return null;
  }
  if (path.resolve(dumpPath) === path.resolve(PHASE0_CANDIDATE)) {
    return loadJson(dumpPath);
  }
  if (!fs.existsSync(dumpPath)) {
    return null;
  }
  return loadJson(dumpPath);
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const dumpArg = process.argv.includes("--dump")
    ? process.argv[process.argv.indexOf("--dump") + 1]
    : null;
  const outArg = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : DEFAULT_OUTPUT;
  const extracted = extractAuthorityCandidate(loadAuthorityDump(dumpArg), {
    forbidAgentIdIdentity: true,
  });
  fs.writeFileSync(outArg, `${JSON.stringify(extracted, null, 2)}\n`);
}
