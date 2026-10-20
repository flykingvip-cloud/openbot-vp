/**
 * Builds the two read-only evolution perception RPC bodies.
 * Tenant stays on the trusted session. Outbound params never include
 * `tenantScope` or `sightings`.
 * Claim grade: runtime-enabled. Not production-proven.
 */

import { DEFAULT_EVOLUTION_PERCEPTION_INTENT } from "./copy.ts";
import {
  acceptEvolutionProject,
  acceptEvolutionQuery,
  evolutionPanelsFromSlices,
} from "./mapping.ts";
import type {
  EvolutionPerceptionPanels,
  EvolutionPerceptionProjectSlice,
  EvolutionPerceptionQueryView,
  EvolutionPerceptionWindow,
} from "./types.ts";

export const EVOLUTION_PERCEPTION_QUERY_METHOD = "evolution.perception.query";
export const EVOLUTION_PERCEPTION_PROJECT_METHOD = "evolution.perception.project";

export const EVOLUTION_PERCEPTION_METHODS = [
  EVOLUTION_PERCEPTION_QUERY_METHOD,
  EVOLUTION_PERCEPTION_PROJECT_METHOD,
] as const;

export type EvolutionPerceptionMethod = (typeof EVOLUTION_PERCEPTION_METHODS)[number];

const PROJECT_OPERATIONS = ["timeline", "digest", "pending", "automatic", "observation"] as const;

export type EvolutionPerceptionProjectOperation = (typeof PROJECT_OPERATIONS)[number];

const WINDOWED_PROJECT_OPERATIONS = new Set<EvolutionPerceptionProjectOperation>([
  "digest",
  "automatic",
]);

const OUTBOUND_KEYS = new Set(["intent", "operation", "window", "agentId"]);

export class EvolutionPerceptionClientError extends Error {
  readonly code: "forbidden_method" | "forbidden_param";

  constructor(code: "forbidden_method" | "forbidden_param", detail: string) {
    super(code === "forbidden_method" ? `不允许调用 ${detail}` : `不允许出站字段 ${detail}`);
    this.name = "EvolutionPerceptionClientError";
    this.code = code;
  }
}

export function isEvolutionPerceptionMethodAllowed(
  method: string,
): method is EvolutionPerceptionMethod {
  return (
    method === EVOLUTION_PERCEPTION_QUERY_METHOD || method === EVOLUTION_PERCEPTION_PROJECT_METHOD
  );
}

export type EvolutionPerceptionCall = {
  method: EvolutionPerceptionMethod;
  params: Record<string, unknown>;
};

export type EvolutionPerceptionTransport = {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
};

export type EvolutionPerceptionPhase =
  | { status: "offline" }
  | { status: "denied" }
  | { status: "untrusted" }
  | { status: "failed"; message: string }
  | { status: "loaded"; panels: EvolutionPerceptionPanels };

export type EvolutionPerceptionSnapshot = {
  window: EvolutionPerceptionWindow;
  phase: EvolutionPerceptionPhase;
  answer: EvolutionPerceptionQueryView | null;
  answerError: string | null;
  selectedIntent: string;
};

/** Inclusive window ending now, about 7 days, matching OpenBotKit `trailingDays`. */
export function evolutionPerceptionTrailingWindow(
  days: number,
  now: Date = new Date(),
): EvolutionPerceptionWindow {
  const spanMs = Math.max(days, 1) * 24 * 60 * 60 * 1000;
  const end = new Date(now.getTime());
  const start = new Date(end.getTime() - spanMs);
  return { from: start.toISOString(), to: end.toISOString() };
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function outboundParams(
  entries: Array<["intent" | "operation" | "window" | "agentId", unknown]>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (value === undefined) {
      continue;
    }
    if (!OUTBOUND_KEYS.has(key)) {
      throw new EvolutionPerceptionClientError("forbidden_param", key);
    }
    params[key] = value;
  }
  if ("tenantScope" in params || "sightings" in params) {
    throw new EvolutionPerceptionClientError(
      "forbidden_param",
      "tenantScope" in params ? "tenantScope" : "sightings",
    );
  }
  return params;
}

export function evolutionPerceptionQueryCall(input: {
  intent: string;
  window: EvolutionPerceptionWindow;
  agentId?: string | null;
}): EvolutionPerceptionCall {
  return {
    method: EVOLUTION_PERCEPTION_QUERY_METHOD,
    params: outboundParams([
      ["intent", input.intent],
      ["window", input.window],
      ["agentId", nonEmpty(input.agentId)],
    ]),
  };
}

