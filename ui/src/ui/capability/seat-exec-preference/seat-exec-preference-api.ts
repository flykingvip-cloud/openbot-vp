import type { GatewayBrowserClient } from "../../gateway.ts";

export type SeatExecAsk = "off" | "on-miss" | "always";
export type SeatExecSecurity = "deny" | "allowlist" | "full";

export type SeatExecPreferenceResponse = {
  tenantId: string;
  seatId: string;
  ceiling: { ask: SeatExecAsk; security: SeatExecSecurity; host: string };
  preference: { ask: SeatExecAsk | null; security: SeatExecSecurity | null };
  effective: { ask: SeatExecAsk; security: SeatExecSecurity };
  allowed: { ask: SeatExecAsk[]; security: SeatExecSecurity[] };
};

export async function fetchSeatExecPreference(
  client: GatewayBrowserClient,
): Promise<SeatExecPreferenceResponse | null> {
  try {
    return await client.request<SeatExecPreferenceResponse>("seat-rules.get-exec-preference", {});
  } catch {
    return null;
  }
}

export async function saveSeatExecPreference(
  client: GatewayBrowserClient,
  patch: { ask?: SeatExecAsk | null; security?: SeatExecSecurity | null },
): Promise<SeatExecPreferenceResponse | null> {
  try {
    return await client.request<SeatExecPreferenceResponse>(
      "seat-rules.set-exec-preference",
      patch,
    );
  } catch {
    return null;
  }
}
