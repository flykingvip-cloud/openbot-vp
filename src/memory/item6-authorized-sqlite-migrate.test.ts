import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  denyItem6LiveCutover,
  denyItem6ProductionSqliteWrite,
  denyItem6ResolverSwitch,
  denyItem6SchemaV2ProductionWrite,
  failClosedItem6Restore,
  ITEM6_PRODUCTION_SQLITE_WRITE,
  ITEM6_SCHEMA_V2_PRODUCTION_WRITE,
  ITEM6_SINGLE_WRITER,
  resolveItem6IsolationRoot,
  restoreItem6IsolatedCopy,
  runItem6IsolatedShadowMigration,
  type Item6MigrateDenial,
  type Item6MigrateReceipt,
} from "./item6-authorized-sqlite-migrate.js";
import {
  ITEM6_AUTHORIZED_SQLITE_ENV,
  ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV,
} from "./item6-authorized-sqlite-path.js";
import { createItem6TrustedOperatorFixture } from "./item6-authorized-sqlite-test-fixtures.js";
import { SCHEMA_V2_ENABLED } from "./schema-v2.js";

const IDENTITY = { tenantId: "tenant-a", resourceId: "resource-1" };

function expectDenied(
  result: Item6MigrateDenial | Item6MigrateReceipt,
  reason: Item6MigrateDenial["reason"],
): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe(reason);
  }
}

describe("Item 6 isolated shadow migration", () => {
  it("accepts operator-bound authorized path and keeps source unwritten", () => {
    const fixture = createItem6TrustedOperatorFixture("pass");
    const before = fs.readFileSync(fixture.sqlitePath);
    const result = runItem6IsolatedShadowMigration({
      env: fixture.env,
      identity: IDENTITY,
      operationId: "op-pass",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.productionSqliteWrite).toBe(false);
      expect(result.sourceUnwritten).toBe(true);
      expect(result.item6Met).toBe(false);
      expect(result.shadowTables).toContain("item6_recovery_required");
      expect(result.fencingToken.startsWith("fence:")).toBe(true);
      expect(result.isolationRoot).toBe(
        resolveItem6IsolationRoot({
          trustedRoot: fixture.trustedRoot,
          identity: IDENTITY,
          operationId: "op-pass",
        }),
      );
    }
    expect(Buffer.compare(before, fs.readFileSync(fixture.sqlitePath))).toBe(0);
    expect(ITEM6_PRODUCTION_SQLITE_WRITE).toBe(false);
    expect(ITEM6_SINGLE_WRITER).toBe(true);
    expect(ITEM6_SCHEMA_V2_PRODUCTION_WRITE).toBe(false);
    expect(SCHEMA_V2_ENABLED).toBe(false);
  });

  it("denies empty, host, evidence, temp fixture, and missing trusted root paths", () => {
    expectDenied(runItem6IsolatedShadowMigration({ env: {}, identity: IDENTITY }), "unconfigured");

    const host = path.join(os.homedir(), ".openbot", "memory", "fixture.sqlite");
    expectDenied(
      runItem6IsolatedShadowMigration({
        env: { [ITEM6_AUTHORIZED_SQLITE_ENV]: host },
        identity: IDENTITY,
      }),
      "missing-trusted-root",
    );

    const evidence = path.join(process.cwd(), "docs/design/evidence/fixture.sqlite");
    expectDenied(
      runItem6IsolatedShadowMigration({
        env: { [ITEM6_AUTHORIZED_SQLITE_ENV]: evidence },
        identity: IDENTITY,
      }),
      "missing-trusted-root",
    );

    const tmp = path.join(os.tmpdir(), "openbot-item6-fixture.sqlite");
    expectDenied(
      runItem6IsolatedShadowMigration({
        env: { [ITEM6_AUTHORIZED_SQLITE_ENV]: tmp },
        identity: IDENTITY,
      }),
      "missing-trusted-root",
    );

    const varTmp = path.join("/var/tmp", `openbot-item6-mig-${process.pid}`, "memory.sqlite");
    fs.mkdirSync(path.dirname(varTmp), { recursive: true });
    fs.writeFileSync(varTmp, "x");
    expectDenied(
      runItem6IsolatedShadowMigration({
        env: {
          [ITEM6_AUTHORIZED_SQLITE_ENV]: varTmp,
          [ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV]: path.dirname(varTmp),
        },
        identity: IDENTITY,
      }),
      "rejected-fixture-path",
    );
  });

  it("denies unknown identity and cross-tenant access", () => {
    const fixture = createItem6TrustedOperatorFixture("tenant");
    expectDenied(
      runItem6IsolatedShadowMigration({
        env: fixture.env,
        identity: { tenantId: "", resourceId: "resource-1" },
      }),
      "unknown-identity",
    );
    expectDenied(
      runItem6IsolatedShadowMigration({
        env: fixture.env,
        identity: IDENTITY,
        accessTenantId: "tenant-b",
      }),
      "cross-tenant",
    );
  });

  it("denies backup hash mismatch with recovery_required", () => {
    const fixture = createItem6TrustedOperatorFixture("hash");
    const denied = runItem6IsolatedShadowMigration({
      env: fixture.env,
      identity: IDENTITY,
      expectedSourceHash: "0".repeat(64),
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe("backup-hash-mismatch");
      expect(denied.recoveryRequired).toBe(true);
      expect(denied.failClosed).toBe(true);
    }
  });

  it("partitions isolation by operationId and denies concurrent migrations", () => {
    const fixture = createItem6TrustedOperatorFixture("concurrent");
    const first = runItem6IsolatedShadowMigration({
      env: fixture.env,
      identity: IDENTITY,
      operationId: "same-op",
    });
    expect(first.ok).toBe(true);

    const lockPath = path.join(
      resolveItem6IsolationRoot({
        trustedRoot: fixture.trustedRoot,
        identity: IDENTITY,
        operationId: "same-op",
      }),
      ".migrate.lock",
    );
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "held", { flag: "wx" });

    expectDenied(
      runItem6IsolatedShadowMigration({
        env: fixture.env,
        identity: IDENTITY,
        operationId: "same-op",
      }),
      "concurrent-migration-forbidden",
    );
  });

  it("restores isolated copy and fail-closes missing backup restore", () => {
    const fixture = createItem6TrustedOperatorFixture("restore");
    const restored = restoreItem6IsolatedCopy({
      env: fixture.env,
      identity: IDENTITY,
      operationId: "op-restore",
    });
    expect(restored.ok).toBe(true);
    const missing = failClosedItem6Restore({});
    expect(missing.reason).toBe("restore-failure");
    expect(missing.failClosed).toBe(true);
    expect(missing.recoveryRequired).toBe(true);
  });

  it("denies production write, live cutover, resolver switch, and schema v2 write", () => {
    expect(denyItem6ProductionSqliteWrite().reason).toBe("production-sqlite-write-forbidden");
    expect(denyItem6LiveCutover().reason).toBe("live-cutover-forbidden");
    expect(denyItem6ResolverSwitch().reason).toBe("resolver-switch-forbidden");
    expect(denyItem6SchemaV2ProductionWrite().reason).toBe("schema-v2-production-write-forbidden");
  });
});
