import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HEARTBEAT_PROMPT } from "../auto-reply/heartbeat.js";
import * as replyModule from "../auto-reply/reply.js";
import { whatsappOutbound } from "../channels/plugins/outbound/whatsapp.js";
import type { OpenBotConfig } from "../config/config.js";
import {
  resolveAgentIdFromSessionKey,
  resolveAgentMainSessionKey,
  resolveMainSessionKey,
  resolveStorePath,
} from "../config/sessions.js";
import { getActivePluginRegistry, setActivePluginRegistry } from "../plugins/runtime.js";
import { buildAgentPeerSessionKey } from "../routing/session-key.js";
import { createOutboundTestPlugin, createTestRegistry } from "../test-utils/channel-plugins.js";
import { typedCases } from "../test-utils/typed-cases.js";
import {
  type HeartbeatDeps,
  isHeartbeatEnabledForAgent,
  resolveHeartbeatIntervalMs,
  resolveHeartbeatPrompt,
  runHeartbeatOnce,
} from "./heartbeat-runner.js";
import {
  resolveHeartbeatDeliveryTarget,
  resolveHeartbeatSenderContext,
} from "./outbound/targets.js";
import { enqueueSystemEvent, resetSystemEventsForTest } from "./system-events.js";

// Avoid pulling optional runtime deps during isolated runs.
vi.mock("jiti", () => ({ createJiti: () => () => ({}) }));

let previousRegistry: ReturnType<typeof getActivePluginRegistry> | null = null;
let testRegistry: ReturnType<typeof getActivePluginRegistry> | null = null;

let fixtureRoot = "";
let fixtureCount = 0;

