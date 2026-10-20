import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFileInterventionCaseStore,
  createMemoryInterventionCaseStore,
  resolveInterventionCaseStorePath,
} from "./intervention-case-store.js";
import { newInterventionCaseId, type InterventionCase } from "./intervention-case.js";

function base(partial: Partial<InterventionCase> = {}): InterventionCase {
  return {
    schemaVersion: 1,
    caseId: newInterventionCaseId("persist-t1"),
    tenantId: "001",
    status: "expanding",
    actionKind: "identity",
    title: "补身份字段",
    actor: "owner",
    source: {
      actionId: "act:identity:main",
      growthAgentId: "main",
      growthGroupId: "grp-daniel-hhd-gmail-com-upbeyond",
    },
    target: {
      kind: "group_parent",
      agentId: "main",
      sessionKey: null,
    },
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    ...partial,
  };
}

describe("InterventionCase file store (P1)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists put and reads back after new store instance (restart-equivalent)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ic-store-"));
    dirs.push(dir);
    const filePath = path.join(dir, "diagnosis-intervention-cases.json");
    const row = base();
    const a = createFileInterventionCaseStore(filePath);
    a.put(row);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(a.filePath).toBe(filePath);

    // New instance = process restart re-open
    const b = createFileInterventionCaseStore(filePath);
    const got = b.get(row.caseId);
    expect(got?.caseId).toBe(row.caseId);
    expect(got?.tenantId).toBe("001");
    expect(got?.status).toBe("expanding");
    expect(got?.source.growthGroupId).toBe("grp-daniel-hhd-gmail-com-upbeyond");
  });

  it("reload() re-reads disk after external overwrite", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ic-store-"));
    dirs.push(dir);
    const filePath = path.join(dir, "diagnosis-intervention-cases.json");
    const store = createFileInterventionCaseStore(filePath);
    const row = base({ status: "suggested" });
    store.put(row);

    const other = createFileInterventionCaseStore(filePath);
    other.put({ ...row, status: "queued", updatedAt: "2026-10-15T01:00:00.000Z" });

    expect(store.get(row.caseId)?.status).toBe("suggested");
    store.reload?.();
    expect(store.get(row.caseId)?.status).toBe("queued");
  });

  it("put is idempotent by caseId (overwrite same id)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ic-store-"));
    dirs.push(dir);
    const filePath = path.join(dir, "diagnosis-intervention-cases.json");
    const store = createFileInterventionCaseStore(filePath);
    const row = base();
    store.put(row);
    store.put({ ...row, status: "queued", title: "updated" });
    expect(store.list().length).toBe(1);
    expect(store.get(row.caseId)?.title).toBe("updated");
    expect(store.get(row.caseId)?.status).toBe("queued");
  });

  it("atomic write leaves no .tmp after put", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ic-store-"));
    dirs.push(dir);
    const filePath = path.join(dir, "diagnosis-intervention-cases.json");
    createFileInterventionCaseStore(filePath).put(base());
    const leftovers = fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("memory store still works for tests", () => {
    const row = base({ caseId: newInterventionCaseId("mem") });
    const store = createMemoryInterventionCaseStore([row]);
    expect(store.get(row.caseId)?.caseId).toBe(row.caseId);
    store.reload?.();
    expect(store.get(row.caseId)?.caseId).toBe(row.caseId);
  });

  it("resolveInterventionCaseStorePath respects override env", () => {
    const prev = process.env.OPENBOT_INTERVENTION_CASE_STORE_PATH;
    process.env.OPENBOT_INTERVENTION_CASE_STORE_PATH = "/tmp/ic-override-test.json";
    try {
      expect(resolveInterventionCaseStorePath("/ignored")).toBe("/tmp/ic-override-test.json");
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_INTERVENTION_CASE_STORE_PATH;
      } else {
        process.env.OPENBOT_INTERVENTION_CASE_STORE_PATH = prev;
      }
    }
  });
});
