import { describe, expect, it } from "vitest";
import {
  readItem6AuthorizedSqliteSnapshot,
  readItem6AuthorizedSqliteTableForeignKeys,
  readItem6AuthorizedSqliteTableIndexes,
  readItem6AuthorizedSqliteTableRowSample,
  readItem6AuthorizedSqliteTableSchema,
  readItem6AuthorizedSqliteTableTriggers,
  readItem6AuthorizedSqliteTableXinfo,
} from "./item6-authorized-sqlite-read.js";
import { createItem6TrustedOperatorFixtureWithSql } from "./item6-authorized-sqlite-test-fixtures.js";

describe("Item 6 authorized sqlite read-only snapshot", () => {
  it("fail-closed without authorized path", () => {
    const result = readItem6AuthorizedSqliteSnapshot({});
    expect("ok" in result && !result.ok).toBe(true);
  });

  it("reads integrity_check read-only on authorized path", () => {
    const fixture = createItem6TrustedOperatorFixtureWithSql(
      "read",
      "CREATE TABLE item6_probe (id INTEGER PRIMARY KEY)",
    );
    const snapshot = readItem6AuthorizedSqliteSnapshot(fixture.env);
    expect("integrityCheck" in snapshot).toBe(true);
    if ("integrityCheck" in snapshot) {
      expect(snapshot.integrityCheck).toBe("ok");
      expect(snapshot.readOnly).toBe(true);
      expect(snapshot.productionSqliteWrite).toBe(false);
      expect(snapshot.tableCount).toBeGreaterThanOrEqual(1);
      expect(snapshot.tableNames).toContain("item6_probe");
    }
  });

  it("reads table schema read-only on authorized path", () => {
    const fixture = createItem6TrustedOperatorFixtureWithSql(
      "schema",
      "CREATE TABLE item6_probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)",
    );
    const schema = readItem6AuthorizedSqliteTableSchema("item6_probe", fixture.env);
    expect("columns" in schema).toBe(true);
    if ("columns" in schema) {
      expect(schema.columns.length).toBe(2);
      expect(schema.readOnly).toBe(true);
      expect(schema.productionSqliteWrite).toBe(false);
    }
  });

  it("reads table indexes read-only on authorized path", () => {
    const fixture = createItem6TrustedOperatorFixtureWithSql(
      "index",
      "CREATE TABLE item6_probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL); CREATE INDEX item6_probe_label ON item6_probe(label)",
    );
    const indexes = readItem6AuthorizedSqliteTableIndexes("item6_probe", fixture.env);
    expect(indexes.ok).toBe(true);
    if (indexes.ok) {
      expect(indexes.indexes.length).toBeGreaterThanOrEqual(1);
      expect(indexes.indexes[0]?.readOnly).toBe(true);
    }
  });

  it("reads table foreign keys read-only on authorized path", () => {
    const fixture = createItem6TrustedOperatorFixtureWithSql(
      "fk",
      "PRAGMA foreign_keys=ON; CREATE TABLE item6_parent (id INTEGER PRIMARY KEY); CREATE TABLE item6_child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES item6_parent(id))",
    );
    const foreignKeys = readItem6AuthorizedSqliteTableForeignKeys("item6_child", fixture.env);
    expect(foreignKeys.ok).toBe(true);
    if (foreignKeys.ok) {
      expect(foreignKeys.foreignKeys.length).toBe(1);
      expect(foreignKeys.foreignKeys[0]?.referencedTable).toBe("item6_parent");
      expect(foreignKeys.foreignKeys[0]?.readOnly).toBe(true);
    }
  });

  it("reads table triggers read-only on authorized path", () => {
    const fixture = createItem6TrustedOperatorFixtureWithSql(
      "trg",
      "CREATE TABLE item6_parent (id INTEGER PRIMARY KEY); CREATE TRIGGER item6_parent_ai AFTER INSERT ON item6_parent BEGIN SELECT 1; END",
    );
    const triggers = readItem6AuthorizedSqliteTableTriggers("item6_parent", fixture.env);
    expect(triggers.ok).toBe(true);
    if (triggers.ok) {
      expect(triggers.triggers.some((row) => row.triggerName === "item6_parent_ai")).toBe(true);
    }
  });

  it("reads table_xinfo read-only on authorized path", () => {
    const fixture = createItem6TrustedOperatorFixtureWithSql(
      "xinfo",
      "CREATE TABLE item6_xinfo (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
    );
    const xinfo = readItem6AuthorizedSqliteTableXinfo("item6_xinfo", fixture.env);
    expect(xinfo.ok).toBe(true);
    if (xinfo.ok) {
      expect(
        xinfo.columns.some((col) => col.name === "name" && col.notNull && col.hidden === 0),
      ).toBe(true);
      expect(xinfo.productionSqliteWrite).toBe(false);
    }
  });

  it("reads capped row sample counts read-only on authorized path", () => {
    const fixture = createItem6TrustedOperatorFixtureWithSql(
      "sample",
      "CREATE TABLE item6_sample (id INTEGER PRIMARY KEY); INSERT INTO item6_sample (id) VALUES (1),(2),(3),(4),(5),(6),(7)",
    );
    const sample = readItem6AuthorizedSqliteTableRowSample("item6_sample", fixture.env);
    expect(sample.ok).toBe(true);
    if (sample.ok) {
      expect(sample.rowCount).toBe(7);
      expect(sample.sampleSize).toBe(5);
      expect(sample.sampleCap).toBe(5);
      expect(sample.productionSqliteWrite).toBe(false);
    }
  });
});
