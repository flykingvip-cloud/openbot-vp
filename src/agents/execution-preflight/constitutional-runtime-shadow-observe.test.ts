/**
 * Constitutional runtime shadow observation (Checkpoint C first slice).
 * Frozen test plan cases: B-10, B-21, B-22, B-33, B-38 at unit level. The
 * attempt-level halves of B-33 and B-38 live in the spawn-workspace harness
 * (Checkpoint C3).
 */
import { createHook } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { observePreflightRuntimeFacade } from "./constitutional-runtime-facade.js";
import type { ConstitutionalRuntimeShadowDeps } from "./constitutional-runtime-shadow-deps.js";
import { observeConstitutionalRuntimeShadow } from "./constitutional-runtime-shadow-observe.js";
import {
  CONSTITUTIONAL_RUNTIME_SHADOW_RECORD_KEYS,
  minimizeShadowRecord,
  projectPreflightShadowObservation,
} from "./constitutional-runtime-shadow-projection.js";
import {
  NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK,
  safeRecord,
  safeRecordError,
  type ConstitutionalRuntimeShadowErrorCode,
  type ConstitutionalRuntimeShadowRecord,
  type ConstitutionalRuntimeShadowSink,
} from "./constitutional-runtime-shadow-sink.js";
import type { ExecutionPreflight } from "./types.js";

// Pass-through spies: real behavior by default, so a test can make exactly one
// step throw (fault injection) and read the call order. Deps still arrive only
// as the observation's arguments.
vi.mock("./constitutional-runtime-facade.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./constitutional-runtime-facade.js")>();
  return {
    ...actual,
    observePreflightRuntimeFacade: vi.fn(actual.observePreflightRuntimeFacade),
  };
});
vi.mock("./constitutional-runtime-shadow-projection.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./constitutional-runtime-shadow-projection.js")>();
  return {
    ...actual,
    projectPreflightShadowObservation: vi.fn(actual.projectPreflightShadowObservation),
    minimizeShadowRecord: vi.fn(actual.minimizeShadowRecord),
  };
});
vi.mock("./constitutional-runtime-shadow-sink.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./constitutional-runtime-shadow-sink.js")>();
  return {
    ...actual,
    safeRecord: vi.fn(actual.safeRecord),
    safeRecordError: vi.fn(actual.safeRecordError),
  };
});

const SHADOW_MODULES = ["deps", "gate", "observe", "projection", "sink"].map(
  (name) => `./constitutional-runtime-shadow-${name}.ts`,
);

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

function collectorSink(options: { recordErrorThrows?: boolean } = {}) {
  const record = vi.fn<(value: ConstitutionalRuntimeShadowRecord) => void>();
  const recordError = vi.fn<(code: ConstitutionalRuntimeShadowErrorCode) => void>(() => {
    if (options.recordErrorThrows) {
      throw new Error("sink recordError failed");
    }
  });
  const sink: ConstitutionalRuntimeShadowSink = Object.freeze({ record, recordError });
  return { sink, record, recordError };
}

function frozenDeps(
  sink: ConstitutionalRuntimeShadowSink,
  now: () => number = () => 0,
): ConstitutionalRuntimeShadowDeps {
  return Object.freeze({ runtimeShadowEnabled: true, sink, now });
}

/** Runs `run` synchronously and returns the type of every async resource it created. */
function collectAsyncResources(run: () => void): string[] {
  const types: string[] = [];
  const hook = createHook({
    init(_asyncId, type) {
      types.push(type);
    },
  });
  hook.enable();
  try {
    run();
  } finally {
    hook.disable();
  }
  return types;
}

