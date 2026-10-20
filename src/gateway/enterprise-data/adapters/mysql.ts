import type { MockHandlerInput, MockHandlerResult } from "../mock-handlers.js";
import type { DataConnectorCredentialSecret } from "../types.js";
import { resolveReadOnlyQuery } from "./sql-read-guard.js";

export type MysqlProbeResult = {
  ok: boolean;
  message: string;
};

/** Read action handler ref registered by the mysql connector package. */
export const MYSQL_READ_HANDLER_REF = "enterprise-data/handlers/mysql-read-query-v1";

const MYSQL_DRIVER_MISSING_MESSAGE =
  "MySQL 驱动（mysql2）加载失败：请确认网关依赖已正确安装（pnpm install）。";

/** Minimal subset of the `mysql2/promise` Connection surface this adapter uses. */
export type MysqlConnectionLike = {
  query(sql: string, params?: unknown[]): Promise<[rows: unknown, fields: unknown]>;
  end(): Promise<void>;
};

export type MysqlClientConfig = {
  host: string;
  port: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: { rejectUnauthorized: boolean };
  connectTimeout?: number;
};

/** Factory that connects and returns a client — injectable so tests avoid the real driver. */
export type MysqlConnectionFactory = (config: MysqlClientConfig) => Promise<MysqlConnectionLike>;

type MysqlModule = {
  createConnection: (config: MysqlClientConfig) => Promise<MysqlConnectionLike>;
};

/**
 * Lazily load the optional `mysql2` driver (promise API). A variable specifier
 * keeps the bundler from inlining `mysql2` (it stays an external runtime
 * import); a missing module surfaces a clear, actionable message. The `.default`
 * fallback handles mysql2's CommonJS/ESM interop.
 */
async function loadDefaultMysqlFactory(): Promise<MysqlConnectionFactory> {
  const specifier = "mysql2/promise" as string;
  let mod: MysqlModule & { default?: MysqlModule };
  try {
    mod = (await import(specifier)) as MysqlModule & { default?: MysqlModule };
  } catch {
    throw new Error(MYSQL_DRIVER_MISSING_MESSAGE);
  }
  const createConnection = mod.createConnection ?? mod.default?.createConnection;
  if (typeof createConnection !== "function") {
    throw new Error(MYSQL_DRIVER_MISSING_MESSAGE);
  }
  return (config) => createConnection(config);
}

/**
 * Build mysql2 connection config from a stored secret. `instanceUrl` holds the
 * connection string (e.g. `mysql://host:3306/dbname`) and is intentionally
 * credential-free so it stays safe in the (non-encrypted) credential metadata
 * record; the DB user (`basicUsername`) and password (`apiKey`) live in the
 * encrypted vault. A `sslmode`/`ssl-mode` hint in the connection string enables
 * TLS. Any credentials embedded in the URL itself are honored only as a
 * fallback when the structured user/password are absent.
 */
export function buildMysqlClientConfig(secret: DataConnectorCredentialSecret): MysqlClientConfig {
  const connectionString = secret.instanceUrl?.trim();
  if (!connectionString) {
    throw new Error("MySQL 连接串（instanceUrl）必填，例如 mysql://host:3306/dbname。");
  }
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("MySQL 连接串格式无效，应为 mysql://host:3306/dbname。");
  }
  const config: MysqlClientConfig = {
    host: parsed.hostname || "127.0.0.1",
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 3306,
    connectTimeout: 10_000,
  };
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (database) {
    config.database = database;
  }
  const user =
    secret.basicUsername?.trim() || (parsed.username ? decodeURIComponent(parsed.username) : "");
  if (user) {
    config.user = user;
  }
  const password =
    secret.apiKey?.trim() || (parsed.password ? decodeURIComponent(parsed.password) : "");
  if (password) {
    config.password = password;
  }
  if (/ssl-?mode=(require|required|verify-ca|verify-full|preferred)/i.test(connectionString)) {
    config.ssl = { rejectUnauthorized: false };
  }
  return config;
}

export async function probeMysqlConnection(
  secret: DataConnectorCredentialSecret,
  factory?: MysqlConnectionFactory,
): Promise<MysqlProbeResult> {
  let config: MysqlClientConfig;
  let make: MysqlConnectionFactory;
  try {
    config = buildMysqlClientConfig(secret);
    make = factory ?? (await loadDefaultMysqlFactory());
  } catch (error) {
    const message = error instanceof Error ? error.message : "配置无效";
    return { ok: false, message };
  }
  let connection: MysqlConnectionLike | undefined;
  try {
    connection = await make(config);
    await connection.query("SELECT 1");
    return { ok: true, message: "MySQL 连通性正常（已执行 SELECT 1）。" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "连接失败";
    return { ok: false, message: `无法连接 MySQL：${message}` };
  } finally {
    if (connection) {
      await connection.end().catch(() => undefined);
    }
  }
}

export async function executeMysqlHandler(
  handlerRef: string,
  input: MockHandlerInput,
  secret: DataConnectorCredentialSecret,
  factory?: MysqlConnectionFactory,
): Promise<MockHandlerResult> {
  if (handlerRef !== MYSQL_READ_HANDLER_REF) {
    throw new Error(`MySQL adapter does not support handler: ${handlerRef}`);
  }
  const sql = resolveReadOnlyQuery(input.input?.sql);
  const config = buildMysqlClientConfig(secret);
  const make = factory ?? (await loadDefaultMysqlFactory());
  const connection = await make(config);
  try {
    const [rows] = await connection.query(sql);
    const rowsArray = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
    return {
      payload: {
        rows: rowsArray,
        rowCount: rowsArray.length,
      },
    };
  } finally {
    await connection.end().catch(() => undefined);
  }
}
