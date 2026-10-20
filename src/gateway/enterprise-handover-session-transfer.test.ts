import { describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import {
  executeHandoverSessionDataTransfer,
  HANDOVER_RECENT_SESSION_WINDOW_DAYS,
  mergeHandoverSessionTransferExecution,
} from "./enterprise-handover-session-transfer.js";

const NOW_MS = Date.UTC(2026, 5, 12, 12, 0, 0);
const RECENT_MS = NOW_MS - 5 * 24 * 60 * 60 * 1000;
const OLD_MS = NOW_MS - (HANDOVER_RECENT_SESSION_WINDOW_DAYS + 2) * 24 * 60 * 60 * 1000;

function createCfg(): OpenBotConfig {
  return {
    session: { mainKey: "main" },
    agents: {
      list: [
        { id: "sales", default: true, workspace: "/tmp/sales" },
        { id: "backup", workspace: "/tmp/backup" },
      ],
    },
  } as OpenBotConfig;
}

function createStore(): Record<string, SessionEntry> {
  return {
    "agent:sales:main": {
      sessionId: "sess-recent",
      updatedAt: RECENT_MS,
    },
    "agent:sales:legacy": {
      sessionId: "sess-old",
      updatedAt: OLD_MS,
    },
    "agent:backup:main": {
      sessionId: "sess-backup-old",
      updatedAt: OLD_MS,
    },
  };
}

describe("executeHandoverSessionDataTransfer", () => {
  it("records recent sessions and archives only stale transcripts for covered agents", () => {
    const archiveTranscripts = vi.fn((opts: { sessionId: string }) => [
      `/tmp/archive/${opts.sessionId}.jsonl`,
    ]);
    const result = executeHandoverSessionDataTransfer({
      transfer: {
        recentSessions: true,
        historyArchive: true,
        coveredAgentIds: ["sales"],
      },
      deps: {
        nowMs: NOW_MS,
        loadContext: () => ({
          cfg: createCfg(),
          storePath: "/tmp/sessions.json",
          store: createStore(),
        }),
        archiveTranscripts,
      },
    });

    expect(result.recentSessionIds).toEqual(["sess-recent"]);
    expect(result.archivedSessionIds).toEqual(["sess-old"]);
    expect(archiveTranscripts).toHaveBeenCalledTimes(1);
    expect(archiveTranscripts).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-old",
        reason: "reset",
        restrictToStoreDir: true,
      }),
    );
  });

  it("skips archive work when history archive is not selected", () => {
    const archiveTranscripts = vi.fn(() => []);
    const result = executeHandoverSessionDataTransfer({
      transfer: {
        recentSessions: true,
        historyArchive: false,
        coveredAgentIds: ["sales"],
      },
      deps: {
        nowMs: NOW_MS,
        loadContext: () => ({
          cfg: createCfg(),
          storePath: "/tmp/sessions.json",
          store: createStore(),
        }),
        archiveTranscripts,
      },
    });

    expect(result.recentSessionIds).toEqual(["sess-recent"]);
    expect(result.archivedSessionIds).toEqual([]);
    expect(archiveTranscripts).not.toHaveBeenCalled();
  });

  it("does not touch agents outside coveredAgentIds", () => {
    const archiveTranscripts = vi.fn(() => ["/tmp/archive/sess-backup-old.jsonl"]);
    const result = executeHandoverSessionDataTransfer({
      transfer: {
        recentSessions: false,
        historyArchive: true,
        coveredAgentIds: ["backup"],
      },
      deps: {
        nowMs: NOW_MS,
        loadContext: () => ({
          cfg: createCfg(),
          storePath: "/tmp/sessions.json",
          store: createStore(),
        }),
        archiveTranscripts,
      },
    });

    expect(result.archivedSessionIds).toEqual(["sess-backup-old"]);
    expect(archiveTranscripts).toHaveBeenCalledTimes(1);
  });
});

describe("mergeHandoverSessionTransferExecution", () => {
  it("writes execution metadata back to the session transfer plan", () => {
    const merged = mergeHandoverSessionTransferExecution({
      plan: {
        recentSessions: true,
        historyArchive: true,
        coveredAgentIds: ["sales"],
      },
      execution: {
        archivedSessionIds: ["sess-old"],
        recentSessionIds: ["sess-recent"],
        archivedTranscriptPaths: ["/tmp/archive/sess-old.jsonl"],
      },
      executedAt: "2026-06-12T12:00:00.000Z",
    });

    expect(merged).toEqual({
      recentSessions: true,
      historyArchive: true,
      coveredAgentIds: ["sales"],
      executedAt: "2026-06-12T12:00:00.000Z",
      archivedSessionIds: ["sess-old"],
      recentSessionIds: ["sess-recent"],
      archivedTranscriptCount: 1,
    });
  });
});
