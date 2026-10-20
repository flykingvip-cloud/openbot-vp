import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalMetadataStore } from "../adapters/local-metadata.js";
import { IdempotencyConflictError } from "../errors.js";
import type { EvidenceRecord, Scope } from "../models.js";
import { InMemoryCogniWeaveEngine } from "./in-memory-engine.js";

const scope: Scope = {
  workspaceId: "ws_persist",
  projectId: "proj_persist",
  agentId: "agent_main",
  visibility: "private",
};

const engineConfig = {
  environment: "local" as const,
  metadataBackend: "memory" as const,
  graphBackend: "memory" as const,
  evidenceBackend: "memory" as const,
  vectorBackend: "memory" as const,
};

function makeEvidence(uri: string, snippet: string): EvidenceRecord {
  return {
    id: `ev_${uri.replace(/[^a-z0-9]+/gi, "_").slice(0, 24)}`,
    type: "document",
    uri,
    snippet,
    trustScore: 0.9,
    scope,
    locator: { messageIds: [], toolCallIds: [] },
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("InMemoryCogniWeaveEngine source lifecycle persistence", () => {
  it("survives LocalMetadataStore restart for archive/restore filtering", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cw-lifecycle-persist-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "meta.sqlite");

    const store1 = new LocalMetadataStore({
      backend: "local",
      environment: "local",
      path: dbPath,
    });
    const identity = "sid_persist_alpha";
    await store1.saveEvidence(makeEvidence(`msrc://${identity}`, "persist alpha secret phrase"));
    await store1.saveEvidence(
      makeEvidence("agents/main/sessions/other.jsonl", "unrelated keep me visible"),
    );

    const engine1 = new InMemoryCogniWeaveEngine(engineConfig, { metadataStore: store1 });
    await engine1.archiveSource({
      operationId: "op-persist-archive",
      selector: { mode: "identity", sourceIdentityId: identity },
      subject: { scope },
      reasonCode: "TEST_PERSIST_ARCHIVE",
    });
    const afterArchive = await engine1.searchEvidence("persist alpha secret", { scope });
    expect(afterArchive.map((r) => r.evidence.uri)).not.toContain(`msrc://${identity}`);
    store1.close();

    const store2 = new LocalMetadataStore({
      backend: "local",
      environment: "local",
      path: dbPath,
    });
    const engine2 = new InMemoryCogniWeaveEngine(engineConfig, { metadataStore: store2 });
    const afterRestart = await engine2.searchEvidence("persist alpha secret", { scope });
    expect(afterRestart.map((r) => r.evidence.uri)).not.toContain(`msrc://${identity}`);
    const keep = await engine2.searchEvidence("unrelated keep me", { scope });
    expect(keep.some((r) => r.evidence.uri.includes("other.jsonl"))).toBe(true);
    expect(engine2.getSourceBindingStatus({ mode: "identity", sourceIdentityId: identity })).toBe(
      "archived",
    );
    expect(engine2.isSourcePathRetrievable(`msrc://${identity}/chunk`)).toBe(false);

    const evidenceBefore = (await store2.listEvidence()).length;
    await engine2.restoreSource({
      operationId: "op-persist-restore",
      selector: { mode: "identity", sourceIdentityId: identity },
      subject: { scope },
      reasonCode: "TEST_PERSIST_RESTORE",
    });
    const afterRestore = await engine2.searchEvidence("persist alpha secret", { scope });
    expect(afterRestore.map((r) => r.evidence.uri)).toContain(`msrc://${identity}`);
    expect((await store2.listEvidence()).length).toBe(evidenceBefore);
    store2.close();
  });

  it("replays operationId receipts and conflicts on status mismatch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cw-lifecycle-receipt-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "meta.sqlite");
    const store = new LocalMetadataStore({
      backend: "local",
      environment: "local",
      path: dbPath,
    });
    const engine = new InMemoryCogniWeaveEngine(engineConfig, { metadataStore: store });
    const identity = "sid_receipt";

    const first = await engine.archiveSource({
      operationId: "op-same",
      selector: { mode: "identity", sourceIdentityId: identity },
      subject: { scope },
      reasonCode: "TEST_RECEIPT",
    });
    const again = await engine.archiveSource({
      operationId: "op-same",
      selector: { mode: "identity", sourceIdentityId: identity },
      subject: { scope },
      reasonCode: "TEST_RECEIPT",
    });
    expect(again).toEqual(first);

    store.close();
    const store2 = new LocalMetadataStore({
      backend: "local",
      environment: "local",
      path: dbPath,
    });
    const engine2 = new InMemoryCogniWeaveEngine(engineConfig, { metadataStore: store2 });
    const replayed = await engine2.archiveSource({
      operationId: "op-same",
      selector: { mode: "identity", sourceIdentityId: identity },
      subject: { scope },
      reasonCode: "TEST_RECEIPT",
    });
    expect(replayed.currentStatus).toBe("archived");
    expect(replayed.completedAt).toBe(first.completedAt);

    await expect(
      engine2.forgetSource({
        operationId: "op-same",
        selector: { mode: "identity", sourceIdentityId: identity },
        subject: { scope },
        reasonCode: "TEST_CONFLICT",
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    store2.close();
  });

  it("persists source_object_links and survives restart for multi-source forget", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cw-object-links-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "meta.sqlite");
    const store = new LocalMetadataStore({
      backend: "local",
      environment: "local",
      path: dbPath,
    });
    const identity = "sid_link_persist";
    await store.saveEvidence(makeEvidence(`msrc://${identity}`, "link persist secret"));
    const engine = new InMemoryCogniWeaveEngine(engineConfig, { metadataStore: store });
    await engine.archiveSource({
      operationId: "op-link-archive",
      selector: { mode: "identity", sourceIdentityId: identity },
      subject: { scope },
      reasonCode: "TEST_LINK_ARCHIVE",
    });
    const links = await store.listSourceObjectLinks({ liveOnly: true });
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((link) => link.objectType === "evidence")).toBe(true);
    // Archive must retain links (no unlink).
    expect(links.every((link) => !link.unlinkedAt)).toBe(true);
    store.close();

    const store2 = new LocalMetadataStore({
      backend: "local",
      environment: "local",
      path: dbPath,
    });
    const engine2 = new InMemoryCogniWeaveEngine(engineConfig, { metadataStore: store2 });
    expect((await store2.listSourceObjectLinks({ liveOnly: true })).length).toBeGreaterThan(0);
    await engine2.forgetSource({
      operationId: "op-link-forget",
      selector: { mode: "identity", sourceIdentityId: identity },
      subject: { scope },
      reasonCode: "TEST_LINK_FORGET",
    });
    const binding = await store2.findSourceBindingByIdentity(identity);
    expect(binding).toBeTruthy();
    const afterForget = await store2.listSourceObjectLinks({
      sourceBindingId: binding!.id,
    });
    expect(afterForget.length).toBeGreaterThan(0);
    expect(afterForget.every((link) => Boolean(link.unlinkedAt))).toBe(true);
    store2.close();
  });
});
