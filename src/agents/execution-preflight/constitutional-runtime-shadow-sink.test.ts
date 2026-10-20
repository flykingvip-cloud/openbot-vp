/**
 * Sink contract (Checkpoint C first slice).
 * Frozen test plan cases: B-31 and B-32 at unit level. The attempt-level half
 * of B-31 lives in the spawn-workspace harness (Checkpoint C3).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ConstitutionalRuntimeShadowDeps } from "./constitutional-runtime-shadow-deps.js";
import { observeConstitutionalRuntimeShadow } from "./constitutional-runtime-shadow-observe.js";
import {
  NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK,
  safeRecord,
  safeRecordError,
  type ConstitutionalRuntimeShadowErrorCode,
  type ConstitutionalRuntimeShadowRecord,
  type ConstitutionalRuntimeShadowSink,
} from "./constitutional-runtime-shadow-sink.js";
import type { ExecutionPreflight } from "./types.js";

const SAMPLE_RECORD: ConstitutionalRuntimeShadowRecord = Object.freeze({
  mode: "shadow",
  decisionStage: "preflight",
  reasonCode: "none",
  invoked: true,
  blocked: false,
  executed: false,
  wroteReceipt: false,
  wroteTrace: false,
  flagOn: true,
  pathExists: false,
  gapExists: false,
  profileCategory: "unspecified",
  capabilityCategory: "unspecified",
  latencyBucket: "le_1ms",
});

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug", "trace"] as const;

function preflightFixture(): ExecutionPreflight {
  return {
    taskId: "task-fixture",
    sessionId: "session-fixture",
    intentClass: "chat",
    qualificationKind: "none",
    skillAliases: [],
    candidateSkills: [],
    allowedTools: ["read"],
    blockedTools: [],
    toolVisibility: { read: "visible" },
    resourceScope: [],
    deliveryRequirements: [],
    decisionCode: "skill_alias_resolved",
    forbiddenFinalEngines: [],
    requiredValidators: [],
    requiredArtifacts: [],
    requiredConfirmations: [],
    generationStageTools: [],
    deliveryStageTools: [],
    attemptNumber: 1,
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function frozenDeps(sink: ConstitutionalRuntimeShadowSink): ConstitutionalRuntimeShadowDeps {
  return Object.freeze({ runtimeShadowEnabled: true, sink, now: () => 0 });
}

/** Runs `run` with every console method stubbed; returns how many console calls happened. */
function countConsoleCalls(run: () => void): number {
  const spies = CONSOLE_METHODS.map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
  try {
    run();
    return spies.reduce((total, spy) => total + spy.mock.calls.length, 0);
  } finally {
    for (const spy of spies) {
      spy.mockRestore();
    }
  }
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

describe("Constitutional runtime shadow sink", () => {
  it("the NOOP sink is a frozen, shared, synchronous module-level constant", async () => {
    const sink = NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK;
    expect(Object.isFrozen(sink)).toBe(true);
    expect(Object.keys(sink).toSorted()).toEqual(["record", "recordError"]);
    expect(() => sink.record(SAMPLE_RECORD)).not.toThrow();
    expect(() => sink.recordError("observe_error")).not.toThrow();
    expect(() => Object.assign(sink, { record: () => undefined })).toThrow(TypeError);

    // Same instance on every import: reuse is not attempt-level sink creation.
    const reimported = await import("./constitutional-runtime-shadow-sink.js");
    expect(reimported.NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK).toBe(sink);
  });

  it("B-31: a sink.record throw is swallowed and never triggers recordError", () => {
    const record = vi.fn<(value: ConstitutionalRuntimeShadowRecord) => void>(() => {
      throw new Error("sink record failed");
    });
    const recordError = vi.fn<(code: ConstitutionalRuntimeShadowErrorCode) => void>();
    const sink: ConstitutionalRuntimeShadowSink = Object.freeze({ record, recordError });

    const consoleCalls = countConsoleCalls(() => {
      expect(() => safeRecord(sink, SAMPLE_RECORD)).not.toThrow();
      record.mockImplementationOnce(() => {
        throw new RangeError("second failure kind");
      });
      expect(() => safeRecord(sink, SAMPLE_RECORD)).not.toThrow();
    });
    expect(record).toHaveBeenCalledTimes(2);
    expect(recordError).not.toHaveBeenCalled();
    expect(consoleCalls).toBe(0);

    // Through the observation: returns normally and leaves the preflight untouched.
    const preflight = deepFreeze(preflightFixture());
    const snapshot = structuredClone(preflight);
    let returned: unknown = "not-called";
    expect(() => {
      returned = observeConstitutionalRuntimeShadow(frozenDeps(sink), preflight);
    }).not.toThrow();
    expect(returned).toBeUndefined();
    expect(record).toHaveBeenCalledTimes(3);
    expect(recordError).not.toHaveBeenCalled();
    expect(preflight).toEqual(snapshot);
  });

  it("B-32: a sink.recordError throw is swallowed with no further sink call", () => {
    const record = vi.fn<(value: ConstitutionalRuntimeShadowRecord) => void>();
    const recordError = vi.fn<(code: ConstitutionalRuntimeShadowErrorCode) => void>(() => {
      throw new Error("sink recordError failed");
    });
    const sink: ConstitutionalRuntimeShadowSink = Object.freeze({ record, recordError });

    let returned: unknown = "not-called";
    const consoleCalls = countConsoleCalls(() => {
      expect(() => {
        returned = safeRecordError(sink, "observe_error");
      }).not.toThrow();
    });
    expect(returned).toBeUndefined();
    expect(recordError).toHaveBeenCalledTimes(1);
    expect(recordError).toHaveBeenCalledWith("observe_error");
    expect(record).not.toHaveBeenCalled();
    expect(consoleCalls).toBe(0);
  });

  it("the sink module has no fallback reporting channel", () => {
    const code = stripComments(
      readFileSync(new URL("./constitutional-runtime-shadow-sink.ts", import.meta.url), "utf8"),
    );
    const specifiers = [...code.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1]);
    expect(specifiers).toEqual(["./constitutional-runtime-shadow-projection.js"]);
    expect(code).not.toMatch(/^import(?!\s+type\b)/m);
    expect(code).not.toMatch(
      /console|process|globalThis|\bfetch\b|\brequire\s*\(|\bimport\s*\(|writeFile|appendFile|createWriteStream|opentelemetry|\botel\b|jsonl/i,
    );
    // Module state is immutable: no reassignable bindings.
    expect(code).not.toMatch(/^\s*(let|var)\s/m);
  });
});
