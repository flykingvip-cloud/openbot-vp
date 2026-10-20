// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

describe("local-folder-open", () => {
  it("resolves and opens an active local_index document with the default app", async () => {
    const root = makeTempRoot("openbot-lf-open-");
    const bindingStorePath = path.join(root, "bindings.json");
    const linkStorePath = path.join(root, "links.json");
    const folder = path.join(root, "docs");
    fs.mkdirSync(folder, { recursive: true });
    const filePath = path.join(folder, "resume.docx");
    fs.writeFileSync(filePath, "demo");

    const { upsertLocalFolderBinding } = await import("./local-folder-binding-store.js");
    const { upsertSourceDocumentLink } = await import("./source-document-link-store.js");
    const {
      openLocalFolderDocument,
      listOpenableLocalFolderDocumentIds,
      resolveLocalFolderDocument,
    } = await import("./local-folder-open.js");
    const execModule = await import("../../../daemon/exec-file.js");
    const execSpy = vi.spyOn(execModule, "execFileUtf8").mockResolvedValue({
      stdout: "",
      stderr: "",
      code: 0,
    });

    const binding = upsertLocalFolderBinding(
      {
        sourceDescriptorId: "src-folder",
        knowledgeBaseId: "kb-1",
        deviceId: "dev-1",
        mode: "local_index",
        rootPath: folder,
        rootLabel: "docs",
      },
      bindingStorePath,
    );
    upsertSourceDocumentLink(
      {
        sourceDescriptorId: "src-folder",
        docId: "lfdoc-resume",
        relativePath: "resume.docx",
        state: "active",
        lastSeenAt: Date.now(),
      },
      linkStorePath,
    );

    expect(
      listOpenableLocalFolderDocumentIds({
        knowledgeBaseId: "kb-1",
        bindingStorePath,
        linkStorePath,
      }).has("lfdoc-resume"),
    ).toBe(true);

    const resolved = resolveLocalFolderDocument({
      documentId: "lfdoc-resume",
      knowledgeBaseId: "kb-1",
      bindingStorePath,
      linkStorePath,
    });
    expect(resolved.relativePath).toBe("resume.docx");
    expect(resolved.absolutePath).toBe(fs.realpathSync(filePath));
    expect(resolved.bindingId).toBeTruthy();

    const result = await openLocalFolderDocument({
      documentId: "lfdoc-resume",
      knowledgeBaseId: "kb-1",
      bindingStorePath,
      linkStorePath,
    });

    expect(result.ok).toBe(true);
    expect(result.bindingId).toBe(binding.bindingId);
    expect(result.absolutePath).toBe(fs.realpathSync(filePath));
    expect(execSpy).toHaveBeenCalled();
    const [command, args] = execSpy.mock.calls[0] ?? [];
    if (process.platform === "darwin") {
      expect(command).toBe("open");
      expect(args).toEqual([result.absolutePath]);
    }
  });

  it("rejects path escape attempts", async () => {
    const root = makeTempRoot("openbot-lf-escape-");
    const bindingStorePath = path.join(root, "bindings.json");
    const linkStorePath = path.join(root, "links.json");
    const folder = path.join(root, "docs");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(root, "secret.txt"), "nope");

    const { upsertLocalFolderBinding } = await import("./local-folder-binding-store.js");
    const { upsertSourceDocumentLink } = await import("./source-document-link-store.js");
    const { openLocalFolderDocument } = await import("./local-folder-open.js");

    upsertLocalFolderBinding(
      {
        sourceDescriptorId: "src-folder",
        knowledgeBaseId: "kb-1",
        deviceId: "dev-1",
        mode: "local_index",
        rootPath: folder,
        rootLabel: "docs",
      },
      bindingStorePath,
    );
    upsertSourceDocumentLink(
      {
        sourceDescriptorId: "src-folder",
        docId: "lfdoc-escape",
        relativePath: "../secret.txt",
        state: "active",
        lastSeenAt: Date.now(),
      },
      linkStorePath,
    );

    await expect(
      openLocalFolderDocument({
        documentId: "lfdoc-escape",
        bindingStorePath,
        linkStorePath,
        dryRun: true,
      }),
    ).rejects.toThrow(/unsafe local-folder relativePath|escapes/i);
  });
});
