import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ITEM6_AUTHORIZED_SQLITE_ENV,
  ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV,
} from "./item6-authorized-sqlite-path.js";

function operatorTrustedRootBase(): string {
  const realHome = process.env.OPENCLAW_REAL_HOME?.trim();
  if (realHome) {
    return path.join(realHome, ".item6-operator-test-fixtures");
  }
  return path.join(os.homedir(), ".item6-operator-test-fixtures");
}

function operatorTrustedRoot(label: string): string {
  return path.join(operatorTrustedRootBase(), `${label}-${process.pid}`);
}

/** Operator-bound fixture outside host SoT and temp roots. */
export function createItem6TrustedOperatorFixture(label: string): {
  trustedRoot: string;
  sqlitePath: string;
  env: NodeJS.ProcessEnv;
} {
  const trustedRoot = operatorTrustedRoot(label);
  fs.mkdirSync(trustedRoot, { recursive: true });
  const sqlitePath = path.join(trustedRoot, "memory.sqlite");
  const db = new DatabaseSync(sqlitePath);
  db.exec(
    "CREATE TABLE IF NOT EXISTS item6_probe (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL)",
  );
  db.exec("INSERT OR IGNORE INTO item6_probe (id, tenant_id) VALUES (1, 'tenant-a')");
  db.close();
  return {
    trustedRoot,
    sqlitePath,
    env: {
      [ITEM6_AUTHORIZED_SQLITE_ENV]: sqlitePath,
      [ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV]: trustedRoot,
    },
  };
}

export function createItem6TrustedOperatorFixtureWithSql(
  label: string,
  sql: string,
): {
  trustedRoot: string;
  sqlitePath: string;
  env: NodeJS.ProcessEnv;
} {
  const trustedRoot = operatorTrustedRoot(label);
  fs.mkdirSync(trustedRoot, { recursive: true });
  const sqlitePath = path.join(trustedRoot, "memory.sqlite");
  const db = new DatabaseSync(sqlitePath);
  db.exec(sql);
  db.close();
  return {
    trustedRoot,
    sqlitePath,
    env: {
      [ITEM6_AUTHORIZED_SQLITE_ENV]: sqlitePath,
      [ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV]: trustedRoot,
    },
  };
}
