import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateVector, type Vector } from "./contract-vector-runner.js";

const PIN_DIR = join(dirname(fileURLToPath(import.meta.url)), "contracts-pin");
const EXPECTED_MANIFEST_SHA256 = "6da567e0f376fee7b6b2b033e6666cbd5eba7bc3d67b93089e49e6edb759906d";
const VECTOR_FILES = [
  "model-adapter.vectors.json",
  "controlled-data-bridge.vectors.json",
  "memory-resource-bridge.vectors.json",
  "ai-execution-trace.vectors.json",
  "openapi-v3-draft.vectors.json",
] as const;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

type Manifest = {
  file_count: number;
  files: Array<{ path: string; sha256: string }>;
};

const manifest = JSON.parse(
  readFileSync(join(PIN_DIR, "v21-contract-manifest.json"), "utf8"),
) as Manifest;

describe("VB-4 OpenBot-side pin and 51-vector compatibility", () => {
  it("pins the Team A manifest SHA-256 and 18 file digests", () => {
    expect(sha256File(join(PIN_DIR, "v21-contract-manifest.json"))).toBe(EXPECTED_MANIFEST_SHA256);
    expect(manifest.file_count).toBe(18);
    expect(manifest.files).toHaveLength(18);
    for (const file of manifest.files) {
      expect(existsSync(join(PIN_DIR, file.path)), file.path).toBe(true);
      expect(sha256File(join(PIN_DIR, file.path)), file.path).toBe(file.sha256);
    }
  });

  it("executes all 51 draft vectors and keeps /v3/spaces out of the OpenAPI draft", () => {
    const results: Array<{ id: string; ok: boolean }> = [];
    for (const name of VECTOR_FILES) {
      const pack = JSON.parse(readFileSync(join(PIN_DIR, name), "utf8")) as { vectors: Vector[] };
      for (const vector of pack.vectors) {
        const result = evaluateVector(vector);
        if (!result.ok) {
          throw new Error(
            `${vector.id}: expect ${vector.expect} actual ${result.actual} code ${result.code} wanted ${vector.code}`,
          );
        }
        results.push({ id: result.id, ok: result.ok });
      }
    }
    expect(results).toHaveLength(51);
    expect(results.filter((row) => row.ok)).toHaveLength(51);
    const openapi = readFileSync(join(PIN_DIR, "openapi-v3-draft.yaml"), "utf8");
    expect(openapi.includes("\n  /v3/spaces") || openapi.includes("\n  /v3/spaces/")).toBe(false);
  });
});
