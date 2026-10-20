import { DatabaseSync } from "node:sqlite";
import {
  classifyAuthorizedSqlitePath,
  requireItem6AuthorizedSqlitePath,
} from "./item6-authorized-sqlite-path.js";

export type Item6AuthorizedSqliteReadSnapshot = {
  pathToken: string;
  integrityCheck: string;
  userVersion: number | null;
  tableCount: number;
  tableNames: string[];
  readOnly: true;
  productionSqliteWrite: false;
};

export type Item6AuthorizedSqliteColumnSchema = {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
};

export type Item6AuthorizedSqliteTableSchema = {
  pathToken: string;
  tableName: string;
  columns: Item6AuthorizedSqliteColumnSchema[];
  readOnly: true;
  productionSqliteWrite: false;
};

/**
 * Item 6 step-2: read-only snapshot on operator-issued authorized sqlite only.
 */
export function readItem6AuthorizedSqliteSnapshot(
  env: NodeJS.ProcessEnv = process.env,
):
  | Item6AuthorizedSqliteReadSnapshot
  | { ok: false; status: ReturnType<typeof classifyAuthorizedSqlitePath>["status"] } {
  const gate = requireItem6AuthorizedSqlitePath(env);
  if (!gate.ok) {
    return { ok: false, status: gate.status };
  }
  const db = new DatabaseSync(gate.resolved, { readOnly: true });
  try {
    const integrityRow = db.prepare("PRAGMA integrity_check").get() as
      | { integrity_check?: string }
      | undefined;
    const userVersionRow = db.prepare("PRAGMA user_version").get() as
      | { user_version?: number }
      | undefined;
    const tableCountRow = db
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .get() as { count?: number } | undefined;
    const tableNameRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name?: string }>;
    return {
      pathToken: gate.pathToken,
      integrityCheck: String(integrityRow?.integrity_check ?? "fail"),
      userVersion: userVersionRow?.user_version ?? null,
      tableCount: Number(tableCountRow?.count ?? 0),
      tableNames: tableNameRows.map((row) => String(row.name ?? "")).filter(Boolean),
      readOnly: true,
      productionSqliteWrite: false,
    };
  } finally {
    db.close();
  }
}

/**
 * Item 6 step-4: read-only table schema on operator-issued authorized sqlite only.
 */
export function readItem6AuthorizedSqliteTableSchema(
  tableName: string,
  env: NodeJS.ProcessEnv = process.env,
):
  | Item6AuthorizedSqliteTableSchema
  | { ok: false; status: ReturnType<typeof classifyAuthorizedSqlitePath>["status"] } {
  const gate = requireItem6AuthorizedSqlitePath(env);
  if (!gate.ok) {
    return { ok: false, status: gate.status };
  }
  const safeName = tableName.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(safeName)) {
    return { ok: false, status: "unconfigured" };
  }
  const db = new DatabaseSync(gate.resolved, { readOnly: true });
  try {
    const columnRows = db.prepare(`PRAGMA table_info(${safeName})`).all() as Array<{
      name?: string;
      type?: string;
      notnull?: number;
      pk?: number;
    }>;
    return {
      pathToken: gate.pathToken,
      tableName: safeName,
      columns: columnRows.map((row) => ({
        name: String(row.name ?? ""),
        type: String(row.type ?? ""),
        notNull: Number(row.notnull ?? 0) === 1,
        primaryKey: Number(row.pk ?? 0) === 1,
      })),
      readOnly: true,
      productionSqliteWrite: false,
    };
  } finally {
    db.close();
  }
}

export type Item6AuthorizedSqliteIndexSchema = {
  pathToken: string;
  tableName: string;
  indexName: string;
  unique: boolean;
  columns: string[];
  readOnly: true;
  productionSqliteWrite: false;
};

/**
 * Item 6 step-5: read-only index list on operator-issued authorized sqlite only.
 */
