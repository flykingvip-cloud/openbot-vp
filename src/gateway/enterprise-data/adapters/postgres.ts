import type { MockHandlerInput, MockHandlerResult } from "../mock-handlers.js";
import type { DataConnectorCredentialSecret } from "../types.js";
import { resolveReadOnlyQuery } from "./sql-read-guard.js";

export type PostgresProbeResult = {
  ok: boolean;
  message: string;
};

/** Read action handler ref registered by the postgres connector package. */
export const POSTGRES_READ_HANDLER_REF = "enterprise-data/handlers/postgres-read-query-v1";

const POSTGRES_DRIVER_MISSING_MESSAGE =
  "PostgreSQL 驱动（pg）加载失败：请确认网关依赖已正确安装（pnpm install）。";

/** Minimal subset of the `pg` Client surface this adapter depends on. */
export type PostgresClientLike = {
  connect(): Promise<void>;
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
  end(): Promise<void>;
};

export type PostgresClientConfig = {
  connectionString: string;
  user?: string;
  password?: string;
  ssl?: { rejectUnauthorized: boolean };
  connectionTimeoutMillis?: number;
};

/** Factory that builds a client from a config — injectable so tests avoid the real driver. */
export type PostgresClientFactory = (config: PostgresClientConfig) => PostgresClientLike;

type PostgresModule = {
  Client: new (config: PostgresClientConfig) => PostgresClientLike;
};

/**
 * Lazily load the optional `pg` driver. A variable specifier keeps the bundler
 * from inlining `pg` (it stays an external runtime import) and avoids a hard
 * type dependency; a missing module surfaces a clear, actionable message. The
 * `.default` fallback handles `pg`'s CommonJS/ESM interop.
 */
async function loadDefaultPostgresFactory(): Promise<PostgresClientFactory> {
  const specifier = "pg" as string;
  let mod: PostgresModule & { default?: PostgresModule };
  try {
    mod = (await import(specifier)) as PostgresModule & { default?: PostgresModule };
  } catch {
    throw new Error(POSTGRES_DRIVER_MISSING_MESSAGE);
  }
  const Client = mod.Client ?? mod.default?.Client;
  if (typeof Client !== "function") {
    throw new Error(POSTGRES_DRIVER_MISSING_MESSAGE);
  }
  return (config) => new Client(config);
}

/**
 * Build pg client config from a stored secret. `instanceUrl` holds the
 * connection string (e.g. `postgres://host:5432/dbname`) and is intentionally
 * credential-free so it stays safe in the (non-encrypted) credential metadata
 * record; the DB user (`basicUsername`) and password (`apiKey`) live in the
 * encrypted vault. `sslmode=require` in the connection string enables TLS.
 */
export function buildPostgresClientConfig(
  secret: DataConnectorCredentialSecret,
): PostgresClientConfig {
  const connectionString = secret.instanceUrl?.trim();
  if (!connectionString) {
    throw new Error("PostgreSQL 连接串（instanceUrl）必填，例如 postgres://host:5432/dbname。");
  }
  const config: PostgresClientConfig = { connectionString, connectionTimeoutMillis: 10_000 };
  const user = secret.basicUsername?.trim();
  if (user) {
    config.user = user;
  }
  const password = secret.apiKey?.trim();
  if (password) {
    config.password = password;
  }
  if (/sslmode=(require|verify-ca|verify-full)/i.test(connectionString)) {
    config.ssl = { rejectUnauthorized: false };
  }
  return config;
}

/**
 * Read-only SQL guard, shared with the other relational adapters (see
 * `./sql-read-guard.ts`). Re-exported so existing importers keep working.
 */
export { resolveReadOnlyQuery };

export async function probePostgresConnection(
  secret: DataConnectorCredentialSecret,
  factory?: PostgresClientFactory,
): Promise<PostgresProbeResult> {
  let client: PostgresClientLike;
  try {
    const config = buildPostgresClientConfig(secret);
    const make = factory ?? (await loadDefaultPostgresFactory());
    client = make(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "配置无效";
    return { ok: false, message };
  }
  try {
    await client.connect();
    await client.query("SELECT 1");
    return { ok: true, message: "PostgreSQL 连通性正常（已执行 SELECT 1）。" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "连接失败";
    return { ok: false, message: `无法连接 PostgreSQL：${message}` };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function executePostgresHandler(
  handlerRef: string,
  input: MockHandlerInput,
  secret: DataConnectorCredentialSecret,
  factory?: PostgresClientFactory,
): Promise<MockHandlerResult> {
  if (handlerRef !== POSTGRES_READ_HANDLER_REF) {
    throw new Error(`Postgres adapter does not support handler: ${handlerRef}`);
  }
  const sql = resolveReadOnlyQuery(input.input?.sql);
  const config = buildPostgresClientConfig(secret);
  const make = factory ?? (await loadDefaultPostgresFactory());
  const client = make(config);
  try {
    await client.connect();
    const result = await client.query(sql);
    return {
      payload: {
        rows: result.rows,
        rowCount: result.rowCount ?? result.rows.length,
      },
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
