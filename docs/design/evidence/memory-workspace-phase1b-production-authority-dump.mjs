#!/usr/bin/env node
/**
 * Phase 1B item 2: collect a non-LIVE production authority dump from local
 * platform-auth + Agent Registry + group profiles (user-scoped root and
 * tenants/<tid>/collaboration/groups). Tenant comes from profile or the
 * managed path; it is never invented from membership alone.
 *
 * This does not copy Phase 0 inventory, does not rename the Stage A fixture,
 * does not write Catalog, and does not enable LIVE. Identifiers are rewritten
 * to opaque sequential labels so emails, tenant slugs, and paths never enter
 * the git dump. Seat occupancy is recorded from enterprise seat-assets; it
 * does not mint user-owned agent resourceIds.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.dirname(import.meta.filename);
const DEFAULT_OUTPUT = path.join(DIR, "memory-workspace-phase1b-production-authority-dump.json");
const FORBIDDEN_DUMP_KEYS = [
  "email",
  "normalizedEmail",
  "passwordHash",
  "secret",
  "sessions",
  "displayName",
  "name",
  "workspacePath",
  "contactEmail",
  "contactPhone",
  "contactName",
];

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function values(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return Object.values(asRecord(value));
}

function opaqueMap(ids, prefix) {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.trim()))].toSorted(
    (left, right) => left.localeCompare(right),
  );
  const map = new Map();
  unique.forEach((id, index) => {
    map.set(id, `${prefix}-${index + 1}`);
  });
  return map;
}

function identityMap(ids) {
  const map = new Map();
  for (const id of ids) {
    if (typeof id === "string" && id.trim()) {
      map.set(id, id.trim());
    }
  }
  return map;
}

function mapId(map, value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  return map.get(value) ?? "";
}

function currentOwnerBinding(bindings, agentAssetId, enterpriseId) {
  const open = bindings.filter(
    (row) =>
      row?.agentAssetId === agentAssetId &&
      row?.enterpriseId === enterpriseId &&
      row?.isPrimary === true &&
      !row?.endedAt,
  );
  return open.length === 1 ? open[0] : null;
}

export function assertDumpHasNoSecrets(dump) {
  const raw = JSON.stringify(dump);
  for (const key of FORBIDDEN_DUMP_KEYS) {
    if (raw.includes(`"${key}"`)) {
      throw new Error(`production_authority_dump_contains_forbidden_key:${key}`);
    }
  }
  if (raw.includes("@")) {
    throw new Error("production_authority_dump_contains_email_marker");
  }
}

export function buildProductionAuthorityDump(input = {}, options = {}) {
  if (input.live === true) {
    throw new Error("production_authority_dump_must_not_be_live");
  }
  const opaque = options.opaque !== false;

  const membershipsIn = values(input.memberships);
  const assetsIn = values(input.assets ?? input.agentAssets);
  const bindingsIn = values(input.ownerBindings);
  const groupsIn = values(input.groups);
  const occupanciesIn = values(input.seatOccupancies);

  const enterpriseIds = [
    ...membershipsIn.map((row) => row?.enterpriseId),
    ...assetsIn.map((row) => row?.enterpriseId),
    ...groupsIn.map((row) => row?.enterpriseId),
    ...occupanciesIn.map((row) => row?.enterpriseId),
  ];
  const userIds = membershipsIn.map((row) => row?.userId);
  const occupancyUserIds = occupanciesIn.map((row) => row?.userId);
  const assetIds = assetsIn.map((row) => row?.agentAssetId);
  const seatIds = bindingsIn.filter((row) => row?.ownerType === "seat").map((row) => row?.ownerId);
  const occupancySeatIds = occupanciesIn.map((row) => row?.seatId);
  const membershipOwnerIds = bindingsIn
    .filter((row) => row?.ownerType === "membership")
    .map((row) => row?.ownerId);
  const groupIds = groupsIn.map((row) => row?.groupId);

  const enterprises = opaque ? opaqueMap(enterpriseIds, "ent") : identityMap(enterpriseIds);
  const users = opaque
    ? opaqueMap([...userIds, ...membershipOwnerIds, ...occupancyUserIds], "user")
    : identityMap([...userIds, ...membershipOwnerIds, ...occupancyUserIds]);
  const assets = opaque ? opaqueMap(assetIds, "asset") : identityMap(assetIds);
  // Occupancy seats that are not registry-owned stay on a separate prefix so
  // adding occupancy cannot renumber existing ws:...:seat:... resourceIds.
  const seats = opaque ? opaqueMap(seatIds, "seat") : identityMap(seatIds);
  const unboundOccupancySeats = opaque
    ? opaqueMap(
        occupancySeatIds.filter((id) => typeof id === "string" && id.trim() && !seats.has(id)),
        "oseat",
      )
    : identityMap(
        occupancySeatIds.filter((id) => typeof id === "string" && id.trim() && !seats.has(id)),
      );
  const groups = opaque ? opaqueMap(groupIds, "group") : identityMap(groupIds);

  const membershipKeys = new Set();
  const memberships = [];
  for (const row of membershipsIn) {
    const mapped = {
      userId: mapId(users, row?.userId),
      enterpriseId: mapId(enterprises, row?.enterpriseId),
    };
    const key = `${mapped.enterpriseId}:${mapped.userId}`;
    if (!mapped.userId || !mapped.enterpriseId || membershipKeys.has(key)) {
      continue;
    }
    membershipKeys.add(key);
    memberships.push(mapped);
  }
  memberships.sort((a, b) =>
    `${a.enterpriseId}:${a.userId}`.localeCompare(`${b.enterpriseId}:${b.userId}`),
  );

  const agentAssets = assetsIn
    .map((row) => {
      const agentAssetId = mapId(assets, row?.agentAssetId);
      const enterpriseId = mapId(enterprises, row?.enterpriseId);
      const binding = currentOwnerBinding(bindingsIn, row?.agentAssetId, row?.enterpriseId);
      const ownerType = binding?.ownerType;
      let ownerId = "";
      if (ownerType === "seat") {
        ownerId = mapId(seats, binding.ownerId);
      } else if (ownerType === "membership") {
        ownerId = mapId(users, binding.ownerId);
      }
      const status = typeof row?.status === "string" && row.status.trim() ? row.status.trim() : "";
      const out = { agentAssetId, enterpriseId };
      if (ownerType) {
        out.ownerType = ownerType;
      }
      if (ownerId) {
        out.ownerId = ownerId;
      }
      if (status) {
        out.status = status;
      }
      return out;
    })
    .filter((row) => row.agentAssetId && row.enterpriseId)
    .toSorted((a, b) => a.agentAssetId.localeCompare(b.agentAssetId));

  const dumpGroups = [];
  let userScopedGroupsWithoutTenant = 0;
  for (const row of groupsIn) {
    const groupId = mapId(groups, row?.groupId);
    const enterpriseId = mapId(enterprises, row?.enterpriseId);
    if (!groupId) {
      continue;
    }
    if (!enterpriseId) {
      userScopedGroupsWithoutTenant += 1;
      dumpGroups.push({ groupId });
      continue;
    }
    dumpGroups.push({ groupId, enterpriseId });
  }
  dumpGroups.sort((a, b) => a.groupId.localeCompare(b.groupId));

  const occupancyKeys = new Set();
  const seatOccupancies = [];
  for (const row of occupanciesIn) {
    const userId = mapId(users, row?.userId);
    const enterpriseId = mapId(enterprises, row?.enterpriseId);
    const registrySeatId = mapId(seats, row?.seatId);
    const seatId = registrySeatId || mapId(unboundOccupancySeats, row?.seatId);
    const key = `${enterpriseId}:${userId}:${seatId}`;
    if (!userId || !enterpriseId || !seatId || occupancyKeys.has(key)) {
      continue;
    }
    occupancyKeys.add(key);
    seatOccupancies.push({
      userId,
      seatId,
      enterpriseId,
      registrySeatBound: Boolean(registrySeatId),
    });
  }
  seatOccupancies.sort((a, b) =>
    `${a.enterpriseId}:${a.userId}:${a.seatId}`.localeCompare(
      `${b.enterpriseId}:${b.userId}:${b.seatId}`,
    ),
  );

  const dump = {
    schema: "memory-workspace-phase1b-authority-dump/v1",
    live: false,
    writable: false,
    source: "local-platform-auth-and-agent-registry",
    identifierPolicy: opaque ? "opaque-redacted" : "in-memory-unredacted",
    note: opaque
      ? "Non-LIVE extract from local platform-auth + Agent Registry + enterprise seat-assets occupancy. Identifiers are opaque. Not Phase 0 inventory. Not the Stage A fixture. Not Catalog SoT. Extract may mint user-owned rows from unique occupancy; this dump does not write Catalog."
      : "In-memory unredacted dump for host Catalog merge only. Must not be written to docs/ or git. Extract may mint user-owned rows from unique occupancy.",
    counts: {
      memberships: memberships.length,
      agentAssets: agentAssets.length,
      groups: dumpGroups.length,
      seatOccupancies: seatOccupancies.length,
      userScopedGroupsWithoutTenant,
    },
    memberships,
    agentAssets,
    groups: dumpGroups,
    seatOccupancies,
  };
  assertDumpHasNoSecrets(dump);
  return dump;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const SAFE_TENANT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function profileEnterpriseId(profile) {
  if (typeof profile?.enterpriseId === "string" && profile.enterpriseId.trim()) {
    return profile.enterpriseId.trim();
  }
  if (typeof profile?.tenantId === "string" && profile.tenantId.trim()) {
    return profile.tenantId.trim();
  }
  return "";
}

function collectLocalGroups(groupsRoot, pathTenantId = "") {
  if (!groupsRoot || !fs.existsSync(groupsRoot)) {
    return [];
  }
  const groups = [];
  for (const entry of fs.readdirSync(groupsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const profilePath = path.join(groupsRoot, entry.name, "profile.json");
    if (!fs.existsSync(profilePath)) {
      continue;
    }
    const profile = loadJson(profilePath);
    const groupId =
      typeof profile.groupId === "string" && profile.groupId.trim()
        ? profile.groupId.trim()
        : entry.name;
    const profileTenant = profileEnterpriseId(profile);
    if (pathTenantId && profileTenant && profileTenant !== pathTenantId) {
      groups.push({ groupId });
      continue;
    }
    const enterpriseId = profileTenant || pathTenantId;
    groups.push(enterpriseId ? { groupId, enterpriseId } : { groupId });
  }
  return groups;
}

function collectTenantScopedGroups(tenantsRoot) {
  if (!tenantsRoot || !fs.existsSync(tenantsRoot)) {
    return [];
  }
  const groups = [];
  for (const tenant of fs.readdirSync(tenantsRoot, { withFileTypes: true })) {
    if (!tenant.isDirectory() || !SAFE_TENANT_ID.test(tenant.name)) {
      continue;
    }
    groups.push(
      ...collectLocalGroups(
        path.join(tenantsRoot, tenant.name, "collaboration", "groups"),
        tenant.name,
      ),
    );
  }
  return groups;
}

function collectSeatOccupanciesFromStore(store) {
  const rows = [];
  for (const seat of values(store?.seats)) {
    const userId = typeof seat?.currentEmployeeId === "string" ? seat.currentEmployeeId.trim() : "";
    const seatId = typeof seat?.seatId === "string" ? seat.seatId.trim() : "";
    const enterpriseId = typeof seat?.tenantId === "string" ? seat.tenantId.trim() : "";
    const status = typeof seat?.status === "string" ? seat.status.trim() : "";
    if (!userId || !seatId || !enterpriseId) {
      continue;
    }
    if (status === "vacant" || status === "frozen") {
      continue;
    }
    rows.push({ userId, seatId, enterpriseId });
  }
  for (const binding of values(store?.bindings)) {
    if (binding?.bindingStatus !== "active" || binding?.endedAt) {
      continue;
    }
    const userId = typeof binding?.employeeId === "string" ? binding.employeeId.trim() : "";
    const seatId = typeof binding?.seatId === "string" ? binding.seatId.trim() : "";
    const enterpriseId = typeof binding?.tenantId === "string" ? binding.tenantId.trim() : "";
    if (!userId || !seatId || !enterpriseId) {
      continue;
    }
    rows.push({ userId, seatId, enterpriseId });
  }
  return rows;
}

function dedupeOccupancies(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.enterpriseId}:${row.userId}:${row.seatId}`;
    if (!row.userId || !row.seatId || !row.enterpriseId || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(row);
  }
  return out;
}

function collectLocalSeatOccupancies(paths = {}) {
  const home = os.homedir();
  const seatAssetsPath =
    paths.seatAssetsPath ?? path.join(home, ".openbot", "openbot-enterprise-seat-assets.json");
  const tenantsRoot = paths.tenantsRoot ?? path.join(home, ".openbot", "tenants");
  const rows = [];
  if (seatAssetsPath && fs.existsSync(seatAssetsPath)) {
    rows.push(...collectSeatOccupanciesFromStore(loadJson(seatAssetsPath)));
  }
  if (tenantsRoot && fs.existsSync(tenantsRoot)) {
    for (const tenant of fs.readdirSync(tenantsRoot, { withFileTypes: true })) {
      if (!tenant.isDirectory() || !SAFE_TENANT_ID.test(tenant.name)) {
        continue;
      }
      const tenantSeatPath = path.join(
        tenantsRoot,
        tenant.name,
        "control-plane",
        "seat-assets.json",
      );
      if (!fs.existsSync(tenantSeatPath)) {
        continue;
      }
      rows.push(...collectSeatOccupanciesFromStore(loadJson(tenantSeatPath)));
    }
  }
  return dedupeOccupancies(rows);
}

function dedupeGroups(groups) {
  const seen = new Set();
  const out = [];
  for (const row of groups) {
    const key = `${row.enterpriseId ?? ""}:${row.groupId}`;
    if (!row.groupId || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function collectLocalAuthorityStores(paths = {}) {
  const home = os.homedir();
  const authPath = paths.authPath ?? path.join(home, ".openbot", "openbot-platform-auth.json");
  const registryPath =
    paths.registryPath ?? path.join(home, ".openbot", "openbot-agent-registry.json");
  const groupsRoot =
    paths.groupsRoot ?? path.join(home, ".openbot", "collaboration-shared", "groups");
  const tenantsRoot = paths.tenantsRoot ?? path.join(home, ".openbot", "tenants");
  const auth = fs.existsSync(authPath) ? loadJson(authPath) : {};
  const registry = fs.existsSync(registryPath) ? loadJson(registryPath) : {};
  return {
    live: false,
    memberships: auth.memberships ?? {},
    assets: registry.assets ?? {},
    ownerBindings: registry.ownerBindings ?? {},
    groups: dedupeGroups([
      ...collectLocalGroups(groupsRoot),
      ...collectTenantScopedGroups(tenantsRoot),
    ]),
    seatOccupancies: collectLocalSeatOccupancies({
      seatAssetsPath: paths.seatAssetsPath,
      tenantsRoot,
    }),
  };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const fromLocal = process.argv.includes("--from-local");
  const outArg = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : DEFAULT_OUTPUT;
  if (!fromLocal) {
    process.stderr.write(
      "usage: memory-workspace-phase1b-production-authority-dump.mjs --from-local [--out path]\n",
    );
    process.exit(2);
  }
  const dump = buildProductionAuthorityDump(collectLocalAuthorityStores());
  fs.writeFileSync(outArg, `${JSON.stringify(dump, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(dump.counts, null, 2)}\n`);
}
