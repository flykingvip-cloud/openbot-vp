// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ownershipProofFromTenantUser } from "../../gateway/data-governance/ownership-proof.js";
import { ingestKnowledgeDocument } from "../../gateway/knowledge/kb-ingest.js";
import { createKnowledgeBase } from "../../gateway/knowledge/knowledge-base-store.js";
import {
  getKnowledgeRetrievalService,
  resetKnowledgeRetrievalServiceForTests,
} from "../retrieval-service.js";
import type { RetrievalContext } from "../types.js";
import {
  createKnowledgeRetrievalSource,
  ensureKnowledgeRetrievalSourceRegistered,
  resetKnowledgeRetrievalSourceRegistrationForTests,
} from "./knowledge-source.js";

let indexRoot: string;
let storePath: string;

beforeEach(() => {
  indexRoot = path.join(os.tmpdir(), `kb-source-${randomUUID()}`);
  storePath = path.join(os.tmpdir(), `kb-store-${randomUUID()}`, "bases.json");
  resetKnowledgeRetrievalServiceForTests();
  resetKnowledgeRetrievalSourceRegistrationForTests();
});

afterEach(() => {
  fs.rmSync(indexRoot, { recursive: true, force: true });
  fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
});

async function seedIndexedKb(params: {
  title: string;
  ownerId: string;
  tenantId?: string | null;
  visibility?: "private" | "team" | "enterprise";
  robotIds?: string[];
  docText: string;
  docId?: string;
}) {
  const kb = createKnowledgeBase(
    {
      title: params.title,
      ownerId: params.ownerId,
      tenantId: params.tenantId ?? null,
      visibility: params.visibility ?? "private",
      robotIds: params.robotIds,
    },
    storePath,
  );
  await ingestKnowledgeDocument({
    kbId: kb.id,
    docId: params.docId ?? `doc-${kb.id}`,
    title: params.title,
    fileName: "policy.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(params.docText, "utf8"),
    ownerId: params.ownerId,
    tenantId: params.tenantId ?? null,
    indexRoot,
    embeddingProvider: null,
    ...(params.tenantId
      ? {
          governanceOwnershipProof: ownershipProofFromTenantUser({
            tenantId: params.tenantId,
            userId: params.ownerId,
          }),
        }
      : {}),
  });
  return kb;
}

describe("knowledge-source", () => {
  it("returns empty evidence for unauthorized caller (private kb)", async () => {
    await seedIndexedKb({
      title: "Private Refunds",
      ownerId: "user-owner",
      docText: "# Refunds\n\nPrivate refund escalation policy.",
    });

    const source = createKnowledgeRetrievalSource({ storePath, indexRoot });
    const outsider: RetrievalContext = {
      userId: "user-outsider",
      seatId: "seat-x",
      tenantId: null,
    };
    const results = await source.search("refund escalation", outsider);
    expect(results).toEqual([]);
  });

  it("returns KnowledgeEvidence for authorized owner with kb title and sourceUri", async () => {
    const kb = await seedIndexedKb({
      title: "Owner Refunds",
      ownerId: "user-owner",
      docText: "# Refunds\n\nOwner refund escalation policy details.",
    });

    const source = createKnowledgeRetrievalSource({ storePath, indexRoot });
    const owner: RetrievalContext = { userId: "user-owner", seatId: null, tenantId: null };
    const results = await source.search("refund escalation", owner);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.kbId).toBe(kb.id);
    expect(results[0]?.kbTitle).toBe("Owner Refunds");
    expect(results[0]?.sourceKind).toBe("knowledge");
    expect(results[0]?.sourceUri).toMatch(/^ku:\/\/kb\//);
    expect(results[0]?.chunkText.toLowerCase()).toContain("refund");
  });

  it("recalls multiple tenant knowledge bases in one index db group", async () => {
    const kbA = await seedIndexedKb({
      title: "Tenant KB A",
      ownerId: "user-a",
      tenantId: "tenant-a",
      visibility: "team",
      docId: "doc-a",
      docText: "# Alpha\n\nAlpha refund escalation matrix.",
    });
    const kbB = await seedIndexedKb({
      title: "Tenant KB B",
      ownerId: "user-b",
      tenantId: "tenant-a",
      visibility: "enterprise",
      docId: "doc-b",
      docText: "# Beta\n\nBeta refund escalation matrix.",
    });

    const source = createKnowledgeRetrievalSource({ storePath, indexRoot });
    const member: RetrievalContext = {
      userId: "user-member",
      seatId: "seat-1",
      tenantId: "tenant-a",
    };
    const results = await source.search("refund escalation", member, { maxResults: 8 });
    const kbIds = new Set(results.map((entry) => entry.kbId));
    expect(kbIds.has(kbA.id)).toBe(true);
    expect(kbIds.has(kbB.id)).toBe(true);
  });

  it("registers onto the retrieval service singleton", async () => {
    await seedIndexedKb({
      title: "Registered KB",
      ownerId: "user-owner",
      docText: "# Refunds\n\nRegistered refund escalation content.",
    });
    ensureKnowledgeRetrievalSourceRegistered({ storePath, indexRoot });
    const svc = getKnowledgeRetrievalService();
    expect(svc.listSources()).toContain("knowledge");
    const results = await svc.search("refund escalation", {
      userId: "user-owner",
      seatId: null,
      tenantId: null,
    });
    expect(results.length).toBeGreaterThan(0);
  });

  it("requires user authorization even for a tenant-matched bound robot", async () => {
    const kb = await seedIndexedKb({
      title: "Robot Memo",
      ownerId: "user-owner",
      tenantId: "tenant-a",
      visibility: "private",
      robotIds: ["bot-2"],
      docText: "# Memo\n\nInternal product code MK-FrostKoi-2026.",
    });
    const source = createKnowledgeRetrievalSource({ storePath, indexRoot });
    const robot: RetrievalContext = {
      userId: null,
      seatId: null,
      tenantId: "tenant-a",
      agentId: "bot-2",
    };
    const outsider: RetrievalContext = {
      userId: null,
      seatId: null,
      tenantId: "tenant-a",
      agentId: "bot-9",
    };
    const hits = await source.search("MK-FrostKoi-2026", robot, { kbScope: [kb.id] });
    expect(hits).toEqual([]);
    expect(await source.search("MK-FrostKoi-2026", outsider, { kbScope: [kb.id] })).toEqual([]);
  });
});
