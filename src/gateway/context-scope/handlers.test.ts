import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CollaborationContextScopeRecord } from "../collaboration-ledger/types.js";

const readCollaborationLedgerArchive = vi.fn();
const resolveTrustedCollaborationTenantId = vi.fn();
const loadContextScopeCatalog = vi.fn();

vi.mock("../collaboration-ledger/reader.js", () => ({
  readCollaborationLedgerArchive: (...args: unknown[]) => readCollaborationLedgerArchive(...args),
}));

vi.mock("../collaboration-learning/trusted-tenant.js", () => ({
  resolveTrustedCollaborationTenantId: (...args: unknown[]) =>
    resolveTrustedCollaborationTenantId(...args),
}));

vi.mock("./catalog.js", () => ({
  loadContextScopeCatalog: (...args: unknown[]) => loadContextScopeCatalog(...args),
}));

vi.mock("./audit.js", () => ({
  listContextScopeAuditRecords: vi.fn(() => {
    throw new Error("JSONL must not be the production audit SoT");
  }),
}));

const { contextScopeHandlers } = await import("./handlers.js");

describe("context.scope.audit.list", () => {
  beforeEach(() => {
    readCollaborationLedgerArchive.mockReset();
    resolveTrustedCollaborationTenantId.mockReset();
    loadContextScopeCatalog.mockReset();
  });

  test("serves Collaboration Ledger context_scope records, not JSONL", async () => {
    const record: CollaborationContextScopeRecord = {
      kind: "context_scope",
      groupId: "alpha",
      sessionKey: "space:alpha",
      mode: "focused",
      confidentialityMaxLevel: "internal",
      allowedSources: [{ type: "file", id: "notes.md" }],
      deniedSources: [],
      budgetMaxTokens: 24_000,
      budgetMaxFiles: 20,
      recordedAtMs: 1,
    };
    resolveTrustedCollaborationTenantId.mockResolvedValue("tenant-a");
    readCollaborationLedgerArchive.mockResolvedValue({
      groupId: "alpha",
      records: [record],
      totalRead: 1,
      truncated: false,
      sources: ["/tmp/ledger.jsonl"],
    });
    const respond = vi.fn();
    await contextScopeHandlers["context.scope.audit.list"]({
      client: {} as never,
      params: { groupId: "alpha" },
      respond,
    } as never);
    expect(readCollaborationLedgerArchive).toHaveBeenCalledWith({
      groupId: "alpha",
      // P0.0a: the server-resolved tenant addresses the runtime namespace.
      tenantId: "tenant-a",
      kinds: ["context_scope"],
    });
    expect(respond).toHaveBeenCalledWith(true, {
      records: [record],
      source: "collaboration_ledger",
    });
  });

  test("does not invent a JSONL SoT when groupId is missing", async () => {
    resolveTrustedCollaborationTenantId.mockResolvedValue("tenant-a");
    const respond = vi.fn();
    await contextScopeHandlers["context.scope.audit.list"]({
      client: {} as never,
      params: {},
      respond,
    } as never);
    expect(readCollaborationLedgerArchive).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(true, {
      records: [],
      source: "collaboration_ledger",
    });
  });
});
