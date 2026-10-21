import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeDevicePlatformConnection } from "./dto.js";
import { assertSafeTenantId, type DevicePlatformPaths } from "./paths.js";
import { recoverTenantShard } from "./recovery.js";
import {
  DEVICE_PLATFORM_SCHEMA_VERSION,
  type ClaimsFile,
  type ConnectionsFile,
  type TenantShard,
} from "./types.js";

export type StoredServiceCredential = {
  serviceUser: string;
  /** Write-once service Basic password. Never copied onto the connection record. */
  secret: string;
};

export type CredentialsFile = {
  schemaVersion: number;
  credentials: Record<string, StoredServiceCredential>;
};

export function emptyCredentials(): CredentialsFile {
  return { schemaVersion: DEVICE_PLATFORM_SCHEMA_VERSION, credentials: {} };
}

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
    const file = readJson(this.locations.connectionFile, emptyConnections());
    for (const [platformId, connection] of Object.entries(file.connections)) {
      // "v1-draft" stays on read (pending upgrade). The health probe rewrites it
      // to "v1" only after device-control reports maturity=v1-frozen.
      file.connections[platformId] = normalizeDevicePlatformConnection({
        ...connection,
        platformId: connection.platformId || platformId,
      });
    }
    return file;
  }

  saveConnections(file: ConnectionsFile): void {
    writeJson(this.locations.connectionFile, file);
  }

  loadCredentials(): CredentialsFile {
    return readJson(this.locations.credentialFile, emptyCredentials());
  }

  saveCredentials(file: CredentialsFile): void {
    writeJson(this.locations.credentialFile, file, 0o600);
  }

  loadCredential(platformId: string): StoredServiceCredential | null {
    return this.loadCredentials().credentials[platformId] ?? null;
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

function writeJson(filePath: string, value: unknown, mode?: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: mode ?? 0o600,
    });
    fs.renameSync(temporary, filePath);
    if (mode !== undefined) {
      fs.chmodSync(filePath, mode);
    }
  } finally {
    if (fs.existsSync(temporary)) {
      fs.rmSync(temporary, { force: true });
    }
  }
}
