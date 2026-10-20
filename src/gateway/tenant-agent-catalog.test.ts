import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFileTenantAgentCatalogSource,
  createLocalFileAgentCatalogPort,
  getTenantAgentCatalogEntry,
  listTenantAgentCatalogEntries,
  previewTenantAgentCatalogMigration,
  seedTenantAgentCatalogFromLocalAgents,
  setAgentCatalogPortForTests,
  setTenantAgentCatalogSourceForTests,
  upsertTenantAgentCatalogEntry,
} from "./tenant-agent-catalog.js";

describe("tenant-agent-catalog", () => {
  const dirs: string[] = [];

  afterEach(() => {
    setAgentCatalogPortForTests(null);
    setTenantAgentCatalogSourceForTests(null);
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function useTempCatalog() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-catalog-"));
    dirs.push(dir);
    const file = path.join(dir, "agent-catalog.json");
    const source = createFileTenantAgentCatalogSource(file);
    setTenantAgentCatalogSourceForTests(source);
    setAgentCatalogPortForTests(createLocalFileAgentCatalogPort(source, "test-local-adapter"));
    return file;
  }

  it("upserts and lists entries by tenant", async () => {
    useTempCatalog();
    await upsertTenantAgentCatalogEntry({
      tenantId: "upbeyond",
      agentId: "panda",
      name: "熊猫学习",
      ownerId: "user-ceo",
      scope: "self",
    });
    await upsertTenantAgentCatalogEntry({
      tenantId: "other",
      agentId: "panda",
      name: "Other panda",
    });

    const rows = await listTenantAgentCatalogEntries({ tenantId: "upbeyond" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("熊猫学习");
    expect(
      (await getTenantAgentCatalogEntry({ tenantId: "upbeyond", agentId: "panda" }))?.ownerId,
    ).toBe("user-ceo");
  });

  it("fail-closes list/upsert without tenantId", async () => {
    useTempCatalog();
    expect(await listTenantAgentCatalogEntries({})).toEqual([]);
    await expect(
      upsertTenantAgentCatalogEntry({
        tenantId: "  ",
        agentId: "panda",
        name: "x",
      }),
    ).rejects.toThrow(/tenantId required/);
  });

  it("seeds from local agents idempotently and previews migration", async () => {
    useTempCatalog();
    const agents = [
      { id: "bot-2", name: "市场助手", ownerId: "user-ceo", scope: "self" },
      { id: "main", name: "大白管家", scope: "self" },
    ];
    const first = await seedTenantAgentCatalogFromLocalAgents({ tenantId: "upbeyond", agents });
    expect(first.upserted).toBe(2);

    const preview = await previewTenantAgentCatalogMigration({ tenantId: "upbeyond", agents });
    expect(preview.map((row) => row.action)).toEqual(["unchanged", "unchanged"]);
  });
});
