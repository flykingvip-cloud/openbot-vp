import type { GatewayBrowserClient } from "../../gateway.ts";

export type SeatDrillAsk = "off" | "on-miss" | "always";
export type SeatDrillSecurity = "deny" | "allowlist" | "full";
export type SeatDrillOutcome = "allow" | "deny" | "tighten";

export type SeatDrillResponse = {
  tenantId: string;
  seatId: string;
  command: string;
  ceiling: { ask: SeatDrillAsk; security: SeatDrillSecurity; host: string };
  effective: { ask: SeatDrillAsk; security: SeatDrillSecurity };
  outcome: SeatDrillOutcome;
  decision: "ALLOW" | "DENY" | "MODIFY";
  reason: string | null;
  matchedRules: string[];
  relaxation: boolean;
  wouldRequireApprovalIfExecuted: boolean;
  preAuthorization: false;
  persisted: false;
  note: string;
};

export async function runSeatDrill(
  client: GatewayBrowserClient,
  params?: { command?: string },
): Promise<SeatDrillResponse | null> {
  try {
    return await client.request<SeatDrillResponse>("seat-rules.drill", params ?? {});
  } catch {
    return null;
  }
}
