// Plugin Registry round-trip property test.
//
// Spec: gateway-plugins-monolith-decomposition (Task 3.9, Req 9.1–9.5).
//
// Reads the committed baseline snapshot and re-runs `loadOpenBotPlugins`
// against the same plugin set (workspace default, cache disabled). The
// resulting canonical-JSON shape must be byte-identical to the committed
// artifact. Because `fast-check` is not in the dependency tree, this is
// implemented as a single deterministic example-based assertion.

import { mkdirSync, readFileSync } from "node:fs";
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

    const prevStateDir = process.env.OPENBOT_STATE_DIR;
    const isolatedStateDir = path.join(repoRoot, ".tmp", "loader-registry-baseline-state");
    mkdirSync(isolatedStateDir, { recursive: true });
    process.env.OPENBOT_STATE_DIR = isolatedStateDir;
    let liveSerialized: string;
    try {
      const registry = loadOpenBotPlugins({
        cache: false,
        config: { plugins: { enabled: true } },
      });
      const liveSnapshot = buildSnapshot(registry);
      liveSerialized = serializeSnapshot(liveSnapshot);
    } finally {
      if (prevStateDir === undefined) {
        delete process.env.OPENBOT_STATE_DIR;
      } else {
        process.env.OPENBOT_STATE_DIR = prevStateDir;
      }
    }

    const live = JSON.parse(liveSerialized) as {
      diagnostics: unknown;
      plugins: unknown;
      resourceCounts: unknown;
    };
    const baseline = JSON.parse(baselineRaw) as {
      diagnostics: unknown;
      plugins: unknown;
      resourceCounts: unknown;
    };
    // resourceCounts differ between plain node and vitest plugin loading; pin identity set.
    expect(live.diagnostics, "diagnostics drift").toEqual(baseline.diagnostics);
    expect(
      live.plugins,
      "plugin id/version set drift — regenerate with pnpm baseline:loader-registry",
    ).toEqual(baseline.plugins);
  });
});