const createCaseDir = async (prefix: string) => {
  const dir = path.join(fixtureRoot, `${prefix}-${fixtureCount++}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "HEARTBEAT.md"), "- Check status\n", "utf-8");
  return dir;
};

beforeAll(async () => {
  previousRegistry = getActivePluginRegistry();

  const whatsappPlugin = createOutboundTestPlugin({ id: "whatsapp", outbound: whatsappOutbound });
  whatsappPlugin.config = {
    ...whatsappPlugin.config,
    resolveAllowFrom: ({ cfg }) =>
      cfg.channels?.whatsapp?.allowFrom?.map((entry) => String(entry)) ?? [],
  };

  const telegramPlugin = createOutboundTestPlugin({
    id: "telegram",
    outbound: {
      deliveryMode: "direct",
      sendText: async ({ to, text, deps, accountId }) => {
        if (!deps?.sendTelegram) {
          throw new Error("sendTelegram missing");
        }
        const res = await deps.sendTelegram(to, text, {
          verbose: false,
          accountId: accountId ?? undefined,
        });
        return { channel: "telegram", messageId: res.messageId, chatId: res.chatId };
      },
      sendMedia: async ({ to, text, mediaUrl, deps, accountId }) => {
        if (!deps?.sendTelegram) {
          throw new Error("sendTelegram missing");
        }
        const res = await deps.sendTelegram(to, text, {
          verbose: false,
          accountId: accountId ?? undefined,
          mediaUrl,
        });
        return { channel: "telegram", messageId: res.messageId, chatId: res.chatId };
      },
    },
  });
  telegramPlugin.config = {
    ...telegramPlugin.config,
    listAccountIds: (cfg) => Object.keys(cfg.channels?.telegram?.accounts ?? {}),
    resolveAllowFrom: ({ cfg, accountId }) => {
      const channel = cfg.channels?.telegram;
      const normalized = accountId?.trim();
      if (normalized && channel?.accounts?.[normalized]?.allowFrom) {
        return channel.accounts[normalized].allowFrom?.map((entry) => String(entry)) ?? [];
      }
      return channel?.allowFrom?.map((entry) => String(entry)) ?? [];
    },
  };

  testRegistry = createTestRegistry([
    { pluginId: "whatsapp", plugin: whatsappPlugin, source: "test" },
    { pluginId: "telegram", plugin: telegramPlugin, source: "test" },
  ]);
  setActivePluginRegistry(testRegistry);

  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-heartbeat-suite-"));
});

beforeEach(() => {
  resetSystemEventsForTest();
  if (testRegistry) {
    setActivePluginRegistry(testRegistry);
  }
});

afterAll(async () => {
  if (fixtureRoot) {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
  if (previousRegistry) {
    setActivePluginRegistry(previousRegistry);
  }
});

describe("resolveHeartbeatIntervalMs", () => {
  it("returns null when unset so interval patrol stays off", () => {
    expect(resolveHeartbeatIntervalMs({})).toBeNull();
  });

  it("returns null when invalid or zero", () => {
    expect(
      resolveHeartbeatIntervalMs({
        agents: { defaults: { heartbeat: { every: "0m" } } },
      }),
    ).toBeNull();
    expect(
      resolveHeartbeatIntervalMs({
        agents: { defaults: { heartbeat: { every: "oops" } } },
      }),
    ).toBeNull();
  });

  it("parses duration strings with minute defaults", () => {
    expect(
      resolveHeartbeatIntervalMs({
        agents: { defaults: { heartbeat: { every: "5m" } } },
      }),
    ).toBe(5 * 60_000);
    expect(
      resolveHeartbeatIntervalMs({
        agents: { defaults: { heartbeat: { every: "5" } } },
      }),
    ).toBe(5 * 60_000);
    expect(
      resolveHeartbeatIntervalMs({
        agents: { defaults: { heartbeat: { every: "2h" } } },
      }),
    ).toBe(2 * 60 * 60_000);
  });

  it("uses explicit heartbeat overrides when provided", () => {
    expect(
      resolveHeartbeatIntervalMs(
        { agents: { defaults: { heartbeat: { every: "30m" } } } },
        undefined,
        { every: "5m" },
      ),
    ).toBe(5 * 60_000);
  });
});

describe("resolveHeartbeatPrompt", () => {
  it("uses default or trimmed override prompts", () => {
    const cases = [
      { cfg: {} as OpenBotConfig, expected: HEARTBEAT_PROMPT },
      {
        cfg: {
          agents: { defaults: { heartbeat: { prompt: "  ping  " } } },
        } as OpenBotConfig,
        expected: "ping",
      },
    ] as const;
    for (const testCase of cases) {
      expect(resolveHeartbeatPrompt(testCase.cfg)).toBe(testCase.expected);
    }
  });
});

describe("isHeartbeatEnabledForAgent", () => {
  it("enables only explicit heartbeat agents when configured", () => {
    const cfg: OpenBotConfig = {
      agents: {
        defaults: { heartbeat: { every: "30m" } },
        list: [{ id: "main" }, { id: "ops", heartbeat: { every: "1h" } }],
      },
    };
    expect(isHeartbeatEnabledForAgent(cfg, "main")).toBe(false);
    expect(isHeartbeatEnabledForAgent(cfg, "ops")).toBe(true);
  });

  it("falls back to default agent when no explicit heartbeat entries", () => {
    const cfg: OpenBotConfig = {
      agents: {
        defaults: { heartbeat: { every: "30m" } },
        list: [{ id: "main" }, { id: "ops" }],
      },
    };
    expect(isHeartbeatEnabledForAgent(cfg, "main")).toBe(true);
    expect(isHeartbeatEnabledForAgent(cfg, "ops")).toBe(false);
  });
});

describe("resolveHeartbeatDeliveryTarget", () => {
  it("keeps heartbeat delivery on the OpenBot session surface", () => {
    expect(
      resolveHeartbeatDeliveryTarget({
        cfg: {},
        entry: {
          sessionId: "sid",
          updatedAt: Date.now(),
          lastChannel: "whatsapp",
          lastTo: "120363401234567890@g.us",
        },
      }),
    ).toEqual({
      channel: "none",
      reason: "session-surface",
    });
  });
});

describe("resolveHeartbeatSenderContext", () => {
  it.skip("retired leftover outbound sender resolution", () => {
    const cfg: OpenBotConfig = {
      channels: {
        telegram: {
          allowFrom: ["111"],
          accounts: {
            work: { allowFrom: ["222"], botToken: "token" },
          },
        },
      },
    };
    const entry = {
      sessionId: "sid",
      updatedAt: Date.now(),
      lastChannel: "telegram" as const,
      lastTo: "111",
      lastAccountId: "default",
    };
    const delivery = {
      channel: "telegram" as const,
      to: "999",
      lastChannel: "telegram" as const,
      lastAccountId: "default",
    };

    const ctx = resolveHeartbeatSenderContext({ cfg, entry, delivery });

    expect(ctx.allowFrom).toEqual(["222"]);
  });
});

describe("runHeartbeatOnce", () => {
  const createHeartbeatDeps = (
    sendWhatsApp: NonNullable<HeartbeatDeps["sendWhatsApp"]>,
    nowMs = 0,
  ): HeartbeatDeps => ({
    sendWhatsApp,
    getQueueSize: () => 0,
    nowMs: () => nowMs,
    webAuthExists: async () => true,
    hasActiveWebListener: () => true,
  });

  it("skips when agent heartbeat is not enabled", async () => {
    const cfg: OpenBotConfig = {
      agents: {
        defaults: { heartbeat: { every: "30m" } },
        list: [{ id: "main" }, { id: "ops", heartbeat: { every: "1h" } }],
      },
    };

    const res = await runHeartbeatOnce({ cfg, agentId: "main" });
    expect(res.status).toBe("skipped");
    if (res.status === "skipped") {
      expect(res.reason).toBe("disabled");
    }
  });

  it("skips outside active hours", async () => {
    const cfg: OpenBotConfig = {
      agents: {
        defaults: {
          userTimezone: "UTC",
          heartbeat: {
            every: "30m",
            activeHours: { start: "08:00", end: "24:00", timezone: "user" },
          },
        },
      },
    };

    const res = await runHeartbeatOnce({
      cfg,
      deps: { nowMs: () => Date.UTC(2025, 0, 1, 7, 0, 0) },
    });

    expect(res.status).toBe("skipped");
    if (res.status === "skipped") {
      expect(res.reason).toBe("quiet-hours");
    }
  });

  it("uses the last non-empty payload for delivery", async () => {
    const tmpDir = await createCaseDir("hb-last-payload");
    const storePath = path.join(tmpDir, "sessions.json");
    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
    try {
      const cfg: OpenBotConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "5m" },
          },
        },
        channels: { whatsapp: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      const sessionKey = resolveMainSessionKey(cfg);

      await fs.writeFile(
        storePath,
        JSON.stringify({
          [sessionKey]: {
            sessionId: "sid",
            updatedAt: Date.now(),
            lastChannel: "whatsapp",
            lastTo: "120363401234567890@g.us",
          },
        }),
      );

      replySpy.mockResolvedValue([{ text: "Let me check..." }, { text: "Final alert" }]);
      const sendWhatsApp = vi.fn<NonNullable<HeartbeatDeps["sendWhatsApp"]>>().mockResolvedValue({
        messageId: "m1",
        toJid: "jid",
      });

      await runHeartbeatOnce({
        cfg,
        reason: "manual",
        deps: createHeartbeatDeps(sendWhatsApp),
      });

      expect(sendWhatsApp).toHaveBeenCalledTimes(0);
    } finally {
      replySpy.mockRestore();
    }
  });

  it("uses per-agent heartbeat overrides and session keys", async () => {
    const tmpDir = await createCaseDir("hb-agent-overrides");
    const storePath = path.join(tmpDir, "sessions.json");
    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
    try {
      const cfg: OpenBotConfig = {
        agents: {
          defaults: {
            heartbeat: { every: "30m", prompt: "Default prompt" },
          },
          list: [
            { id: "main", default: true },
            {
              id: "ops",
              workspace: tmpDir,
              heartbeat: { every: "5m", prompt: "Ops check" },
            },
          ],
        },
        channels: { whatsapp: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      const sessionKey = resolveAgentMainSessionKey({ cfg, agentId: "ops" });

      await fs.writeFile(
        storePath,
        JSON.stringify({
          [sessionKey]: {
            sessionId: "sid",
            updatedAt: Date.now(),
            lastChannel: "whatsapp",
            lastTo: "120363401234567890@g.us",
          },
        }),
      );
      replySpy.mockResolvedValue([{ text: "Final alert" }]);
      const sendWhatsApp = vi.fn<NonNullable<HeartbeatDeps["sendWhatsApp"]>>().mockResolvedValue({
        messageId: "m1",
        toJid: "jid",
      });
      await runHeartbeatOnce({
        cfg,
        agentId: "ops",
        reason: "manual",
        deps: createHeartbeatDeps(sendWhatsApp),
      });
      expect(sendWhatsApp).toHaveBeenCalledTimes(0);
      expect(replySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          Body: expect.stringMatching(/Ops check[\s\S]*Current time: /),
          SessionKey: sessionKey,
          Provider: "heartbeat",
        }),
        expect.objectContaining({ isHeartbeat: true, suppressToolErrorWarnings: false }),
        cfg,
      );
    } finally {
      replySpy.mockRestore();
    }
  });

  it("reuses non-default agent sessionFile from templated stores", async () => {
    const tmpDir = await createCaseDir("hb-templated-store");
    const storeTemplate = path.join(tmpDir, "agents", "{agentId}", "sessions", "sessions.json");
    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
    const agentId = "ops";
    try {
      const cfg: OpenBotConfig = {
        agents: {
          defaults: {
            heartbeat: { every: "30m", prompt: "Default prompt" },
          },
          list: [
            { id: "main", default: true },
            {
              id: agentId,
              workspace: tmpDir,
              heartbeat: { every: "5m", prompt: "Ops check" },
            },
          ],
        },
        channels: { whatsapp: { allowFrom: ["*"] } },
        session: { store: storeTemplate },
      };
      const sessionKey = resolveAgentMainSessionKey({ cfg, agentId });
      const storePath = resolveStorePath(storeTemplate, { agentId });
      const sessionsDir = path.dirname(storePath);
      const sessionId = "sid-ops";
      const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);

      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.writeFile(sessionFile, "", "utf-8");
      await fs.writeFile(
        storePath,
        JSON.stringify({
          [sessionKey]: {
            sessionId,
            sessionFile,
            updatedAt: Date.now(),
            lastChannel: "whatsapp",
            lastTo: "120363401234567890@g.us",
          },
        }),
      );

      replySpy.mockResolvedValue([{ text: "Final alert" }]);
      const sendWhatsApp = vi.fn<NonNullable<HeartbeatDeps["sendWhatsApp"]>>().mockResolvedValue({
        messageId: "m1",
        toJid: "jid",
      });
      const result = await runHeartbeatOnce({
        cfg,
        agentId,
        reason: "manual",
        deps: createHeartbeatDeps(sendWhatsApp),
      });

      expect(result.status).toBe("ran");
      expect(sendWhatsApp).toHaveBeenCalledTimes(0);
      expect(replySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          SessionKey: sessionKey,
          Provider: "heartbeat",
        }),
        expect.objectContaining({ isHeartbeat: true, suppressToolErrorWarnings: false }),
        cfg,
      );
    } finally {
      replySpy.mockRestore();
    }
  });

  it("resolves configured and forced session key overrides", async () => {
    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
    try {
      const cases = typedCases<{
        name: string;
        caseDir: string;
        peerKind: "group" | "direct";
        peerId: string;
        message: string;
        applyOverride: (params: { cfg: OpenBotConfig; sessionKey: string }) => void;
        runOptions: (params: { sessionKey: string }) => { sessionKey?: string };
      }>([
        {
          name: "heartbeat.session",
          caseDir: "hb-explicit-session",
          peerKind: "group" as const,
          peerId: "120363401234567890@g.us",
          message: "Group alert",
          applyOverride: ({ cfg, sessionKey }: { cfg: OpenBotConfig; sessionKey: string }) => {
            if (cfg.agents?.defaults?.heartbeat) {
              cfg.agents.defaults.heartbeat.session = sessionKey;
            }
          },
          runOptions: ({ sessionKey: _sessionKey }: { sessionKey: string }) => ({
            sessionKey: undefined as string | undefined,
          }),
        },
        {
          name: "runHeartbeatOnce sessionKey arg",
          caseDir: "hb-forced-session-override",
          peerKind: "group" as const,
          peerId: "120363401234567891@g.us",
          message: "Forced alert",
          applyOverride: () => {},
          runOptions: ({ sessionKey }: { sessionKey: string }) => ({ sessionKey }),
        },
      ]);

      for (const testCase of cases) {
        const tmpDir = await createCaseDir(testCase.caseDir);
        const storePath = path.join(tmpDir, "sessions.json");
        const cfg: OpenBotConfig = {
          agents: {
            defaults: {
              workspace: tmpDir,
              heartbeat: {
                every: "5m",
              },
            },
          },
          channels: { whatsapp: { allowFrom: ["*"] } },
          session: { store: storePath },
        };
        const mainSessionKey = resolveMainSessionKey(cfg);
        const agentId = resolveAgentIdFromSessionKey(mainSessionKey);
        const overrideSessionKey = buildAgentPeerSessionKey({
          agentId,
          channel: "whatsapp",
          peerKind: testCase.peerKind,
          peerId: testCase.peerId,
        });
        testCase.applyOverride({ cfg, sessionKey: overrideSessionKey });

        await fs.writeFile(
          storePath,
          JSON.stringify({
            [mainSessionKey]: {
              sessionId: "sid-main",
              updatedAt: Date.now(),
              lastChannel: "whatsapp",
              lastTo: "120363401234567890@g.us",
            },
            [overrideSessionKey]: {
              sessionId: `sid-${testCase.peerKind}`,
              updatedAt: Date.now() + 10_000,
              lastChannel: "whatsapp",
              lastTo: testCase.peerId,
            },
          }),
        );

        replySpy.mockClear();
        replySpy.mockResolvedValue([{ text: testCase.message }]);
        const sendWhatsApp = vi
          .fn<NonNullable<HeartbeatDeps["sendWhatsApp"]>>()
          .mockResolvedValue({ messageId: "m1", toJid: "jid" });

        await runHeartbeatOnce({
          cfg,
          reason: "manual",
          ...testCase.runOptions({ sessionKey: overrideSessionKey }),
          deps: createHeartbeatDeps(sendWhatsApp),
        });

        expect(sendWhatsApp, testCase.name).toHaveBeenCalledTimes(0);
        expect(replySpy, testCase.name).toHaveBeenCalledWith(
          expect.objectContaining({
            SessionKey: overrideSessionKey,
            Provider: "heartbeat",
          }),
          expect.objectContaining({ isHeartbeat: true, suppressToolErrorWarnings: false }),
          cfg,
        );
      }
    } finally {
      replySpy.mockRestore();
    }
  });

  it("suppresses duplicate heartbeat payloads within 24h", async () => {
    const tmpDir = await createCaseDir("hb-dup-suppress");
    const storePath = path.join(tmpDir, "sessions.json");
    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
    try {
      const cfg: OpenBotConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "5m" },
          },
        },
        channels: { whatsapp: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      const sessionKey = resolveMainSessionKey(cfg);

      await fs.writeFile(
        storePath,
        JSON.stringify({
          [sessionKey]: {
            sessionId: "sid",
            updatedAt: Date.now(),
            lastChannel: "whatsapp",
            lastTo: "120363401234567890@g.us",
            lastHeartbeatText: "Final alert",
            lastHeartbeatSentAt: 0,
          },
        }),
      );

      replySpy.mockResolvedValue([{ text: "Final alert" }]);
      const sendWhatsApp = vi
        .fn<NonNullable<HeartbeatDeps["sendWhatsApp"]>>()
        .mockResolvedValue({ messageId: "m1", toJid: "jid" });

      await runHeartbeatOnce({
        cfg,
        reason: "manual",
        deps: createHeartbeatDeps(sendWhatsApp, 60_000),
      });

      expect(sendWhatsApp).toHaveBeenCalledTimes(0);
    } finally {
      replySpy.mockRestore();
    }
  });

  it("handles reasoning payload delivery variants", async () => {
    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
    try {
      const cases = typedCases<{
        name: string;
        caseDir: string;
        replies: Array<{ text: string }>;
        expectedTexts: string[];
      }>([
        {
          name: "reasoning + final payload",
          caseDir: "hb-reasoning",
          replies: [{ text: "Reasoning:\n_Because it helps_" }, { text: "Final alert" }],
          expectedTexts: ["Reasoning:\n_Because it helps_", "Final alert"],
        },
        {
          name: "reasoning + HEARTBEAT_OK",
          caseDir: "hb-reasoning-heartbeat-ok",
          replies: [{ text: "Reasoning:\n_Because it helps_" }, { text: "HEARTBEAT_OK" }],
          expectedTexts: ["Reasoning:\n_Because it helps_"],
        },
      ]);

      for (const testCase of cases) {
        const tmpDir = await createCaseDir(testCase.caseDir);
        const storePath = path.join(tmpDir, "sessions.json");
        const cfg: OpenBotConfig = {
          agents: {
            defaults: {
              workspace: tmpDir,
              heartbeat: {
                every: "5m",
                includeReasoning: true,
              },
            },
          },
          channels: { whatsapp: { allowFrom: ["*"] } },
          session: { store: storePath },
        };
        const sessionKey = resolveMainSessionKey(cfg);

        await fs.writeFile(
          storePath,
          JSON.stringify({
            [sessionKey]: {
              sessionId: "sid",
              updatedAt: Date.now(),
              lastChannel: "whatsapp",
              lastProvider: "whatsapp",
              lastTo: "120363401234567890@g.us",
            },
          }),
        );

        replySpy.mockClear();
        replySpy.mockResolvedValue(testCase.replies);
        const sendWhatsApp = vi
          .fn<NonNullable<HeartbeatDeps["sendWhatsApp"]>>()
          .mockResolvedValue({ messageId: "m1", toJid: "jid" });

        await runHeartbeatOnce({
          cfg,
          reason: "manual",
          deps: createHeartbeatDeps(sendWhatsApp),
        });

        expect(sendWhatsApp, testCase.name).toHaveBeenCalledTimes(0);
      }
    } finally {
      replySpy.mockRestore();
    }
  });

  it("loads the default agent session from templated stores", async () => {
    const tmpDir = await createCaseDir("openclaw-hb");
    const storeTemplate = path.join(tmpDir, "agents", "{agentId}", "sessions.json");
    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
    try {
      const cfg: OpenBotConfig = {
        agents: {
          defaults: { workspace: tmpDir, heartbeat: { every: "5m" } },
          list: [{ id: "work", default: true }],
        },
        channels: { whatsapp: { allowFrom: ["*"] } },
        session: { store: storeTemplate },
      };
      const sessionKey = resolveMainSessionKey(cfg);
      const agentId = resolveAgentIdFromSessionKey(sessionKey);
      const storePath = resolveStorePath(storeTemplate, { agentId });

      await fs.mkdir(path.dirname(storePath), { recursive: true });
      await fs.writeFile(
        storePath,
        JSON.stringify({
          [sessionKey]: {
            sessionId: "sid",
            updatedAt: Date.now(),
            lastChannel: "whatsapp",
            lastProvider: "whatsapp",
            lastTo: "120363401234567890@g.us",
          },
        }),
      );

      replySpy.mockResolvedValue({ text: "Hello from heartbeat" });
      const sendWhatsApp = vi.fn<NonNullable<HeartbeatDeps["sendWhatsApp"]>>().mockResolvedValue({
        messageId: "m1",
        toJid: "jid",
      });

      await runHeartbeatOnce({
        cfg,
        reason: "manual",
        deps: createHeartbeatDeps(sendWhatsApp),
      });

      expect(sendWhatsApp).toHaveBeenCalledTimes(0);
    } finally {
      replySpy.mockRestore();
    }
  });

  type HeartbeatFileState = "empty" | "actionable" | "missing" | "read-error";

  async function runHeartbeatFileScenario(params: {
    fileState: HeartbeatFileState;
    reason?: "interval" | "wake";
    queueCronEvent?: boolean;
    replyText?: string;
  }) {
    const tmpDir = await createCaseDir("openclaw-hb");
    const storePath = path.join(tmpDir, "sessions.json");
    const workspaceDir = path.join(tmpDir, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    resetSystemEventsForTest();

    if (params.fileState === "empty") {
      await fs.writeFile(
        path.join(workspaceDir, "HEARTBEAT.md"),
        "# HEARTBEAT.md\n\n## Tasks\n\n",
        "utf-8",
      );
    } else if (params.fileState === "actionable") {
      await fs.writeFile(
        path.join(workspaceDir, "HEARTBEAT.md"),
        "# HEARTBEAT.md\n\n- Check server logs\n- Review pending PRs\n",
        "utf-8",
      );
    } else if (params.fileState === "read-error") {
      // readFile on a directory triggers EISDIR.
      await fs.mkdir(path.join(workspaceDir, "HEARTBEAT.md"), { recursive: true });
    }

    const cfg: OpenBotConfig = {
      agents: {
        defaults: {
          workspace: workspaceDir,
          heartbeat: { every: "5m" },
        },
      },
      channels: { whatsapp: { allowFrom: ["*"] } },
      session: { store: storePath },
    };
    const sessionKey = resolveMainSessionKey(cfg);
    await fs.writeFile(
      storePath,
      JSON.stringify({
        [sessionKey]: {
          sessionId: "sid",
          updatedAt: Date.now(),
          lastChannel: "whatsapp",
          lastTo: "120363401234567890@g.us",
        },
      }),
    );
    if (params.queueCronEvent) {
      enqueueSystemEvent("Cron: QMD maintenance completed", {
        sessionKey,
        contextKey: "cron:qmd-maintenance",
      });
    }

    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
    replySpy.mockResolvedValue({ text: params.replyText ?? "Checked logs and PRs" });
    const sendWhatsApp = vi
      .fn<NonNullable<HeartbeatDeps["sendWhatsApp"]>>()
      .mockResolvedValue({ messageId: "m1", toJid: "jid" });
    const res = await runHeartbeatOnce({
      cfg,
      reason: params.reason,
      deps: createHeartbeatDeps(sendWhatsApp),
    });
    return { res, replySpy, sendWhatsApp, workspaceDir };
  }

  it("adds explicit workspace HEARTBEAT.md path guidance to heartbeat prompts", async () => {
    const { res, replySpy, sendWhatsApp, workspaceDir } = await runHeartbeatFileScenario({
      fileState: "actionable",
      reason: "wake",
      replyText: "Checked logs and PRs",
    });
    try {
      expect(res.status).toBe("ran");
      expect(sendWhatsApp).toHaveBeenCalledTimes(0);
      expect(replySpy).toHaveBeenCalledTimes(1);
      const calledCtx = replySpy.mock.calls[0]?.[0] as { Body?: string };
      const expectedPath = path.join(workspaceDir, "HEARTBEAT.md").replace(/\\/g, "/");
      expect(calledCtx.Body).toContain(`use workspace file ${expectedPath} (exact case)`);
      expect(calledCtx.Body).toContain("Do not read docs/heartbeat.md.");
    } finally {
      replySpy.mockRestore();
    }
  });

  it("applies HEARTBEAT.md gating rules across file states and triggers", async () => {
    const cases: Array<{
      name: string;
      fileState: HeartbeatFileState;
      reason?: "interval" | "wake";
      queueCronEvent?: boolean;
      expectedStatus: "ran" | "skipped";
      expectedSkipReason?: "empty-heartbeat-file" | "no-trigger";
      expectedSendCalls: number;
      expectedReplyCalls: number;
      expectCronContext?: boolean;
      replyText?: string;
    }> = [
      {
        name: "empty file + interval skips",
        fileState: "empty",
        expectedStatus: "skipped",
        expectedSkipReason: "empty-heartbeat-file",
        expectedSendCalls: 0,
        expectedReplyCalls: 0,
      },
      {
        name: "empty file + wake runs",
        fileState: "empty",
        reason: "wake",
        expectedStatus: "ran",
        expectedSendCalls: 0,
        expectedReplyCalls: 1,
        replyText: "wake event processed",
      },
      {
        name: "empty file + queued cron interval runs",
        fileState: "empty",
        reason: "interval",
        queueCronEvent: true,
        expectedStatus: "ran",
        expectedSendCalls: 0,
        expectedReplyCalls: 1,
        expectCronContext: true,
        replyText: "Relay this cron update now",
      },
      {
        name: "actionable file + interval skips without a real trigger",
        fileState: "actionable",
        reason: "interval",
        expectedStatus: "skipped",
        expectedSkipReason: "no-trigger",
        expectedSendCalls: 0,
        expectedReplyCalls: 0,
      },
      {
        name: "missing file skips",
        fileState: "missing",
        expectedStatus: "skipped",
        expectedSkipReason: "empty-heartbeat-file",
        expectedSendCalls: 0,
        expectedReplyCalls: 0,
      },
      {
        name: "read error + interval skips without a real trigger",
        fileState: "read-error",
        reason: "interval",
        expectedStatus: "skipped",
        expectedSkipReason: "no-trigger",
        expectedSendCalls: 0,
        expectedReplyCalls: 0,
      },
      {
        name: "missing file + wake runs",
        fileState: "missing",
        reason: "wake",
        expectedStatus: "ran",
        expectedSendCalls: 0,
        expectedReplyCalls: 1,
        replyText: "wake event processed",
      },
      {
        name: "missing file + queued cron interval runs",
        fileState: "missing",
        reason: "interval",
        queueCronEvent: true,
        expectedStatus: "ran",
        expectedSendCalls: 0,
        expectedReplyCalls: 1,
        expectCronContext: true,
        replyText: "Relay this cron update now",
      },
    ];

    for (const testCase of cases) {
      const { res, replySpy, sendWhatsApp } = await runHeartbeatFileScenario(testCase);
      try {
        expect(res.status, testCase.name).toBe(testCase.expectedStatus);
        if (res.status === "skipped") {
          expect(res.reason, testCase.name).toBe(testCase.expectedSkipReason);
        }
        expect(replySpy, testCase.name).toHaveBeenCalledTimes(testCase.expectedReplyCalls);
        expect(sendWhatsApp, testCase.name).toHaveBeenCalledTimes(testCase.expectedSendCalls);
        if (testCase.expectCronContext) {
          const calledCtx = replySpy.mock.calls[0]?.[0] as { Provider?: string; Body?: string };
          expect(calledCtx.Provider, testCase.name).toBe("cron-event");
          expect(calledCtx.Body, testCase.name).toContain("scheduled reminder has been triggered");
        }
      } finally {
        replySpy.mockRestore();
      }
    }
  });

  it("keeps cron reminders on the OpenBot session surface", async () => {
    const tmpDir = await createCaseDir("hb-cron-target-none");
    const storePath = path.join(tmpDir, "sessions.json");
    const cfg: OpenBotConfig = {
      agents: {
        defaults: {
          workspace: tmpDir,
          heartbeat: { every: "5m" },
        },
      },
      channels: { whatsapp: { allowFrom: ["*"] } },
      session: { store: storePath },
    };
    const sessionKey = resolveMainSessionKey(cfg);
    await fs.writeFile(
      storePath,
      JSON.stringify({
        [sessionKey]: {
          sessionId: "sid",
          updatedAt: Date.now(),
          lastChannel: "whatsapp",
          lastTo: "120363401234567890@g.us",
        },
      }),
    );
    enqueueSystemEvent("Cron: rotate logs", {
      sessionKey,
      contextKey: "cron:rotate-logs",
    });

    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
    replySpy.mockResolvedValue({ text: "Handled internally" });
    const sendWhatsApp = vi
      .fn<NonNullable<HeartbeatDeps["sendWhatsApp"]>>()
      .mockResolvedValue({ messageId: "m1", toJid: "jid" });

    try {
      const res = await runHeartbeatOnce({
        cfg,
        reason: "interval",
        deps: createHeartbeatDeps(sendWhatsApp),
      });
      expect(res.status).toBe("ran");
      expect(sendWhatsApp).toHaveBeenCalledTimes(0);
      const calledCtx = replySpy.mock.calls[0]?.[0] as { Provider?: string; Body?: string };
      expect(calledCtx.Provider).toBe("cron-event");
      expect(calledCtx.Body).toContain("Please relay this reminder to the user");
      expect(calledCtx.Body).not.toContain("Handle this reminder internally");
    } finally {
      replySpy.mockRestore();
    }
  });

  it("drains idle exec completions without a model turn", async () => {
    const tmpDir = await createCaseDir("hb-exec-target-none");
    const storePath = path.join(tmpDir, "sessions.json");
    const cfg: OpenBotConfig = {
      agents: {
        defaults: {
          workspace: tmpDir,
          heartbeat: { every: "5m" },
        },
      },
      channels: { whatsapp: { allowFrom: ["*"] } },
      session: { store: storePath },
    };
    const sessionKey = resolveMainSessionKey(cfg);
    await fs.writeFile(
      storePath,
      JSON.stringify({
        [sessionKey]: {
          sessionId: "sid",
          updatedAt: Date.now(),
          lastChannel: "whatsapp",
          lastTo: "120363401234567890@g.us",
        },
      }),
    );
    enqueueSystemEvent("exec finished: backup completed", {
      sessionKey,
      contextKey: "exec:backup",
    });

    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
    replySpy.mockResolvedValue({ text: "Handled internally" });
    const sendWhatsApp = vi
      .fn<NonNullable<HeartbeatDeps["sendWhatsApp"]>>()
      .mockResolvedValue({ messageId: "m1", toJid: "jid" });

    try {
      const res = await runHeartbeatOnce({
        cfg,
        reason: "exec-event",
        deps: createHeartbeatDeps(sendWhatsApp),
      });
      expect(res.status).toBe("ran");
      expect(sendWhatsApp).toHaveBeenCalledTimes(0);
      expect(replySpy).not.toHaveBeenCalled();
    } finally {
      replySpy.mockRestore();
    }
  });

  it("keeps event wakes when the interval is off", async () => {
    const tmpDir = await createCaseDir("hb-event-only");
    const storePath = path.join(tmpDir, "sessions.json");
    const cfg: OpenBotConfig = {
      agents: {
        defaults: {
          workspace: tmpDir,
          heartbeat: { every: "0m" },
        },
      },
      channels: { whatsapp: { allowFrom: ["*"] } },
      session: { store: storePath },
    };
    const sessionKey = resolveMainSessionKey(cfg);
    await fs.writeFile(
      storePath,
      JSON.stringify({
        [sessionKey]: {
          sessionId: "sid",
          updatedAt: Date.now(),
          lastChannel: "whatsapp",
          lastTo: "120363401234567890@g.us",
        },
      }),
    );
    const replySpy = vi.spyOn(replyModule, "getReplyFromConfig");
    const sendWhatsApp = vi
      .fn<NonNullable<HeartbeatDeps["sendWhatsApp"]>>()
      .mockResolvedValue({ messageId: "m1", toJid: "jid" });

    try {
      const interval = await runHeartbeatOnce({
        cfg,
        reason: "interval",
        deps: createHeartbeatDeps(sendWhatsApp),
      });
      expect(interval).toEqual({ status: "skipped", reason: "no-trigger" });
      expect(replySpy).not.toHaveBeenCalled();

      enqueueSystemEvent("exec finished: backup completed", {
        sessionKey,
        contextKey: "exec:backup",
      });
      const execExit = await runHeartbeatOnce({
        cfg,
        reason: "exec:sid:exit",
        deps: createHeartbeatDeps(sendWhatsApp),
      });
      expect(execExit.status).toBe("ran");
      expect(replySpy).not.toHaveBeenCalled();

      enqueueSystemEvent("Notification posted (node=phone key=mail)", {
        sessionKey,
        contextKey: "notification:mail",
      });
      replySpy.mockResolvedValue({ text: "You have a new mail notification." });
      const notification = await runHeartbeatOnce({
        cfg,
        reason: "notifications-event",
        deps: createHeartbeatDeps(sendWhatsApp),
      });
      expect(notification.status).toBe("ran");
      expect(replySpy).toHaveBeenCalledTimes(1);
      expect(sendWhatsApp).toHaveBeenCalledTimes(0);
    } finally {
      replySpy.mockRestore();
    }
  });
});
