import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  computeHealthSummary,
  reportHealthSample,
  toFriendlyLabel,
  type SkillHealthSample,
  type SkillHealthState,
  type SkillHealthThresholds,
} from "./skill-health.ts";

type RequestHandler = (method: string, params?: unknown) => unknown;

function toGatewayRequest(handler: RequestHandler): GatewayBrowserClient["request"] {
  return ((method: string, params?: unknown) =>
    Promise.resolve(handler(method, params))) as GatewayBrowserClient["request"];
}

function createState(request: RequestHandler): SkillHealthState {
  return {
    client: { request: toGatewayRequest(request) } as GatewayBrowserClient,
    connected: true,
    bufferedSamples: [],
  };
}

const DEFAULT_THRESHOLDS: SkillHealthThresholds = {
  warningSuccessRate: 0.8,
  brokenConsecutiveFailures: 5,
  windowMs: 60_000, // 1 minute
};

function makeSample(overrides: Partial<SkillHealthSample> = {}): SkillHealthSample {
  return {
    skillId: "skill-1",
    agentId: "agent-1",
    timestamp: Date.now(),
    outcome: "success",
    latencyMs: 100,
    ...overrides,
  };
}

describe("skill-health controller", () => {
  describe("toFriendlyLabel", () => {
    it("maps healthy to 运行正常", () => {
      expect(toFriendlyLabel("healthy")).toBe("运行正常");
    });

    it("maps warning to 偶尔出错", () => {
      expect(toFriendlyLabel("warning")).toBe("偶尔出错");
    });

    it("maps broken to 已失效", () => {
      expect(toFriendlyLabel("broken")).toBe("已失效");
    });
  });

  describe("computeHealthSummary", () => {
    it("returns healthy with null metrics for empty samples", () => {
      const result = computeHealthSummary([], DEFAULT_THRESHOLDS);

      expect(result.status).toBe("healthy");
      expect(result.successRate).toBeNull();
      expect(result.avgLatencyMs).toBeNull();
      expect(result.lastVerifiedAt).toBeNull();
      expect(result.friendlyStatusLabel).toBe("运行正常");
    });

    it("returns healthy for all-success samples", () => {
      const now = Date.now();
      const samples: SkillHealthSample[] = [
        makeSample({ timestamp: now - 10_000, latencyMs: 100 }),
        makeSample({ timestamp: now - 5_000, latencyMs: 200 }),
        makeSample({ timestamp: now - 1_000, latencyMs: 150 }),
      ];

      const result = computeHealthSummary(samples, DEFAULT_THRESHOLDS);

      expect(result.status).toBe("healthy");
      expect(result.successRate).toBe(1);
      expect(result.avgLatencyMs).toBe(150);
      expect(result.lastVerifiedAt).toBe(now - 1_000);
      expect(result.friendlyStatusLabel).toBe("运行正常");
    });

    it("returns warning when success rate is below threshold", () => {
      const now = Date.now();
      // 3 failures out of 5 → 40% success rate, below 80% threshold
      const samples: SkillHealthSample[] = [
        makeSample({ timestamp: now - 5_000, outcome: "success", latencyMs: 100 }),
        makeSample({ timestamp: now - 4_000, outcome: "failure", latencyMs: 200 }),
        makeSample({ timestamp: now - 3_000, outcome: "failure", latencyMs: 300 }),
        makeSample({ timestamp: now - 2_000, outcome: "success", latencyMs: 100 }),
        makeSample({ timestamp: now - 1_000, outcome: "failure", latencyMs: 400 }),
      ];

      const result = computeHealthSummary(samples, DEFAULT_THRESHOLDS);

      expect(result.status).toBe("warning");
      expect(result.successRate).toBe(0.4);
      expect(result.friendlyStatusLabel).toBe("偶尔出错");
    });

    it("returns broken when consecutive trailing failures meet threshold", () => {
      const now = Date.now();
      // 1 success followed by 5 consecutive failures
      const samples: SkillHealthSample[] = [
        makeSample({ timestamp: now - 6_000, outcome: "success", latencyMs: 100 }),
        makeSample({ timestamp: now - 5_000, outcome: "failure", latencyMs: 200 }),
        makeSample({ timestamp: now - 4_000, outcome: "failure", latencyMs: 200 }),
        makeSample({ timestamp: now - 3_000, outcome: "failure", latencyMs: 200 }),
        makeSample({ timestamp: now - 2_000, outcome: "failure", latencyMs: 200 }),
        makeSample({ timestamp: now - 1_000, outcome: "failure", latencyMs: 200 }),
      ];

      const result = computeHealthSummary(samples, DEFAULT_THRESHOLDS);

      expect(result.status).toBe("broken");
      expect(result.friendlyStatusLabel).toBe("已失效");
    });

    it("filters out samples outside the sliding window", () => {
      const now = Date.now();
      // Old samples outside window (all failures) should be excluded
      const samples: SkillHealthSample[] = [
        makeSample({ timestamp: now - 120_000, outcome: "failure", latencyMs: 500 }),
        makeSample({ timestamp: now - 110_000, outcome: "failure", latencyMs: 500 }),
        makeSample({ timestamp: now - 100_000, outcome: "failure", latencyMs: 500 }),
        // Recent samples within window (all success)
        makeSample({ timestamp: now - 10_000, outcome: "success", latencyMs: 100 }),
        makeSample({ timestamp: now - 5_000, outcome: "success", latencyMs: 150 }),
      ];

      const result = computeHealthSummary(samples, DEFAULT_THRESHOLDS);

      expect(result.status).toBe("healthy");
      expect(result.successRate).toBe(1);
      expect(result.avgLatencyMs).toBe(125);
    });

    it("returns healthy when all samples are outside window", () => {
      const now = Date.now();
      const samples: SkillHealthSample[] = [
        makeSample({ timestamp: now - 200_000, outcome: "failure", latencyMs: 500 }),
        makeSample({ timestamp: now - 150_000, outcome: "failure", latencyMs: 500 }),
      ];

      const result = computeHealthSummary(samples, DEFAULT_THRESHOLDS);

      expect(result.status).toBe("healthy");
      expect(result.successRate).toBeNull();
      expect(result.avgLatencyMs).toBeNull();
      expect(result.lastVerifiedAt).toBeNull();
    });

    it("broken takes priority over warning when both conditions met", () => {
      const now = Date.now();
      // 5 consecutive failures also means low success rate
      const samples: SkillHealthSample[] = [
        makeSample({ timestamp: now - 5_000, outcome: "failure", latencyMs: 200 }),
        makeSample({ timestamp: now - 4_000, outcome: "failure", latencyMs: 200 }),
        makeSample({ timestamp: now - 3_000, outcome: "failure", latencyMs: 200 }),
        makeSample({ timestamp: now - 2_000, outcome: "failure", latencyMs: 200 }),
        makeSample({ timestamp: now - 1_000, outcome: "failure", latencyMs: 200 }),
      ];

      const result = computeHealthSummary(samples, DEFAULT_THRESHOLDS);

      expect(result.status).toBe("broken");
      expect(result.successRate).toBe(0);
      expect(result.friendlyStatusLabel).toBe("已失效");
    });
  });

  describe("reportHealthSample", () => {
    it("calls gateway skill-health.sample endpoint", async () => {
      const handler = vi.fn(async () => ({}));
      const state = createState(handler);
      const sample = makeSample();

      await reportHealthSample(state, sample);

      expect(handler).toHaveBeenCalledWith("skill-health.sample", { sample });
    });

    it("buffers sample when not connected", async () => {
      const state: SkillHealthState = {
        client: null,
        connected: false,
        bufferedSamples: [],
      };
      const sample = makeSample();

      await reportHealthSample(state, sample);

      expect(state.bufferedSamples).toHaveLength(1);
      expect(state.bufferedSamples[0]).toBe(sample);
    });

    it("buffers sample when client exists but not connected", async () => {
      const handler = vi.fn(async () => ({}));
      const state = createState(handler);
      state.connected = false;
      const sample = makeSample();

      await reportHealthSample(state, sample);

      expect(handler).not.toHaveBeenCalled();
      expect(state.bufferedSamples).toHaveLength(1);
    });
  });
});
