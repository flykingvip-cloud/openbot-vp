// @vitest-environment node
import type { ModelProfile } from "@openbot/aor-core";
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import type { RunGovernanceSnapshot } from "../governance/decision.js";
import {
  buildChildSpawnContextEstimate,
  planChildSpawnCapabilityRouting,
  resolveChildSpawnRoutingModeAndStrategy,
} from "./child-spawn-capability-routing.js";

const CHEAP: ModelProfile = {
  ref: { provider: "api-proxy-deepseek", id: "cheap" },
  cost: { inputPerMtok: 0.1, outputPerMtok: 0.2 },
  taskTypeScores: { tool_use: 0.75 },
};
const PREMIUM: ModelProfile = {
  ref: { provider: "api-proxy-deepseek", id: "premium" },
  cost: { inputPerMtok: 10, outputPerMtok: 20 },
  taskTypeScores: { coding: 0.8, reasoning: 0.85 },
};

function snap(partial: {
  allowlist: string[];
  preferredModelOrder?: string[];
  platformModelsMode?: "native" | "aor_enhanced";
  selectorStrategy?: "cheapest" | "best_quality" | "balanced" | "bandit";
}): RunGovernanceSnapshot {
  return {
    snapshotId: "s1",
    runId: "parent-1",
    governanceMode: "shadow",
    decisions: [],
    effectiveModelSet: {
      allowlist: partial.allowlist,
      ...(partial.preferredModelOrder ? { preferredModelOrder: partial.preferredModelOrder } : {}),
      ...(partial.platformModelsMode ? { platformModelsMode: partial.platformModelsMode } : {}),
      ...(partial.selectorStrategy ? { selectorStrategy: partial.selectorStrategy } : {}),
    },
    createdAt: new Date().toISOString(),
  };
}

const cfgNative = {
  gateway: { platform: { models: { mode: "native" } } },
} as unknown as OpenBotConfig;
const cfgAor = {
  gateway: { platform: { models: { mode: "aor_enhanced" } } },
} as unknown as OpenBotConfig;

describe("spawn-path child capability routing (not helper-only)", () => {
  it("inherits native mode from parent snapshot and keeps authorized order", () => {
    const parentOrder = ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"];
    const planned = planChildSpawnCapabilityRouting({
      cfg: cfgAor, // trusted cfg would re-rank; snapshot must win
      taskText: "帮我重构这段支付回调",
      parentSnapshot: snap({
        allowlist: parentOrder,
        preferredModelOrder: parentOrder,
        platformModelsMode: "native",
        selectorStrategy: "best_quality",
      }),
      authorizedModelIds: parentOrder,
      parentPreferredModelOrder: parentOrder,
      catalog: [CHEAP, PREMIUM],
    });
    expect(planned.inherited.mode).toBe("native");
    expect(planned.inherited.source).toBe("parent_snapshot");
    expect(planned.preferredModelOrder[0]).toBe("api-proxy-deepseek/cheap");
    // Plan ≠ completion even when routing ok.
    expect(planned.consumedSurface.targetModalityCompleted).toBe(false);
  });

  it("inherits aor_enhanced + strategy from parent and re-ranks child coding task", () => {
    const parentOrder = ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"];
    const planned = planChildSpawnCapabilityRouting({
      cfg: cfgNative,
      taskText: "帮我重构这段支付回调",
      parentSnapshot: snap({
        allowlist: parentOrder,
        preferredModelOrder: parentOrder,
        platformModelsMode: "aor_enhanced",
        selectorStrategy: "best_quality",
      }),
      authorizedModelIds: parentOrder,
      parentPreferredModelOrder: parentOrder,
      catalog: [CHEAP, PREMIUM],
    });
    expect(planned.inherited.mode).toBe("aor_enhanced");
    expect(planned.inherited.selectorStrategy).toBe("best_quality");
    expect(planned.preferredModelOrder[0]).toBe("api-proxy-deepseek/premium");
    expect(planned.preferredModelOrder.toSorted()).toEqual(parentOrder.toSorted());
  });

  it("falls back to trusted config mode when snapshot lacks mode", () => {
    const inherited = resolveChildSpawnRoutingModeAndStrategy({
      cfg: cfgNative,
      parentSnapshot: snap({ allowlist: ["m1"] }),
    });
    expect(inherited.mode).toBe("native");
    expect(inherited.source).toBe("trusted_config");
  });

  it("does not hardcode aor_enhanced when config is native", () => {
    const planned = planChildSpawnCapabilityRouting({
      cfg: cfgNative,
      taskText: "帮我重构这段支付回调",
      authorizedModelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
      catalog: [CHEAP, PREMIUM],
    });
    expect(planned.inherited.mode).toBe("native");
    expect(planned.preferredModelOrder[0]).toBe("api-proxy-deepseek/cheap");
  });

  it("subagent accepted-not-completed: routing surface stays incomplete", () => {
    const planned = planChildSpawnCapabilityRouting({
      cfg: cfgAor,
      taskText: "summarize this note",
      parentSnapshot: snap({
        allowlist: ["openai/gpt-5.4"],
        platformModelsMode: "aor_enhanced",
        selectorStrategy: "balanced",
      }),
      authorizedModelIds: ["openai/gpt-5.4"],
      catalog: [],
    });
    // Spawn would return status=accepted with this surface — completed must stay false.
    expect(planned.consumedSurface.status).toBe("ok");
    expect(planned.consumedSurface.targetModalityCompleted).toBe(false);
    expect(planned.planFailure.kind).toBe("none");
  });
});

describe("child spawn attachment / tools estimate", () => {
  it("keeps attachments unknown when byte sizes are invalid (names must not fake known content)", () => {
    const built = buildChildSpawnContextEstimate({
      taskText: "read the doc",
      attachments: { files: [{ name: "huge.bin", bytes: -1 }] },
    });
    expect(built.unknownParts).toContain("attachments");
  });

  it("uses byte sizes for token estimate without filename fluff as content", () => {
    const built = buildChildSpawnContextEstimate({
      taskText: "read the doc",
      attachments: { files: [{ name: "huge.bin", bytes: 4000 }] },
    });
    expect(built.unknownParts).not.toContain("attachments");
    expect(built.contextParts.attachmentsText?.length).toBe(4000);
    expect(built.contextParts.attachmentsText).not.toContain("huge.bin");
  });

  it("never claims tools known with empty fake defs", () => {
    const built = buildChildSpawnContextEstimate({
      taskText: "hi",
      attachments: null,
    });
    expect(built.unknownParts).toContain("tools");
  });
});
