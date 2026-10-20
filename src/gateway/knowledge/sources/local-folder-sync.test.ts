import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ownershipProofFromLocalUser } from "../../data-governance/ownership-proof.js";
import { computeRawContentHash } from "../document-fingerprint.js";
import {
  createKnowledgeBase,
  getKnowledgeBase,
  type KnowledgeBase,
} from "../knowledge-base-store.js";
import { upsertLocalFolderBinding } from "./local-folder-binding-store.js";
import { loadLocalFolderSyncPlan } from "./local-folder-sync-plan-store.js";
import {
  commitLocalFolderSync,
  commitManagedLocalFolderSync,
  createManagedLocalFolderSyncPlan,
  planLocalFolderSync,
} from "./local-folder-sync.js";
import type { LocalFolderBinding, LocalFolderSyncCommitFile } from "./local-folder-types.js";
import { bindKnowledgeSource } from "./source-binding-store.js";
import { listSourceDocumentLinks, upsertSourceDocumentLink } from "./source-document-link-store.js";

const tmpRoot = path.join(os.tmpdir(), `openbot-lf-sync-${Math.random().toString(36).slice(2)}`);

type Fixture = {
  binding: LocalFolderBinding;
  knowledgeBase: KnowledgeBase;
  bindingStore: string;
  linkStore: string;
  kbStore: string;
  indexRoot: string;
  planStore: string;
  sourceDescriptorId: string;
};

function hash(body: string): string {
  return computeRawContentHash(Buffer.from(body, "utf8"));
}

const governanceOwnershipProof = ownershipProofFromLocalUser({ userId: "user-a" });

function commitFile(relativePath: string, body: string): LocalFolderSyncCommitFile {
  return { relativePath, textContent: body, rawHash: hash(body) };
}

