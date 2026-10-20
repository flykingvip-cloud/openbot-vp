import { describe, expect, it } from "vitest";
import { classifyIntent } from "./daibai-intent-router.js";
import { buildReadRecommendation } from "./daibai-read-router.js";

describe("classifyIntent", () => {
  it("classifies read-only queries as self_serve with a domain hint", () => {
    expect(classifyIntent("这个功能怎么用？").tier).toBe("self_serve");
    expect(classifyIntent("我这个月还剩多少额度").domainHint).toBe("billing");
    expect(classifyIntent("我现在有哪些能力可以用").domainHint).toBe("capability");
    expect(classifyIntent("有哪些模型可以用").domainHint).toBe("model-access");
  });

  it("routes capability discovery prompts (推荐能力) to self_serve, not escalate", () => {
    // Onboarding quick-prompt: must not fall through to the conservative escalate fallback.
    const result = classifyIntent("有哪些推荐能力？");
    expect(result.tier).toBe("self_serve");
    expect(result.domainHint).toBe("capability");
  });

  it("classifies bug/feature/help reports as escalate", () => {
    expect(classifyIntent("我遇到一个 bug").tier).toBe("escalate");
    expect(classifyIntent("我想提一个新的 skill 需求").tier).toBe("escalate");
    expect(classifyIntent("这个功能报错了，无法使用").tier).toBe("escalate");
  });

  it("classifies actionable do-it-for-me requests as assisted_action", () => {
    expect(classifyIntent("帮我安装这个能力").tier).toBe("assisted_action");
    expect(classifyIntent("帮我设置一下预算").tier).toBe("assisted_action");
  });

  it("falls back to conversation tier for unclear input (chat agent handles reply)", () => {
    expect(classifyIntent("").tier).toBe("escalate");
    expect(classifyIntent("随便聊聊")).toEqual({
      tier: "self_serve",
      domainHint: "conversation",
    });
  });
});

describe("buildReadRecommendation", () => {
  it("maps domains to read RPCs", () => {
    expect(buildReadRecommendation("billing", "额度").recommendedMethod).toBe("billing.dashboard");
    expect(buildReadRecommendation("capability", "能力").recommendedMethod).toBe(
      "employee-capability.profile",
    );
    expect(buildReadRecommendation("model-access", "模型").recommendedMethod).toBe(
      "employee-model-access.summary",
    );
  });

  it("defaults to knowledge search with a truncated query", () => {
    const rec = buildReadRecommendation(undefined, "x".repeat(500));
    expect(rec.recommendedMethod).toBe("knowledge.search");
    expect((rec.params.query as string).length).toBe(200);
  });
});
