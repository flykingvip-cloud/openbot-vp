import { describe, expect, it } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  DEFAULT_THRESHOLDS,
  dismissHint,
  evaluatePatternHint,
  getActiveHints,
  normalizePatternHint,
  processIncomingHint,
  subscribeToPatternDetection,
  approvePatternCandidateOnServer,
  publishPatternDraftSkillOnServer,
  type PatternDetectionHint,
  type PatternDetectionState,
  type PatternDetectionThresholds,
  type PatternSignal,
} from "./pattern-detection.ts";

type RequestHandler = (method: string, params?: unknown) => unknown;

function toGatewayRequest(handler: RequestHandler): GatewayBrowserClient["request"] {
  return ((method, params) =>
    Promise.resolve(handler(method, params))) as GatewayBrowserClient["request"];
}

function createState(
  request?: RequestHandler,
  thresholds?: PatternDetectionThresholds,
): PatternDetectionState {
  return {
    client: request ? ({ request: toGatewayRequest(request) } as GatewayBrowserClient) : null,
    connected: !!request,
    pendingHints: [],
    dismissedContextIds: new Set(),
    thresholds: thresholds ?? DEFAULT_THRESHOLDS,
  };
}

function makeSignal(overrides?: Partial<PatternSignal>): PatternSignal {
  return {
    kind: "repeated_task",
    description: "重复执行周报生成",
    confidence: 0.85,
    detectedAt: Date.now(),
    sampleCount: 5,
    ...overrides,
  };
}

function makeHint(overrides?: Partial<PatternDetectionHint>): PatternDetectionHint {
  return {
    agentId: "agent-1",
    contextId: "ctx-1",
    signals: [makeSignal(), makeSignal({ kind: "stable_prompt", sampleCount: 4 })],
    overallConfidence: 0.8,
    suggestedName: "周报生成",
    suggestedSummary: "自动生成项目周报",
    ...overrides,
  };
}

