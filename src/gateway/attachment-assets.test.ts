import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAttachmentAsset, upsertAttachmentAsset } from "./attachment-assets.js";

async function withTempState<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-attachment-assets-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", dir);
  try {
    return await run(dir);
  } finally {
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("attachment asset store", () => {
  it("returns an existing version for identical content", async () => {
    await withTempState(async () => {
      const first = await upsertAttachmentAsset({
        fileName: "report.pdf",
        mimeType: "application/pdf",
        content: Buffer.from("same").toString("base64"),
        sizeBytes: 4,
        lastModified: 100,
      });
      const second = await upsertAttachmentAsset({
        fileName: "report.pdf",
        mimeType: "application/pdf",
        content: Buffer.from("same").toString("base64"),
        sizeBytes: 4,
        lastModified: 100,
      });

      expect(first.status).toBe("created");
      expect(second.status).toBe("existing");
      expect(second.version.versionId).toBe(first.version.versionId);
    });
  });

  it("creates a new version for same-name different content", async () => {
    await withTempState(async () => {
      await upsertAttachmentAsset({
        fileName: "report.pdf",
        content: Buffer.from("old").toString("base64"),
        sizeBytes: 3,
        lastModified: 100,
      });
      const next = await upsertAttachmentAsset({
        fileName: "report.pdf",
        content: Buffer.from("new").toString("base64"),
        sizeBytes: 3,
        lastModified: 200,
      });

      expect(next.status).toBe("new-version");
      expect(next.version.versionId).toBe("v2");
    });
  });

  it("resolves an unreadable local file by filename and metadata", async () => {
    await withTempState(async () => {
      const saved = await upsertAttachmentAsset({
        fileName: "report.pdf",
        mimeType: "application/pdf",
        content: Buffer.from("content").toString("base64"),
        sizeBytes: 7,
        lastModified: 300,
      });

      const resolved = await resolveAttachmentAsset({
        fileName: "REPORT.pdf",
        sizeBytes: 7,
        lastModified: 300,
      });

      expect(resolved?.assetId).toBe(saved.version.assetId);
      expect(resolved?.content).toBe(saved.version.content);
    });
  });
});