describe("local-folder-sync (P3 managed_push)", () => {
  let bindingStore: string;
  let linkStore: string;
  let kbStore: string;
  let indexRoot: string;
  let sourceBindings: string;
  let planStore: string;

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
    bindingStore = path.join(tmpRoot, "bindings.json");
    linkStore = path.join(tmpRoot, "links.json");
    kbStore = path.join(tmpRoot, "bases.json");
    indexRoot = path.join(tmpRoot, "index");
    sourceBindings = path.join(tmpRoot, "source-bindings.json");
    planStore = path.join(tmpRoot, "plans.json");
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function createFixture(label = "Notes"): Fixture {
    const knowledgeBase = createKnowledgeBase(
      { title: `Managed ${label}`, visibility: "private", ownerId: "user-a" },
      kbStore,
    );
    const descriptor = bindKnowledgeSource(
      {
        kind: "localFolder",
        title: label,
        knowledgeBaseId: knowledgeBase.id,
        ownerId: "user-a",
        visibility: "private",
        endpoint: `local-folder://${label.toLowerCase().replace(/\s+/g, "-")}`,
        metadata: { mode: "managed_push" },
      },
      sourceBindings,
    );
    const binding = upsertLocalFolderBinding(
      {
        sourceDescriptorId: descriptor.id,
        knowledgeBaseId: knowledgeBase.id,
        deviceId: "mac-1",
        mode: "managed_push",
        directoryId: `directory-${label.toLowerCase().replace(/\s+/g, "-")}`,
        rootPath: "",
        rootLabel: label,
        deletePolicy: "snapshot",
      },
      bindingStore,
    );
    return {
      binding,
      knowledgeBase: getKnowledgeBase(knowledgeBase.id, kbStore)!,
      bindingStore,
      linkStore,
      kbStore,
      indexRoot,
      planStore,
      sourceDescriptorId: descriptor.id,
    };
  }

  async function seedFile(fixture: Fixture, relativePath: string, body: string) {
    const result = await commitLocalFolderSync({
      binding: fixture.binding,
      knowledgeBase: fixture.knowledgeBase,
      ownerId: "user-a",
      files: [commitFile(relativePath, body)],
      indexRoot: fixture.indexRoot,
      originalsRoot: path.join(tmpRoot, "originals"),
      kbStorePath: fixture.kbStore,
      bindingStorePath: fixture.bindingStore,
      linkStorePath: fixture.linkStore,
      embeddingProvider: null,
      governanceOwnershipProof,
    });
    expect(result.errors).toEqual([]);
  }

  function managedCommitParams(fixture: Fixture) {
    return {
      binding: fixture.binding,
      knowledgeBase: fixture.knowledgeBase,
      ownerId: "user-a",
      deviceId: "mac-1",
      indexRoot: fixture.indexRoot,
      originalsRoot: path.join(tmpRoot, "originals"),
      kbStorePath: fixture.kbStore,
      bindingStorePath: fixture.bindingStore,
      linkStorePath: fixture.linkStore,
      planStorePath: fixture.planStore,
      embeddingProvider: null,
      governanceOwnershipProof,
    } as const;
  }

  it("keeps pure delta planning compatible with generic connector ingest", async () => {
    const fixture = createFixture();
    const body = "# Hello\n\nmanaged content";
    const rawHash = hash(body);

    const first = planLocalFolderSync({
      binding: fixture.binding,
      candidates: [{ relativePath: "a.md", rawHash }],
      linkStorePath: fixture.linkStore,
      originalsRoot: path.join(tmpRoot, "originals"),
    });
    expect(first.needUpload).toEqual([
      expect.objectContaining({ relativePath: "a.md", reason: "missing" }),
    ]);

    await seedFile(fixture, "a.md", body);
    const second = planLocalFolderSync({
      binding: fixture.binding,
      candidates: [{ relativePath: "a.md", rawHash }],
      linkStorePath: fixture.linkStore,
      originalsRoot: path.join(tmpRoot, "originals"),
    });
    expect(second.needUpload).toEqual([]);
    expect(second.unchanged).toEqual(["a.md"]);
    expect(second.missingOnDevice).toEqual([]);
  });

  it("does not ingest UUID skill/object files from an uploaded OpenBot folder", () => {
    const fixture = createFixture("OpenBot dump");
    const planned = planLocalFolderSync({
      binding: fixture.binding,
      candidates: [
        {
          relativePath: "5d56ea0c-e52f-40ba-a200-babb4f2ebe54.md",
          rawHash: hash("# skill asset"),
        },
        { relativePath: "UPBEYOND/brief.pdf", rawHash: hash("human file") },
      ],
      linkStorePath: fixture.linkStore,
      originalsRoot: path.join(tmpRoot, "originals-empty"),
    });
    expect(planned.needUpload.map((item) => item.relativePath)).toEqual(["UPBEYOND/brief.pdf"]);
  });

  it("re-requests upload when catalog hash matches but original bytes are missing", () => {
    const fixture = createFixture("Catalog only");
    const body = "# Catalog\n\nno original blob";
    const rawHash = hash(body);
    upsertSourceDocumentLink(
      {
        sourceDescriptorId: fixture.sourceDescriptorId,
        docId: "lfdoc-catalog-only",
        relativePath: "upbeyond/brief.pdf",
        state: "active",
        lastSeenAt: Date.now(),
        rawHash,
      },
      fixture.linkStore,
    );
    const planned = planLocalFolderSync({
      binding: fixture.binding,
      candidates: [{ relativePath: "upbeyond/brief.pdf", rawHash }],
      linkStorePath: fixture.linkStore,
      originalsRoot: path.join(tmpRoot, "originals-empty"),
    });
    expect(planned.unchanged).toEqual([]);
    expect(planned.needUpload).toEqual([
      expect.objectContaining({ relativePath: "upbeyond/brief.pdf", reason: "missing" }),
    ]);
  });

  it("does not treat retained unread paths as missing on the device", async () => {
    const fixture = createFixture("Retain unread");
    await seedFile(fixture, "cloud.md", "still on disk");
    const plan = await createManagedLocalFolderSyncPlan({
      binding: fixture.binding,
      bindingStorePath: fixture.bindingStore,
      deviceId: "mac-1",
      candidates: [{ relativePath: "ok.md", rawHash: hash("ok") }],
      retainRelativePaths: ["cloud.md"],
      linkStorePath: fixture.linkStore,
      planStorePath: fixture.planStore,
      originalsRoot: path.join(tmpRoot, "originals"),
    });
    expect(plan.missingOnDevice).toEqual([]);
    expect(plan.needUpload.map((item) => item.relativePath)).toEqual(["ok.md"]);
    expect(plan.needUpload.some((item) => item.relativePath === "cloud.md")).toBe(false);
  });

  it("does not mark a document ready until original, chunks, and vectors all exist", async () => {
    const fixture = createFixture("Ready Notes");
    const originalsRoot = path.join(tmpRoot, "originals");
    const body = "# Ready\n\nThis paragraph is long enough to become a searchable chunk.";
    const result = await commitLocalFolderSync({
      binding: fixture.binding,
      knowledgeBase: fixture.knowledgeBase,
      ownerId: "user-a",
      files: [commitFile("ready.md", body)],
      indexRoot: fixture.indexRoot,
      originalsRoot,
      kbStorePath: fixture.kbStore,
      bindingStorePath: fixture.bindingStore,
      linkStorePath: fixture.linkStore,
      embeddingProvider: null,
      governanceOwnershipProof,
    });

    expect(result.errors).toEqual([]);
    expect(result.documents).toEqual([
      expect.objectContaining({
        relativePath: "ready.md",
        originalStored: true,
        ready: false,
      }),
    ]);
    expect(result.documents?.[0]?.chunkCount).toBeGreaterThan(0);
    expect(result.documents?.[0]?.vectorCount).toBe(0);
  });

  it("keeps passive connector path aliases and per-file partial success compatible", async () => {
    const fixture = createFixture("Passive compatibility");
    const planned = planLocalFolderSync({
      binding: fixture.binding,
      candidates: [
        { relativePath: "./docs/readme.txt", rawHash: "opaque-etag" },
        { relativePath: "docs\\readme.txt", rawHash: "duplicate-etag" },
      ],
      linkStorePath: fixture.linkStore,
    });
    expect(planned.needUpload).toEqual([
      expect.objectContaining({ relativePath: "docs/readme.txt", reason: "missing" }),
    ]);

    const committed = await commitLocalFolderSync({
      binding: fixture.binding,
      knowledgeBase: fixture.knowledgeBase,
      ownerId: "user-a",
      files: [
        { relativePath: "../escape.txt", textContent: "unsafe" },
        { relativePath: "./docs/readme.txt", textContent: "first", rawHash: "opaque-etag" },
        { relativePath: "docs\\windows.txt", textContent: "second" },
      ],
      indexRoot: fixture.indexRoot,
      kbStorePath: fixture.kbStore,
      bindingStorePath: fixture.bindingStore,
      linkStorePath: fixture.linkStore,
      embeddingProvider: null,
      governanceOwnershipProof,
    });

    expect(committed.ingested).toBeGreaterThanOrEqual(2);
    expect(committed.skipped).toBe(1);
    expect(committed.errors.join(" ")).toMatch(/unsafe local-folder relativePath/i);
    expect(
      listSourceDocumentLinks(
        { sourceDescriptorId: fixture.sourceDescriptorId, state: "active" },
        fixture.linkStore,
      )
        .map((item) => item.relativePath)
        .toSorted(),
    ).toEqual(["docs/readme.txt", "docs/windows.txt"]);
  });

  it("issues opaque monotonic leases and supersedes the previous generation", async () => {
    const fixture = createFixture("Generation");
    const body = "generation";
    const first = await createManagedLocalFolderSyncPlan({
      binding: fixture.binding,
      bindingStorePath: fixture.bindingStore,
      deviceId: "mac-1",
      candidates: [{ relativePath: "a.txt", rawHash: hash(body) }],
      linkStorePath: fixture.linkStore,
      planStorePath: fixture.planStore,
      originalsRoot: path.join(tmpRoot, "originals"),
      nowMs: 1_000,
      ttlMs: 10_000,
    });
    const second = await createManagedLocalFolderSyncPlan({
      binding: fixture.binding,
      bindingStorePath: fixture.bindingStore,
      deviceId: "mac-1",
      candidates: [{ relativePath: "a.txt", rawHash: hash(body) }],
      linkStorePath: fixture.linkStore,
      planStorePath: fixture.planStore,
      originalsRoot: path.join(tmpRoot, "originals"),
      nowMs: 2_000,
      ttlMs: 10_000,
    });

    expect(first.planId).toMatch(/^lfp:[0-9a-f-]{36}$/i);
    expect(first.planId).not.toContain(fixture.binding.bindingId);
    expect(second.planId).not.toBe(first.planId);
    expect(second.generation).toBe(first.generation + 1);
    await expect(
      commitManagedLocalFolderSync({
        ...managedCommitParams(fixture),
        planId: first.planId,
        generation: first.generation,
        phase: "upload",
        files: [commitFile("a.txt", body)],
        nowMs: 2_001,
      }),
    ).rejects.toThrow(/stale|superseded/i);
    await expect(
      createManagedLocalFolderSyncPlan({
        binding: fixture.binding,
        bindingStorePath: fixture.bindingStore,
        deviceId: "wrong-device",
        candidates: [],
        planStorePath: fixture.planStore,
        originalsRoot: path.join(tmpRoot, "originals"),
      }),
    ).rejects.toThrow(/deviceId mismatch/i);
  });

  it("keeps managed inventories strict and rejects a stale binding revision", async () => {
    const fixture = createFixture("Strict revision");
    await expect(
      createManagedLocalFolderSyncPlan({
        binding: fixture.binding,
        bindingStorePath: fixture.bindingStore,
        deviceId: "mac-1",
        candidates: [{ relativePath: "./alias.txt", rawHash: hash("alias") }],
        planStorePath: fixture.planStore,
        originalsRoot: path.join(tmpRoot, "originals"),
      }),
    ).rejects.toThrow(/unsafe local-folder relativePath/i);
    await expect(
      createManagedLocalFolderSyncPlan({
        binding: fixture.binding,
        bindingStorePath: fixture.bindingStore,
        deviceId: "mac-1",
        candidates: [{ relativePath: "opaque.txt", rawHash: "opaque-etag" }],
        planStorePath: fixture.planStore,
        originalsRoot: path.join(tmpRoot, "originals"),
      }),
    ).rejects.toThrow(/sha256/i);

    const plan = await createManagedLocalFolderSyncPlan({
      binding: fixture.binding,
      bindingStorePath: fixture.bindingStore,
      deviceId: "mac-1",
      candidates: [],
      planStorePath: fixture.planStore,
      originalsRoot: path.join(tmpRoot, "originals"),
    });
    const rebound = upsertLocalFolderBinding(
      {
        bindingId: fixture.binding.bindingId,
        sourceDescriptorId: fixture.binding.sourceDescriptorId,
        knowledgeBaseId: fixture.binding.knowledgeBaseId,
        deviceId: fixture.binding.deviceId,
        mode: "managed_push",
        directoryId: fixture.binding.directoryId,
        rootPath: "",
        rootLabel: fixture.binding.rootLabel,
        deletePolicy: "sync",
      },
      fixture.bindingStore,
    );
    expect(rebound.revision).toBe((fixture.binding.revision ?? 0) + 1);
    await expect(
      commitManagedLocalFolderSync({
        ...managedCommitParams(fixture),
        planId: plan.planId,
        generation: plan.generation,
        phase: "finalize",
        files: [],
      }),
    ).rejects.toThrow(/binding changed/i);
  });

  it("records multiple upload batches without consuming, then consumes on finalize", async () => {
    const fixture = createFixture("Batches");
    const firstBody = "first";
    const secondBody = "second";
    const plan = await createManagedLocalFolderSyncPlan({
      binding: fixture.binding,
      bindingStorePath: fixture.bindingStore,
      deviceId: "mac-1",
      candidates: [
        { relativePath: "first.txt", rawHash: hash(firstBody) },
        { relativePath: "second.txt", rawHash: hash(secondBody) },
      ],
      linkStorePath: fixture.linkStore,
      planStorePath: fixture.planStore,
      originalsRoot: path.join(tmpRoot, "originals"),
    });

    await commitManagedLocalFolderSync({
      ...managedCommitParams(fixture),
      planId: plan.planId,
      generation: plan.generation,
      phase: "upload",
      files: [commitFile("first.txt", firstBody)],
    });
    expect(loadLocalFolderSyncPlan(fixture.binding.bindingId, fixture.planStore)).toMatchObject({
      state: "active",
      uploadedRelativePaths: ["first.txt"],
    });
    await expect(
      commitManagedLocalFolderSync({
        ...managedCommitParams(fixture),
        planId: plan.planId,
        generation: plan.generation,
        phase: "finalize",
        files: [],
      }),
    ).rejects.toThrow(/pending upload/i);

    await commitManagedLocalFolderSync({
      ...managedCommitParams(fixture),
      planId: plan.planId,
      generation: plan.generation,
      phase: "upload",
      files: [commitFile("second.txt", secondBody)],
    });
    const finalized = await commitManagedLocalFolderSync({
      ...managedCommitParams(fixture),
      planId: plan.planId,
      generation: plan.generation,
      phase: "finalize",
      files: [],
    });
    expect(finalized.errors).toEqual([]);
    expect(loadLocalFolderSyncPlan(fixture.binding.bindingId, fixture.planStore)).toMatchObject({
      state: "consumed",
      uploadedRelativePaths: ["first.txt", "second.txt"],
    });
    expect(
      listSourceDocumentLinks(
        { sourceDescriptorId: fixture.sourceDescriptorId, state: "active" },
        fixture.linkStore,
      )
        .map((item) => item.relativePath)
        .toSorted(),
    ).toEqual(["first.txt", "second.txt"]);
    await expect(
      commitManagedLocalFolderSync({
        ...managedCommitParams(fixture),
        planId: plan.planId,
        generation: plan.generation,
        phase: "finalize",
        files: [],
      }),
    ).rejects.toThrow(/consumed/i);
  });

  it("leaves the plan active and blocks deletes when an upload fails", async () => {
    const fixture = createFixture("Upload failure");
    await seedFile(fixture, "old.txt", "old content");
    const expectedBody = "expected content";
    const plan = await createManagedLocalFolderSyncPlan({
      binding: fixture.binding,
      bindingStorePath: fixture.bindingStore,
      deviceId: "mac-1",
      candidates: [{ relativePath: "new.txt", rawHash: hash(expectedBody) }],
      linkStorePath: fixture.linkStore,
      planStorePath: fixture.planStore,
      originalsRoot: path.join(tmpRoot, "originals"),
    });
    expect(plan.missingOnDevice).toEqual(["old.txt"]);

    await expect(
      commitManagedLocalFolderSync({
        ...managedCommitParams(fixture),
        planId: plan.planId,
        generation: plan.generation,
        phase: "upload",
        files: [commitFile("new.txt", "tampered content")],
      }),
    ).rejects.toThrow(/differs from the planned inventory/i);
    expect(loadLocalFolderSyncPlan(fixture.binding.bindingId, fixture.planStore)).toMatchObject({
      state: "active",
      uploadedRelativePaths: [],
    });
    await expect(
      commitManagedLocalFolderSync({
        ...managedCommitParams(fixture),
        planId: plan.planId,
        generation: plan.generation,
        phase: "finalize",
        files: [],
      }),
    ).rejects.toThrow(/pending upload/i);
    expect(
      listSourceDocumentLinks(
        { sourceDescriptorId: fixture.sourceDescriptorId },
        fixture.linkStore,
      ),
    ).toEqual([expect.objectContaining({ relativePath: "old.txt", state: "active" })]);
  });

  it("rejects stale plan A after plan B restores the device inventory", async () => {
    const fixture = createFixture("Freshness");
    const body = "restored";
    await seedFile(fixture, "restored.txt", body);
    const planA = await createManagedLocalFolderSyncPlan({
      binding: fixture.binding,
      bindingStorePath: fixture.bindingStore,
      deviceId: "mac-1",
      candidates: [],
      linkStorePath: fixture.linkStore,
      planStorePath: fixture.planStore,
      originalsRoot: path.join(tmpRoot, "originals"),
    });
    expect(planA.missingOnDevice).toEqual(["restored.txt"]);

    const planB = await createManagedLocalFolderSyncPlan({
      binding: fixture.binding,
      bindingStorePath: fixture.bindingStore,
      deviceId: "mac-1",
      candidates: [{ relativePath: "restored.txt", rawHash: hash(body) }],
      linkStorePath: fixture.linkStore,
      planStorePath: fixture.planStore,
      originalsRoot: path.join(tmpRoot, "originals"),
    });
    expect(planB.unchanged).toEqual(["restored.txt"]);
    await commitManagedLocalFolderSync({
      ...managedCommitParams(fixture),
      planId: planB.planId,
      generation: planB.generation,
      phase: "finalize",
      files: [],
    });
    await expect(
      commitManagedLocalFolderSync({
        ...managedCommitParams(fixture),
        planId: planA.planId,
        generation: planA.generation,
        phase: "finalize",
        files: [],
      }),
    ).rejects.toThrow(/stale|superseded/i);
    expect(
      listSourceDocumentLinks(
        { sourceDescriptorId: fixture.sourceDescriptorId },
        fixture.linkStore,
      ),
    ).toEqual([expect.objectContaining({ relativePath: "restored.txt", state: "active" })]);
  });

  it("allows only one concurrent finalize for the same lease", async () => {
    const fixture = createFixture("Concurrent");
    const plan = await createManagedLocalFolderSyncPlan({
      binding: fixture.binding,
      bindingStorePath: fixture.bindingStore,
      deviceId: "mac-1",
      candidates: [],
      linkStorePath: fixture.linkStore,
      planStorePath: fixture.planStore,
      originalsRoot: path.join(tmpRoot, "originals"),
    });
    const finalize = () =>
      commitManagedLocalFolderSync({
        ...managedCommitParams(fixture),
        planId: plan.planId,
        generation: plan.generation,
        phase: "finalize",
        files: [],
      });
    const outcomes = await Promise.allSettled([finalize(), finalize()]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(loadLocalFolderSyncPlan(fixture.binding.bindingId, fixture.planStore)?.state).toBe(
      "consumed",
    );
  });

  it("rejects expired leases without consuming them", async () => {
    const fixture = createFixture("Expiry");
    const plan = await createManagedLocalFolderSyncPlan({
      binding: fixture.binding,
      bindingStorePath: fixture.bindingStore,
      deviceId: "mac-1",
      candidates: [],
      linkStorePath: fixture.linkStore,
      planStorePath: fixture.planStore,
      originalsRoot: path.join(tmpRoot, "originals"),
      nowMs: 10_000,
      ttlMs: 50,
    });
    await expect(
      commitManagedLocalFolderSync({
        ...managedCommitParams(fixture),
        planId: plan.planId,
        generation: plan.generation,
        phase: "finalize",
        files: [],
        nowMs: 10_050,
      }),
    ).rejects.toThrow(/expired/i);
    expect(loadLocalFolderSyncPlan(fixture.binding.bindingId, fixture.planStore)?.state).toBe(
      "active",
    );
  });

  it("applies deletes only from the current server-side plan", async () => {
    const fixture = createFixture("Server deletes");
    await seedFile(fixture, "removed.txt", "remove me");
    const plan = await createManagedLocalFolderSyncPlan({
      binding: fixture.binding,
      bindingStorePath: fixture.bindingStore,
      deviceId: "mac-1",
      candidates: [],
      linkStorePath: fixture.linkStore,
      planStorePath: fixture.planStore,
      originalsRoot: path.join(tmpRoot, "originals"),
    });
    const result = await commitManagedLocalFolderSync({
      ...managedCommitParams(fixture),
      planId: plan.planId,
      generation: plan.generation,
      phase: "finalize",
      files: [],
    });
    expect(result.snapshotted).toBe(1);
    expect(
      listSourceDocumentLinks(
        { sourceDescriptorId: fixture.sourceDescriptorId },
        fixture.linkStore,
      ),
    ).toEqual([
      expect.objectContaining({ relativePath: "removed.txt", state: "snapshotted_deleted" }),
    ]);
  });

  it("fails closed on unsafe paths and mismatched content hashes", async () => {
    const fixture = createFixture("Validation");
    const unsafe = await commitLocalFolderSync({
      binding: fixture.binding,
      knowledgeBase: fixture.knowledgeBase,
      ownerId: "user-a",
      files: [commitFile("../escape.txt", "unsafe")],
      bindingStorePath: fixture.bindingStore,
      linkStorePath: fixture.linkStore,
      embeddingProvider: null,
      governanceOwnershipProof,
    });
    expect(unsafe.errors.join(" ")).toMatch(/unsafe local-folder relativePath/i);

    const plan = await createManagedLocalFolderSyncPlan({
      binding: fixture.binding,
      bindingStorePath: fixture.bindingStore,
      deviceId: "mac-1",
      candidates: [{ relativePath: "safe.txt", rawHash: hash("actual") }],
      linkStorePath: fixture.linkStore,
      planStorePath: fixture.planStore,
      originalsRoot: path.join(tmpRoot, "originals"),
    });
    await expect(
      commitManagedLocalFolderSync({
        ...managedCommitParams(fixture),
        planId: plan.planId,
        generation: plan.generation,
        phase: "upload",
        files: [{ relativePath: "safe.txt", textContent: "actual", rawHash: hash("other") }],
      }),
    ).rejects.toThrow(/rawHash does not match/i);
    expect(
      listSourceDocumentLinks(
        { sourceDescriptorId: fixture.sourceDescriptorId },
        fixture.linkStore,
      ),
    ).toEqual([]);
  });

  it("flattens managed folder import to files only and drops folder shells", async () => {
    const fixture = createFixture("Flatten import");
    const plan = await createManagedLocalFolderSyncPlan({
      binding: fixture.binding,
      bindingStorePath: fixture.bindingStore,
      deviceId: "mac-1",
      candidates: [
        { relativePath: "图书室/手册.md", rawHash: hash("# 手册") },
        { relativePath: "UPBEYOND", rawHash: hash("") },
        { relativePath: "docs/手册.md", rawHash: hash("# 另一份") },
      ],
      linkStorePath: fixture.linkStore,
      planStorePath: fixture.planStore,
      originalsRoot: path.join(tmpRoot, "originals"),
    });
    expect(plan.needUpload.map((item) => item.relativePath).toSorted()).toEqual([
      "手册-2.md",
      "手册.md",
    ]);
  });
});