export function readItem6AuthorizedSqliteTableIndexes(
  tableName: string,
  env: NodeJS.ProcessEnv = process.env,
):
  | { ok: true; pathToken: string; tableName: string; indexes: Item6AuthorizedSqliteIndexSchema[] }
  | { ok: false; status: ReturnType<typeof classifyAuthorizedSqlitePath>["status"] } {
  const gate = requireItem6AuthorizedSqlitePath(env);
  if (!gate.ok) {
    return { ok: false, status: gate.status };
  }
  const safeName = tableName.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(safeName)) {
    return { ok: false, status: "unconfigured" };
  }
  const db = new DatabaseSync(gate.resolved, { readOnly: true });
  try {
    const indexRows = db.prepare(`PRAGMA index_list(${safeName})`).all() as Array<{
      name?: string;
      unique?: number;
    }>;
    const indexes: Item6AuthorizedSqliteIndexSchema[] = [];
    for (const row of indexRows) {
      const indexName = String(row.name ?? "").trim();
      if (!indexName) {
        continue;
      }
      const infoRows = db.prepare(`PRAGMA index_info(${indexName})`).all() as Array<{
        name?: string;
      }>;
      indexes.push({
        pathToken: gate.pathToken,
        tableName: safeName,
        indexName,
        unique: Number(row.unique ?? 0) === 1,
        columns: infoRows.map((info) => String(info.name ?? "")).filter(Boolean),
        readOnly: true,
        productionSqliteWrite: false,
      });
    }
    return { ok: true, pathToken: gate.pathToken, tableName: safeName, indexes };
  } finally {
    db.close();
  }
}

export type Item6AuthorizedSqliteForeignKeySchema = {
  pathToken: string;
  tableName: string;
  id: number;
  seq: number;
  referencedTable: string;
  fromColumn: string;
  toColumn: string;
  onUpdate: string;
  onDelete: string;
  match: string;
  readOnly: true;
  productionSqliteWrite: false;
};

/**
 * Item 6 step-6: read-only foreign_key_list on operator-issued authorized sqlite only.
 */
export function readItem6AuthorizedSqliteTableForeignKeys(
  tableName: string,
  env: NodeJS.ProcessEnv = process.env,
):
  | {
      ok: true;
      pathToken: string;
      tableName: string;
      foreignKeys: Item6AuthorizedSqliteForeignKeySchema[];
    }
  | { ok: false; status: ReturnType<typeof classifyAuthorizedSqlitePath>["status"] } {
  const gate = requireItem6AuthorizedSqlitePath(env);
  if (!gate.ok) {
    return { ok: false, status: gate.status };
  }
  const safeName = tableName.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(safeName)) {
    return { ok: false, status: "unconfigured" };
  }
  const db = new DatabaseSync(gate.resolved, { readOnly: true });
  try {
    const rows = db.prepare(`PRAGMA foreign_key_list(${safeName})`).all() as Array<{
      id?: number;
      seq?: number;
      table?: string;
      from?: string;
      to?: string;
      on_update?: string;
      on_delete?: string;
      match?: string;
    }>;
    return {
      ok: true,
      pathToken: gate.pathToken,
      tableName: safeName,
      foreignKeys: rows.map((row) => ({
        pathToken: gate.pathToken,
        tableName: safeName,
        id: Number(row.id ?? 0),
        seq: Number(row.seq ?? 0),
        referencedTable: String(row.table ?? ""),
        fromColumn: String(row.from ?? ""),
        toColumn: String(row.to ?? ""),
        onUpdate: String(row.on_update ?? ""),
        onDelete: String(row.on_delete ?? ""),
        match: String(row.match ?? ""),
        readOnly: true,
        productionSqliteWrite: false,
      })),
    };
  } finally {
    db.close();
  }
}

export type Item6AuthorizedSqliteTriggerSchema = {
  pathToken: string;
  tableName: string;
  triggerName: string;
  readOnly: true;
  productionSqliteWrite: false;
};

/**
 * Item 6 step-7: read-only trigger list on operator-issued authorized sqlite only.
 */
export function readItem6AuthorizedSqliteTableTriggers(
  tableName: string,
  env: NodeJS.ProcessEnv = process.env,
):
  | {
      ok: true;
      pathToken: string;
      tableName: string;
      triggers: Item6AuthorizedSqliteTriggerSchema[];
    }
  | { ok: false; status: ReturnType<typeof classifyAuthorizedSqlitePath>["status"] } {
  const gate = requireItem6AuthorizedSqlitePath(env);
  if (!gate.ok) {
    return { ok: false, status: gate.status };
  }
  const safeName = tableName.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(safeName)) {
    return { ok: false, status: "unconfigured" };
  }
  const db = new DatabaseSync(gate.resolved, { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name = ? ORDER BY name")
      .all(safeName) as Array<{ name?: string }>;
    return {
      ok: true,
      pathToken: gate.pathToken,
      tableName: safeName,
      triggers: rows
        .map((row) => String(row.name ?? "").trim())
        .filter(Boolean)
        .map((triggerName) => ({
          pathToken: gate.pathToken,
          tableName: safeName,
          triggerName,
          readOnly: true,
          productionSqliteWrite: false,
        })),
    };
  } finally {
    db.close();
  }
}

