import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { onAgentEvent, resetAgentRunContextForTest } from "../infra/agent-events.js";
import {
  buildInboundDepthHarvestRecord,
  buildInboundDepthScorecard,
  configureInboundDepthHarvestForTest,
  maybeHarvestChatInboundStage,
  pruneInboundDepthHarvestFiles,
  readInboundDepthHarvestRecords,
  resetInboundDepthHarvestForTest,
  resolveInboundDepthHarvestFilePath,
} from "./chat-inbound-depth-harvest.js";
import { emitChatInboundStage, hashChatSessionKey } from "./chat-inbound-stage-events.js";
import { resetExecutionRouterObservationForTest } from "./execution-router-observation.js";

const previous = new Map<string, string | undefined>();

function setEnv(key: string, value: string | undefined) {
  if (!previous.has(key)) {
    previous.set(key, process.env[key]);
  }
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "inbound-depth-harvest-"));
}

afterEach(() => {
  for (const [key, value] of previous) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  previous.clear();
  resetInboundDepthHarvestForTest();
  resetAgentRunContextForTest();
  resetExecutionRouterObservationForTest();
});

describe("inbound depth harvest", () => {
  it("does not write when harvest is disabled", () => {
    const root = makeTempRoot();
    configureInboundDepthHarvestForTest({ enabled: false, rootDir: root });
    maybeHarvestChatInboundStage({
      runId: "run-off",
      stage: "depth_decided",
      extra: { wouldDepth: "chat", mode: "shadow" },
    });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("appends depth_decided JSONL without raw session keys or user text", () => {
    const root = makeTempRoot();
    const now = Date.parse("2026-10-15T07:00:00.000Z");
    configureInboundDepthHarvestForTest({
      enabled: true,
      rootDir: root,
      now: () => now,
    });
    maybeHarvestChatInboundStage({
      runId: "run-1",
      stage: "depth_decided",
      sessionKey: "agent:main:employee:secret-user",
      extra: {
        wouldDepth: "chat",
        mode: "shadow",
        routeMs: 2,
        routeStrength: "unknown",
        classifierVersion: "v-test",
        reasons: ["default_chat"],
      },
    });
    // non-depth stages ignored
    maybeHarvestChatInboundStage({
      runId: "run-1",
      stage: "knowledge_started",
      extra: { depth: "chat" },
    });
    const filePath = resolveInboundDepthHarvestFilePath({ atMs: now, rootDir: root });
    expect(fs.existsSync(filePath)).toBe(true);
    const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed.event).toBe("chat.depth_decided");
    expect(parsed.wouldDepth).toBe("chat");
    expect(parsed.sessionKeyHash).toBe(hashChatSessionKey("agent:main:employee:secret-user"));
    expect(JSON.stringify(parsed)).not.toContain("secret-user");
    expect(parsed).not.toHaveProperty("text");
    expect(parsed).not.toHaveProperty("message");
  });

  it("prunes day files older than retention", () => {
    const root = makeTempRoot();
    const now = Date.parse("2026-10-15T12:00:00.000Z");
    fs.writeFileSync(path.join(root, "depth-decided-2026-09-01.jsonl"), "{}\n", "utf8");
    fs.writeFileSync(path.join(root, "depth-decided-2026-10-14.jsonl"), "{}\n", "utf8");
    const removed = pruneInboundDepthHarvestFiles({
      rootDir: root,
      nowMs: now,
      retentionDays: 7,
    });
    expect(removed.some((p) => p.endsWith("depth-decided-2026-09-01.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(root, "depth-decided-2026-09-01.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(root, "depth-decided-2026-10-14.jsonl"))).toBe(true);
  });

  it("builds a scorecard with wouldDepth mix and under-route risk hits", () => {
    const records = [
      buildInboundDepthHarvestRecord({
        runId: "a",
        extra: { wouldDepth: "chat", mode: "shadow", reasons: ["default_chat"] },
        atMs: 1,
      }),
      buildInboundDepthHarvestRecord({
        runId: "b",
        extra: { wouldDepth: "retrieve", mode: "shadow", reasons: ["explicit_knowledge_query"] },
        atMs: 2,
      }),
      buildInboundDepthHarvestRecord({
        runId: "c",
        extra: {
          wouldDepth: "chat",
          mode: "shadow",
          reasons: ["steward_operational_intent"],
        },
        atMs: 3,
      }),
      buildInboundDepthHarvestRecord({
        runId: "d",
        extra: { wouldDepth: "act", mode: "shadow", reasons: ["explicit_write_or_side_effect"] },
        atMs: 4,
      }),
    ];
    const scorecard = buildInboundDepthScorecard(records);
    expect(scorecard.total).toBe(4);
    expect(scorecard.byWouldDepth).toEqual({ chat: 2, retrieve: 1, act: 1 });
    expect(scorecard.underRouteRiskCount).toBe(1);
    expect(scorecard.underRouteRiskSamples[0]?.runId).toBe("c");
    expect(scorecard.goNoGoHints).toContain("under_route_risk_hits");
  });

  it("emitChatInboundStage persists harvest when SHADOW=1 (auto harvest)", () => {
    const root = makeTempRoot();
    setEnv("OPENBOT_STATE_DIR", root);
    setEnv("OPENBOT_CHAT_INBOUND_DEPTH_SHADOW", "1");
    setEnv("OPENBOT_CHAT_INBOUND_DEPTH_HARVEST", undefined);
    resetInboundDepthHarvestForTest();
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    emitChatInboundStage({
      runId: "run-live-shape",
      stage: "depth_decided",
      sessionKey: "agent:main:employee:u1",
      extra: {
        wouldDepth: "retrieve",
        mode: "shadow",
        routeMs: 5,
        reasons: ["explicit_knowledge_query"],
      },
    });
    stop();
    expect(events.some((evt) => evt.event === "chat.depth_decided")).toBe(true);
    const harvestRoot = path.join(root, "inbound-depth-harvest");
    const records = readInboundDepthHarvestRecords({ rootDir: harvestRoot });
    expect(records).toHaveLength(1);
    expect(records[0]?.wouldDepth).toBe("retrieve");
    expect(records[0]?.flags).toEqual(
      expect.arrayContaining(["chatInboundDepthShadow", "chatInboundDepthHarvest"]),
    );
  });

  it("emitChatInboundStage skips harvest when HARVEST=0 even if SHADOW=1", () => {
    const root = makeTempRoot();
    setEnv("OPENBOT_STATE_DIR", root);
    setEnv("OPENBOT_CHAT_INBOUND_DEPTH_SHADOW", "1");
    setEnv("OPENBOT_CHAT_INBOUND_DEPTH_HARVEST", "0");
    resetInboundDepthHarvestForTest();
    emitChatInboundStage({
      runId: "run-disabled",
      stage: "depth_decided",
      extra: { wouldDepth: "chat", mode: "shadow", reasons: ["default_chat"] },
    });
    const harvestRoot = path.join(root, "inbound-depth-harvest");
    expect(fs.existsSync(harvestRoot)).toBe(false);
  });
});
