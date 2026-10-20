import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function walkBrowserTests(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkBrowserTests(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".browser.test.ts")) {
      found.push(full);
    }
  }
  return found;
}

describe("browser tests stay on the browser runner", () => {
  it("excludes *.browser.test.ts from the node unit config", () => {
    const rootConfig = read("vitest.config.ts");
    expect(rootConfig).toContain('"**/*.browser.test.ts"');
    const excludeBlock = rootConfig.slice(
      rootConfig.indexOf("exclude: ["),
      rootConfig.indexOf("coverage:"),
    );
    expect(excludeBlock).toContain('"**/*.browser.test.ts"');
    // vitest.unit.config.ts spreads the root exclude, so the unit lane inherits it.
    expect(read("vitest.unit.config.ts")).toContain("...exclude");
  });

  it("keeps every ui browser file on the browser config and not file-skipped", () => {
    const uiConfig = read("ui/vitest.config.ts");
    expect(uiConfig).toContain('include: ["src/**/*.browser.test.ts"]');
    expect(uiConfig).toContain("enabled: true");

    const files = walkBrowserTests(path.join(root, "ui/src"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const relFromUi = path.relative(path.join(root, "ui"), file).split(path.sep).join("/");
      expect(relFromUi.endsWith(".browser.test.ts")).toBe(true);
      expect(relFromUi.startsWith("src/")).toBe(true);
      const text = fs.readFileSync(file, "utf8");
      expect(text, relFromUi).not.toMatch(/^describe\.skip\(/m);
      expect(text, relFromUi).not.toMatch(/^describe\.skipIf\(true\)/m);
    }
  });
});
