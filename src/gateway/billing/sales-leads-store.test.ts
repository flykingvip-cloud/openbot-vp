// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSalesLead, listSalesLeads } from "./sales-leads-store.js";

let dir: string;
let storePath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sales-leads-"));
  storePath = path.join(dir, "openbot-sales-leads.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("sales-leads-store", () => {
  it("创建线索并保留必填字段与可选字段", async () => {
    const lead = await createSalesLead(
      {
        planId: "plan-ent",
        company: "Acme",
        contact: "张三",
        phone: "13800000000",
        scale: "120",
        requirements: "私有化部署",
        submittedByUserId: "u-1",
      },
      storePath,
    );
    expect(lead.id).toMatch(/^lead-/);
    expect(lead.company).toBe("Acme");
    expect(lead.planId).toBe("plan-ent");
    expect(lead.scale).toBe("120");
    expect(lead.submittedByUserId).toBe("u-1");
    expect(lead.createdAt).toBeTruthy();
  });

  it("省略可选字段时不写入空键", async () => {
    const lead = await createSalesLead({ company: "B", contact: "李四", phone: "139" }, storePath);
    expect("planId" in lead).toBe(false);
    expect("scale" in lead).toBe(false);
    expect("requirements" in lead).toBe(false);
    expect("submittedByUserId" in lead).toBe(false);
  });

  it("append-only：list 返回最新在前", async () => {
    await createSalesLead({ company: "1", contact: "a", phone: "1" }, storePath);
    await createSalesLead({ company: "2", contact: "b", phone: "2" }, storePath);
    const leads = await listSalesLeads(storePath);
    expect(leads.map((l) => l.company)).toEqual(["2", "1"]);
  });

  it("空 store 返回空数组", async () => {
    expect(await listSalesLeads(storePath)).toEqual([]);
  });
});
