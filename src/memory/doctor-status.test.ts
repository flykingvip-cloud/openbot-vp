import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";

const loadConfig = vi.hoisted(() => vi.fn(() => ({}) as OpenBotConfig));
const resolveDefaultAgentId = vi.hoisted(() => vi.fn(() => "main"));
const getMemorySearchManager = vi.hoisted(() => vi.fn());

vi.mock("../config/config.js", () => ({
  loadConfig,
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveDefaultAgentId,
}));

vi.mock("./index.js", () => ({
  getMemorySearchManager,
}));

import {
  inferEmbeddingFromProviderStatus,
  loadGatewayMemoryDoctorStatus,
  MEMORY_EMBEDDING_PROBE_CACHE_TTL_MS,
  resetMemoryDoctorEmbeddingProbeCache,
} from "./doctor-status.js";

function mockManager(params: {
  provider?: string;
  probe?: ReturnType<typeof vi.fn>;
  close?: ReturnType<typeof vi.fn>;
}) {
  const probe = params.probe ?? vi.fn().mockResolvedValue({ ok: true });
  const close = params.close ?? vi.fn().mockResolvedValue(undefined);
  getMemorySearchManager.mockResolvedValue({
    manager: {
      status: () => ({
        backend: "builtin",
        provider: params.provider ?? "gemini",
      }),
      probeEmbeddingAvailability: probe,
      close,
    },
  });
  return { probe, close };
}

describe("loadGatewayMemoryDoctorStatus", () => {
  beforeEach(() => {
    loadConfig.mockClear();
    resolveDefaultAgentId.mockClear();
    getMemorySearchManager.mockReset();
    resetMemoryDoctorEmbeddingProbeCache();
  });

  afterEach(() => {
    resetMemoryDoctorEmbeddingProbeCache();
  });

  it("skips the live embedding ping on the default health path", async () => {
    const { probe, close } = mockManager({});

    const payload = await loadGatewayMemoryDoctorStatus();

    expect(payload.embedding).toEqual({ ok: true });
    expect(probe).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("does not treat a configured provider as a live Gemini ping", async () => {
    const { probe } = mockManager({ provider: "gemini" });

    await loadGatewayMemoryDoctorStatus({ probeEmbeddings: false });

    expect(probe).not.toHaveBeenCalled();
  });

  it("infers FTS-only when no embedding provider is configured", async () => {
    mockManager({ provider: "none" });

    const payload = await loadGatewayMemoryDoctorStatus({ probeEmbeddings: false });

    expect(payload.embedding).toEqual({
      ok: false,
      error: "No embedding provider available (FTS-only mode)",
    });
  });

  it("live-probes only when explicitly requested", async () => {
    const { probe } = mockManager({
      probe: vi.fn().mockResolvedValue({ ok: true }),
    });

    const payload = await loadGatewayMemoryDoctorStatus({ probeEmbeddings: true });

    expect(probe).toHaveBeenCalledTimes(1);
    expect(payload.embedding).toEqual({ ok: true });
  });

  it("reuses a fresh live probe instead of metronoming Gemini", async () => {
    const { probe } = mockManager({
      probe: vi.fn().mockResolvedValue({ ok: true }),
    });
    const now = vi.fn().mockReturnValue(1_000);

    await loadGatewayMemoryDoctorStatus({ probeEmbeddings: true, now });
    now.mockReturnValue(1_000 + MEMORY_EMBEDDING_PROBE_CACHE_TTL_MS - 1);
    await loadGatewayMemoryDoctorStatus({ probeEmbeddings: true, now });
    await loadGatewayMemoryDoctorStatus({ probeEmbeddings: false, now });

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("re-probes after the cache TTL", async () => {
    const { probe } = mockManager({
      probe: vi.fn().mockResolvedValue({ ok: true }),
    });
    const now = vi.fn().mockReturnValue(1_000);

    await loadGatewayMemoryDoctorStatus({ probeEmbeddings: true, now });
    now.mockReturnValue(1_000 + MEMORY_EMBEDDING_PROBE_CACHE_TTL_MS);
    await loadGatewayMemoryDoctorStatus({ probeEmbeddings: true, now });

    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe("inferEmbeddingFromProviderStatus", () => {
  it("treats missing and FTS sentinels as unavailable", () => {
    expect(inferEmbeddingFromProviderStatus({ provider: "none" }).ok).toBe(false);
    expect(inferEmbeddingFromProviderStatus({ provider: "fts-only" }).ok).toBe(false);
    expect(inferEmbeddingFromProviderStatus({ provider: "gemini" }).ok).toBe(true);
  });
});
