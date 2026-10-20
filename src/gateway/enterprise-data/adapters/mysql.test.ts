// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ScopeEvaluationResult } from "../types.js";
import {
  buildMysqlClientConfig,
  executeMysqlHandler,
  MYSQL_READ_HANDLER_REF,
  type MysqlClientConfig,
  type MysqlConnectionFactory,
  probeMysqlConnection,
} from "./mysql.js";
import { resolveReadOnlyQuery } from "./sql-read-guard.js";

const ALL_SCOPE: ScopeEvaluationResult = {
  scopeType: "ALL",
  appliedFilters: [],
  resolvedValues: {},
  scopeAppliedLabel: "ALL",
};

type FakeBehavior = {
  connect?: () => Promise<void>;
  rows?: Array<Record<string, unknown>>;
  queries: string[];
  configs: MysqlClientConfig[];
  ended: number;
};

function fakeFactory(behavior: FakeBehavior): MysqlConnectionFactory {
  return async (config) => {
    behavior.configs.push(config);
    // mysql2/promise establishes the connection inside createConnection, so a
    // connect failure surfaces here (mirrors the real driver rejecting).
    if (behavior.connect) {
      await behavior.connect();
    }
    return {
      async query(sql: string) {
        behavior.queries.push(sql);
        const rows = behavior.rows ?? [];
        return [rows, []];
      },
      async end() {
        behavior.ended += 1;
      },
    };
  };
}

describe("mysql adapter config + query guard", () => {
  it("parses host/port/database from the connection string and takes user/password from the secret", () => {
    const config = buildMysqlClientConfig({
      instanceUrl: "mysql://db.example.com:3306/app?ssl-mode=REQUIRED",
      basicUsername: "readonly_user",
      apiKey: "secret-pass",
    });
    expect(config.host).toBe("db.example.com");
    expect(config.port).toBe(3306);
    expect(config.database).toBe("app");
    expect(config.user).toBe("readonly_user");
    expect(config.password).toBe("secret-pass");
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("defaults the port to 3306 and honors URL-embedded credentials as a fallback", () => {
    const config = buildMysqlClientConfig({ instanceUrl: "mysql://svc:pw@10.0.0.5/sales" });
    expect(config.host).toBe("10.0.0.5");
    expect(config.port).toBe(3306);
    expect(config.database).toBe("sales");
    expect(config.user).toBe("svc");
    expect(config.password).toBe("pw");
  });

  it("requires a connection string", () => {
    expect(() => buildMysqlClientConfig({ apiKey: "x" })).toThrow();
  });

  it("rejects a malformed connection string", () => {
    expect(() => buildMysqlClientConfig({ instanceUrl: "not a url" })).toThrow();
  });

  it("defaults to SELECT 1 and accepts SELECT/WITH read-only queries", () => {
    expect(resolveReadOnlyQuery(undefined)).toBe("SELECT 1 AS ok");
    expect(resolveReadOnlyQuery("select * from accounts limit 5")).toBe(
      "select * from accounts limit 5",
    );
    expect(resolveReadOnlyQuery("WITH t AS (SELECT 1) SELECT * FROM t")).toBe(
      "WITH t AS (SELECT 1) SELECT * FROM t",
    );
  });

  it("rejects non-read-only and multi-statement queries", () => {
    expect(() => resolveReadOnlyQuery("delete from accounts")).toThrow();
    expect(() => resolveReadOnlyQuery("update accounts set x=1")).toThrow();
    expect(() => resolveReadOnlyQuery("select 1; drop table accounts")).toThrow();
  });
});

describe("mysql adapter probe + handler (injected driver)", () => {
  it("probes connectivity with SELECT 1", async () => {
    const behavior: FakeBehavior = { queries: [], configs: [], ended: 0 };
    const result = await probeMysqlConnection(
      { instanceUrl: "mysql://db.example.com:3306/app", basicUsername: "u", apiKey: "p" },
      fakeFactory(behavior),
    );
    expect(result.ok).toBe(true);
    expect(behavior.queries).toContain("SELECT 1");
    expect(behavior.ended).toBe(1);
  });

  it("reports failure when the connection throws", async () => {
    const behavior: FakeBehavior = {
      queries: [],
      configs: [],
      ended: 0,
      connect: async () => {
        throw new Error("ECONNREFUSED");
      },
    };
    const result = await probeMysqlConnection(
      { instanceUrl: "mysql://db.example.com:3306/app", apiKey: "p" },
      fakeFactory(behavior),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("ECONNREFUSED");
  });

  it("reports failure (not throw) when the connection string is missing", async () => {
    const behavior: FakeBehavior = { queries: [], configs: [], ended: 0 };
    const result = await probeMysqlConnection({ apiKey: "p" }, fakeFactory(behavior));
    expect(result.ok).toBe(false);
  });

  it("runs a read query via the handler and returns rows + rowCount", async () => {
    const behavior: FakeBehavior = {
      queries: [],
      configs: [],
      ended: 0,
      rows: [{ id: 1 }, { id: 2 }],
    };
    const result = await executeMysqlHandler(
      MYSQL_READ_HANDLER_REF,
      { input: { sql: "select id from accounts" }, scope: ALL_SCOPE, employeeId: "emp-1" },
      { instanceUrl: "mysql://db.example.com:3306/app", apiKey: "p" },
      fakeFactory(behavior),
    );
    expect(result.payload).toEqual({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 });
    expect(behavior.queries).toContain("select id from accounts");
  });

  it("rejects unsupported handler refs", async () => {
    const behavior: FakeBehavior = { queries: [], configs: [], ended: 0 };
    await expect(
      executeMysqlHandler(
        "enterprise-data/handlers/unknown",
        { scope: ALL_SCOPE, employeeId: "emp-1" },
        { instanceUrl: "mysql://db.example.com:3306/app", apiKey: "p" },
        fakeFactory(behavior),
      ),
    ).rejects.toThrow();
  });

  it("fails closed on an unreachable database (real driver, refused connection)", async () => {
    // No factory injected → uses the real `mysql2` driver. An unreachable local
    // port yields an immediate ECONNREFUSED, so the probe fails gracefully.
    const result = await probeMysqlConnection({
      instanceUrl: "mysql://127.0.0.1:59999/nope",
      basicUsername: "x",
    });
    expect(result.ok).toBe(false);
  });
});
