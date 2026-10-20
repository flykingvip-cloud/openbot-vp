import type { PostgresQueryResult, PostgresSqlClient } from "./postgres-metadata.js";

export type CreatePgSqlClientOptions = {
  connectionString: string;
  /** Max pool size (default 4). */
  max?: number;
};

export type PgSqlClientHandle = PostgresSqlClient & {
  /** End the underlying pool. */
  end(): Promise<void>;
  readonly connectionString: string;
};

type PgPoolLike = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  connect: () => Promise<{
    query: (
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
    release: () => void;
  }>;
  end: () => Promise<void>;
};

/**
 * Build a CogniWeave PostgresSqlClient on top of `pg` Pool.
 * Requires the host to resolve the `pg` package (workspace root / SDK install).
 */
export async function createPgSqlClient(
  options: CreatePgSqlClientOptions,
): Promise<PgSqlClientHandle> {
  const connectionString = options.connectionString.trim();
  if (!connectionString) {
    throw new Error("createPgSqlClient requires a non-empty connectionString");
  }

  let PoolCtor: new (config: { connectionString: string; max?: number }) => PgPoolLike;
  try {
    // Avoid static `import("pg")` so tsc does not require @types/pg for plugin-sdk dts.
    const loadPg = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<{
      Pool?: new (config: { connectionString: string; max?: number }) => PgPoolLike;
      default?: {
        Pool?: new (config: { connectionString: string; max?: number }) => PgPoolLike;
      };
    }>;
    const mod = await loadPg("pg");
    const resolved = mod.Pool ?? mod.default?.Pool;
    if (!resolved) {
      throw new Error("pg.Pool export missing");
    }
    PoolCtor = resolved;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `createPgSqlClient could not import pg (${message}). Install pg in the workspace.`,
    );
  }

  const pool = new PoolCtor({
    connectionString,
    max: options.max ?? 4,
  });

  const query: PostgresSqlClient["query"] = async <Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>> => {
    const result = await pool.query(sql, params ? [...params] : undefined);
    return {
      rows: result.rows as Row[],
      rowCount: result.rowCount ?? result.rows.length,
    };
  };

  const client: PgSqlClientHandle = {
    connectionString,
    query,
    async transaction<T>(
      runner: (transaction: { query: PostgresSqlClient["query"] }) => Promise<T>,
    ): Promise<T> {
      const conn = await pool.connect();
      try {
        await conn.query("begin");
        const txQuery: PostgresSqlClient["query"] = async <Row = Record<string, unknown>>(
          sql: string,
          params?: readonly unknown[],
        ) => {
          const result = await conn.query(sql, params ? [...params] : undefined);
          return {
            rows: result.rows as Row[],
            rowCount: result.rowCount ?? result.rows.length,
          };
        };
        const value = await runner({ query: txQuery });
        await conn.query("commit");
        return value;
      } catch (error) {
        try {
          await conn.query("rollback");
        } catch {
          // ignore rollback errors
        }
        throw error;
      } finally {
        conn.release();
      }
    },
    async end() {
      await pool.end();
    },
  };

  return client;
}

/** Resolve connection string for live drills (env first). */
export function resolveCogniWeavePostgresUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const keys = [
    "COGNIWEAVE_POSTGRES_URL",
    "OPENBOT_COGNIWEAVE_POSTGRES_URL",
    "DATABASE_URL",
  ] as const;
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}
