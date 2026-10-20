import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getVaultKnowledgeBaseBinding, setVaultKnowledgeBaseBinding } from "./vault-kb-binding.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("vault-kb-binding", () => {
  it("persists and reads vault→knowledgeBase binding", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-kb-bind-"));
    tmpDirs.push(dir);
    expect(getVaultKnowledgeBaseBinding("vault-1", dir)).toBeNull();
    const written = setVaultKnowledgeBaseBinding({
      vaultId: "vault-1",
      knowledgeBaseId: "kb-sales",
      rootDir: dir,
    });
    expect(written.knowledgeBaseId).toBe("kb-sales");
    expect(getVaultKnowledgeBaseBinding("vault-1", dir)?.knowledgeBaseId).toBe("kb-sales");
  });
});
