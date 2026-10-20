import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertSafeTenantId, type DevicePlatformPaths } from "./paths.js";
import { recoverTenantShard } from "./recovery.js";
import {
  DEVICE_PLATFORM_SCHEMA_VERSION,
  type ClaimsFile,
  type ConnectionsFile,
  type TenantShard,
} from "./types.js";

export function emptyConnections(): ConnectionsFile {
  return { schemaVersion: DEVICE_PLATFORM_SCHEMA_VERSION, connections: {} };
}

export function emptyClaims(): ClaimsFile {
  return { schemaVersion: DEVICE_PLATFORM_SCHEMA_VERSION, claims: {} };
}

export function emptyTenantShard(): TenantShard {
  return {
    schemaVersion: DEVICE_PLATFORM_SCHEMA_VERSION,
    associations: {},
    bindings: {},
    bindingHistory: [],
    operations: {},
    projections: {},
    grants: {},
    runs: {},
    events: [],
    toolRequests: {},
    idempotency: {},
  };
}

export class DevicePlatformStore {
  readonly locations: DevicePlatformPaths;

  constructor(paths: DevicePlatformPaths) {
    this.locations = paths;
  }

  loadConnections(): ConnectionsFile {
    return readJson(this.locations.connectionFile, emptyConnections());
  }

  saveConnections(file: ConnectionsFile): void {
    writeJson(this.locations.connectionFile, file);
  }

  loadClaims(): ClaimsFile {
    return readJson(this.locations.claimFile, emptyClaims());
  }

  saveClaims(file: ClaimsFile): void {
    writeJson(this.locations.claimFile, file);
  }

  loadTenant(tenantId: string): TenantShard {
    assertSafeTenantId(tenantId);
    return readJson(this.locations.tenantFile(tenantId), emptyTenantShard());
  }

  saveTenant(tenantId: string, shard: TenantShard): void {
    assertSafeTenantId(tenantId);
    writeJson(this.locations.tenantFile(tenantId), shard);
  }

  listTenantIds(): string[] {
    const root = this.locations.tenantsRoot;
    if (!fs.existsSync(root)) {
      return [];
    }
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "_platform")
      .map((entry) => entry.name)
      .filter((name) => {
        try {
          assertSafeTenantId(name);
          return fs.existsSync(this.locations.tenantFile(name));
        } catch {
          return false;
        }
      });
  }

  /**
   * Persist interruption marks for every tenant shard. No device-platform calls.
   */
  recoverAll(nowIso: string): void {
    for (const tenantId of this.listTenantIds()) {
      const recovered = recoverTenantShard(this.loadTenant(tenantId), nowIso);
      this.saveTenant(tenantId, recovered);
    }
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) {
      fs.rmSync(temporary, { force: true });
    }
  }
}
