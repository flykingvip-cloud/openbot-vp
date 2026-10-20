import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyWorkspaceCatalog } from "./catalog.js";
import { readLocalIndexDocumentContent } from "./local-index-read.js";

describe("local index resolver integration", () => {
  it("reads a bound local_index file through resolver helper", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-local-index-read-"));
    const folder = path.join(root, "docs");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "memo.md"), "# memo");

    const result = readLocalIndexDocumentContent({
      catalog: createEmptyWorkspaceCatalog(),
      actor: { tenantId: "personal-local", userId: "user-a" },
      tenantId: "personal-local",
      userId: "user-a",
      bindingId: "lf-bind-1",
      workspaceRoot: folder,
      relativePath: "memo.md",
      operation: "preview",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.buffer.toString()).toBe("# memo");
      expect(result.resourceId).toBe("ws:personal-local:user:user-a:asset:local-folder:lf-bind-1");
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
});
