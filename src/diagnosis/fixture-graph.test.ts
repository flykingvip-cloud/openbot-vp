import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadGoldenDiagnosticRunGraph } from "./fixture-graph.js";

const DIAGNOSIS_DIR = path.dirname(fileURLToPath(import.meta.url));

describe("diagnosis fixture JSON loader (NOT Mode B F4)", () => {
  it("loads golden graphs through the shared helper", () => {
    const graph = loadGoldenDiagnosticRunGraph("agent-not-started.json");
    expect(graph.graphKind).toBe("DiagnosticRunGraph");
    expect(graph.run.runId).toEqual(expect.any(String));
    expect(graph.evidences.length).toBeGreaterThan(0);
  });

  it("keeps diagnosis test files off local fixture JSON.parse copies", () => {
    const files = fs
      .readdirSync(DIAGNOSIS_DIR)
      .filter((name) => name.endsWith(".test.ts") && name !== "fixture-graph.test.ts");
    expect(files.length).toBeGreaterThan(0);
    const localLoader = /JSON\.parse\(\s*\n?\s*fs\.readFileSync\(path\.join\(FIXTURE_DIR/;
    for (const name of files) {
      const src = fs.readFileSync(path.join(DIAGNOSIS_DIR, name), "utf8");
      expect(src, name).not.toMatch(localLoader);
    }
  });

  it("reads projection snapshots through the shared infra JSON helper", () => {
    const src = fs.readFileSync(
      path.join(DIAGNOSIS_DIR, "report-query-projection-snapshot.ts"),
      "utf8",
    );
    expect(src).toMatch(/import \{ loadJsonFile \} from "\.\.\/infra\/json-file\.js"/);
    expect(src).not.toMatch(/function readSnapshotFile/);
  });
});