function moduleCode(file: string): string {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function firstCallOrder(mock: { mock: { invocationCallOrder: number[] } }): number {
  return mock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
}

describe("Constitutional runtime shadow observation", () => {
  beforeEach(() => {
    // mockReset restores each pass-through implementation and drops any leftover "once".
    vi.mocked(observePreflightRuntimeFacade).mockReset();
    vi.mocked(projectPreflightShadowObservation).mockReset();
    vi.mocked(minimizeShadowRecord).mockReset();
    vi.mocked(safeRecord).mockReset();
    vi.mocked(safeRecordError).mockReset();
  });

  it("records once through safeRecord, in design order, returns void and mutates nothing", () => {
    const preflight = deepFreeze(preflightFixture());
    const snapshot = structuredClone(preflight);
    const { sink, record, recordError } = collectorSink();
    const deps = frozenDeps(sink);

    expect(observeConstitutionalRuntimeShadow(deps, preflight)).toBeUndefined();

    expect(record).toHaveBeenCalledTimes(1);
    expect(recordError).not.toHaveBeenCalled();
    const value = record.mock.calls[0]?.[0];
    expect(Object.keys(value ?? {}).toSorted()).toEqual(
      [...CONSTITUTIONAL_RUNTIME_SHADOW_RECORD_KEYS].toSorted(),
    );
    expect(safeRecord).toHaveBeenCalledWith(sink, value);
    expect(safeRecordError).not.toHaveBeenCalled();
    expect(observePreflightRuntimeFacade).toHaveBeenCalledWith({
      decisionStage: "preflight",
      capabilityCategory: "unspecified",
      profileCategory: "unspecified",
      shadow: true,
    });
    // projection → façade → record build → safe sink call.
    expect(firstCallOrder(vi.mocked(projectPreflightShadowObservation))).toBeLessThan(
      firstCallOrder(vi.mocked(observePreflightRuntimeFacade)),
    );
    expect(firstCallOrder(vi.mocked(observePreflightRuntimeFacade))).toBeLessThan(
      firstCallOrder(vi.mocked(minimizeShadowRecord)),
    );
    expect(firstCallOrder(vi.mocked(minimizeShadowRecord))).toBeLessThan(
      firstCallOrder(vi.mocked(safeRecord)),
    );
    expect(preflight).toEqual(snapshot);
    expect(Object.isFrozen(deps)).toBe(true);
    expect(deps.sink).toBe(sink);
  });

  it("B-10: a synchronous façade throw is reported once as observe_error and never rethrown", () => {
    vi.mocked(observePreflightRuntimeFacade).mockImplementationOnce(() => {
      throw new Error("façade failed");
    });
    const preflight = deepFreeze(preflightFixture());
    const snapshot = structuredClone(preflight);
    const { sink, record, recordError } = collectorSink();

    let returned: unknown = "not-called";
    expect(() => {
      returned = observeConstitutionalRuntimeShadow(frozenDeps(sink), preflight);
    }).not.toThrow();
    expect(returned).toBeUndefined();
    expect(safeRecordError).toHaveBeenCalledTimes(1);
    expect(safeRecordError).toHaveBeenCalledWith(sink, "observe_error");
    expect(recordError).toHaveBeenCalledTimes(1);
    expect(recordError).toHaveBeenCalledWith("observe_error");
    expect(minimizeShadowRecord).not.toHaveBeenCalled();
    expect(safeRecord).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(preflight).toEqual(snapshot);
  });

  it("projection, record-build and clock throws are reported the same way (design §2.2)", () => {
    const faults: [string, () => void][] = [
      [
        "projection",
        () => {
          vi.mocked(projectPreflightShadowObservation).mockImplementationOnce(() => {
            throw new Error("projection failed");
          });
        },
      ],
      [
        "record build",
        () => {
          vi.mocked(minimizeShadowRecord).mockImplementationOnce(() => {
            throw new Error("record build failed");
          });
        },
      ],
    ];
    const preflight = deepFreeze(preflightFixture());
    for (const [label, arm] of faults) {
      arm();
      const { sink, record, recordError } = collectorSink();
      expect(
        () => observeConstitutionalRuntimeShadow(frozenDeps(sink), preflight),
        label,
      ).not.toThrow();
      expect(recordError.mock.calls, label).toEqual([["observe_error"]]);
      expect(record, label).not.toHaveBeenCalled();
    }

    // The clock can fail before or after the façade call.
    for (const failingCall of [1, 2]) {
      let calls = 0;
      const now = () => {
        calls += 1;
        if (calls === failingCall) {
          throw new Error("clock failed");
        }
        return 0;
      };
      const { sink, record, recordError } = collectorSink();
      expect(() =>
        observeConstitutionalRuntimeShadow(frozenDeps(sink, now), preflight),
      ).not.toThrow();
      expect(recordError.mock.calls, `clock call ${failingCall}`).toEqual([["observe_error"]]);
      expect(record, `clock call ${failingCall}`).not.toHaveBeenCalled();
    }
  });

  it("B-21: the injected clock drives a bounded bucket; real overhead p95 stays within 2 ms", () => {
    const preflight = deepFreeze(preflightFixture());

    // Injected now: only the bucket crosses, never the raw milliseconds.
    const cases: [number, string][] = [
      [0.37, "le_1ms"],
      [1.63, "le_2ms"],
      [4.19, "le_5ms"],
      [7.93, "gt_5ms"],
    ];
    for (const [elapsed, bucket] of cases) {
      const { sink, record } = collectorSink();
      const now = vi
        .fn<() => number>()
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(1000 + elapsed);
      observeConstitutionalRuntimeShadow(frozenDeps(sink, now), preflight);
      expect(now).toHaveBeenCalledTimes(2);
      const value = record.mock.calls[0]?.[0];
      expect(value?.latencyBucket).toBe(bucket);
      expect(JSON.stringify(value)).not.toContain(String(elapsed));
    }

    // No network, disk or await: the synchronous call creates no async resource,
    // and no shadow module imports anything but its sibling modules.
    const created = collectAsyncResources(() => {
      observeConstitutionalRuntimeShadow(frozenDeps(collectorSink().sink), preflight);
    });
    expect(created).toEqual([]);
    for (const file of SHADOW_MODULES) {
      const code = moduleCode(file);
      for (const [, specifier] of code.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\//);
      }
      expect(code, file).not.toMatch(
        /\bfetch\b|XMLHttpRequest|WebSocket|node:|\bprocess\b|\brequire\s*\(|\bimport\s*\(/,
      );
    }

    // Real overhead with the production clock shape and sink.
    const deps = frozenDeps(
      NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK,
      performance.now.bind(performance),
    );
    for (let warmup = 0; warmup < 50; warmup += 1) {
      observeConstitutionalRuntimeShadow(deps, preflight);
    }
    const samples: number[] = [];
    for (let run = 0; run < 500; run += 1) {
      const startedAt = performance.now();
      observeConstitutionalRuntimeShadow(deps, preflight);
      samples.push(performance.now() - startedAt);
    }
    const sorted = samples.toSorted((a, b) => a - b);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    expect(p95).toBeLessThanOrEqual(2);
  });

  it("B-22: the observation leaves no pending promise, timer, AbortController or queue", async () => {
    // Detector self-check: it does see a promise and a timer when they exist.
    const control = collectAsyncResources(() => {
      void Promise.resolve();
      clearTimeout(setTimeout(() => undefined, 1_000));
    });
    expect(control).toEqual(expect.arrayContaining(["PROMISE", "Timeout"]));

    const { sink, record, recordError } = collectorSink();
    let returned: unknown = "not-called";
    const created = collectAsyncResources(() => {
      returned = observeConstitutionalRuntimeShadow(
        frozenDeps(sink),
        deepFreeze(preflightFixture()),
      );
    });
    expect(created).toEqual([]);
    expect(returned).toBeUndefined();
    expect(record).toHaveBeenCalledTimes(1);

    // Let microtasks, immediates and short timers run: nothing arrives late.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(recordError).not.toHaveBeenCalled();

    // No shadow module can schedule deferred work.
    for (const file of SHADOW_MODULES) {
      expect(moduleCode(file), file).not.toMatch(
        /\basync\b|\bawait\b|\bPromise\b|\.then\(|setTimeout|setInterval|setImmediate|queueMicrotask|nextTick|AbortController|EventEmitter|\bWorker\b/,
      );
    }
  });

  it("B-33: a façade throw followed by a recordError throw stays contained", () => {
    vi.mocked(observePreflightRuntimeFacade).mockImplementationOnce(() => {
      throw new Error("façade failed");
    });
    const preflight = deepFreeze(preflightFixture());
    const snapshot = structuredClone(preflight);
    const { sink, record, recordError } = collectorSink({ recordErrorThrows: true });
    const deps = frozenDeps(sink);

    let returned: unknown = "not-called";
    expect(() => {
      returned = observeConstitutionalRuntimeShadow(deps, preflight);
    }).not.toThrow();
    expect(returned).toBeUndefined();
    expect(safeRecordError).toHaveBeenCalledTimes(1);
    expect(recordError).toHaveBeenCalledTimes(1);
    expect(safeRecord).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(preflight).toEqual(snapshot);
    expect(Object.isFrozen(deps)).toBe(true);
    expect(deps.sink).toBe(sink);
  });

  it("B-38: a projection throw followed by a recordError throw stays contained", () => {
    vi.mocked(projectPreflightShadowObservation).mockImplementationOnce(() => {
      throw new Error("projection failed");
    });
    const preflight = deepFreeze(preflightFixture());
    const snapshot = structuredClone(preflight);
    const { sink, record, recordError } = collectorSink({ recordErrorThrows: true });
    const deps = frozenDeps(sink);

    let returned: unknown = "not-called";
    expect(() => {
      returned = observeConstitutionalRuntimeShadow(deps, preflight);
    }).not.toThrow();
    expect(returned).toBeUndefined();
    expect(observePreflightRuntimeFacade).not.toHaveBeenCalled();
    expect(safeRecordError).toHaveBeenCalledTimes(1);
    expect(recordError).toHaveBeenCalledTimes(1);
    expect(safeRecord).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(preflight).toEqual(snapshot);
    expect(Object.isFrozen(deps)).toBe(true);
    expect(deps.sink).toBe(sink);
  });
});
