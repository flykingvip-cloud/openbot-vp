import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
const { configDir } = vi.hoisted(() => ({ configDir: "/tmp/openbot-telemetry-" + process.pid }));
vi.mock("../utils.js", () => ({ CONFIG_DIR: configDir }));
import {
  recordTelemetry,
  __agentRuntimeStoreInternals,
  listTelemetry,
  type RuntimeTelemetry,
  type TelemetryWindow,
} from "./agent-runtime-store.js";

const now = 1_800_000_000_000;
const sample = (
  lastSampleAt: number,
  provenance: RuntimeTelemetry["provenance"] = "injected",
): RuntimeTelemetry => ({
  runtimeAgentId: "agent-a",
  capabilityId: "cap-a",
  calls7d: 42,
  successRate7d: 0.5,
  avgLatencyMs: 20,
  p95LatencyMs: 30,
  tokenConsumption7d: 50,
  errorCount7d: 21,
  queueDepth: 0,
  memoryPressure: 0,
  lastSampleAt,
  provenance,
});
const query = (window: TelemetryWindow = "1h") =>
  listTelemetry({ runtimeAgentId: null, capabilityId: null, window });
afterEach(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  __agentRuntimeStoreInternals.reset();
});
describe("telemetry snapshot windows and provenance", () => {
  it("normalizes invalid provenance and isolates input and returned objects", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    __agentRuntimeStoreInternals.reset();
    const input = sample(now);
    recordTelemetry(input);
    input.calls7d = 999;
    query()[0].calls7d = 888;
    expect(query()[0].calls7d).toBe(42);
    const invalid = JSON.parse(
      JSON.stringify({ ...sample(now), provenance: "untrusted" }),
    ) as RuntimeTelemetry;
    __agentRuntimeStoreInternals.seed({ telemetry: [invalid] });
    expect(query()[0].provenance).toBe("unknown");
    recordTelemetry(invalid);
    expect(query()[1].provenance).toBe("unknown");
  });
  it("retains the newest 5000 inserted snapshots", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    __agentRuntimeStoreInternals.seed({
      telemetry: Array.from({ length: 5000 }, (_, i) => sample(now - 5000 + i)),
    });
    recordTelemetry(sample(now));
    expect(query()).toHaveLength(5000);
    expect(query()[0].lastSampleAt).toBe(now - 4999);
    expect(query().at(-1)?.lastSampleAt).toBe(now);
  });
  it.each([
    ["1h", 3600000],
    ["6h", 21600000],
    ["24h", 86400000],
    ["7d", 604800000],
    ["30d", 2592000000],
  ] as const)(
    "filters %s inclusively without recomputing seven-day aggregates",
    (window, duration) => {
      vi.spyOn(Date, "now").mockReturnValue(now);
      __agentRuntimeStoreInternals.seed({
        telemetry: [
          sample(now - duration - 1),
          sample(now - duration),
          sample(now),
          sample(now + 1),
          sample(NaN),
        ],
      });
      expect(query(window).map((s) => s.lastSampleAt)).toEqual([now - duration, now]);
      expect(query(window).every((s) => s.calls7d === 42)).toBe(true);
    },
  );
  it("keeps sources distinct and legacy snapshots unknown", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const legacy = sample(now);
    delete legacy.provenance;
    __agentRuntimeStoreInternals.seed({
      telemetry: [legacy, sample(now, "seed"), sample(now, "live"), sample(now)],
    });
    expect(query().map((s) => s.provenance)).toEqual(["unknown", "seed", "live", "injected"]);
    expect(legacy.provenance).toBeUndefined();
  });
  it("combines scope filters with time and handles empty stores", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    __agentRuntimeStoreInternals.reset();
    expect(query()).toEqual([]);
    __agentRuntimeStoreInternals.seed({
      telemetry: [
        sample(now),
        { ...sample(now), runtimeAgentId: "other" },
        { ...sample(now), capabilityId: null },
      ],
    });
    expect(
      listTelemetry({ runtimeAgentId: "agent-a", capabilityId: "cap-a", window: "1h" }),
    ).toHaveLength(1);
  });
});
