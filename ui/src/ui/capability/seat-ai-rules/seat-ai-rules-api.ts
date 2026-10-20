import { GatewayRequestError, type GatewayBrowserClient } from "../../gateway.ts";

export type SeatAiRuleView = {
  id: string;
  text: string;
};

export type SeatAiRulesLimits = {
  maxChars: number;
  maxTotalChars: number;
  maxCount: number;
};

/**
 * UI textarea maxlength slack above server maxChars.
 * Slightly looser so users can finish typing / paste, then see a server rejection
 * (server stays at 500/2000/8 + content-guard).
 */
export const SEAT_AI_RULES_UI_MAXLENGTH_SLACK = 200;

export function seatAiRulesUiMaxLength(maxChars: number): number {
  return maxChars + SEAT_AI_RULES_UI_MAXLENGTH_SLACK;
}

export type SeatAiRulesResponse = {
  tenantId: string;
  seatId: string;
  rules: SeatAiRuleView[];
  updatedAt: string | null;
  limits: SeatAiRulesLimits;
};

export type SeatAiRulesSaveInput = {
  id?: string;
  text: string;
};

export type SeatAiRulesRejection = {
  ruleId?: string;
  reason: string;
};

export class SeatAiRulesSaveError extends Error {
  readonly rejections: SeatAiRulesRejection[];

  constructor(message: string, rejections: SeatAiRulesRejection[]) {
    super(message);
    this.name = "SeatAiRulesSaveError";
    this.rejections = rejections;
  }
}

function readRejections(details: unknown): SeatAiRulesRejection[] {
  if (!details || typeof details !== "object") {
    return [];
  }
  const raw = (details as { rejections?: unknown }).rejections;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry): entry is SeatAiRulesRejection => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      ...(typeof entry.ruleId === "string" ? { ruleId: entry.ruleId } : {}),
      reason: typeof entry.reason === "string" ? entry.reason : "rejected",
    }));
}

export async function fetchSeatAiRules(
  client: GatewayBrowserClient,
): Promise<SeatAiRulesResponse | null> {
  try {
    return await client.request<SeatAiRulesResponse>("seat-rules.get", {});
  } catch {
    return null;
  }
}

export async function saveSeatAiRules(
  client: GatewayBrowserClient,
  rules: SeatAiRulesSaveInput[],
): Promise<SeatAiRulesResponse> {
  try {
    return await client.request<SeatAiRulesResponse>("seat-rules.set", { rules });
  } catch (err) {
    if (err instanceof GatewayRequestError) {
      throw new SeatAiRulesSaveError(err.message, readRejections(err.details));
    }
    throw err;
  }
}
