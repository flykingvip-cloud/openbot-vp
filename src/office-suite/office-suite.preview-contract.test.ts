import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { createOfficeSuite } from "./service.js";
it("renders a bounded summary as escaped text for an authorized owner", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "office-preview-contract-"));
  try {
    const suite = createOfficeSuite({ rootDir: root });
    const owner = { tenantId: "preview-test", userId: "owner" };
    const created = await suite.execute(owner, {
      action: "create",
      kind: "docx",
      spec: { blocks: [{ type: "paragraph", text: "<script>preview-proof</script>" }] },
    });
    expect(created.ok).toBe(true);
    const preview = await suite.execute(owner, {
      action: "preview",
      artifactId: created.artifactId,
    });
    expect(preview.ok).toBe(true);
    const previewPath = preview.details?.previewPath;
    expect(typeof previewPath).toBe("string");
    if (typeof previewPath !== "string") {
      throw new Error("Preview locator missing");
    }
    const html = await fs.readFile(path.join(root, previewPath), "utf8");
    expect(html).toContain("preview-proof");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
