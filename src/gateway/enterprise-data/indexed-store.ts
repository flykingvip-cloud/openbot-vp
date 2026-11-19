/** Authoritative row store. Legacy JSON is imported once and then left untouched. */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { withFileLock } from "../../infra/file-lock.js";
import { requireNodeSqlite } from "../../memory/sqlite.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import type { EnterpriseDataStore } from "./types.js";

const require = createRequire(import.meta.url);
const { parser } = require("stream-json") as { parser: () => Transform };
const { pick } = require("stream-json/filters/Pick") as {
  pick: (options: {
    filter: (stack: Array<string | number>, token: { name: string }) => boolean;
  }) => Transform;
};
const { streamValues } = require("stream-json/streamers/StreamValues") as {
  streamValues: () => Transform;
};
type Row = { body: string; revision: number };
type Entry = { original?: string; revision: number; value: unknown };
type MapState = {
  section: string;
  entries: Map<string, Entry>;
  deleted: Set<string>;
  proxy: Record<string, unknown>;
};
type View = { file: string; revision: number; maps: Map<string, MapState> };
const views = new WeakMap<object, View>();
const mapViews = new WeakMap<object, { view: View; map: MapState }>();
const migrationInFlight = new Map<string, Promise<void>>();
export const isIndexedEnterpriseStore = (value: object): boolean => views.has(value);
export const indexedEnterpriseStorePath = (file: string): string => `${file}.sqlite`;
const MAX_RECORD_BYTES = 16 * 1024 * 1024;

