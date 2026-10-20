import { startDeliveryContextSweep } from "../agents/execution-preflight/completion-hold.js";
import type { HealthSummary } from "../commands/health.js";
import { cleanOldMedia } from "../media/store.js";
import { drainUsageOutbox } from "./billing/usage-outbox-drain.js";
import { abortChatRunById, type ChatAbortControllerEntry } from "./chat-abort.js";
import { tickScheduledProjectionMaterialization } from "./enterprise-data/scheduled-projection-materializer.js";
import { tickAgentKnowledgeGeneration } from "./knowledge/agent-knowledge-generation-runtime.js";
import { tickKnowledgeGovernanceJobs } from "./knowledge/governance/runtime/gateway-tick.js";
import { tickDueWebSourceRefreshes } from "./knowledge/web-source-refresh-runtime.js";
import { runMeetingReminderTick } from "./meeting-reminder-runtime.js";
import type { ChatRunEntry } from "./server-chat.js";
import {
  DEDUPE_MAX,
  DEDUPE_TTL_MS,
  HEALTH_REFRESH_INTERVAL_MS,
  TICK_INTERVAL_MS,
} from "./server-constants.js";
import type { DedupeEntry } from "./server-shared.js";
import { formatError } from "./server-utils.js";
import { setBroadcastHealthUpdate } from "./server/health-state.js";
import { setWorkbenchSignalsInvalidateBroadcast } from "./workbench/signals-invalidate.js";

