import type { ChatCapabilityEventPayload } from "../capability/chat/index.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  DEFAULT_THRESHOLDS,
  evaluatePatternHint,
  getActiveHints,
  processIncomingHint,
  type PatternDetectionHint,
  type PatternDetectionState,
  type PatternSignal,
} from "./pattern-detection.ts";

export type AssetSuggestionTriggerSource =
  | "assistant-task-complete"
  | "group-task-complete"
  | "manual-iteration";

export type AssetSuggestionDecision = {
  shouldSuggest: boolean;
  source: AssetSuggestionTriggerSource;
  label: string;
  contextId: string | null;
  hint?: PatternDetectionHint;
};

export type AssetSuggestionPatternRuntime = {
  state: PatternDetectionState;
  aggregatedHintsByScope: Map<string, PatternDetectionHint>;
  /** Chat finals ingested per session scope — drives L3 recurrence evidence */
  ingestCountByScope: Map<string, number>;
};

const patternRuntimes = new WeakMap<object, AssetSuggestionPatternRuntime>();
const STORAGE_KEY = "openbot.asset-suggestion-patterns.v1";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractMessageText(payload?: ChatCapabilityEventPayload): string {
  const record = asRecord(payload?.message);
  if (!record) {
    return "";
  }
  if (typeof record.text === "string") {
    return record.text.trim();
  }
  const content = Array.isArray(record.content) ? record.content : [];
  return content
    .map((entry) => {
      const part = asRecord(entry);
      return part?.type === "text" && typeof part.text === "string" ? part.text.trim() : "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Build structural signals from one chat final.
 * sampleCount is always 1 per observation — never fabricate "3 times".
 * Independent-task evidence is accumulated by mergeHintsByScope / server ingest.
 */
function buildSignalsFromText(text: string, hasArtifact: boolean): PatternSignal[] {
  const now = Date.now();
  const normalized = text.trim();
  const signals: PatternSignal[] = [];
  if (/任务完成总结/.test(normalized)) {
    signals.push({
      kind: "repeated_task",
      description: "任务完成后形成了可总结的稳定任务结果",
      confidence: 0.76,
      detectedAt: now,
      sampleCount: 1,
    });
  }
  if (/^#{1,6}\s+\S/m.test(normalized) || /^\s*\d+[.、]\s+\S/m.test(normalized)) {
    signals.push({
      kind: "stable_io",
      description: "输出结构具有明确标题或编号列表",
      confidence: 0.8,
      detectedAt: now,
      sampleCount: 1,
    });
  }
  if (/^\s*[-*]\s+\S/m.test(normalized)) {
    signals.push({
      kind: "stable_io",
      description: "输出结构具有稳定条目清单",
      confidence: 0.72,
      detectedAt: now,
      sampleCount: 1,
    });
  }
  if (/(流程|步骤|依次|先.+再.+|workflow)/i.test(normalized)) {
    signals.push({
      kind: "fixed_workflow",
      description: "结果中存在固定步骤或流程表达",
      confidence: 0.78,
      detectedAt: now,
      sampleCount: 1,
    });
  }
  if (/(模版|模板|template|周报|纪要|复盘|方案|报告|文档|草稿|知识)/i.test(normalized)) {
    signals.push({
      kind: "stable_prompt",
      description: "结果明显指向可复用模版或知识产物",
      confidence: 0.74,
      detectedAt: now,
      sampleCount: 1,
    });
  }
  if (hasArtifact) {
    signals.push({
      kind: "stable_io",
      description: "任务产出了可独立承接的交付物",
      confidence: 0.88,
      detectedAt: now,
      sampleCount: 1,
    });
  }
  return signals;
}

function canUseStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function loadPersistedPatternHints(): Map<string, PatternDetectionHint> {
  if (!canUseStorage()) {
    return new Map();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return new Map();
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = Object.entries(parsed).flatMap(([key, value]) => {
      const record = asRecord(value);
      if (!record) {
        return [];
      }
      const hint = {
        agentId: stringValue(record.agentId),
        contextId: stringValue(record.contextId),
        signals: Array.isArray(record.signals)
          ? record.signals
              .map((entry) => {
                const signal = asRecord(entry);
                if (!signal) {
                  return null;
                }
                const kind = stringValue(signal.kind) as PatternSignal["kind"];
                if (!kind) {
                  return null;
                }
                return {
                  kind,
                  description: stringValue(signal.description),
                  confidence: typeof signal.confidence === "number" ? signal.confidence : 0,
                  detectedAt: typeof signal.detectedAt === "number" ? signal.detectedAt : 0,
                  sampleCount: typeof signal.sampleCount === "number" ? signal.sampleCount : 0,
                } satisfies PatternSignal;
              })
              .filter((entry): entry is PatternSignal => entry !== null)
          : [],
        overallConfidence:
          typeof record.overallConfidence === "number" ? record.overallConfidence : 0,
        suggestedName: stringValue(record.suggestedName),
        suggestedSummary: stringValue(record.suggestedSummary),
      } satisfies PatternDetectionHint;
      return key.trim() ? [[key, hint] as const] : [];
    });
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function persistPatternHints(hints: Map<string, PatternDetectionHint>): void {
  if (!canUseStorage()) {
    return;
  }
  try {
    const payload = Object.fromEntries(hints.entries());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // best-effort
  }
}

function createPatternRuntime(
  client: GatewayBrowserClient | null,
  connected: boolean,
): AssetSuggestionPatternRuntime {
  const aggregatedHintsByScope = loadPersistedPatternHints();
  return {
    state: {
      client,
      connected,
      pendingHints: [...aggregatedHintsByScope.values()],
      dismissedContextIds: new Set(),
      thresholds: DEFAULT_THRESHOLDS,
    },
    aggregatedHintsByScope,
    ingestCountByScope: new Map(),
  };
}

export function ensureAssetSuggestionPatternRuntime(
  owner: object,
  client: GatewayBrowserClient | null,
  connected: boolean,
): AssetSuggestionPatternRuntime {
  const existing = patternRuntimes.get(owner);
  if (existing) {
    existing.state.client = client;
    existing.state.connected = connected;
    return existing;
  }
  const runtime = createPatternRuntime(client, connected);
  patternRuntimes.set(owner, runtime);
  return runtime;
}

function mergeSignals(left: PatternSignal, right: PatternSignal): PatternSignal {
  return {
    kind: left.kind,
    description: left.description || right.description,
    confidence: Math.max(left.confidence, right.confidence),
    detectedAt: Math.max(left.detectedAt, right.detectedAt),
    // Sum independent observations (each ingest contributes sampleCount, typically 1).
    sampleCount: left.sampleCount + right.sampleCount,
  };
}

function mergeHintsByScope(
  scopeKey: string,
  previous: PatternDetectionHint | undefined,
  incoming: PatternDetectionHint,
): PatternDetectionHint {
  if (!previous) {
    return incoming;
  }
  const signalMap = new Map<PatternSignal["kind"], PatternSignal>();
  for (const signal of previous.signals) {
    signalMap.set(signal.kind, signal);
  }
  for (const signal of incoming.signals) {
    const existing = signalMap.get(signal.kind);
    signalMap.set(signal.kind, existing ? mergeSignals(existing, signal) : signal);
  }
  const signals = [...signalMap.values()];
  const overallConfidence =
    signals.length > 0
      ? signals.reduce((sum, signal) => sum + signal.confidence, 0) / signals.length
      : 0;
  return {
    ...incoming,
    contextId: incoming.contextId,
    signals,
    overallConfidence,
  };
}

function buildHintFromChatFinal(payload: ChatCapabilityEventPayload): PatternDetectionHint | null {
  const sessionKey = stringValue(payload.sessionKey);
  if (!sessionKey) {
    return null;
  }
  const messageRecord = asRecord(payload.message);
  const directArtifactId = stringValue(messageRecord?.artifactId);
  const text = extractMessageText(payload);
  const signals = buildSignalsFromText(text, Boolean(directArtifactId));
  if (signals.length === 0) {
    return null;
  }
  const overallConfidence =
    signals.reduce((sum, signal) => sum + signal.confidence, 0) / signals.length;
  return {
    agentId: sessionKey.startsWith("space:") ? "group-supervisor" : "assistant-runtime",
    contextId: directArtifactId || sessionKey,
    signals,
    overallConfidence,
    suggestedName: sessionKey.startsWith("space:") ? "协作结果沉淀" : "任务结果沉淀",
    suggestedSummary: sessionKey.startsWith("space:")
      ? "将协作小组本次任务中的稳定做法整理为可复用资产"
      : "将本次机器人任务中的稳定做法整理为可复用资产",
  };
}

function ingestChatFinalHint(
  runtime: AssetSuggestionPatternRuntime | undefined,
  payload: ChatCapabilityEventPayload,
): PatternDetectionHint | null {
  const incoming = buildHintFromChatFinal(payload);
  if (!incoming) {
    return null;
  }
  if (!runtime) {
    return incoming;
  }
  const scopeKey = stringValue(payload.sessionKey);
  const merged = mergeHintsByScope(
    scopeKey,
    runtime.aggregatedHintsByScope.get(scopeKey),
    incoming,
  );
  runtime.aggregatedHintsByScope.set(scopeKey, merged);
  runtime.ingestCountByScope.set(scopeKey, (runtime.ingestCountByScope.get(scopeKey) ?? 0) + 1);
  persistPatternHints(runtime.aggregatedHintsByScope);
  processIncomingHint(runtime.state, merged);
  return merged;
}

function isServerAuthoritativeHint(hint: PatternDetectionHint): boolean {
  return hint.contextId.startsWith("pc_");
}

export function decideAssetSuggestionFromChatFinal(
  payload: ChatCapabilityEventPayload | undefined,
  runtime?: AssetSuggestionPatternRuntime,
): AssetSuggestionDecision {
  const sessionKey = stringValue(payload?.sessionKey);
  const source: AssetSuggestionTriggerSource = sessionKey.startsWith("space:")
    ? "group-task-complete"
    : "assistant-task-complete";
  if (!payload || payload.state !== "final" || !sessionKey) {
    return {
      shouldSuggest: false,
      source,
      label: "",
      contextId: null,
    };
  }
  const hint = ingestChatFinalHint(runtime, payload);
  const activeHint = runtime
    ? getActiveHints(runtime.state).find(
        (entry) => entry.contextId === hint?.contextId || entry.contextId === sessionKey,
      )
    : null;
  const effectiveHint = activeHint ?? hint;
  const gatewayConnected = Boolean(runtime?.state?.connected);
  const shouldSuggest = effectiveHint
    ? gatewayConnected
      ? isServerAuthoritativeHint(effectiveHint) &&
        evaluatePatternHint(effectiveHint, DEFAULT_THRESHOLDS)
      : evaluatePatternHint(effectiveHint, DEFAULT_THRESHOLDS)
    : false;
  return {
    shouldSuggest,
    source,
    label:
      source === "group-task-complete"
        ? "协作小组刚完成一项任务，系统建议整理其中可复用的资产。"
        : "这次机器人任务已完成，系统建议整理其中可复用的资产。",
    contextId: effectiveHint?.contextId ?? null,
    hint: effectiveHint ?? undefined,
  };
}

export function decideAssetSuggestionFromManualIteration(params: {
  capabilityId: string;
  capabilityName: string;
}): AssetSuggestionDecision {
  const capabilityId = params.capabilityId.trim();
  const capabilityName = params.capabilityName.trim();
  // Explicit human action — do not fabricate multi-task sampleCount; surface CTA directly.
  const hint: PatternDetectionHint | null = capabilityId
    ? {
        agentId: "employee-workbench",
        contextId: `manual:${capabilityId}`,
        signals: [
          {
            kind: "stable_prompt",
            description: "员工对资产进行了主动整理和补全",
            confidence: 0.78,
            detectedAt: Date.now(),
            sampleCount: 1,
          },
        ],
        overallConfidence: 0.78,
        suggestedName: capabilityName || "资产草稿",
        suggestedSummary: "该资产已被整理，适合继续固化为更稳定版本",
      }
    : null;
  return {
    shouldSuggest: Boolean(hint),
    source: "manual-iteration",
    label: `${capabilityName || "当前资产"} 已更新，可继续整理为更稳定的资产版本`,
    contextId: capabilityId || null,
    hint: hint ?? undefined,
  };
}