function fingerprint(file: string): string {
  try {
    const s = fs.statSync(file);
    return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "absent";
    }
    throw error;
  }
}
function open(file: string): DatabaseSync {
  const db = new (requireNodeSqlite().DatabaseSync)(indexedEnterpriseStorePath(file));
  db.exec("PRAGMA busy_timeout=10000");
  const meta = db.prepare("SELECT value FROM meta WHERE key='legacy_fingerprint'").get() as
    | { value: string }
    | undefined;
  if (!meta || meta.value !== fingerprint(file)) {
    db.close();
    throw new Error("enterprise_store_legacy_changed_after_migration");
  }
  return db;
}
function schema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT INTO meta VALUES('revision','1');
    CREATE TABLE records(section TEXT NOT NULL,id TEXT NOT NULL,tenant TEXT NOT NULL,trace TEXT NOT NULL,body TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(section,id));
    CREATE INDEX records_tenant ON records(section,tenant,id);
    CREATE INDEX records_trace ON records(section,tenant,trace,id);`);
}
function encode(value: unknown): { body: string; tenant: string; trace: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("enterprise_store_invalid_record");
  }
  const record = value as Record<string, unknown>;
  const tenant =
    typeof record.tenantId === "string"
      ? (canonicalizeTenantId(record.tenantId) ?? record.tenantId)
      : "";
  const body = JSON.stringify({ ...record, ...(tenant ? { tenantId: tenant } : {}) });
  if (Buffer.byteLength(body) > MAX_RECORD_BYTES) {
    throw new Error("enterprise_store_record_budget_exceeded");
  }
  return { body, tenant, trace: typeof record.traceId === "string" ? record.traceId : "" };
}

async function importLegacy(file: string, sections: readonly string[]): Promise<void> {
  const target = indexedEnterpriseStorePath(file);
  if (fs.existsSync(target)) {
    const db = open(file);
    db.close();
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  await withFileLock(
    target,
    { retries: { retries: 100, factor: 1.1, minTimeout: 20, maxTimeout: 200 }, stale: 120000 },
    async () => {
      if (fs.existsSync(target)) {
        const db = open(file);
        db.close();
        return;
      }
      const before = fingerprint(file);
      const temp = `${target}.${randomUUID()}.tmp`;
      const db = new (requireNodeSqlite().DatabaseSync)(temp);
      fs.chmodSync(temp, 0o600);
      try {
        schema(db);
        db.exec("BEGIN IMMEDIATE");
        const insert = db.prepare("INSERT OR REPLACE INTO records VALUES(?,?,?,?,?,1)");
        const keys: Array<[string, string, boolean]> = [];
        const canonicalBindingIds = new Set<string>();
        const aliasBindingIds = new Set<string>();
        let canonicalBindingsPresent = false;
        if (before !== "absent") {
          await pipeline(
            fs.createReadStream(file, { highWaterMark: 64 * 1024 }),
            parser(),
            new Transform({
              objectMode: true,
              transform(raw: unknown, _encoding, done) {
                const token = raw as { name: string; value?: unknown };
                if (token.name === "keyValue" && token.value === "__proto__") {
                  done(new Error("enterprise_store_unsafe_record_key"));
                  return;
                }
                done(null, raw);
              },
            }),
            pick({
              filter(stack, token) {
                if (
                  stack.length === 1 &&
                  stack[0] === "enterpriseKnowledgeProjectionBindings" &&
                  token.name === "startObject"
                ) {
                  canonicalBindingsPresent = true;
                }
                if (
                  stack.length !== 2 ||
                  typeof stack[0] !== "string" ||
                  typeof stack[1] !== "string" ||
                  (!sections.includes(stack[0]) && stack[0] !== "knowledgeProjectionBindings")
                ) {
                  return false;
                }
                const alias = stack[0] === "knowledgeProjectionBindings";
                if (alias && canonicalBindingsPresent) {
                  return false;
                }
                keys.push([
                  alias ? "enterpriseKnowledgeProjectionBindings" : stack[0],
                  stack[1],
                  alias,
                ]);
                return true;
              },
            }),
            streamValues(),
            new Writable({
              objectMode: true,
              write(raw: unknown, _encoding, done) {
                try {
                  const key = keys.shift();
                  if (!key) {
                    throw new Error("enterprise_store_import_key_missing");
                  }
                  const row = encode((raw as { value: unknown }).value);
                  insert.run(key[0], key[1], row.tenant, row.trace, row.body);
                  if (key[0] === "enterpriseKnowledgeProjectionBindings") {
                    (key[2] ? aliasBindingIds : canonicalBindingIds).add(key[1]);
                  }
                  done();
                } catch (error) {
                  done(error as Error);
                }
              },
            }),
          );
        }
        if (canonicalBindingsPresent) {
          const removeAlias = db.prepare(
            "DELETE FROM records WHERE section='enterpriseKnowledgeProjectionBindings' AND id=?",
          );
          for (const id of aliasBindingIds) {
            if (!canonicalBindingIds.has(id)) {
              removeAlias.run(id);
            }
          }
        }
        if (before !== fingerprint(file)) {
          throw new Error("enterprise_store_changed_during_import");
        }
        db.prepare("INSERT INTO meta VALUES('legacy_fingerprint',?)").run(before);
        db.exec("COMMIT");
        db.close();
        fs.renameSync(temp, target);
      } catch (error) {
        try {
          db.close();
        } catch {
          /* already closed */
        }
        fs.rmSync(temp, { force: true });
        fs.rmSync(`${temp}-journal`, { force: true });
        throw error;
      }
    },
  );
}
export async function ensureIndexedEnterpriseStore(
  file: string,
  sections: readonly string[],
): Promise<void> {
  const pending = migrationInFlight.get(file);
  if (pending) {
    return pending;
  }
  const operation = importLegacy(file, sections);
  migrationInFlight.set(file, operation);
  try {
    await operation;
  } finally {
    migrationInFlight.delete(file);
  }
}

function lazyMap(view: View, section: string): Record<string, unknown> {
  const entries = new Map<string, Entry>();
  const deleted = new Set<string>();
  const target: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const read = (id: string): unknown => {
    if (deleted.has(id)) {
      return undefined;
    }
    if (entries.has(id)) {
      return entries.get(id)?.value;
    }
    const db = open(view.file);
    try {
      const row = db
        .prepare("SELECT body,revision FROM records WHERE section=? AND id=?")
        .get(section, id) as Row | undefined;
      if (!row) {
        return undefined;
      }
      const value: unknown = JSON.parse(row.body);
      entries.set(id, { original: row.body, revision: row.revision, value });
      return value;
    } finally {
      db.close();
    }
  };
  const proxy = new Proxy(target, {
    get(_t, key) {
      return typeof key === "string" ? read(key) : undefined;
    },
    set(_t, key, value: unknown) {
      if (typeof key !== "string" || key === "__proto__") {
        throw new Error("enterprise_store_unsafe_record_key");
      }
      read(key);
      const prior = entries.get(key);
      entries.set(key, { original: prior?.original, revision: prior?.revision ?? 0, value });
      deleted.delete(key);
      return true;
    },
    deleteProperty(_t, key) {
      if (typeof key === "string") {
        read(key);
        deleted.add(key);
      }
      return true;
    },
    ownKeys() {
      const db = open(view.file);
      try {
        const rows = db
          .prepare("SELECT id,body,revision FROM records WHERE section=? ORDER BY id")
          .all(section) as Array<Row & { id: string }>;
        for (const row of rows) {
          if (!entries.has(row.id) && !deleted.has(row.id)) {
            entries.set(row.id, {
              original: row.body,
              revision: row.revision,
              value: JSON.parse(row.body) as unknown,
            });
          }
        }
        return [...new Set([...rows.map((row) => row.id), ...entries.keys()])].filter(
          (id) => !deleted.has(id),
        );
      } finally {
        db.close();
      }
    },
    getOwnPropertyDescriptor(_t, key) {
      return typeof key === "string" && read(key) !== undefined
        ? { enumerable: true, configurable: true }
        : undefined;
    },
    has(_t, key) {
      return typeof key === "string" && read(key) !== undefined;
    },
  });
  const map = { section, entries, deleted, proxy };
  view.maps.set(section, map);
  mapViews.set(proxy, { view, map });
  return proxy;
}
export async function loadIndexedEnterpriseStore(
  file: string,
  blank: EnterpriseDataStore,
): Promise<EnterpriseDataStore> {
  const sections = Object.keys(blank).filter((key) => key !== "version");
  await ensureIndexedEnterpriseStore(file, sections);
  const db = open(file);
  const revision = Number(
    (db.prepare("SELECT value FROM meta WHERE key='revision'").get() as { value: string }).value,
  );
  db.close();
  const view: View = { file, revision, maps: new Map() };
  const result: Record<string, unknown> = { version: blank.version };
  for (const section of sections) {
    result[section] = lazyMap(view, section);
  }
  views.set(result, view);
  return result as EnterpriseDataStore;
}

export async function saveIndexedEnterpriseStore(
  file: string,
  store: EnterpriseDataStore,
  blank: EnterpriseDataStore,
): Promise<void> {
  await ensureIndexedEnterpriseStore(
    file,
    Object.keys(blank).filter((key) => key !== "version"),
  );
  const view = views.get(store);
  if (view && view.file !== file) {
    throw new Error("enterprise_store_cross_path_save");
  }
  const db = open(file);
  const committed: Array<() => void> = [];
  try {
    db.exec("BEGIN IMMEDIATE");
    const revision = Number(
      (db.prepare("SELECT value FROM meta WHERE key='revision'").get() as { value: string }).value,
    );
    const get = db.prepare("SELECT body,revision FROM records WHERE section=? AND id=?");
    const insert = db.prepare("INSERT INTO records VALUES(?,?,?,?,?,?)");
    const update = db.prepare(
      "UPDATE records SET tenant=?,trace=?,body=?,revision=? WHERE section=? AND id=?",
    );
    const remove = db.prepare("DELETE FROM records WHERE section=? AND id=?");
    for (const section of Object.keys(blank).filter((key) => key !== "version")) {
      const current = (store as unknown as Record<string, unknown>)[section];
      const map = view?.maps.get(section);
      if (map && current === map.proxy) {
        for (const id of new Set([...map.entries.keys(), ...map.deleted])) {
          const entry = map.entries.get(id);
          const deleted = map.deleted.has(id);
          const row = !deleted && entry ? encode(entry.value) : undefined;
          if (!deleted && row?.body === entry?.original) {
            continue;
          }
          const existing = get.get(section, id) as Row | undefined;
          if ((existing?.revision ?? 0) !== (entry?.revision ?? 0)) {
            throw new Error("enterprise_store_write_conflict");
          }
          if (deleted) {
            remove.run(section, id);
            committed.push(() => {
              map.entries.delete(id);
              map.deleted.delete(id);
            });
          } else if (row && entry) {
            if (existing) {
              update.run(row.tenant, row.trace, row.body, revision + 1, section, id);
            } else {
              insert.run(section, id, row.tenant, row.trace, row.body, revision + 1);
            }
            committed.push(() => {
              entry.original = row.body;
              entry.revision = revision + 1;
            });
          }
        }
      } else {
        // Replacing a section must not erase records committed since this view loaded.
        if (view && view.revision !== revision) {
          throw new Error("enterprise_store_write_conflict");
        }
        // Explicitly replaced/plain maps are full section replacements, not lazy reads.
        const values = current && typeof current === "object" ? Object.entries(current) : [];
        db.prepare("DELETE FROM records WHERE section=?").run(section);
        for (const [id, value] of values) {
          const row = encode(value);
          insert.run(section, id, row.tenant, row.trace, row.body, revision + 1);
        }
      }
    }
    db.prepare("UPDATE meta SET value=? WHERE key='revision'").run(String(revision + 1));
    db.exec("COMMIT");
    if (view) {
      view.revision = revision + 1;
    }
    for (const done of committed) {
      done();
    }
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

/** Indexed tenant projection: ordinary reads never scan the legacy JSON. */
export async function readIndexedEnterpriseSections(
  file: string,
  blank: EnterpriseDataStore,
  tenant: string,
  sections: readonly string[],
  maxBytes: number,
): Promise<EnterpriseDataStore> {
  await ensureIndexedEnterpriseStore(
    file,
    Object.keys(blank).filter((key) => key !== "version"),
  );
  const db = open(file);
  const result: Record<string, unknown> = { ...blank };
  let bytes = 0;
  try {
    const select = db.prepare(
      "SELECT id,body FROM records WHERE section=? AND tenant=? ORDER BY id",
    );
    for (const section of sections.filter((key) => key !== "version")) {
      const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const raw of select.iterate(section, tenant)) {
        const row = raw as { id: string; body: string };
        bytes += Buffer.byteLength(row.body);
        if (bytes > maxBytes) {
          throw new Error("knowledge_read_projection_budget_exceeded");
        }
        values[row.id] = JSON.parse(row.body) as unknown;
      }
      result[section] = values;
    }
    return result as EnterpriseDataStore;
  } finally {
    db.close();
  }
}

/** Query by tenant/trace without enumerating the audit table; pending edits stay visible. */
export function queryEnterpriseRecordEntries<T extends { tenantId: string; traceId?: string }>(
  records: Record<string, T>,
  filter: { tenantId: string; traceId?: string },
): Array<[string, T]> {
  const binding = mapViews.get(records);
  const matches = (value: T) =>
    value.tenantId === filter.tenantId &&
    (filter.traceId === undefined || value.traceId === filter.traceId);
  if (!binding) {
    return Object.entries(records).filter(([, row]) => matches(row));
  }
  const { view, map } = binding;
  const db = open(view.file);
  try {
    const sql =
      filter.traceId === undefined
        ? "SELECT id,body,revision FROM records WHERE section=? AND tenant=? ORDER BY id"
        : "SELECT id,body,revision FROM records WHERE section=? AND tenant=? AND trace=? ORDER BY id";
    const args =
      filter.traceId === undefined
        ? [map.section, filter.tenantId]
        : [map.section, filter.tenantId, filter.traceId];
    const ids = new Set<string>();
    for (const raw of db.prepare(sql).iterate(...args)) {
      const row = raw as Row & { id: string };
      ids.add(row.id);
      if (!map.entries.has(row.id) && !map.deleted.has(row.id)) {
        map.entries.set(row.id, {
          original: row.body,
          revision: row.revision,
          value: JSON.parse(row.body) as unknown,
        });
      }
    }
    for (const id of map.entries.keys()) {
      ids.add(id);
    }
    return [...ids]
      .filter((id) => !map.deleted.has(id))
      .flatMap((id) => {
        const value = map.entries.get(id)?.value as T | undefined;
        return value && matches(value) ? [[id, value] as [string, T]] : [];
      });
  } finally {
    db.close();
  }
}
