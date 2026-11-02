import { describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { createModelSelectionState } from "./model-selection.js";

vi.mock("../../agents/model-catalog.js", () => ({
  loadModelCatalog: vi.fn(async () => [
    { provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5" },
    { provider: "inferencer", id: "deepseek-v3-4bit-mlx", name: "DeepSeek V3" },
    { provider: "kimi-coding", id: "k2p5", name: "Kimi K2.5" },
    { provider: "openai", id: "gpt-4o-mini", name: "GPT-4o mini" },
    { provider: "openai", id: "gpt-4o", name: "GPT-4o" },
  ]),
}));
vi.mock("../../gateway/knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => ({
    tenantId: null,
    seatId: null,
    userId: null,
    hasEnterpriseScope: false,
  })),
}));

const makeEntry = (overrides: Record<string, unknown> = {}) => ({
  sessionId: "session-id",
  updatedAt: Date.now(),
  ...overrides,
});

describe("createModelSelectionState no longer inherits session model overrides", () => {
  const defaultProvider = "inferencer";
  const defaultModel = "deepseek-v3-4bit-mlx";

  async function resolveState(sessionEntry: ReturnType<typeof makeEntry>) {
    const cfg = {} as OpenBotConfig;
    const sessionKey = "agent:main:main";
    const sessionStore = { [sessionKey]: sessionEntry };

    return createModelSelectionState({
      cfg,
      agentCfg: undefined,
      sessionEntry,
      sessionStore,
      sessionKey,
      defaultProvider,
      defaultModel,
      provider: defaultProvider,
      model: defaultModel,
      hasModelDirective: false,
    });
  }

  it("falls back to default when session modelOverride is present", async () => {
    const state = await resolveState(
      makeEntry({
        providerOverride: "kimi-coding",
        modelOverride: "k2p5",
      }),
    );

    expect(state.provider).toBe(defaultProvider);
    expect(state.model).toBe(defaultModel);
  });

  it("falls back to default when no modelOverride is set", async () => {
    const state = await resolveState(makeEntry());

    expect(state.provider).toBe(defaultProvider);
    expect(state.model).toBe(defaultModel);
  });

  it("prefers runtime model when runtime model field differs", async () => {
    const state = await resolveState(
      makeEntry({
        model: "k2p5",
        modelProvider: "kimi-coding",
        contextTokens: 262_000,
        providerOverride: "anthropic",
        modelOverride: "claude-opus-4-5",
      }),
    );

    expect(state.provider).toBe("kimi-coding");
    expect(state.model).toBe("k2p5");
  });

  it("uses default provider when only modelOverride is present", async () => {
    const state = await resolveState(
      makeEntry({
        modelOverride: "deepseek-v3-4bit-mlx",
      }),
    );

    expect(state.provider).toBe(defaultProvider);
    expect(state.model).toBe(defaultModel);
  });

  it("still ignores session modelOverride for governed enterprise sessions", async () => {
    const { resolveKnowledgeSourceContext } = await import("../../gateway/knowledge/context.js");
    vi.mocked(resolveKnowledgeSourceContext).mockResolvedValueOnce({
      tenantId: "tenant-acme",
      seatId: "seat-1",
      userId: "user-1",
      hasEnterpriseScope: true,
    });
    const cfg = {} as OpenBotConfig;
    const sessionKey = "agent:main:main";
    const sessionEntry = makeEntry({
      providerOverride: "kimi-coding",
      modelOverride: "k2p5",
    });
    const sessionStore = { [sessionKey]: sessionEntry };

    const state = await createModelSelectionState({
      cfg,
      agentCfg: undefined,
      sessionEntry,
      sessionStore,
      sessionKey,
      defaultProvider,
      defaultModel,
      provider: defaultProvider,
      model: defaultModel,
      hasModelDirective: false,
      gatewayClientUser: "mgr@acme.test",
      gatewayClientSessionDomain: "employee",
    });

    expect(state.provider).toBe(defaultProvider);
    expect(state.model).toBe(defaultModel);
  });

  it("ignores a sticky ent/* runtime pin on an enterprise session", async () => {
    const { resolveKnowledgeSourceContext } = await import("../../gateway/knowledge/context.js");
    vi.mocked(resolveKnowledgeSourceContext).mockResolvedValueOnce({
      tenantId: "tenant-acme",
      seatId: "seat-1",
      userId: "user-1",
      hasEnterpriseScope: true,
    });
    const state = await createModelSelectionState({
      cfg: {} as OpenBotConfig,
      agentCfg: undefined,
      sessionEntry: makeEntry({
        modelProvider: "ent",
        model: "cc41dd5419/mimo-v2.6-flash",
      }),
      sessionStore: { "agent:main:main": makeEntry({}) },
      sessionKey: "agent:main:main",
      defaultProvider,
      defaultModel,
      provider: defaultProvider,
      model: defaultModel,
      hasModelDirective: false,
      gatewayClientUser: "elledecke204@gmail.com",
      gatewayClientSessionDomain: "employee",
    });

    expect(state.provider).toBe(defaultProvider);
    expect(state.model).toBe(defaultModel);
    expect(`${state.provider}/${state.model}`).not.toContain("mimo-v2.6-flash");
  });
});

describe("createModelSelectionState resolveDefaultReasoningLevel", () => {
  it("returns on when catalog model has reasoning true", async () => {
    const { loadModelCatalog } = await import("../../agents/model-catalog.js");
    vi.mocked(loadModelCatalog).mockResolvedValueOnce([
      { provider: "openrouter", id: "x-ai/grok-4.1-fast", name: "Grok", reasoning: true },
    ]);
    const state = await createModelSelectionState({
      cfg: {} as OpenBotConfig,
      agentCfg: undefined,
      defaultProvider: "openrouter",
      defaultModel: "x-ai/grok-4.1-fast",
      provider: "openrouter",
      model: "x-ai/grok-4.1-fast",
      hasModelDirective: false,
    });
    await expect(state.resolveDefaultReasoningLevel()).resolves.toBe("on");
  });

  it("returns off when catalog model has no reasoning", async () => {
    const state = await createModelSelectionState({
      cfg: {} as OpenBotConfig,
      agentCfg: undefined,
      defaultProvider: "openai",
      defaultModel: "gpt-4o-mini",
      provider: "openai",
      model: "gpt-4o-mini",
      hasModelDirective: false,
    });
    await expect(state.resolveDefaultReasoningLevel()).resolves.toBe("off");
  });
});
