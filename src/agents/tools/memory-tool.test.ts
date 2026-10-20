import { beforeEach, describe, expect, it } from "vitest";
import {
  resetMemoryToolMockState,
  setMemorySearchImpl,
} from "../../../test/helpers/memory-tool-manager-mock.js";
import { getMemorySearchManager } from "../../memory/index.js";
import { createMemorySearchTool } from "./memory-tool.js";

describe("memory_search unavailable payloads", () => {
  beforeEach(() => {
    resetMemoryToolMockState({ searchImpl: async () => [] });
  });

  it("returns billing structured unavailable for 429 insufficient_quota", async () => {
    setMemorySearchImpl(async () => {
      throw new Error("openai embeddings failed: 429 insufficient_quota");
    });

    const tool = createMemorySearchTool({
      config: { agents: { list: [{ id: "main", default: true }] } },
    });
    if (!tool) {
      throw new Error("tool missing");
    }

    const result = await tool.execute("quota", { query: "hello" });
    expect(result.details).toEqual({
      results: [],
      disabled: true,
      unavailable: true,
      reason: "billing",
      retryable: false,
      degraded: false,
      error: "openai embeddings failed: 429 insufficient_quota",
      warning:
        "Memory search is unavailable because the embedding provider reports a billing or quota problem.",
      action:
        "Check the embedding provider balance and API key, top up credits, or switch provider (re-index required), then retry memory_search.",
    });
  });

  it("returns rate_limit structured unavailable for bare 429 Too Many Requests", async () => {
    setMemorySearchImpl(async () => {
      throw new Error("429 Too Many Requests");
    });

    const tool = createMemorySearchTool({
      config: { agents: { list: [{ id: "main", default: true }] } },
    });
    if (!tool) {
      throw new Error("tool missing");
    }

    const result = await tool.execute("rate", { query: "hello" });
    expect(result.details).toMatchObject({
      unavailable: true,
      reason: "rate_limit",
      retryable: true,
      degraded: false,
      error: "429 Too Many Requests",
    });
    expect(String((result.details as { action?: string }).action)).toMatch(/RPM\/TPM|Retry-After/i);
  });

  it("returns auth structured unavailable for 401", async () => {
    setMemorySearchImpl(async () => {
      throw new Error("401 Unauthorized");
    });

    const tool = createMemorySearchTool({
      config: { agents: { list: [{ id: "main", default: true }] } },
    });
    if (!tool) {
      throw new Error("tool missing");
    }

    const result = await tool.execute("auth", { query: "hello" });
    expect(result.details).toMatchObject({
      unavailable: true,
      reason: "auth",
      retryable: false,
    });
  });

  it("returns timeout structured unavailable for provider timeouts", async () => {
    setMemorySearchImpl(async () => {
      throw new Error("embedding provider timeout");
    });

    const tool = createMemorySearchTool({
      config: { agents: { list: [{ id: "main", default: true }] } },
    });
    if (!tool) {
      throw new Error("tool missing");
    }

    const result = await tool.execute("generic", { query: "hello" });
    expect(result.details).toMatchObject({
      results: [],
      disabled: true,
      unavailable: true,
      reason: "timeout",
      retryable: true,
      degraded: false,
      error: "embedding provider timeout",
    });
  });

  it("surfaces FTS-only degraded results without unavailable", async () => {
    setMemorySearchImpl(async () => [
      {
        path: "MEMORY.md",
        startLine: 1,
        endLine: 2,
        score: 0.3,
        snippet: "keyword hit",
        source: "memory" as const,
      },
    ]);
    const resolved = await getMemorySearchManager({
      cfg: { agents: { list: [{ id: "main", default: true }] } } as never,
      agentId: "main",
    });
    const manager = resolved.manager;
    if (!manager) {
      throw new Error("manager missing");
    }
    const previousStatus = manager.status.bind(manager);
    manager.status = () =>
      ({
        ...previousStatus(),
        provider: "openai",
        model: "mock-embed",
        custom: {
          searchMode: "fts-only",
          degraded: true,
          degradeReason: "rate_limit",
          degradeRetryable: true,
          degradeError: "429 Too Many Requests",
        },
      }) as ReturnType<typeof manager.status>;

    const tool = createMemorySearchTool({
      config: { agents: { list: [{ id: "main", default: true }] } },
    });
    if (!tool) {
      throw new Error("tool missing");
    }

    try {
      const result = await tool.execute("degraded", { query: "hello" });
      expect(result.details).toMatchObject({
        results: [expect.objectContaining({ path: "MEMORY.md" })],
        degraded: true,
        reason: "rate_limit",
        retryable: true,
        mode: "fts-only",
        error: "429 Too Many Requests",
      });
      expect(result.details).not.toMatchObject({ unavailable: true, disabled: true });
    } finally {
      manager.status = previousStatus;
    }
  });

  it("redacts secrets from unavailable error payloads", async () => {
    setMemorySearchImpl(async () => {
      throw new Error("401 Unauthorized api_key=sk-abcdefghijklmnopqrst password=hunter2");
    });

    const tool = createMemorySearchTool({
      config: { agents: { list: [{ id: "main", default: true }] } },
    });
    if (!tool) {
      throw new Error("tool missing");
    }

    const result = await tool.execute("secret", { query: "hello" });
    const details = result.details as { error?: string };
    expect(details.error).not.toContain("sk-abcdefghijklmnopqrst");
    expect(details.error).not.toContain("hunter2");
    expect(JSON.stringify(result.details)).not.toMatch(/sk-abcdefghijklmnopqrst|hunter2/);
  });
});
