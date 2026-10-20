/**
 * 一次性迁移：enterprise seat assets JSON -> SQLite canonical store。
 *
 * 用法：
 *   node --import tsx scripts/migrate-enterprise-seat-assets-to-sqlite.ts
 *   node --import tsx scripts/migrate-enterprise-seat-assets-to-sqlite.ts --source /path/a.json --target /path/b.sqlite
 *   node --import tsx scripts/migrate-enterprise-seat-assets-to-sqlite.ts --busy-timeout-ms 8000
 */

import {
  migrateEnterpriseSeatAssetsJsonToSqlite,
  resolveDefaultEnterpriseSeatAssetsSqlitePath,
  resolveDefaultEnterpriseSeatAssetsStorePath,
} from "../src/gateway/enterprise-seat-assets-backend.ts";

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
}

function parseBusyTimeout(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

async function main(): Promise<void> {
  const sourcePath = readArg("--source") ?? resolveDefaultEnterpriseSeatAssetsStorePath();
  const targetPath = readArg("--target") ?? resolveDefaultEnterpriseSeatAssetsSqlitePath();
  const busyTimeoutMs = parseBusyTimeout(readArg("--busy-timeout-ms"));

  const summary = await migrateEnterpriseSeatAssetsJsonToSqlite({
    sourcePath,
    targetPath,
    busyTimeoutMs,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
