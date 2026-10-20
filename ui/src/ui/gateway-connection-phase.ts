/**
 * Control UI connection-phase labels.
 *
 * GatewayBrowserClient already reconnects with the existing backoff. This module
 * only classifies that activity for the chat banner: a short flap stays
 * "reconnecting", and a bounded run of transient closes without hello becomes
 * "gateway unreachable". Auth and pairing failures are not classified here.
 */

/** Transient closes that stay in the reconnecting banner before unreachable. */
export const GATEWAY_RECONNECTING_CLOSE_BUDGET = 6;

export const TRANSIENT_GATEWAY_CLOSE_CODES = [1012, 1006, 1001, 1005] as const;

export type GatewayConnectionPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "unreachable"
  | "blocked";

export type GatewayChatBanner =
  | { kind: "hidden" }
  | {
      kind: "status";
      messageKey:
        | "chat.connecting"
        | "chat.reconnecting"
        | "chat.gatewayUnreachable"
        | "chat.disconnected";
    };

export function isTransientGatewayClose(code: number): boolean {
  return (TRANSIENT_GATEWAY_CLOSE_CODES as readonly number[]).includes(code);
}

/**
 * Advance one silent transport close. Attempts within the budget stay
 * "reconnecting"; the next close latches "unreachable" until hello or a fresh
 * connectGateway() resets the counter. Backoff timing is unchanged.
 */
export function advanceTransientGatewayClose(priorAttempt: number | null | undefined): {
  reconnectAttempt: number;
  phase: "reconnecting" | "unreachable";
} {
  const reconnectAttempt = Math.max(0, priorAttempt ?? 0) + 1;
  return {
    reconnectAttempt,
    phase: reconnectAttempt > GATEWAY_RECONNECTING_CLOSE_BUDGET ? "unreachable" : "reconnecting",
  };
}

export function resolveGatewayChatBanner(params: {
  connected: boolean;
  phase: GatewayConnectionPhase | null | undefined;
}): GatewayChatBanner {
  if (params.connected) {
    return { kind: "hidden" };
  }
  switch (params.phase) {
    case "connecting":
      return { kind: "status", messageKey: "chat.connecting" };
    case "reconnecting":
      return { kind: "status", messageKey: "chat.reconnecting" };
    case "unreachable":
      return { kind: "status", messageKey: "chat.gatewayUnreachable" };
    case "blocked":
    case "idle":
    case "connected":
    default:
      // Sticky auth/pairing, logged-out, or not-yet-classified: keep today's copy.
      return { kind: "status", messageKey: "chat.disconnected" };
  }
}
