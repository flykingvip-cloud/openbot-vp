/**
 * AIExecutionTrace header propagator (VB-3). Default-off.
 * Official required keys from Team A AIExecutionTrace / v2.1 契约四.
 * Not wired into conversation-evaluation or Gateway routes in this wave.
 */
export const AI_EXECUTION_TRACE_HEADER_PROPAGATOR_ENABLED_DEFAULT = false;

export const AI_EXECUTION_TRACE_HEADER_KEYS = [
  "tenant_id",
  "user_id",
  "agent_id",
  "trace_id",
  "run_id",
  "plan_id",
  "policy_generation",
] as const;

export type AiExecutionTraceHeaderKey = (typeof AI_EXECUTION_TRACE_HEADER_KEYS)[number];

export type AiExecutionTraceHeaders = {
  tenant_id: string;
  user_id: string;
  agent_id: string;
  trace_id: string;
  run_id: string;
  plan_id: string;
  policy_generation: number;
};

export type AiExecutionTracePropagateResult =
  | { ok: true; headers: AiExecutionTraceHeaders; outgoing: Record<string, string> }
  | {
      ok: false;
      reason: "PROPAGATOR_DISABLED" | "MISSING_OR_INVALID_HEADER";
      missing: AiExecutionTraceHeaderKey[];
    };

function readHeader(
  input: Record<string, unknown>,
  key: AiExecutionTraceHeaderKey,
): string | number | undefined {
  if (key in input) {
    return input[key] as string | number;
  }
  // Accept camelCase from conversation-evaluation / runtime bags without inventing values.
  const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  if (camel in input) {
    return input[camel] as string | number;
  }
  return undefined;
}

export function createAiExecutionTraceHeaderPropagator(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? AI_EXECUTION_TRACE_HEADER_PROPAGATOR_ENABLED_DEFAULT;
  return {
    enabled,
    propagate(input: Record<string, unknown>): AiExecutionTracePropagateResult {
      if (!enabled) {
        return { ok: false, reason: "PROPAGATOR_DISABLED", missing: [] };
      }
      const missing: AiExecutionTraceHeaderKey[] = [];
      const bag: Partial<AiExecutionTraceHeaders> = {};
      for (const key of AI_EXECUTION_TRACE_HEADER_KEYS) {
        const value = readHeader(input, key);
        if (key === "policy_generation") {
          if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
            missing.push(key);
          } else {
            bag.policy_generation = value;
          }
        } else if (typeof value !== "string" || !value.trim()) {
          missing.push(key);
        } else {
          (bag as Record<string, string>)[key] = value;
        }
      }
      if (missing.length) {
        return { ok: false, reason: "MISSING_OR_INVALID_HEADER", missing };
      }
      const headers = bag as AiExecutionTraceHeaders;
      const outgoing = {
        "x-openbot-tenant-id": headers.tenant_id,
        "x-openbot-user-id": headers.user_id,
        "x-openbot-agent-id": headers.agent_id,
        "x-openbot-trace-id": headers.trace_id,
        "x-openbot-run-id": headers.run_id,
        "x-openbot-plan-id": headers.plan_id,
        "x-openbot-policy-generation": String(headers.policy_generation),
      };
      return { ok: true, headers, outgoing };
    },
  };
}
