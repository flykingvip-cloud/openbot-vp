import { resolveChatRunTenantId } from "../gateway/chat-session-interest.js";
import { getAgentRunContext, onAgentEvent, type AgentEventPayload } from "../infra/agent-events.js";
import { CONFIG_DIR } from "../utils.js";
import { classifyErrorClass } from "./assessment.js";
import { isConversationEvaluationEnabled } from "./feature.js";
import { EvaluationIdempotency } from "./idempotency.js";
import {
  classifyEntrypoint,
  classifyLinkQuality,
  createEvaluationEventId,
  isDiagnosticReplayRunId,
  weakFallbackRunId,
} from "./identity.js";
import {
  computeMetrics,
  type ConversationEvaluationMetrics,
  type DenominatorMark,
} from "./metrics.js";
import { ConversationReducer, type ObservationInput } from "./reducer.js";
import {
  appendJsonlLine,
  denominatorFilePath,
  evaluationFilePath,
  fnvByteLength,
  readJsonlObjects,
  serializeRecord,
  trustedTenantMatches,
  withTimeout,
} from "./store.js";
import {
  A0_DROP_ALERT_WINDOW_MS,
  A0_QUEUE_MAX_BYTES,
  A0_QUEUE_MAX_ITEMS,
  A0_WRITE_TIMEOUT_MS,
  isDropRateAlert,
  PENDING_SLO_MS,
} from "./thresholds.js";
import type { ConversationEvaluationRecord, LinkQuality } from "./types.js";

const SENSITIVE_KEYS = new Set([
  "text",
  "body",
  "content",
  "prompt",
  "message",
  "attachment",
  "attachments",
  "token",
  "secret",
  "password",
  "apikey",
  "args",
  "result",
  "partialresult",
  "delta",
  "mediaurls",
  "error",
  "llmttftms",
  "dockerms",
  "coldstartms",
  "warmattachms",
  "attemptid",
  "correctness",
]);

export type DropReason =
  | "overflow"
  | "write_timeout"
  | "write_error"
  | "flag_off"
  | "missing_membership_tenant"
  | "consumer_error";

export type DropCounts = Record<DropReason, number>;

type QueueItem = {
  obs: ObservationInput;
  bytes: number;
  breakReducer: boolean;
  preset?: ConversationEvaluationRecord;
};

export type ConversationEvaluationHandle = {
  enabled: boolean;
  stop: () => void;
  flush: () => Promise<void>;
  observe: (input: ObservationInput) => void;
  observeWeak: (input: {
    conversationId: string;
    startedAt: number;
    agentId: string;
    trustedTenantId: string;
    ts: number;
    phase?: "end" | "error";
    sessionKey?: string;
  }) => void;
  reassess: (tenantId: string, runId: string) => void;
  getMetrics: () => ConversationEvaluationMetrics;
  getDropCounts: () => DropCounts;
  getIdempotencySkips: () => number;
  getDropAlert: () => boolean;
  current: (runId: string) => ConversationEvaluationRecord | null;
};

export type StartConversationEvaluationOptions = {
  enabled?: boolean;
  env?: NodeJS.ProcessEnv;
  configDir?: string;
  now?: () => number;
  resolveTrustedTenant?: (runId: string) => string | null;
  isHeartbeat?: (runId: string) => boolean;
  writeTimeoutMs?: number;
  maxQueueItems?: number;
  maxQueueBytes?: number;
  pendingSloMs?: number;
  appendFile?: (filePath: string, line: string) => Promise<void>;
  breakRunIds?: ReadonlySet<string>;
  subscribe?: boolean;
};

function emptyDrops(): DropCounts {
  return {
    overflow: 0,
    write_timeout: 0,
    write_error: 0,
    flag_off: 0,
    missing_membership_tenant: 0,
    consumer_error: 0,
  };
}

function sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      if (key.toLowerCase() === "error") {
        out.errorClass = classifyErrorClass(value);
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

function visibleFlags(
  stream: string,
  data: Record<string, unknown>,
): {
  visibleText: boolean;
  visibleMedia: boolean;
} {
  if (stream !== "assistant") {
    return { visibleText: false, visibleMedia: false };
  }
  const text = typeof data.text === "string" ? data.text.trim() : "";
  const delta = typeof data.delta === "string" ? data.delta.trim() : "";
  const media = Array.isArray(data.mediaUrls) && data.mediaUrls.length > 0;
  return { visibleText: Boolean(text || delta), visibleMedia: media };
}

export function startConversationEvaluation(
  options: StartConversationEvaluationOptions = {},
): ConversationEvaluationHandle {
  const enabled = options.enabled ?? isConversationEvaluationEnabled(options.env ?? process.env);
  const configDir = options.configDir ?? CONFIG_DIR;
  const now = options.now ?? (() => Date.now());
  const resolveTenant = options.resolveTrustedTenant ?? resolveChatRunTenantId;
  const heartbeat =
    options.isHeartbeat ?? ((runId: string) => getAgentRunContext(runId)?.isHeartbeat === true);
  const writeTimeoutMs = options.writeTimeoutMs ?? A0_WRITE_TIMEOUT_MS;
  const maxQueueItems = options.maxQueueItems ?? A0_QUEUE_MAX_ITEMS;
  const maxQueueBytes = options.maxQueueBytes ?? A0_QUEUE_MAX_BYTES;
  const pendingSloMs = options.pendingSloMs ?? PENDING_SLO_MS;
  const appendFile = options.appendFile ?? appendJsonlLine;
  const subscribe = options.subscribe ?? true;

  const reducer = new ConversationReducer();
  const index = new EvaluationIdempotency();
  const drops = emptyDrops();
  const denominator: DenominatorMark[] = [];
  const seenTerminal = new Set<string>();
  const hints = new Map<
    string,
    {
      sawDispatch: boolean;
      sessionKey?: string;
      entrypointHint?: unknown;
      linkQuality: LinkQuality;
    }
  >();
  const seeded = new Set<string>();
  const trackedRuns = new Set<string>();
  const dropTimes: number[] = [];
  const observedTimes: number[] = [];
  let idempotencySkips = 0;
  let stopped = false;
  let unsub: (() => void) | null = null;
  const queue: QueueItem[] = [];
  let queueBytes = 0;
  let running = false;
  const flushWaiters: Array<() => void> = [];
  let denomChain: Promise<void> = Promise.resolve();

  const noteDrop = (reason: DropReason) => {
    drops[reason] += 1;
    if (reason === "overflow" || reason === "write_timeout" || reason === "flag_off") {
      dropTimes.push(now());
    }
  };

  const noteObserved = () => {
    observedTimes.push(now());
  };

  const persistDenominator = (mark: DenominatorMark) => {
    if (mark.linkQuality !== "strong" && mark.linkQuality !== "weak") {
      return;
    }
    if (!mark.tenantId.trim()) {
      return;
    }
    const filePath = denominatorFilePath(configDir, mark.tenantId);
    const line = `${JSON.stringify(mark)}\n`;
    denomChain = denomChain
      .then(async () => {
        if (stopped) {
          return;
        }
        await withTimeout(appendFile(filePath, line), writeTimeoutMs);
      })
      .catch(() => undefined);
  };

  const rememberHint = (obs: ObservationInput) => {
    const hint = hints.get(obs.runId) ?? {
      sawDispatch: false,
      linkQuality: classifyLinkQuality(obs.runId, obs.linkQuality),
    };
    if (obs.sessionKey) {
      hint.sessionKey = obs.sessionKey;
    }
    if (typeof obs.data.event === "string" && obs.data.event === "chat.dispatch_started") {
      hint.sawDispatch = true;
    }
    if (typeof obs.data.entrypoint === "string") {
      hint.entrypointHint = obs.data.entrypoint;
    }
    hint.linkQuality = classifyLinkQuality(obs.runId, obs.linkQuality);
    hints.set(obs.runId, hint);
    return hint;
  };

  const markTerminal = (obs: ObservationInput) => {
    const phase = obs.data.phase;
    const event = obs.data.event;
    const chatStage = typeof event === "string" && event.startsWith("chat.");
    if (obs.stream !== "lifecycle" || chatStage || (phase !== "end" && phase !== "error")) {
      return;
    }
    const hint = rememberHint(obs);
    const key = `${obs.trustedTenantId}\0${obs.runId}`;
    if (seenTerminal.has(key)) {
      return;
    }
    seenTerminal.add(key);
    const mark: DenominatorMark = {
      runId: obs.runId,
      tenantId: obs.trustedTenantId,
      entrypoint: classifyEntrypoint({
        runId: obs.runId,
        sessionKey: hint.sessionKey ?? obs.sessionKey,
        sawDispatch: hint.sawDispatch,
        entrypointHint: hint.entrypointHint,
      }),
      linkQuality: hint.linkQuality,
      eventId: createEvaluationEventId(),
      observedAt: new Date(now()).toISOString(),
    };
    denominator.push(mark);
    persistDenominator(mark);
  };

  const kick = () => {
    if (running) {
      return;
    }
    running = true;
    void pump();
  };

  const enqueue = (item: QueueItem) => {
    if (!enabled || stopped) {
      noteDrop("flag_off");
      return;
    }
    while (
      queue.length >= maxQueueItems ||
      (queue.length > 0 && queueBytes + item.bytes > maxQueueBytes)
    ) {
      const dropped = queue.shift();
      if (!dropped) {
        break;
      }
      queueBytes -= dropped.bytes;
      noteDrop("overflow");
    }
    if (queue.length >= maxQueueItems || queueBytes + item.bytes > maxQueueBytes) {
      noteDrop("overflow");
      return;
    }
    queue.push(item);
    queueBytes += item.bytes;
    kick();
  };

  const seedRun = async (tenantId: string, runId: string, atMs: number) => {
    const key = `${tenantId}\0${runId}`;
    if (seeded.has(key)) {
      return;
    }
    seeded.add(key);
    const filePath = evaluationFilePath({
      configDir,
      tenantId,
      runId,
      at: new Date(atMs),
    });
    const lines = readJsonlObjects<ConversationEvaluationRecord>(filePath);
    for (const line of lines) {
      if (line.runId === runId && trustedTenantMatches(line.tenantId, tenantId)) {
        index.adoptPersisted(line);
      }
    }
  };

  const writeRecord = async (record: ConversationEvaluationRecord) => {
    if (!trustedTenantMatches(record.tenantId, record.tenantId)) {
      noteDrop("missing_membership_tenant");
      return;
    }
    const bucket = reducer.bucketAt(record.tenantId, record.runId) ?? Date.parse(record.observedAt);
    await seedRun(record.tenantId, record.runId, bucket);
    const planned = index.plan(record);
    if (planned.action === "skip") {
      idempotencySkips += 1;
      return;
    }
    const filePath = evaluationFilePath({
      configDir,
      tenantId: planned.record.tenantId,
      runId: planned.record.runId,
      at: new Date(bucket),
    });
    const line = serializeRecord(planned.record);
    const pendingWrite = appendFile(filePath, line);
    try {
      await withTimeout(pendingWrite, writeTimeoutMs);
    } catch (error) {
      void pendingWrite.catch(() => undefined);
      const timedOut = error instanceof Error && error.message === "evaluation_write_timeout";
      noteDrop(timedOut ? "write_timeout" : "write_error");
      return;
    }
    index.adoptPersisted(planned.record);
    trackedRuns.add(planned.record.runId);
  };

  const processItem = async (item: QueueItem) => {
    if (stopped) {
      noteDrop("flag_off");
      return;
    }
    if (item.preset) {
      await writeRecord(item.preset);
      return;
    }
    try {
      const record = reducer.ingest(item.obs, now());
      if (item.breakReducer || options.breakRunIds?.has(item.obs.runId)) {
        throw new Error("reducer_error");
      }
      if (record) {
        await writeRecord(record);
      }
    } catch {
      noteDrop("consumer_error");
      const failed = reducer.fail(item.obs.trustedTenantId, item.obs.runId, now());
      if (failed) {
        await writeRecord(failed);
      }
    }
  };

  const pump = async () => {
    try {
      while (queue.length > 0) {
        if (stopped) {
          while (queue.length > 0) {
            const dropped = queue.shift();
            if (dropped) {
              queueBytes -= dropped.bytes;
            }
            noteDrop("flag_off");
          }
          break;
        }
        const item = queue.shift();
        if (!item) {
          break;
        }
        queueBytes -= item.bytes;
        await processItem(item);
      }
    } finally {
      running = false;
      if (queue.length > 0 && !stopped) {
        kick();
      } else {
        const waiters = flushWaiters.splice(0);
        for (const waiter of waiters) {
          waiter();
        }
      }
    }
  };

  const accept = (obs: ObservationInput, breakReducer = false) => {
    if (!enabled) {
      return;
    }
    noteObserved();
    if (!obs.trustedTenantId.trim()) {
      noteDrop("missing_membership_tenant");
      return;
    }
    if (isDiagnosticReplayRunId(obs.runId, obs.data)) {
      return;
    }
    rememberHint(obs);
    markTerminal(obs);
    const bytes = fnvByteLength(JSON.stringify(obs.data));
    enqueue({ obs, bytes: Math.max(1, bytes), breakReducer });
  };

  const observe = (input: ObservationInput) => {
    if (!enabled || stopped) {
      if (enabled && stopped) {
        noteDrop("flag_off");
      }
      return;
    }
    try {
      accept(input);
    } catch {
      noteDrop("consumer_error");
    }
  };

  if (enabled && subscribe) {
    unsub = onAgentEvent((evt: AgentEventPayload) => {
      if (stopped || heartbeat(evt.runId) || isDiagnosticReplayRunId(evt.runId, evt.data)) {
        return;
      }
      const trusted = resolveTenant(evt.runId);
      if (!trusted) {
        noteObserved();
        noteDrop("missing_membership_tenant");
        return;
      }
      const flags = visibleFlags(evt.stream, evt.data);
      observe({
        runId: evt.runId,
        ts: evt.ts,
        stream: evt.stream,
        ...(evt.sessionKey ? { sessionKey: evt.sessionKey } : {}),
        data: sanitizeData(evt.data),
        trustedTenantId: trusted,
        ...flags,
      });
    });
  }

  return {
    enabled,
    stop: () => {
      stopped = true;
      unsub?.();
      unsub = null;
      while (queue.length > 0) {
        const dropped = queue.shift();
        if (dropped) {
          queueBytes -= dropped.bytes;
        }
        noteDrop("flag_off");
      }
    },
    flush: () => {
      if (!running && queue.length === 0) {
        return denomChain;
      }
      return new Promise((resolve) => {
        flushWaiters.push(() => {
          void denomChain.then(() => resolve());
        });
      });
    },
    observe,
    observeWeak: (input) => {
      observe({
        runId: weakFallbackRunId(input),
        ts: input.ts,
        stream: "lifecycle",
        ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
        data: {
          phase: input.phase ?? "end",
          startedAt: input.startedAt,
          endedAt: input.ts,
        },
        trustedTenantId: input.trustedTenantId,
        linkQuality: "weak",
        conversationId: input.conversationId,
        agentId: input.agentId,
      });
    },
    reassess: (tenantId, runId) => {
      if (!enabled || stopped) {
        return;
      }
      const record = reducer.reassess(tenantId, runId, now());
      if (!record) {
        return;
      }
      noteObserved();
      enqueue({
        obs: {
          runId,
          ts: now(),
          stream: "lifecycle",
          data: {},
          trustedTenantId: tenantId,
        },
        bytes: 1,
        breakReducer: false,
        preset: record,
      });
    },
    getMetrics: () =>
      computeMetrics({
        denominator,
        records: [...trackedRuns]
          .map((runId) => index.current(runId))
          .filter((record): record is ConversationEvaluationRecord => record !== null),
        nowMs: now(),
        pendingSloMs,
      }),
    getDropCounts: () => ({ ...drops }),
    getIdempotencySkips: () => idempotencySkips,
    getDropAlert: () => {
      const cutoff = now() - A0_DROP_ALERT_WINDOW_MS;
      const recentDrops = dropTimes.filter((at) => at >= cutoff).length;
      const recentObserved = observedTimes.filter((at) => at >= cutoff).length;
      return isDropRateAlert(recentDrops, recentObserved);
    },
    current: (runId) => index.current(runId),
  };
}
