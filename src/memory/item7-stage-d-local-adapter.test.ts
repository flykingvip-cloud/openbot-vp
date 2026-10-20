import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalOnlyStagingAdapter } from "./item7-stage-d-local-adapter.js";
import { computeStageDManifest, type StageDSourceFile } from "./item7-stage-d-memory-sync.js";

let stateDir: string;
const FILES: StageDSourceFile[] = [
  { path: "notes/a.md", content: "alpha" },
  { path: "notes/b.md", content: "beta" },
];
const MANIFEST = computeStageDManifest(FILES);

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-d-adapter-"));
});
afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe("local-only adapter — mode + path refusal", () => {
  it("supports only local-only; refuses every non-local mode", () => {
    const adapter = createLocalOnlyStagingAdapter({ stateDir });
    expect(adapter.custodian).toBe("device");
    expect(adapter.supportsMode("local-only")).toBe(true);
    for (const mode of [
      "encrypted-cloud",
      "tenant-cloud",
      "dedicated",
      "byos",
      "cold-archive",
    ] as const) {
      expect(adapter.supportsMode(mode)).toBe(false);
    }
  });

  it("refuses a raw/escaping source path (no host path followed)", async () => {
    const adapter = createLocalOnlyStagingAdapter({ stateDir });
    const escaping: StageDSourceFile[] = [{ path: "../../etc/passwd", content: "x" }];
    const result = await adapter.copy({
      operationId: "op-escape",
      manifest: computeStageDManifest(escaping),
      files: escaping,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.partial).toBe(true);
    expect(adapter.isPublished("op-escape")).toBe(false);
  });
});

describe("local-only adapter — staging then verify then atomic publish", () => {
  it("publishes only after the staging hash matches the source manifest", async () => {
    const adapter = createLocalOnlyStagingAdapter({ stateDir });
    const result = await adapter.copy({ operationId: "op-ok", manifest: MANIFEST, files: FILES });
    expect(result.ok).toBe(true);
    expect(result.ok && result.writtenSha256).toBe(MANIFEST.manifestSha256);
    expect(adapter.isPublished("op-ok")).toBe(true);
    expect(adapter.hasResidualStaging("op-ok")).toBe(false); // staging consumed by rename
  });

  it("a copy exception leaves staging quarantined and publishes nothing", async () => {
    const adapter = createLocalOnlyStagingAdapter({ stateDir, faults: { throwOnCopy: true } });
    const result = await adapter.copy({
      operationId: "op-throw",
      manifest: MANIFEST,
      files: FILES,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.partial).toBe(true);
    expect(adapter.isPublished("op-throw")).toBe(false);
  });

  it("a staging hash mismatch quarantines staging and refuses to publish", async () => {
    const adapter = createLocalOnlyStagingAdapter({ stateDir, faults: { corruptStaging: true } });
    const result = await adapter.copy({
      operationId: "op-corrupt",
      manifest: MANIFEST,
      files: FILES,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.partial).toBe(true);
    expect(!result.ok && result.error.includes("staging_hash_mismatch")).toBe(true);
    expect(adapter.isPublished("op-corrupt")).toBe(false);
    expect(adapter.hasResidualStaging("op-corrupt")).toBe(true); // residual left for recovery
  });

  it("an atomic-publish failure leaves staging quarantined and publishes nothing", async () => {
    const adapter = createLocalOnlyStagingAdapter({ stateDir, faults: { failPublish: true } });
    const result = await adapter.copy({ operationId: "op-pub", manifest: MANIFEST, files: FILES });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.partial).toBe(true);
    expect(adapter.isPublished("op-pub")).toBe(false);
    expect(adapter.hasResidualStaging("op-pub")).toBe(true);
  });

  it("never double-writes: a second copy of an already-published operation is refused", async () => {
    const adapter = createLocalOnlyStagingAdapter({ stateDir });
    const first = await adapter.copy({ operationId: "op-dup", manifest: MANIFEST, files: FILES });
    expect(first.ok).toBe(true);
    const second = await adapter.copy({ operationId: "op-dup", manifest: MANIFEST, files: FILES });
    expect(second.ok).toBe(false);
    expect(!second.ok && second.partial).toBe(false);
    expect(!second.ok && second.error).toBe("already_published_no_overwrite");
  });

  it("the published content matches the source bytes exactly", async () => {
    const adapter = createLocalOnlyStagingAdapter({ stateDir });
    await adapter.copy({ operationId: "op-content", manifest: MANIFEST, files: FILES });
    const published = adapter.publishedPathFor("op-content");
    expect(fs.readFileSync(path.join(published, "notes/a.md"), "utf8")).toBe("alpha");
    expect(fs.readFileSync(path.join(published, "notes/b.md"), "utf8")).toBe("beta");
  });
});
