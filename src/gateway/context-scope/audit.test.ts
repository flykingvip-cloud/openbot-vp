import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { appendContextScopeAuditRecord, listContextScopeAuditRecords } from "./audit.js";

const tmpDirs: string[] = [];

function tmpStore(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "csc-audit-"));
  tmpDirs.push(dir);
  return path.join(dir, "context-scope-audit.jsonl");
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("context scope audit", () => {
  test("records who accessed which authorized sources without the user message", () => {
    const storePath = tmpStore();
    appendContextScopeAuditRecord(
      {
        recordedAtMs: 1,
        runId: "run-1",
        sessionKey: "space:ops",
        groupId: "ops",
        tenantId: "tenant-a",
        actorUserId: "emp-1",
        agentId: "bot-ops",
        mode: "focused",
        confidentialityMaxLevel: "internal",
        allowedSources: [
          { type: "knowledge", id: "kb-product" },
          { type: "file", id: "doc-roadmap", parentId: "kb-product" },
        ],
        deniedSources: [{ type: "knowledge", id: "kb-finance", reason: "confidentiality" }],
        consumeReceipts: [
          {
            ref: { type: "knowledge-file", id: "doc-roadmap", parentId: "kb-product" },
            status: "consumed",
            evidenceKind: "index-chunk",
            chunkIds: ["chunk-roadmap"],
            chars: 42,
          },
        ],
        budgetMaxTokens: 24_000,
        budgetMaxFiles: 20,
        evidenceCount: 2,
        selectedSourceCount: 1,
      },
      storePath,
    );
    const raw = fs.readFileSync(storePath, "utf8");
    expect(raw).not.toContain("帮我看财报");
    const listed = listContextScopeAuditRecords({ tenantId: "tenant-a", storePath });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.actorUserId).toBe("emp-1");
    expect(listed[0]?.agentId).toBe("bot-ops");
    expect(listed[0]?.groupId).toBe("ops");
    expect(listed[0]?.allowedSources).toEqual([
      { type: "knowledge", id: "kb-product" },
      { type: "file", id: "doc-roadmap", parentId: "kb-product" },
    ]);
    expect(listed[0]?.deniedSources[0]?.reason).toBe("confidentiality");
    expect(listed[0]?.consumeReceipts).toEqual([
      expect.objectContaining({
        ref: { type: "knowledge-file", id: "doc-roadmap", parentId: "kb-product" },
        status: "consumed",
        chunkIds: ["chunk-roadmap"],
      }),
    ]);
    expect(listed[0]?.budgetMaxTokens).toBe(24_000);
  });

  test("does not leak another tenant's retrieval audit", () => {
    const storePath = tmpStore();
    appendContextScopeAuditRecord(
      {
        recordedAtMs: 1,
        sessionKey: "agent:main:main",
        tenantId: "tenant-a",
        mode: "auto",
        confidentialityMaxLevel: "internal",
        allowedSources: [],
        deniedSources: [],
        budgetMaxTokens: 8_000,
        budgetMaxFiles: 0,
      },
      storePath,
    );
    expect(listContextScopeAuditRecords({ tenantId: "tenant-b", storePath })).toEqual([]);
    expect(listContextScopeAuditRecords({ tenantId: "", storePath })).toEqual([]);
  });
});
