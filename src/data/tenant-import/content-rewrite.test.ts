import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyContentIdRewriteToStaging,
  flattenRemapPlanToIdMap,
  rewriteJsonIdReferences,
} from "./content-rewrite.js";
import { buildIdRemapPlan } from "./id-remap.js";
import { TENANT_IMPORT_MANIFEST_NAME } from "./manifest.js";

function counter(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

describe("flattenRemapPlanToIdMap", () => {
  it("includes only ids that change (unchanged semantic agent excluded)", () => {
    const plan = buildIdRemapPlan({
      targetTenantId: "acme",
      users: [{ sourceUserId: "u-src" }],
      seatIds: ["s1"],
      groupIds: ["g1"],
      knowledgeBaseIds: ["kb1"],
      identityIds: ["idn1"],
      agentIds: ["main", "sales"],
      existingAgentIds: ["main"], // main -> main-imported; sales stays
      newId: counter(),
    });
    const map = flattenRemapPlanToIdMap(plan);
    expect(map["u-src"]).toBe("id-1");
    expect(map.s1).toBe("id-2");
    expect(map.g1).toBe("id-3");
    expect(map.kb1).toBe("id-4");
    expect(map.idn1).toBe("id-5");
    expect(map.main).toBe("main-imported");
    expect(map.sales).toBeUndefined(); // unchanged agent not in the map
  });

  it("can exclude agents entirely", () => {
    const plan = buildIdRemapPlan({
      targetTenantId: "acme",
      users: [],
      agentIds: ["main"],
      existingAgentIds: ["main"],
      newId: counter(),
    });
    expect(flattenRemapPlanToIdMap(plan, { includeAgents: false }).main).toBeUndefined();
  });
});

describe("rewriteJsonIdReferences", () => {
  const idMap = { "u-src": "u-new", s1: "seat-1", kb1: "kb-new" };

  it("rewrites exact string values in nested objects and arrays", () => {
    const input = { userId: "u-src", nested: { list: ["s1", "keep"] } };
    expect(rewriteJsonIdReferences(input, idMap)).toEqual({
      userId: "u-new",
      nested: { list: ["seat-1", "keep"] },
    });
  });

  it("rewrites id-keyed object keys", () => {
    expect(rewriteJsonIdReferences({ kb1: { x: 1 } }, idMap)).toEqual({ "kb-new": { x: 1 } });
  });

  it("never rewrites substrings or non-string values", () => {
    expect(rewriteJsonIdReferences({ a: "u-src-extra", n: 5, b: true }, idMap)).toEqual({
      a: "u-src-extra",
      n: 5,
      b: true,
    });
  });
});

describe("applyContentIdRewriteToStaging", () => {
  let staging = "";
  beforeEach(async () => {
    staging = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-content-"));
  });
  afterEach(async () => {
    await fs.rm(staging, { recursive: true, force: true });
  });

  it("rewrites id references in staged JSON but never the manifest", async () => {
    await fs.mkdir(path.join(staging, "control-plane"), { recursive: true });
    await fs.writeFile(
      path.join(staging, "control-plane", "seat-assets.json"),
      JSON.stringify({ seatId: "s1", agentId: "main" }),
    );
    await fs.writeFile(
      path.join(staging, TENANT_IMPORT_MANIFEST_NAME),
      JSON.stringify({ contents: { userDataSpaces: ["u-src"] } }),
    );
    await fs.writeFile(path.join(staging, "note.txt"), "s1"); // non-json, untouched

    const result = await applyContentIdRewriteToStaging({
      stagedRoot: staging,
      idMap: { s1: "seat-1", main: "main-imported", "u-src": "u-new" },
    });
    expect(result.filesRewritten).toBe(1);

    const seat = JSON.parse(
      await fs.readFile(path.join(staging, "control-plane", "seat-assets.json"), "utf-8"),
    );
    expect(seat).toEqual({ seatId: "seat-1", agentId: "main-imported" });

    // Manifest documents the SOURCE package; its ids must stay untouched.
    const manifest = JSON.parse(
      await fs.readFile(path.join(staging, TENANT_IMPORT_MANIFEST_NAME), "utf-8"),
    );
    expect(manifest.contents.userDataSpaces).toEqual(["u-src"]);
  });

  it("is a no-op for an empty id map", async () => {
    await fs.writeFile(path.join(staging, "x.json"), '{"seatId":"s1"}');
    const result = await applyContentIdRewriteToStaging({ stagedRoot: staging, idMap: {} });
    expect(result).toEqual({ filesScanned: 0, filesRewritten: 0 });
  });
});