export function startGatewayMaintenanceTimers(params: {
  broadcast: (
    event: string,
    payload: unknown,
    opts?: {
      dropIfSlow?: boolean;
      stateVersion?: { presence?: number; health?: number };
    },
  ) => void;
  broadcastChat: (
    sessionKey: string,
    payload: unknown,
    opts?: { dropIfSlow?: boolean; tenantId?: string | null; runId?: string | null },
  ) => void;
  nodeSendToAllSubscribed: (event: string, payload: unknown) => void;
  getPresenceVersion: () => number;
  getHealthVersion: () => number;
  refreshGatewayHealthSnapshot: (opts?: { probe?: boolean }) => Promise<HealthSummary>;
  logHealth: { error: (msg: string) => void };
  dedupe: Map<string, DedupeEntry>;
  chatAbortControllers: Map<string, ChatAbortControllerEntry>;
  chatRunState: { abortedRuns: Map<string, number> };
  chatRunBuffers: Map<string, string>;
  chatDeltaSentAt: Map<string, number>;
  removeChatRun: (
    sessionId: string,
    clientRunId: string,
    sessionKey?: string,
  ) => ChatRunEntry | undefined;
  agentRunSeq: Map<string, number>;
  nodeSendToSession: (sessionKey: string, event: string, payload: unknown) => void;
  mediaCleanupTtlMs?: number;
}): {
  tickInterval: ReturnType<typeof setInterval>;
  healthInterval: ReturnType<typeof setInterval>;
  dedupeCleanup: ReturnType<typeof setInterval>;
  mediaCleanup: ReturnType<typeof setInterval> | null;
} {
  setBroadcastHealthUpdate((snap: HealthSummary) => {
    params.broadcast("health", snap, {
      stateVersion: {
        presence: params.getPresenceVersion(),
        health: params.getHealthVersion(),
      },
    });
    params.nodeSendToAllSubscribed("health", snap);
  });
  setWorkbenchSignalsInvalidateBroadcast((event, payload, opts) => {
    params.broadcast(event, payload, opts);
  });
  startDeliveryContextSweep();

  // periodic keepalive
  const tickInterval = setInterval(() => {
    const payload = { ts: Date.now() };
    params.broadcast("tick", payload, { dropIfSlow: true });
    params.nodeSendToAllSubscribed("tick", payload);
  }, TICK_INTERVAL_MS);

  // periodic health refresh to keep cached snapshot warm
  const healthInterval = setInterval(() => {
    void params
      .refreshGatewayHealthSnapshot({ probe: true })
      .catch((err) => params.logHealth.error(`refresh failed: ${formatError(err)}`));
  }, HEALTH_REFRESH_INTERVAL_MS);

  // Prime cache so first client gets a snapshot without waiting.
  void params
    .refreshGatewayHealthSnapshot({ probe: true })
    .catch((err) => params.logHealth.error(`initial refresh failed: ${formatError(err)}`));

  // dedupe cache cleanup
  let governanceJobsInFlight = false;
  let webRefreshInFlight = false;
  let agentKnowledgeGenInFlight = false;
  let scheduledProjectionsInFlight = false;
  let usageOutboxInFlight = false;
  let meetingRemindersInFlight = false;
  const dedupeCleanup = setInterval(() => {
    const AGENT_RUN_SEQ_MAX = 10_000;
    const now = Date.now();
    for (const [k, v] of params.dedupe) {
      if (now - v.ts > DEDUPE_TTL_MS) {
        params.dedupe.delete(k);
      }
    }
    if (params.dedupe.size > DEDUPE_MAX) {
      const entries = [...params.dedupe.entries()].toSorted((a, b) => a[1].ts - b[1].ts);
      for (let i = 0; i < params.dedupe.size - DEDUPE_MAX; i++) {
        params.dedupe.delete(entries[i][0]);
      }
    }

    if (params.agentRunSeq.size > AGENT_RUN_SEQ_MAX) {
      const excess = params.agentRunSeq.size - AGENT_RUN_SEQ_MAX;
      let removed = 0;
      for (const runId of params.agentRunSeq.keys()) {
        params.agentRunSeq.delete(runId);
        removed += 1;
        if (removed >= excess) {
          break;
        }
      }
    }

    for (const [runId, entry] of params.chatAbortControllers) {
      if (now <= entry.expiresAtMs) {
        continue;
      }
      abortChatRunById(
        {
          chatAbortControllers: params.chatAbortControllers,
          chatRunBuffers: params.chatRunBuffers,
          chatDeltaSentAt: params.chatDeltaSentAt,
          chatAbortedRuns: params.chatRunState.abortedRuns,
          removeChatRun: params.removeChatRun,
          agentRunSeq: params.agentRunSeq,
          broadcastChat: params.broadcastChat,
          nodeSendToSession: params.nodeSendToSession,
        },
        { runId, sessionKey: entry.sessionKey, stopReason: "timeout" },
      );
    }

    const ABORTED_RUN_TTL_MS = 60 * 60_000;
    for (const [runId, abortedAt] of params.chatRunState.abortedRuns) {
      if (now - abortedAt <= ABORTED_RUN_TTL_MS) {
        continue;
      }
      params.chatRunState.abortedRuns.delete(runId);
      params.chatRunBuffers.delete(runId);
      params.chatDeltaSentAt.delete(runId);
    }

    if (!governanceJobsInFlight) {
      governanceJobsInFlight = true;
      void tickKnowledgeGovernanceJobs()
        .catch((err) => {
          params.logHealth.error(`knowledge governance jobs failed: ${formatError(err)}`);
        })
        .finally(() => {
          governanceJobsInFlight = false;
        });
    }

    // Web source auto-refresh scheduler: re-fetch due web sources (opt-in per source).
    if (!webRefreshInFlight) {
      webRefreshInFlight = true;
      void tickDueWebSourceRefreshes()
        .catch((err) => {
          params.logHealth.error(`web source refresh failed: ${formatError(err)}`);
        })
        .finally(() => {
          webRefreshInFlight = false;
        });
    }

    // Scheduled enterprise knowledge projection materialization (bounded, overlap-safe).
    if (!scheduledProjectionsInFlight) {
      scheduledProjectionsInFlight = true;
      void tickScheduledProjectionMaterialization()
        .catch((err) => {
          params.logHealth.error(
            `scheduled projection materialization failed: ${formatError(err)}`,
          );
        })
        .finally(() => {
          scheduledProjectionsInFlight = false;
        });
    }

    // Commercial usage outbox drain (retry failed / deferred credit settlements).
    if (!usageOutboxInFlight) {
      usageOutboxInFlight = true;
      void drainUsageOutbox()
        .catch((err) => {
          params.logHealth.error(`usage outbox drain failed: ${formatError(err)}`);
        })
        .finally(() => {
          usageOutboxInFlight = false;
        });
    }

    // Agent knowledge auto-generation: drain queued session-summary/SOP jobs (opt-in;
    // no-op unless OPENBOT_KNOWLEDGE_AUTO_GENERATE is enabled).
    if (!agentKnowledgeGenInFlight) {
      agentKnowledgeGenInFlight = true;
      void tickAgentKnowledgeGeneration()
        .catch((err) => {
          params.logHealth.error(`agent knowledge generation failed: ${formatError(err)}`);
        })
        .finally(() => {
          agentKnowledgeGenInFlight = false;
        });
    }

    // Meeting pre-meeting reminders (Phase B2): flip confirmed meetings whose
    // reminder window opened to `reminded` and broadcast to attendees. Pure timing,
    // no LLM; a single scan covers all meetings (no per-meeting daemon).
    if (!meetingRemindersInFlight) {
      meetingRemindersInFlight = true;
      void runMeetingReminderTick({
        notify: (meeting) =>
          params.broadcast(
            "meeting.reminded",
            {
              meetingId: meeting.id,
              title: meeting.title,
              startAtMs: meeting.startAtMs,
              attendees: meeting.attendees.map((attendee) => attendee.userId),
            },
            { dropIfSlow: true },
          ),
      })
        .catch((err) => {
          params.logHealth.error(`meeting reminders failed: ${formatError(err)}`);
        })
        .finally(() => {
          meetingRemindersInFlight = false;
        });
    }
  }, 60_000);

  if (typeof params.mediaCleanupTtlMs !== "number") {
    return { tickInterval, healthInterval, dedupeCleanup, mediaCleanup: null };
  }

  let mediaCleanupInFlight: Promise<void> | null = null;
  const runMediaCleanup = () => {
    if (mediaCleanupInFlight) {
      return mediaCleanupInFlight;
    }
    mediaCleanupInFlight = cleanOldMedia(params.mediaCleanupTtlMs, {
      recursive: true,
      pruneEmptyDirs: true,
    })
      .catch((err) => {
        params.logHealth.error(`media cleanup failed: ${formatError(err)}`);
      })
      .finally(() => {
        mediaCleanupInFlight = null;
      });
    return mediaCleanupInFlight;
  };

  const mediaCleanup = setInterval(() => {
    void runMediaCleanup();
  }, 60 * 60_000);

  void runMediaCleanup();

  return { tickInterval, healthInterval, dedupeCleanup, mediaCleanup };
}