export type Item6AuthorizedSqliteColumnXinfo = {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  hidden: number;
};

export type Item6AuthorizedSqliteTableXinfo = {
  ok: true;
  pathToken: string;
  tableName: string;
  columns: Item6AuthorizedSqliteColumnXinfo[];
  readOnly: true;
  productionSqliteWrite: false;
};

/**
 * Item 6 step-8: read-only table_xinfo on operator-issued authorized sqlite only.
 */
export function readItem6AuthorizedSqliteTableXinfo(
  tableName: string,
  env: NodeJS.ProcessEnv = process.env,
):
  | Item6AuthorizedSqliteTableXinfo
  | { ok: false; status: ReturnType<typeof classifyAuthorizedSqlitePath>["status"] } {
  const gate = requireItem6AuthorizedSqlitePath(env);
  if (!gate.ok) {
    return { ok: false, status: gate.status };
  }
  const safeName = tableName.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(safeName)) {
    return { ok: false, status: "unconfigured" };
  }
  const db = new DatabaseSync(gate.resolved, { readOnly: true });
  try {
    const columnRows = db.prepare(`PRAGMA table_xinfo(${safeName})`).all() as Array<{
      cid?: number;
      name?: string;
      type?: string;
      notnull?: number;
      pk?: number;
      hidden?: number;
    }>;
    return {
      ok: true,
      pathToken: gate.pathToken,
      tableName: safeName,
      columns: columnRows.map((row) => ({
        cid: Number(row.cid ?? 0),
        name: String(row.name ?? ""),
        type: String(row.type ?? ""),
        notNull: Number(row.notnull ?? 0) === 1,
        primaryKey: Number(row.pk ?? 0) === 1,
        hidden: Number(row.hidden ?? 0),
      })),
      readOnly: true,
      productionSqliteWrite: false,
    };
  } finally {
    db.close();
  }
}

export const ITEM6_AUTHORIZED_SQLITE_ROW_SAMPLE_CAP = 5;

export type Item6AuthorizedSqliteTableRowSample = {
  ok: true;
  pathToken: string;
  tableName: string;
  rowCount: number;
  sampleSize: number;
  sampleCap: typeof ITEM6_AUTHORIZED_SQLITE_ROW_SAMPLE_CAP;
  readOnly: true;
  productionSqliteWrite: false;
};

/**
 * Item 6 step-9: read-only capped row sample on operator-issued authorized sqlite only.
 * Does not return row payloads.
 */
export function readItem6AuthorizedSqliteTableRowSample(
  tableName: string,
  env: NodeJS.ProcessEnv = process.env,
):
  | Item6AuthorizedSqliteTableRowSample
  | { ok: false; status: ReturnType<typeof classifyAuthorizedSqlitePath>["status"] } {
  const gate = requireItem6AuthorizedSqlitePath(env);
  if (!gate.ok) {
    return { ok: false, status: gate.status };
  }
  const safeName = tableName.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(safeName)) {
    return { ok: false, status: "unconfigured" };
  }
  const db = new DatabaseSync(gate.resolved, { readOnly: true });
  try {
    const countRow = db.prepare(`SELECT COUNT(*) AS n FROM ${safeName}`).get() as { n?: number };
    const rowCount = Number(countRow?.n ?? 0);
    const sampleSize = Math.min(rowCount, ITEM6_AUTHORIZED_SQLITE_ROW_SAMPLE_CAP);
    return {
      ok: true,
      pathToken: gate.pathToken,
      tableName: safeName,
      rowCount,
      sampleSize,
      sampleCap: ITEM6_AUTHORIZED_SQLITE_ROW_SAMPLE_CAP,
      readOnly: true,
      productionSqliteWrite: false,
    };
  } finally {
    db.close();
  }
}