describe("pattern-detection controller", () => {
  describe("evaluatePatternHint", () => {
    it("returns true when all thresholds met", () => {
      const hint = makeHint({
        overallConfidence: 0.8,
        signals: [makeSignal({ sampleCount: 5 }), makeSignal({ sampleCount: 3 })],
      });
      expect(evaluatePatternHint(hint, DEFAULT_THRESHOLDS)).toBe(true);
    });

    it("returns false when confidence below threshold", () => {
      const hint = makeHint({ overallConfidence: 0.5 });
      expect(evaluatePatternHint(hint, DEFAULT_THRESHOLDS)).toBe(false);
    });

    it("returns false when signal count below threshold", () => {
      const hint = makeHint({
        overallConfidence: 0.9,
        signals: [makeSignal({ sampleCount: 10 })], // only 1 signal, need 2
      });
      expect(evaluatePatternHint(hint, DEFAULT_THRESHOLDS)).toBe(false);
    });

    it("returns false when no signal has enough repetitions", () => {
      const hint = makeHint({
        overallConfidence: 0.9,
        signals: [makeSignal({ sampleCount: 1 }), makeSignal({ sampleCount: 2 })],
      });
      expect(evaluatePatternHint(hint, DEFAULT_THRESHOLDS)).toBe(false);
    });

    it("returns true at exact threshold boundaries", () => {
      const hint = makeHint({
        overallConfidence: 0.7, // exactly minConfidence
        signals: [
          makeSignal({ sampleCount: 3 }), // exactly minRepetitions
          makeSignal({ sampleCount: 1 }),
        ],
      });
      expect(evaluatePatternHint(hint, DEFAULT_THRESHOLDS)).toBe(true);
    });

    it("respects custom thresholds", () => {
      const custom: PatternDetectionThresholds = {
        minRepetitions: 5,
        minConfidence: 0.9,
        minSignalCount: 3,
      };
      const hint = makeHint({
        overallConfidence: 0.95,
        signals: [
          makeSignal({ sampleCount: 6 }),
          makeSignal({ sampleCount: 5 }),
          makeSignal({ sampleCount: 7 }),
        ],
      });
      expect(evaluatePatternHint(hint, custom)).toBe(true);
    });
  });

  describe("processIncomingHint", () => {
    it("adds valid hint to pendingHints", () => {
      const state = createState();
      const hint = makeHint();
      processIncomingHint(state, hint);
      expect(state.pendingHints).toHaveLength(1);
      expect(state.pendingHints[0]).toBe(hint);
    });

    it("ignores dismissed contextIds", () => {
      const state = createState();
      state.dismissedContextIds.add("ctx-1");
      const hint = makeHint({ contextId: "ctx-1" });
      processIncomingHint(state, hint);
      expect(state.pendingHints).toHaveLength(0);
    });

    it("ignores hints that don't pass evaluation", () => {
      const state = createState();
      const hint = makeHint({ overallConfidence: 0.1 }); // below threshold
      processIncomingHint(state, hint);
      expect(state.pendingHints).toHaveLength(0);
    });

    it("replaces existing hint with same contextId", () => {
      const state = createState();
      const hint1 = makeHint({ contextId: "ctx-1", suggestedName: "v1" });
      const hint2 = makeHint({ contextId: "ctx-1", suggestedName: "v2" });
      processIncomingHint(state, hint1);
      processIncomingHint(state, hint2);
      expect(state.pendingHints).toHaveLength(1);
      expect(state.pendingHints[0].suggestedName).toBe("v2");
    });
  });

  describe("dismissHint", () => {
    it("removes from pendingHints and adds to dismissed set", () => {
      const state = createState();
      const hint = makeHint({ contextId: "ctx-1" });
      state.pendingHints.push(hint);

      dismissHint(state, "ctx-1");

      expect(state.pendingHints).toHaveLength(0);
      expect(state.dismissedContextIds.has("ctx-1")).toBe(true);
    });

    it("handles dismissing a contextId not in pendingHints", () => {
      const state = createState();
      dismissHint(state, "ctx-nonexistent");
      expect(state.dismissedContextIds.has("ctx-nonexistent")).toBe(true);
      expect(state.pendingHints).toHaveLength(0);
    });
  });

  describe("getActiveHints", () => {
    it("returns only non-dismissed hints", () => {
      const state = createState();
      state.pendingHints.push(
        makeHint({ contextId: "ctx-1" }),
        makeHint({ contextId: "ctx-2" }),
        makeHint({ contextId: "ctx-3" }),
      );
      state.dismissedContextIds.add("ctx-2");

      const active = getActiveHints(state);
      expect(active).toHaveLength(2);
      expect(active.map((h) => h.contextId)).toEqual(["ctx-1", "ctx-3"]);
    });

    it("returns empty array when all dismissed", () => {
      const state = createState();
      state.pendingHints.push(makeHint({ contextId: "ctx-1" }));
      state.dismissedContextIds.add("ctx-1");

      expect(getActiveHints(state)).toHaveLength(0);
    });

    it("returns empty array when no hints", () => {
      const state = createState();
      expect(getActiveHints(state)).toHaveLength(0);
    });
  });

  describe("normalizePatternHint", () => {
    it("normalizes a complete valid hint", () => {
      const raw = {
        agentId: "agent-1",
        contextId: "ctx-1",
        signals: [
          {
            kind: "repeated_task",
            description: "重复操作",
            confidence: 0.9,
            detectedAt: 1700000000000,
            sampleCount: 5,
          },
        ],
        overallConfidence: 0.85,
        suggestedName: "周报生成",
        suggestedSummary: "自动生成周报",
      };

      const result = normalizePatternHint(raw);
      expect(result.agentId).toBe("agent-1");
      expect(result.contextId).toBe("ctx-1");
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].kind).toBe("repeated_task");
      expect(result.signals[0].sampleCount).toBe(5);
      expect(result.overallConfidence).toBe(0.85);
      expect(result.suggestedName).toBe("周报生成");
      expect(result.suggestedSummary).toBe("自动生成周报");
    });

    it("handles missing/malformed data gracefully", () => {
      const result = normalizePatternHint(null);
      expect(result.agentId).toBe("");
      expect(result.contextId).toBe("");
      expect(result.signals).toHaveLength(0);
      expect(result.overallConfidence).toBe(0);
      expect(result.suggestedName).toBe("");
      expect(result.suggestedSummary).toBe("");
    });

    it("filters out signals with invalid kind", () => {
      const raw = {
        agentId: "agent-1",
        contextId: "ctx-1",
        signals: [
          { kind: "invalid_kind", description: "bad", confidence: 0.9, sampleCount: 5 },
          { kind: "stable_io", description: "good", confidence: 0.8, sampleCount: 3 },
        ],
        overallConfidence: 0.8,
        suggestedName: "test",
        suggestedSummary: "test",
      };

      const result = normalizePatternHint(raw);
      expect(result.signals).toHaveLength(1);
      expect(result.signals[0].kind).toBe("stable_io");
    });

    it("clamps confidence values to 0-1 range", () => {
      const raw = {
        signals: [
          { kind: "repeated_task", description: "x", confidence: 1.5, sampleCount: 3 },
          { kind: "stable_prompt", description: "y", confidence: -0.5, sampleCount: 2 },
        ],
        overallConfidence: 2.0,
      };

      const result = normalizePatternHint(raw);
      expect(result.overallConfidence).toBe(1);
      expect(result.signals[0].confidence).toBe(1);
      expect(result.signals[1].confidence).toBe(0);
    });

    it("handles non-array signals field", () => {
      const result = normalizePatternHint({ signals: "not-an-array" });
      expect(result.signals).toHaveLength(0);
    });

    it("trims string values", () => {
      const raw = {
        agentId: "  agent-1  ",
        contextId: "  ctx-1  ",
        suggestedName: "  周报  ",
        suggestedSummary: "  描述  ",
        signals: [],
        overallConfidence: 0.5,
      };

      const result = normalizePatternHint(raw);
      expect(result.agentId).toBe("agent-1");
      expect(result.contextId).toBe("ctx-1");
      expect(result.suggestedName).toBe("周报");
      expect(result.suggestedSummary).toBe("描述");
    });

    it("floors sampleCount to integer", () => {
      const raw = {
        signals: [{ kind: "repeated_task", description: "x", confidence: 0.8, sampleCount: 3.7 }],
        overallConfidence: 0.8,
      };

      const result = normalizePatternHint(raw);
      expect(result.signals[0].sampleCount).toBe(3);
    });
  });

  describe("subscribeToPatternDetection", () => {
    it("calls pattern-detection.subscribe with agentId", async () => {
      let calledMethod = "";
      let calledParams: unknown = null;
      const state = createState((method, params) => {
        calledMethod = method;
        calledParams = params;
        return {};
      });

      const result = await subscribeToPatternDetection(state, "agent-1");

      expect(result).toBe(true);
      expect(calledMethod).toBe("pattern-detection.subscribe");
      expect(calledParams).toEqual({ agentId: "agent-1" });
    });

    it("returns false when client is not connected", async () => {
      const state = createState();
      state.client = null;
      state.connected = false;

      const result = await subscribeToPatternDetection(state, "agent-1");
      expect(result).toBe(false);
    });

    it("returns false on request error", async () => {
      const state = createState(() => {
        throw new Error("network error");
      });

      const result = await subscribeToPatternDetection(state, "agent-1");
      expect(result).toBe(false);
    });
  });

  describe("pattern governance actions", () => {
    it("approvePatternCandidateOnServer calls pattern-detection.approve", async () => {
      let method = "";
      const state = createState((m, params) => {
        method = m;
        expect(params).toMatchObject({
          agentId: "agent-1",
          candidateId: "cand-1",
        });
        return { candidate: { candidateId: "cand-1", agentId: "agent-1", status: "approved" } };
      });
      processIncomingHint(state, makeHint({ contextId: "cand-1" }));
      const ok = await approvePatternCandidateOnServer(state, {
        agentId: "agent-1",
        candidateId: "cand-1",
      });
      expect(ok).toBe(true);
      expect(method).toBe("pattern-detection.approve");
      expect(state.pendingHints.some((h) => h.contextId === "cand-1")).toBe(false);
    });

    it("publishPatternDraftSkillOnServer calls publish-draft-skill", async () => {
      let method = "";
      const state = createState((m) => {
        method = m;
        return { skillId: "skill-1" };
      });
      const ok = await publishPatternDraftSkillOnServer(state, {
        agentId: "agent-1",
        candidateId: "cand-2",
      });
      expect(ok).toBe(true);
      expect(method).toBe("pattern-detection.publish-draft-skill");
    });
  });
});
