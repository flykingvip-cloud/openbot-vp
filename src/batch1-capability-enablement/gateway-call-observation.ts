/**
 * callGateway resolves with the RPC payload and throws on transport/RPC errors.
 * The payload for chat.send is typically { runId, status } and does not include
 * ok:true. Interpreting payload.ok === true as the only success signal marks
 * successful sends as failed and poisons the evidence summary.
 */
export type GatewayCallObservation = {
  ok: boolean;
  error: string | null;
  payload: Record<string, unknown> | null;
  runId: string | null;
  status: string | null;
};

function errorText(error: unknown): string | null {
  if (error == null) {
    return null;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "unserializable error";
  }
}

export function observationFromCallGatewayPayload(payload: unknown): GatewayCallObservation {
  const record =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  if (record && record.ok === false) {
    return {
      ok: false,
      error: errorText(record.error) ?? "gateway call returned ok=false",
      payload: record,
      runId: typeof record.runId === "string" ? record.runId : null,
      status: typeof record.status === "string" ? record.status : null,
    };
  }
  return {
    ok: true,
    error: null,
    payload: record,
    runId: typeof record?.runId === "string" ? record.runId : null,
    status: typeof record?.status === "string" ? record.status : null,
  };
}

export function observationFromCallGatewayError(caught: unknown): GatewayCallObservation {
  return {
    ok: false,
    error: errorText(caught) ?? String(caught),
    payload: null,
    runId: null,
    status: null,
  };
}

export function messageCountFromHistoryPayload(payload: unknown): number {
  if (!payload || typeof payload !== "object") {
    return 0;
  }
  const messages = (payload as { messages?: unknown }).messages;
  return Array.isArray(messages) ? messages.length : 0;
}
