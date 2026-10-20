import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { telegramPlugin } from "../../extensions/telegram/src/channel.js";
import { setTelegramRuntime } from "../../extensions/telegram/src/runtime.js";
import { loadGatewayMemoryDoctorStatus } from "../memory/doctor-status.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createTestRegistry } from "../test-utils/channel-plugins.js";
import type { HealthSummary } from "./health.js";
import { getHealthSnapshot } from "./health.js";

let testConfig: Record<string, unknown> = {};
let testStore: Record<string, { updatedAt?: number }> = {};
let testMemoryStatus: import("../memory/doctor-status.js").MemoryDoctorStatusPayload = {
  agentId: "main",
  backend: "cogniweave",
  writeStatus: "async",
  queryStatus: "ok",
  indexStatus: "ready",
  enabledSources: ["memory", "sessions"],
  sharedSources: ["sessions"],
  transcriptIngest: "enabled",
  distillation: { atoms: 4, evidence: 2 },
  embedding: { ok: true },
};

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => testConfig,
  };
});

vi.mock("../config/sessions.js", () => ({
  resolveStorePath: () => "/tmp/sessions.json",
  loadSessionStore: () => testStore,
  readSessionUpdatedAt: vi.fn(() => undefined),
  recordSessionMetaFromInbound: vi.fn().mockResolvedValue(undefined),
  updateLastRoute: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../web/auth-store.js", () => ({
  webAuthExists: vi.fn(async () => true),
  getWebAuthAgeMs: vi.fn(() => 1234),
  readWebSelfId: vi.fn(() => ({ e164: null, jid: null })),
  logWebSelfId: vi.fn(),
  logoutWeb: vi.fn(),
}));

vi.mock("../memory/doctor-status.js", () => ({
  loadGatewayMemoryDoctorStatus: vi.fn(async () => testMemoryStatus),
}));

let probeTelegramMock = vi.fn();

async function runSuccessfulTelegramProbe(
  config: Record<string, unknown>,
  options?: { clearTokenEnv?: boolean },
) {
  testConfig = config;
  testStore = {};
  vi.stubEnv("DISCORD_BOT_TOKEN", "");
  if (options?.clearTokenEnv) {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  }

  probeTelegramMock.mockResolvedValueOnce({
    ok: true,
    elapsedMs: 1,
    bot: { id: 1, username: "bot" },
    webhook: { url: "https://example.com/h" },
  });

  const snap = await getHealthSnapshot({ timeoutMs: 1_000 });
  const telegram = snap.channels.telegram as {
    configured?: boolean;
    probe?: {
      ok?: boolean;
      bot?: { username?: string };
      webhook?: { url?: string };
    };
  };

  return { telegram };
}

let createPluginRuntime: typeof import("../plugins/runtime/index.js").createPluginRuntime;

