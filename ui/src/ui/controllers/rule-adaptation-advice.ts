import {
  EMPLOYEE_ADVICE_CANCEL_METHOD,
  EMPLOYEE_ADVICE_METHOD,
  type EmployeeAdviceView,
  type RuleAdaptationAdvicePanelModel,
} from "../chat/rule-adaptation-advice-panel.ts";
import { requestOpenBotAppRerender } from "../request-app-rerender.ts";

type GatewayRequestClient = {
  request: (method: string, params?: unknown, timeoutMs?: number) => Promise<unknown>;
};

export type RuleAdaptationAdviceRequestInput = {
  client: GatewayRequestClient | null;
  question: string;
  sessionKey?: string;
  agentId?: string;
};

const INITIAL: RuleAdaptationAdvicePanelModel & {
  generation: number;
  abort: AbortController | null;
  requestId: string | null;
  client: GatewayRequestClient | null;
} = {
  status: "idle",
  result: null,
  error: null,
  generation: 0,
  abort: null,
  requestId: null,
  client: null,
};

let panel = { ...INITIAL };

function publish() {
  requestOpenBotAppRerender();
}

function isAdviceView(value: unknown): value is EmployeeAdviceView {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.state === "string" &&
    typeof record.label === "string" &&
    record.notEffective === true &&
    record.activationAllowed === false &&
    typeof record.summary === "string"
  );
}

function readAdvicePayload(value: unknown): EmployeeAdviceView | null {
  if (isAdviceView(value)) {
    return value;
  }
  if (typeof value === "object" && value !== null && "advice" in value) {
    const advice = (value as { advice?: unknown }).advice;
    return isAdviceView(advice) ? advice : null;
  }
  return null;
}

export function getRuleAdaptationAdvicePanel(): RuleAdaptationAdvicePanelModel {
  return { status: panel.status, result: panel.result, error: panel.error };
}

export function isRuleAdaptationAdviceInFlight(): boolean {
  return panel.status === "loading";
}

function notifyServerCancel(client: GatewayRequestClient | null, requestId: string | null) {
  if (!client || !requestId) {
    return;
  }
  void client.request(EMPLOYEE_ADVICE_CANCEL_METHOD, { requestId }).catch(() => {
    // Soft-failure: hiding the panel must not start a retry of the advice itself.
  });
}

export function resetRuleAdaptationAdvicePanel() {
  const { abort, client, requestId } = panel;
  abort?.abort();
  if (panel.status === "loading") {
    notifyServerCancel(client, requestId);
  }
  panel = {
    ...INITIAL,
    generation: panel.generation + 1,
    abort: null,
    requestId: null,
    client: null,
  };
  publish();
}

export function cancelRuleAdaptationAdvice() {
  if (panel.status !== "loading") {
    return;
  }
  const { abort, client, requestId } = panel;
  abort?.abort();
  notifyServerCancel(client, requestId);
  panel = {
    status: "cancelled",
    result: null,
    error: null,
    generation: panel.generation + 1,
    abort: null,
    requestId: null,
    client: null,
  };
  publish();
}

export async function requestRuleAdaptationAdvice(input: RuleAdaptationAdviceRequestInput) {
  if (panel.status === "loading") {
    return;
  }
  if (!input.client) {
    panel = {
      ...panel,
      status: "failed",
      result: null,
      error: "未连接网关，无法请求规则适配建议。",
      abort: null,
      requestId: null,
      client: null,
    };
    publish();
    return;
  }
  const generation = panel.generation + 1;
  const abort = new AbortController();
  const requestId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `advice-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  panel = {
    status: "loading",
    result: null,
    error: null,
    generation,
    abort,
    requestId,
    client: input.client,
  };
  publish();

  try {
    const payload = await input.client.request(
      EMPLOYEE_ADVICE_METHOD,
      {
        question: input.question,
        requestId,
        targetRef: {
          ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
          ...(input.agentId ? { agentId: input.agentId } : {}),
        },
      },
      60_000,
    );
    if (abort.signal.aborted || panel.generation !== generation) {
      return;
    }
    const result = readAdvicePayload(payload);
    if (!result) {
      panel = {
        status: "failed",
        result: null,
        error: "本次建议请求失败，已有聊天与原任务未改动。",
        generation,
        abort: null,
        requestId: null,
        client: null,
      };
      publish();
      return;
    }
    panel = {
      status: "result",
      result,
      error: null,
      generation,
      abort: null,
      requestId: null,
      client: null,
    };
    publish();
  } catch (error) {
    if (abort.signal.aborted || panel.generation !== generation) {
      return;
    }
    const message =
      error instanceof Error ? error.message : "本次建议请求失败，已有聊天与原任务未改动。";
    panel = {
      status: "failed",
      result: null,
      error: message,
      generation,
      abort: null,
      requestId: null,
      client: null,
    };
    publish();
  }
}

export const ruleAdaptationAdviceClientContract = {
  method: EMPLOYEE_ADVICE_METHOD,
  cancelMethod: EMPLOYEE_ADVICE_CANCEL_METHOD,
  allowedKeys: ["question", "targetRef", "requestId"] as const,
};
