import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { HEARTBEAT_FOCUS_SKIP_REASON } from "./heartbeat-focus.js";
import { HEARTBEAT_PARKED_NOTICE_SENTINEL } from "./heartbeat-parked-notice.js";
import { HEARTBEAT_NO_TRIGGER_SKIP_REASON } from "./heartbeat-reason.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import {
  seedMainSessionStore,
  setupTelegramHeartbeatPluginRuntimeForTests,
  withTempTelegramHeartbeatSandbox,
} from "./heartbeat-runner.test-utils.js";
import { enqueueSystemEvent, peekSystemEvents, resetSystemEventsForTest } from "./system-events.js";

vi.mock("jiti", () => ({ createJiti: () => () => ({}) }));
vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn().mockResolvedValue({ ok: true }),
}));

const { callGateway } = await import("../gateway/call.js");
const mockedCallGateway = vi.mocked(callGateway);

beforeEach(() => {
  setupTelegramHeartbeatPluginRuntimeForTests();
  resetSystemEventsForTest();
  mockedCallGateway.mockClear();
  mockedCallGateway.mockResolvedValue({ ok: true });
});

describe("heartbeat runner focus gate (P8 / P9 / EA-B5)", () => {
  async function writeUserTranscript(params: {
    tmpDir: string;
    sessionId: string;
    userAtMs: number;
  }): Promise<void> {
    const transcriptPath = path.join(params.tmpDir, `${params.sessionId}.jsonl`);
    const line = JSON.stringify({
      type: "message",
      timestamp: new Date(params.userAtMs).toISOString(),
      message: { role: "user", content: [{ type: "text", text: "调研竞品" }] },
    });
    await fs.writeFile(transcriptPath, `${line}\n`);
  }

  it("skips the LLM turn when the main session FOCUS is occupied", async () => {
    await withTempTelegramHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const nowMs = Date.parse("2026-09-17T06:00:00.000Z");
      const cfg: OpenBotConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "5m" },
          },
        },
        channels: { telegram: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      await seedMainSessionStore(storePath, cfg, {
        sessionId: "sid",
        lastChannel: "telegram",
        lastProvider: "telegram",
        lastTo: "user123",
      });
      await writeUserTranscript({
        tmpDir,
        sessionId: "sid",
        userAtMs: nowMs - 10 * 60 * 1000,
      });
      replySpy.mockResolvedValue({ text: "should not run" });

      const res = await runHeartbeatOnce({
        cfg,
        reason: "interval",
        deps: { nowMs: () => nowMs, sendTelegram: vi.fn() },
      });

      expect(res).toEqual({ status: "skipped", reason: HEARTBEAT_NO_TRIGGER_SKIP_REASON });
      expect(replySpy).not.toHaveBeenCalled();
      expect(mockedCallGateway).not.toHaveBeenCalled();
    });
  });

  it("skips idle patrol when the main session is idle and nothing is due", async () => {
    await withTempTelegramHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const nowMs = Date.parse("2026-09-17T06:00:00.000Z");
      const cfg: OpenBotConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "5m" },
          },
        },
        channels: { telegram: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      await seedMainSessionStore(storePath, cfg, {
        sessionId: "sid",
        lastChannel: "telegram",
        lastProvider: "telegram",
        lastTo: "user123",
      });
      await writeUserTranscript({
        tmpDir,
        sessionId: "sid",
        userAtMs: nowMs - 5 * 60 * 60 * 1000,
      });
      replySpy.mockResolvedValue({ text: "HEARTBEAT_OK" });

      const res = await runHeartbeatOnce({
        cfg,
        reason: "interval",
        deps: { nowMs: () => nowMs, sendTelegram: vi.fn() },
      });

      expect(res).toEqual({ status: "skipped", reason: HEARTBEAT_NO_TRIGGER_SKIP_REASON });
      expect(replySpy).not.toHaveBeenCalled();
      expect(mockedCallGateway).not.toHaveBeenCalled();
    });
  });

  it("defers an occupied heartbeat without inventing a task or discarding its event", async () => {
    await withTempTelegramHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const nowMs = Date.parse("2026-09-17T06:00:00.000Z");
      const cfg: OpenBotConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "5m" },
          },
        },
        channels: { telegram: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      const sessionKey = await seedMainSessionStore(storePath, cfg, {
        sessionId: "sid",
        lastChannel: "telegram",
        lastProvider: "telegram",
        lastTo: "user123",
      });
      await writeUserTranscript({
        tmpDir,
        sessionId: "sid",
        userAtMs: nowMs - 2 * 60 * 1000,
      });
      enqueueSystemEvent("Exec finished: npm test", { sessionKey });
      replySpy.mockResolvedValue({ text: "should not run" });
      const sendTelegram = vi.fn();

      const res = await runHeartbeatOnce({
        cfg,
        reason: "exec-event",
        deps: { nowMs: () => nowMs, sendTelegram },
      });

      expect(res).toEqual({ status: "skipped", reason: HEARTBEAT_FOCUS_SKIP_REASON });
      expect(replySpy).not.toHaveBeenCalled();
      // Mid-flight park stays silent; reminder surfaces after the current task completes.
      expect(mockedCallGateway).not.toHaveBeenCalledWith(
        expect.objectContaining({
          method: "chat.inject",
          params: expect.objectContaining({
            message: expect.stringContaining(HEARTBEAT_PARKED_NOTICE_SENTINEL),
          }),
        }),
      );
      expect(peekSystemEvents(sessionKey)).toEqual(["Exec finished: npm test"]);
      await expect(fs.access(path.join(tmpDir, "sid.jsonl.task-board.json"))).rejects.toThrow();
      expect(sendTelegram).not.toHaveBeenCalled();
    });
  });

  it("reuses the cron parked notice for cron heartbeat wakes", async () => {
    await withTempTelegramHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const nowMs = Date.parse("2026-09-17T06:00:00.000Z");
      const cfg: OpenBotConfig = {
        agents: {
          defaults: {
            workspace: tmpDir,
            heartbeat: { every: "5m" },
          },
        },
        channels: { telegram: { allowFrom: ["*"] } },
        session: { store: storePath },
      };
      await seedMainSessionStore(storePath, cfg, {
        sessionId: "sid",
        lastChannel: "telegram",
        lastProvider: "telegram",
        lastTo: "user123",
      });
      await writeUserTranscript({
        tmpDir,
        sessionId: "sid",
        userAtMs: nowMs - 2 * 60 * 1000,
      });
      replySpy.mockResolvedValue({ text: "should not run" });

      const res = await runHeartbeatOnce({
        cfg,
        reason: "cron:2b9de6b0",
        deps: { nowMs: () => nowMs, sendTelegram: vi.fn() },
      });

      expect(res).toEqual({ status: "skipped", reason: HEARTBEAT_FOCUS_SKIP_REASON });
      expect(replySpy).not.toHaveBeenCalled();
      // Cron wakes also silent-park while FOCUS is busy (same defer-until-complete UX).
      expect(mockedCallGateway).not.toHaveBeenCalledWith(
        expect.objectContaining({
          method: "chat.inject",
          params: expect.objectContaining({
            cronJobId: "2b9de6b0",
            cronResultKind: "parked_notice",
          }),
        }),
      );
    });
  });
});