export function evolutionPerceptionProjectCall(input: {
  operation: EvolutionPerceptionProjectOperation;
  window?: EvolutionPerceptionWindow | null;
  agentId?: string | null;
}): EvolutionPerceptionCall {
  return {
    method: EVOLUTION_PERCEPTION_PROJECT_METHOD,
    params: outboundParams([
      ["operation", input.operation],
      ["window", input.window ?? undefined],
      ["agentId", nonEmpty(input.agentId)],
    ]),
  };
}

/** Five projections. Timeline / pending / observation are unwindowed. */
export function evolutionPerceptionLoadPlan(input: {
  window: EvolutionPerceptionWindow;
  agentId?: string | null;
}): EvolutionPerceptionCall[] {
  return PROJECT_OPERATIONS.map((operation) =>
    evolutionPerceptionProjectCall({
      operation,
      window: WINDOWED_PROJECT_OPERATIONS.has(operation) ? input.window : null,
      agentId: input.agentId,
    }),
  );
}

/**
 * Default page load: five projections, then `learned_this_week`.
 * The chip title is 「本周变化」. No sightings.
 */
export function evolutionPerceptionRefreshPlan(input: {
  window: EvolutionPerceptionWindow;
  agentId?: string | null;
}): EvolutionPerceptionCall[] {
  return [
    ...evolutionPerceptionLoadPlan(input),
    evolutionPerceptionQueryCall({
      intent: DEFAULT_EVOLUTION_PERCEPTION_INTENT,
      window: input.window,
      agentId: input.agentId,
    }),
  ];
}

async function performCall(
  transport: EvolutionPerceptionTransport,
  call: EvolutionPerceptionCall,
): Promise<unknown> {
  if (!isEvolutionPerceptionMethodAllowed(call.method)) {
    throw new EvolutionPerceptionClientError("forbidden_method", call.method);
  }
  return transport.request(call.method, call.params);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the default refresh plan. Any denied slice denies the page.
 * Any untrusted slice closes the page. The weekly query is skipped after that.
 */
export async function refreshEvolutionPerception(input: {
  transport: EvolutionPerceptionTransport;
  window?: EvolutionPerceptionWindow;
  agentId?: string | null;
  now?: Date;
}): Promise<EvolutionPerceptionSnapshot> {
  const window = input.window ?? evolutionPerceptionTrailingWindow(7, input.now ?? new Date());
  const selectedIntent = DEFAULT_EVOLUTION_PERCEPTION_INTENT;
  try {
    const projectCalls = evolutionPerceptionLoadPlan({ window, agentId: input.agentId });
    const slices: EvolutionPerceptionProjectSlice[] = [];
    for (const call of projectCalls) {
      const payload = await performCall(input.transport, call);
      slices.push(acceptEvolutionProject(payload));
    }
    const panels = evolutionPanelsFromSlices(slices);
    if (panels.status === "denied" || panels.status === "untrusted") {
      return {
        window,
        phase: { status: panels.status },
        answer: null,
        answerError: null,
        selectedIntent,
      };
    }
    const asked = await askEvolutionPerception({
      transport: input.transport,
      intent: selectedIntent,
      window,
      agentId: input.agentId,
    });
    if (asked.status === "denied" || asked.status === "untrusted") {
      return {
        window,
        phase: { status: asked.status },
        answer: null,
        answerError: null,
        selectedIntent,
      };
    }
    if (asked.status === "failed") {
      return {
        window,
        phase: { status: "loaded", panels: panels.panels },
        answer: null,
        answerError: asked.message,
        selectedIntent,
      };
    }
    return {
      window,
      phase: { status: "loaded", panels: panels.panels },
      answer: asked.answer,
      answerError: null,
      selectedIntent,
    };
  } catch (error) {
    return {
      window,
      phase: { status: "failed", message: errorMessage(error) },
      answer: null,
      answerError: null,
      selectedIntent,
    };
  }
}

export async function askEvolutionPerception(input: {
  transport: EvolutionPerceptionTransport;
  intent: string;
  window: EvolutionPerceptionWindow;
  agentId?: string | null;
}): Promise<
  | { status: "denied" }
  | { status: "untrusted" }
  | { status: "failed"; message: string }
  | { status: "answer"; answer: EvolutionPerceptionQueryView }
> {
  try {
    const call = evolutionPerceptionQueryCall({
      intent: input.intent,
      window: input.window,
      agentId: input.agentId,
    });
    const payload = await performCall(input.transport, call);
    const view = acceptEvolutionQuery(payload);
    if (view.state === "denied") {
      return { status: "denied" };
    }
    if (view.state === "untrusted") {
      return { status: "untrusted" };
    }
    return { status: "answer", answer: view };
  } catch (error) {
    return { status: "failed", message: errorMessage(error) };
  }
}
