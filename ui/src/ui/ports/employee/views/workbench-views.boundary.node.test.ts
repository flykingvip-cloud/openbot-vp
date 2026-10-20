import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const VIEWS_DIR = dirname(fileURLToPath(new URL("./workbench-home-model.ts", import.meta.url)));

async function readViewSources() {
  const entries = await readdir(VIEWS_DIR, { withFileTypes: true });
  const sourceFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => !name.endsWith(".test.ts"));

  return Promise.all(
    sourceFiles.map(async (name) => ({
      name,
      source: await readFile(join(VIEWS_DIR, name), "utf8"),
    })),
  );
}

describe("employee workbench view boundaries", () => {
  it("does not import controller modules directly", async () => {
    const files = await readViewSources();

    for (const { name, source } of files) {
      expect(source, name).not.toContain("/controllers/");
    }
  });

  it("does not couple view models to storage.ts", async () => {
    const files = await readViewSources();

    for (const { name, source } of files) {
      expect(source, name).not.toContain('from "../../../storage.ts"');
      expect(source, name).not.toContain('from "../../storage.ts"');
    }
  });
});
