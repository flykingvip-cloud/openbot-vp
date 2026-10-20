import { beforeEach, describe, expect, it } from "vitest";
import {
  clearEditPatternsForTests,
  deriveEditTransformSignature,
  recordLocalEditPattern,
} from "./edit-pattern-stability.ts";
import {
  clearExternalizationSignalsForTests,
  countExternalizationSignals,
  recordExternalizationSignal,
} from "./externalization-tracker.ts";
import { buildPatternFingerprint } from "./pattern-fingerprint.ts";

describe("pattern-fingerprint", () => {
  it("separates clusters with different output schema", () => {
    const base = {
      hasArtifact: true,
      hasStructuredOutput: true,
      hasWorkflowLanguage: false,
      signalKinds: ["task_complete"],
    };
    const weeklyNumbered = buildPatternFingerprint({
      ...base,
      text: "# 周报\n1. 进展\n2. 风险",
    });
    const weeklyBullets = buildPatternFingerprint({
      ...base,
      text: "# 周报\n- 进展\n- 风险",
    });
    expect(weeklyNumbered.intentKey).toBe(weeklyBullets.intentKey);
    expect(weeklyNumbered.clusterId).not.toBe(weeklyBullets.clusterId);
  });
});

describe("edit-pattern-stability", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
      },
    });
    clearEditPatternsForTests();
  });

  it("ignores capitalization-only edits", () => {
    expect(deriveEditTransformSignature("Weekly Report", "weekly report")).toBeNull();
  });

  it("counts stable transform repeats", () => {
    const signature = deriveEditTransformSignature("原始标题", "优化后的标题");
    expect(signature).toBeTruthy();
    recordLocalEditPattern(signature!);
    recordLocalEditPattern(signature!);
    const third = recordLocalEditPattern(signature!);
    expect(third.repeatCount).toBe(3);
  });
});

describe("externalization-tracker", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
      },
    });
    clearExternalizationSignalsForTests();
  });

  it("counts signals scoped to contextId", () => {
    recordExternalizationSignal({ kind: "copy", contextId: "artifact-1" });
    recordExternalizationSignal({ kind: "download", contextId: "artifact-1" });
    recordExternalizationSignal({ kind: "share", contextId: "artifact-2" });
    expect(countExternalizationSignals("artifact-1")).toBe(2);
    expect(countExternalizationSignals(null)).toBe(3);
  });
});
