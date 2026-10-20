// Plugin Registry round-trip property test.
//
// Spec: gateway-plugins-monolith-decomposition (Task 3.9, Req 9.1–9.5).
//
// Reads the committed baseline snapshot and re-runs `loadOpenBotPlugins`
// against the same plugin set (workspace default, cache disabled). The
// resulting canonical-JSON shape must be byte-identical to the committed
// artifact. Because `fast-check` is not in the dependency tree, this is
// implemented as a single deterministic example-based assertion.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildSnapshot,
  serializeSnapshot,
} from "../../../scripts/architecture/snapshot-plugin-registry.js";
import { loadOpenBotPlugins } from "../loader.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const baselineFile = path.join(
  repoRoot,
  ".kiro",
  "specs",
  "gateway-plugins-monolith-decomposition",
  "baseline",
  "loader-registry-snapshot.json",
);

describe("loader registry round-trip", () => {
  it("matches the committed baseline snapshot", () => {
    const baselineRaw = readFileSync(baselineFile, "utf8");

    const registry = loadOpenBotPlugins({
      cache: false,
      config: { plugins: { enabled: true } },
    });
    const liveSnapshot = buildSnapshot(registry);
    const liveSerialized = serializeSnapshot(liveSnapshot);

    expect(
      liveSerialized,
      `Live registry canonical JSON does not match committed baseline.
      If this is an intentional plugin-set change, regenerate the baseline:
        pnpm baseline:loader-registry`,
    ).toBe(baselineRaw);
  });
});
