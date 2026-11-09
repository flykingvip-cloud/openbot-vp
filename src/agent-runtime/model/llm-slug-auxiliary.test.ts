import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runEmbedded: vi.fn(),
  runFallback: vi.fn(),
  resolveGov: vi.fn(),
}));

vi.mock("../execution/index.js", () => ({
  runEmbeddedPiAgent: (...args: unknown[]) => mocks.runEmbedded(...args),
}));

vi.mock("./index.js", () => ({
  resolveAuxiliaryModelGovernance: (...args: unknown[]) => mocks.resolveGov(...args),
}));

vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: (...args: unknown[]) => mocks.runFallback(...args),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: () => "main",
  resolveAgentWorkspaceDir: () => "/tmp/ws",
  resolveAgentDir: () => "/tmp/agent",
  resolveAgentEffectiveModelPrimary: () => "openai/gpt-4.1-mini",
}));

import { generateSlugViaLLM } from "../../hooks/llm-slug-generator.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveGov.mockReturnValue({
    governanceMode: "shadow",
    absentAllowlistReason: "parent-model-set-absent",
    governanceContext: { purpose: "slug_filename" },
  });
  mocks.runEmbedded.mockResolvedValue({
    payloads: [{ text: "Api Design!" }],
    meta: { durationMs: 1 },
  });
  mocks.runFallback.mockImplementation(async (options: { run: Function }) => ({
    result: await options.run("openai", "gpt-4.1-mini"),
    provider: "openai",
    model: "gpt-4.1-mini",
    attempts: [],
  }));
});

it("routes slug generation through shared auxiliary governance without task creation", async () => {
  const slug = await generateSlugViaLLM({
    sessionContent: "We designed the API surface today.",
    cfg: {} as never,
    parentRunId: "parent-turn",
  });
  expect(slug).toBe("api-design");
  expect(mocks.resolveGov).toHaveBeenCalledWith({
    purpose: "slug_filename",
    parentRunId: "parent-turn",
  });
  expect(mocks.runFallback).toHaveBeenCalledWith(
    expect.objectContaining({
      governanceMode: "shadow",
      absentAllowlistReason: "parent-model-set-absent",
      governanceContext: { purpose: "slug_filename" },
      runId: expect.stringMatching(/^slug-gen-/),
    }),
  );
  expect(mocks.runEmbedded).toHaveBeenCalledOnce();
});