describe("getHealthSnapshot", () => {
  beforeAll(async () => {
    ({ createPluginRuntime } = await import("../plugins/runtime/index.js"));
  });

  beforeEach(() => {
    setActivePluginRegistry(
      createTestRegistry([{ pluginId: "telegram", plugin: telegramPlugin, source: "test" }]),
    );
    probeTelegramMock = vi.fn();
    setTelegramRuntime({
      ...createPluginRuntime(),
      channel: {
        telegram: {
          probeTelegram: probeTelegramMock,
        },
      },
    } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("skips telegram probe when not configured", async () => {
    testConfig = { session: { store: "/tmp/x" } };
    testStore = {
      global: { updatedAt: Date.now() },
      unknown: { updatedAt: Date.now() },
      main: { updatedAt: 1000 },
      foo: { updatedAt: 2000 },
    };
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    const snap = (await getHealthSnapshot({
      timeoutMs: 10,
    })) satisfies HealthSummary;
    expect(snap.ok).toBe(true);
    const telegram = snap.channels.telegram as {
      configured?: boolean;
      probe?: unknown;
    };
    expect(telegram.configured).toBe(false);
    expect(telegram.probe).toBeUndefined();
    expect(snap.sessions.count).toBe(2);
    expect(snap.sessions.recent[0]?.key).toBe("foo");
    expect(snap.memory?.backend).toBe("cogniweave");
    expect(snap.memory?.transcriptIngest).toBe("enabled");
    expect(snap.memory?.distillation).toEqual({ atoms: 4, evidence: 2 });
    expect(vi.mocked(loadGatewayMemoryDoctorStatus)).toHaveBeenCalledWith({
      probeEmbeddings: false,
    });
  });

  it("probes telegram getMe + webhook info when configured", async () => {
    const { telegram } = await runSuccessfulTelegramProbe({
      channels: { telegram: { botToken: "t-1" } },
    });
    expect(telegram.configured).toBe(true);
    expect(telegram.probe?.ok).toBe(true);
    expect(telegram.probe?.bot?.username).toBe("bot");
    expect(telegram.probe?.webhook?.url).toMatch(/^https:/);
    expect(probeTelegramMock).toHaveBeenCalledWith("t-1", 1_000, {
      accountId: "default",
      network: undefined,
      proxyUrl: undefined,
    });
  });

  it("treats telegram.tokenFile as configured", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-health-"));
    const tokenFile = path.join(tmpDir, "telegram-token");
    fs.writeFileSync(tokenFile, "t-file\n", "utf-8");
    const { telegram } = await runSuccessfulTelegramProbe(
      { channels: { telegram: { tokenFile } } },
      { clearTokenEnv: true },
    );
    expect(telegram.configured).toBe(true);
    expect(telegram.probe?.ok).toBe(true);
    expect(probeTelegramMock).toHaveBeenCalledWith("t-file", 1_000, {
      accountId: "default",
      network: undefined,
      proxyUrl: undefined,
    });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a structured telegram probe error when getMe fails", async () => {
    testConfig = { channels: { telegram: { botToken: "bad-token" } } };
    testStore = {};
    vi.stubEnv("DISCORD_BOT_TOKEN", "");

    probeTelegramMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      error: "unauthorized",
    });

    const snap = await getHealthSnapshot({ timeoutMs: 1_000 });
    const telegram = snap.channels.telegram as {
      configured?: boolean;
      probe?: { ok?: boolean; status?: number; error?: string };
    };
    expect(telegram.configured).toBe(true);
    expect(telegram.probe?.ok).toBe(false);
    expect(telegram.probe?.status).toBe(401);
    expect(telegram.probe?.error).toMatch(/unauthorized/i);
  });

  it("captures unexpected probe exceptions as errors", async () => {
    testConfig = { channels: { telegram: { botToken: "t-err" } } };
    testStore = {};
    vi.stubEnv("DISCORD_BOT_TOKEN", "");

    probeTelegramMock.mockRejectedValueOnce(new Error("network down"));

    const snap = await getHealthSnapshot({ timeoutMs: 1_000 });
    const telegram = snap.channels.telegram as {
      configured?: boolean;
      probe?: { ok?: boolean; error?: string };
    };
    expect(telegram.configured).toBe(true);
    expect(telegram.probe?.ok).toBe(false);
    expect(telegram.probe?.error).toMatch(/network down/i);
  });

  it("disables heartbeat for agents without heartbeat blocks", async () => {
    testConfig = {
      agents: {
        defaults: {
          heartbeat: {
            every: "30m",
          },
        },
        list: [
          { id: "main", default: true },
          { id: "ops", heartbeat: { every: "1h" } },
        ],
      },
    };
    testStore = {};

    const snap = await getHealthSnapshot({ timeoutMs: 10, probe: false });
    const byAgent = new Map(snap.agents.map((agent) => [agent.agentId, agent] as const));
    const main = byAgent.get("main");
    const ops = byAgent.get("ops");

    expect(main?.heartbeat.everyMs).toBeNull();
    expect(main?.heartbeat.every).toBe("disabled");
    expect(ops?.heartbeat.everyMs).toBeTruthy();
    expect(ops?.heartbeat.every).toBe("1h");
  });
});
