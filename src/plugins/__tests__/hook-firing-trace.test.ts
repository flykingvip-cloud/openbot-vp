// Hook firing trace replay test.
//
// Spec: gateway-plugins-monolith-decomposition (Task 2.7, Req 10.1, 10.2, 10.3, 10.4).
//
// Loads the baseline trace recorded against the pre-refactor `hooks.ts` (a
// monolith) at
// `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/hooks-firing-trace.json`
// and re-runs each scenario under the post-refactor `createHookRunner`
// (imported via the `src/plugins/hooks.ts` facade, which re-exports from
// `./hooks/runner.js`). For every scenario we assert record-by-record
// equality on the `(hookName, pluginId, phase, payloadHash)` quadruple.
//
// On mismatch the failure message prints the first differing
// `(hookName, pluginId, phase)` triple (Req 10.3).
//
// **Validates: Requirements 10.1, 10.2, 10.3, 10.4**
//
// Listed as Regression_Baseline test #11 in
// `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/hooks.md`.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  captureTraceByName,
  type HookFiringRecord,
  type HookFiringTrace,
} from "../../../scripts/architecture/hook-firing-scenarios.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BASELINE_PATH = path.join(
  REPO_ROOT,
  ".kiro",
  "specs",
  "gateway-plugins-monolith-decomposition",
  "baseline",
  "hooks-firing-trace.json",
);

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as readonly HookFiringTrace[];

function describeRecord(record: HookFiringRecord | undefined): string {
  if (record === undefined) {
    return "<missing>";
  }
  return `(${record.hookName}, ${record.pluginId}, ${record.phase})`;
}

function compareTraces(scenario: string, live: HookFiringTrace, expected: HookFiringTrace): void {
  const length = Math.max(live.records.length, expected.records.length);
  for (let i = 0; i < length; i++) {
    const liveRecord = live.records[i];
    const expectedRecord = expected.records[i];
    const mismatch =
      liveRecord === undefined ||
      expectedRecord === undefined ||
      liveRecord.hookName !== expectedRecord.hookName ||
      liveRecord.pluginId !== expectedRecord.pluginId ||
      liveRecord.phase !== expectedRecord.phase ||
      liveRecord.payloadHash !== expectedRecord.payloadHash;
    if (mismatch) {
      throw new Error(
        `Hook firing trace mismatch in scenario "${scenario}" at index ${i}:\n` +
          `  expected ${describeRecord(expectedRecord)}\n` +
          `  live     ${describeRecord(liveRecord)}`,
      );
    }
  }
}

describe("hook firing trace replay", () => {
  it("baseline file is non-empty", () => {
    expect(baseline.length).toBeGreaterThan(0);
  });

  it.each(baseline.map((scenario) => ({ scenario })))(
    "$scenario.scenario reproduces the recorded trace",
    async ({ scenario }) => {
      const live = await captureTraceByName(scenario.scenario);
      compareTraces(scenario.scenario, live, scenario);
    },
  );
});
