import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-asset-incubation-handlers-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const { assetIncubationSessionHandlers } = await import("./asset-incubation-session.js");

type HandlerResponse = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

function cleanStore(): void {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

async function invokeHandler(
  method: keyof typeof assetIncubationSessionHandlers,
  params: Record<string, unknown> = {},
): Promise<HandlerResponse> {
  const handler = assetIncubationSessionHandlers[method];
  let response: HandlerResponse = { ok: false };
  await handler({
    req: { type: "req", id: "1", method, params },
    params,
    client: { user: "User-A" },
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
  } as GatewayRequestHandlerOptions);
  return response;
}

describe("asset-incubation session handlers", () => {
  beforeEach(() => {
    cleanStore();
  });

  afterEach(() => {
    cleanStore();
  });

  it("records guidance lifecycle events for asset incubation", async () => {
    const recorded = await invokeHandler("asset-incubation.guidance.record", {
      event: "guidance_completed",
      scenario: "wechat_oa_setup",
      contextConfidence: "high",
      stepsCompleted: 9,
      exceptions: 1,
      reusablePattern: true,
      sessionKey: "agent:main:main",
    });
    expect(recorded.ok).toBe(true);
    const payload = recorded.payload as {
      record?: { clusterId?: string; intentKey?: string; suggestedAssetType?: string };
    };
    expect(payload.record?.clusterId).toBe("guidance:wechat_oa_setup");
    expect(payload.record?.intentKey).toContain("guidance_completed");
    expect(payload.record?.suggestedAssetType).toBe("sop");

    const list = await invokeHandler("asset-incubation.session-events.list");
    expect(list.ok).toBe(true);
    expect((list.payload as { events?: unknown[] })?.events?.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects incomplete guidance step failure payloads", async () => {
    const bad = await invokeHandler("asset-incubation.guidance.record", {
      event: "guidance_step_failed",
      scenario: "wechat_oa_setup",
      contextConfidence: "medium",
    });
    expect(bad.ok).toBe(false);
  });

  it("appends events and schedules review suggestions", async () => {
    const now = Date.now();
    for (let index = 0; index < 3; index += 1) {
      const append = await invokeHandler("asset-incubation.session-events.append", {
        event: {
          id: `weekly:${index}`,
          sessionKey: "agent:main:main",
          contextId: `ctx-${index}`,
          clusterId: "cluster-weekly",
          intentKey: "weekly-report",
          label: "周报生成",
          suggestedAssetType: "template",
          occurredAt: now - index * 1_000,
        },
      });
      expect(append.ok).toBe(true);
    }

    const list = await invokeHandler("asset-incubation.session-events.list");
    expect(list.ok).toBe(true);
    expect((list.payload as { events?: unknown[] })?.events).toHaveLength(3);

    const review = await invokeHandler("asset-incubation.review.schedule", {
      minRecurrence: 3,
    });
    expect(review.ok).toBe(true);
    const suggestions = (review.payload as { suggestions?: unknown[] })?.suggestions ?? [];
    expect(suggestions).toHaveLength(1);
  });

  it("drops knowledge review suggestions and returns at most three organizable ones", async () => {
    const now = Date.now();
    const clusters = [
      { clusterId: "knowledge-article", label: "知识/报告产出", suggestedAssetType: "template" },
      { clusterId: "structured-output", label: "结构化任务", suggestedAssetType: "capability" },
      { clusterId: "competitive-analysis", label: "竞品分析", suggestedAssetType: "workflow" },
      { clusterId: "customer-interview", label: "客户访谈整理", suggestedAssetType: "workflow" },
      { clusterId: "prd", label: "产品需求文档", suggestedAssetType: "template" },
      { clusterId: "business-plan", label: "商业计划", suggestedAssetType: "workflow" },
    ];
    for (const cluster of clusters) {
      for (let index = 0; index < 3; index += 1) {
        const append = await invokeHandler("asset-incubation.session-events.append", {
          event: {
            id: `${cluster.clusterId}:${index}`,
            sessionKey: "agent:main:main",
            contextId: `${cluster.clusterId}-${index}`,
            clusterId: cluster.clusterId,
            intentKey: cluster.clusterId,
            label: cluster.label,
            suggestedAssetType: cluster.suggestedAssetType,
            occurredAt: now - index * 1_000,
          },
        });
        expect(append.ok).toBe(true);
      }
    }

    const review = await invokeHandler("asset-incubation.review.schedule", {
      minRecurrence: 3,
    });
    expect(review.ok).toBe(true);
    const suggestions =
      (review.payload as { suggestions?: Array<{ label?: string }> })?.suggestions ?? [];
    expect(suggestions.map((entry) => entry.label)).toEqual([
      "结构化任务",
      "竞品分析",
      "客户访谈整理",
    ]);
    expect(suggestions.some((entry) => entry.label?.includes("知识"))).toBe(false);
  });

  it("returns evidence summary for cluster", async () => {
    await invokeHandler("asset-incubation.externalization.record", {
      kind: "copy",
      contextId: "artifact-1",
      sessionKey: "agent:main:main",
    });
    await invokeHandler("asset-incubation.edit-pattern.record", {
      transformId: "name->title",
    });
    await invokeHandler("asset-incubation.edit-pattern.record", {
      transformId: "name->title",
    });
    await invokeHandler("asset-incubation.edit-pattern.record", {
      transformId: "name->title",
    });

    const summary = await invokeHandler("asset-incubation.evidence.summary", {
      clusterId: "artifact-1",
    });
    expect(summary.ok).toBe(true);
    const payload = summary.payload as {
      summary?: { externalizationCount?: number; editPatternStabilityCount?: number };
    };
    expect(payload.summary?.externalizationCount).toBe(1);
    expect(payload.summary?.editPatternStabilityCount).toBe(3);
  });

  it("builds weekly digest with review clusters", async () => {
    const now = Date.now();
    for (let index = 0; index < 3; index += 1) {
      await invokeHandler("asset-incubation.session-events.append", {
        event: {
          id: `digest:${index}`,
          sessionKey: "agent:main:main",
          contextId: `ctx-d-${index}`,
          clusterId: "cluster-digest",
          intentKey: "digest-report",
          label: "日报整理",
          suggestedAssetType: "template",
          occurredAt: now - index * 1_000,
        },
      });
    }

    const digest = await invokeHandler("asset-incubation.digest.build", {
      minRecurrence: 3,
    });
    expect(digest.ok).toBe(true);
    const payload = digest.payload as {
      headline?: string;
      entries?: Array<{ kind?: string; fingerprint?: string }>;
    };
    expect(payload.entries?.length).toBeGreaterThan(0);
    expect(payload.entries?.some((entry) => entry.kind === "review")).toBe(true);
  });
});
