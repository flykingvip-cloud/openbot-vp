import { createRequire } from "node:module";
import type { VaultSyncSqlClient, VaultSyncSqlQueryResult } from "./postgres-metadata.js";

type PgPoolLike = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  end: () => Promise<void>;
};

export type VaultSyncPgClient = VaultSyncSqlClient & {
  end(): Promise<void>;
};

const require = createRequire(import.meta.url);

/**
 * Optional Postgres client for vault-sync metadata mirror.
 * Returns null when OPENBOT_VAULT_SYNC_DATABASE_URL is unset.
 */
export function createVaultSyncPgClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): VaultSyncPgClient | null {
  const connectionString = env.OPENBOT_VAULT_SYNC_DATABASE_URL?.trim();
  if (!connectionString) {
    return null;
  }
  const pg = require("pg") as {
    Pool: new (config: { connectionString: string; max?: number }) => PgPoolLike;
  };
  const pool = new pg.Pool({ connectionString, max: 4 });
  return {
    async query<Row = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<VaultSyncSqlQueryResult<Row>> {
      const result = await pool.query(sql, params ? [...params] : undefined);
      return {
        rows: result.rows as Row[],
        rowCount: result.rowCount ?? result.rows.length,
      };
    },
    async end() {
      await pool.end();
    },
  };
}
