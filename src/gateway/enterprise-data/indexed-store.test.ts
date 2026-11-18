import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { indexedEnterpriseStorePath, readIndexedEnterpriseSections } from "./indexed-store.js";
import {
  loadEnterpriseDataStore,
  saveEnterpriseDataStore,
  normalizeEnterpriseDataStore,
} from "./store.js";
const dirs: string[] = [];
function file() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enterprise-indexed-"));
  dirs.push(dir);
  return path.join(dir, "enterprise-data.json");
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
function seed(file: string) {
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      dataSources: {
        own: { sourceId: "own", tenantId: "tenant", displayName: "old" },
        foreign: { sourceId: "foreign", tenantId: "other", displayName: "private" },
      },
      dataAuditEvents: {
        a: { tenantId: "tenant", traceId: "trace", unknownFields: ["preserved"] },
      },
    }),
  );
}
it("imports once, preserves the original JSON and reads tenant sections from indexes", async () => {
  const p = file();
  seed(p);
  const before = fs.readFileSync(p, "utf8");
  const store = await loadEnterpriseDataStore(p);
  expect(store.dataSources.own).toMatchObject({ displayName: "old" });
  expect(fs.existsSync(indexedEnterpriseStorePath(p))).toBe(true);
  const projected = await readIndexedEnterpriseSections(
    p,
    normalizeEnterpriseDataStore(null),
    "tenant",
    ["dataSources"],
    10000,
  );
  expect(Object.keys(projected.dataSources)).toEqual(["own"]);
  expect(projected.dataAuditEvents).toEqual({});
  expect(fs.readFileSync(p, "utf8")).toBe(before);
  store.dataSources.own.displayName = "new";
  await saveEnterpriseDataStore(store, p);
  expect((await loadEnterpriseDataStore(p)).dataSources.own.displayName).toBe("new");
  expect(fs.readFileSync(p, "utf8")).toBe(before);
  expect((await loadEnterpriseDataStore(p)).dataAuditEvents.a.unknownFields).toEqual(["preserved"]);
});
it("merges independent row changes but rejects stale writes to the same row", async () => {
  const p = file();
  seed(p);
  const a = await loadEnterpriseDataStore(p),
    b = await loadEnterpriseDataStore(p);
  a.dataSources.own.displayName = "a";
  b.dataSources.foreign.displayName = "b";
  await saveEnterpriseDataStore(a, p);
  await saveEnterpriseDataStore(b, p);
  const c = await loadEnterpriseDataStore(p),
    d = await loadEnterpriseDataStore(p);
  c.dataSources.own.displayName = "c";
  d.dataSources.own.displayName = "d";
  await saveEnterpriseDataStore(c, p);
  await expect(saveEnterpriseDataStore(d, p)).rejects.toThrow("enterprise_store_write_conflict");
  expect((await loadEnterpriseDataStore(p)).dataSources.own.displayName).toBe("c");
});
it("persists nested mutations and deletes without rewriting unrelated maps", async () => {
  const p = file();
  seed(p);
  const s = await loadEnterpriseDataStore(p);
  s.dataAuditEvents.a.unknownFields.push("extra");
  delete s.dataSources.foreign;
  await saveEnterpriseDataStore(s, p);
  const r = await loadEnterpriseDataStore(p);
  expect(r.dataAuditEvents.a.unknownFields).toEqual(["preserved", "extra"]);
  expect(Object.keys(r.dataSources)).toEqual(["own"]);
});
it("does not activate a partial import and refuses legacy edits after migration", async () => {
  const p = file();
  fs.writeFileSync(p, '{"dataSources":{"x":');
  await expect(loadEnterpriseDataStore(p)).rejects.toThrow();
  expect(fs.existsSync(indexedEnterpriseStorePath(p))).toBe(false);
  seed(p);
  await loadEnterpriseDataStore(p);
  fs.appendFileSync(p, " ");
  await expect(loadEnterpriseDataStore(p)).rejects.toThrow(
    "enterprise_store_legacy_changed_after_migration",
  );
});

it("rejects stale section replacement so it cannot erase another writer's records", async () => {
  const p = file();
  seed(p);
  const a = await loadEnterpriseDataStore(p),
    b = await loadEnterpriseDataStore(p);
  a.dataSources.own.displayName = "updated";
  await saveEnterpriseDataStore(a, p);
  b.dataSources = {};
  await expect(saveEnterpriseDataStore(b, p)).rejects.toThrow("enterprise_store_write_conflict");
  expect((await loadEnterpriseDataStore(p)).dataSources.own.displayName).toBe("updated");
});

it("does not scan JSON after index activation", async () => {
  const p = file();
  seed(p);
  await loadEnterpriseDataStore(p);
  const scan = vi.spyOn(fs, "createReadStream");
  try {
    const result = await readIndexedEnterpriseSections(
      p,
      normalizeEnterpriseDataStore(null),
      "tenant",
      ["dataSources"],
      10000,
    );
    expect(Object.keys(result.dataSources)).toEqual(["own"]);
    expect(scan).not.toHaveBeenCalled();
  } finally {
    scan.mockRestore();
  }
});

it("reopens the authoritative database in a fresh process with audit history intact", async () => {
  const p = file();
  seed(p);
  const store = await loadEnterpriseDataStore(p);
  store.dataSources.own.displayName = "committed";
  await saveEnterpriseDataStore(store, p);
  const moduleUrl = new URL("./store.ts", import.meta.url).href;
  const code = `import {loadEnterpriseDataStore} from ${JSON.stringify(moduleUrl)};const s=await loadEnterpriseDataStore(${JSON.stringify(p)});console.log(JSON.stringify({name:s.dataSources.own.displayName,audit:s.dataAuditEvents.a.unknownFields}));`;
  const result = JSON.parse(
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
      encoding: "utf8",
    }),
  );
  expect(result).toEqual({ name: "committed", audit: ["preserved"] });
});
it("detects a replaced row even when a stale writer loaded the previous incarnation", async () => {
  const p = file();
  seed(p);
  const stale = await loadEnterpriseDataStore(p);
  stale.dataSources.own.displayName = "stale";
  const replacement = await loadEnterpriseDataStore(p);
  replacement.dataSources = { ...replacement.dataSources };
  replacement.dataSources.own.displayName = "replaced";
  await saveEnterpriseDataStore(replacement, p);
  await expect(saveEnterpriseDataStore(stale, p)).rejects.toThrow(
    "enterprise_store_write_conflict",
  );
});

it("keeps legacy binding aliases only when the official map is absent", async () => {
  const p = file();
  fs.writeFileSync(
    p,
    JSON.stringify({
      knowledgeProjectionBindings: { old: { tenantId: "tenant", bindingId: "old" } },
    }),
  );
  expect(
    Object.keys((await loadEnterpriseDataStore(p)).enterpriseKnowledgeProjectionBindings),
  ).toEqual(["old"]);
  const q = file();
  fs.writeFileSync(
    q,
    JSON.stringify({
      knowledgeProjectionBindings: { old: { tenantId: "tenant", bindingId: "old" } },
      enterpriseKnowledgeProjectionBindings: {},
    }),
  );
  expect(
    Object.keys((await loadEnterpriseDataStore(q)).enterpriseKnowledgeProjectionBindings),
  ).toEqual([]);
});
