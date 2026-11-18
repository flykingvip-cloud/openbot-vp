import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { readKnowledgeEnterpriseStore } from "./streaming-store-read.js";
const dirs: string[] = [];
function file() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-projection-"));
  dirs.push(dir);
  return path.join(dir, "store.json");
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
it("skips large audit strings before assembly and returns only tenant catalog rows", async () => {
  const storePath = file();
  const fd = fs.openSync(storePath, "w");
  fs.writeSync(fd, '{"dataAuditEvents":{"audit":{"tenantId":"tenant","unknownFields":[');
  for (let i = 0; i < 20000; i++) {
    fs.writeSync(fd, (i ? "," : "") + JSON.stringify("unneeded-path-".repeat(100)));
  }
  fs.writeSync(
    fd,
    '] }},"dataConnectorCredentials":{"secret":{"tenantId":"tenant","apiKey":"must-not-read"}},"dataSources":{"own":{"tenantId":"tenant","title":"wanted"},"foreign":{"tenantId":"other","title":"private"}}}',
  );
  fs.closeSync(fd);
  const store = await readKnowledgeEnterpriseStore({
    storePath,
    tenantId: "tenant",
    maxSelectedBytes: 2048,
  });
  expect(Object.keys(store.dataSources)).toEqual(["own"]);
  expect(store.dataSources.own).toMatchObject({ title: "wanted" });
  expect(store.dataAuditEvents).toEqual({});
  expect(store.dataConnectorCredentials).toEqual({});
  expect(fs.statSync(storePath).size).toBeGreaterThan(20_000_000);
});
it("stops selected content at its budget and never falls back to a full-store load", async () => {
  const storePath = file();
  fs.writeFileSync(
    storePath,
    JSON.stringify({
      knowledgeFeedItems: { huge: { tenantId: "tenant", body: "x".repeat(10000) } },
    }),
  );
  await expect(
    readKnowledgeEnterpriseStore({ storePath, tenantId: "tenant", maxSelectedBytes: 100 }),
  ).rejects.toThrow("knowledge_read_projection_budget_exceeded");
});
it("fails closed on malformed JSON and does not read without a tenant", async () => {
  const storePath = file();
  fs.writeFileSync(storePath, "not-json");
  await expect(readKnowledgeEnterpriseStore({ storePath, tenantId: "tenant" })).rejects.toThrow();
  expect((await readKnowledgeEnterpriseStore({ storePath, tenantId: null })).dataSources).toEqual(
    {},
  );
});
it("preserves escaped and nested values across stream boundaries", async () => {
  const storePath = file();
  const value = {
    tenantId: "tenant",
    label: 'quote" slash\\ newline\n',
    nested: [{ value: "中".repeat(30000) }],
  };
  fs.writeFileSync(storePath, JSON.stringify({ dataSources: { own: value } }));
  expect(
    (await readKnowledgeEnterpriseStore({ storePath, tenantId: "tenant" })).dataSources.own,
  ).toEqual(value);
});

it("rejects prototype-changing keys in selected data before assembly", async () => {
  const storePath = file();
  fs.writeFileSync(
    storePath,
    '{"dataSources":{"__proto__":{"tenantId":"tenant","title":"not-a-row"}}}',
  );
  await expect(readKnowledgeEnterpriseStore({ storePath, tenantId: "tenant" })).rejects.toThrow(
    "knowledge_read_unsafe_object_key",
  );
});
