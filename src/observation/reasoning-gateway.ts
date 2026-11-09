/** Gateway-callable metadata-only side pass. No model selection, config writes or task authority. */
import { z } from "zod";
import {
  runReasoningPass,
  type ReasoningInput,
  type ReasoningModelPort,
} from "./reasoning-pass.js";
const id = z.string().trim().min(1).max(256);
const inputSchema = z.object({
  evidence: z
    .array(
      z.object({
        evidenceId: id,
        layer: z.enum(["resource", "technical", "execution", "business"]),
        status: z.enum(["present", "partial", "unknown"]),
        reasonCodes: z.array(id).max(64),
      }),
    )
    .min(1)
    .max(200),
  findings: z
    .array(
      z.object({
        findingId: id,
        source: z.literal("rule_v1"),
        evidenceIds: z.array(id).max(200),
        code: id,
      }),
    )
    .max(100),
});
const requestSchema = z.object({ requested: z.literal(true) }).strict();
export type ReasoningAuthorization = {
  identityRef: string;
  scopeRef: string;
  grantVersion: string;
};
/** All ports are server composition-root dependencies, never accepted from RPC parameters. */
export function createReasoningGatewayAdapter(ports: {
  enabled?: boolean;
  authorize: () => Promise<ReasoningAuthorization | null>;
  readEvidence: () => Promise<ReasoningInput>;
  model?: ReasoningModelPort;
  modelRef?: string;
  timeoutMs?: number;
}) {
  return async (request: unknown) => {
    const fallback = (reason: string) => ({
      ok: true as const,
      reasoningPass: { scoringMethod: "rule_v1" as const, items: [], reason },
    });
    if (request === undefined) {
      return fallback("reasoning_not_requested");
    }
    if (!requestSchema.safeParse(request).success) {
      return { ok: false as const, code: "invalid_reasoning_request" };
    }
    if (!ports.enabled) {
      return fallback("reasoning_disabled");
    }
    const unauthorized = () => ({ ok: false as const, code: "unauthorized" });
    try {
      const auth = await ports.authorize();
      if (
        !auth ||
        ![auth.identityRef, auth.scopeRef, auth.grantVersion].every(
          (v) => typeof v === "string" && v.trim(),
        )
      ) {
        return unauthorized();
      }
      const key = JSON.stringify([auth.identityRef, auth.scopeRef, auth.grantVersion]);
      const stillAuthorized = async () => {
        const current = await ports.authorize();
        return (
          current !== null &&
          JSON.stringify([current.identityRef, current.scopeRef, current.grantVersion]) === key
        );
      };
      const raw = await ports.readEvidence();
      if (!(await stillAuthorized())) {
        return unauthorized();
      }
      const parsed = inputSchema.safeParse(raw);
      if (!parsed.success) {
        return fallback("reasoning_evidence_invalid");
      }
      const safe = parsed.data;
      const ids = new Set(safe.evidence.map((e) => e.evidenceId));
      if (
        ids.size !== safe.evidence.length ||
        new Set(safe.findings.map((f) => f.findingId)).size !== safe.findings.length ||
        safe.findings.some((f) => f.evidenceIds.some((ref) => !ids.has(ref)))
      ) {
        return fallback("reasoning_evidence_invalid");
      }
      // Evidence is frozen before any model await; unknown extra body fields are stripped above.
      const result = await runReasoningPass(safe, {
        enabled: true,
        model: ports.model,
        modelRef: ports.modelRef,
        timeoutMs: ports.timeoutMs,
      });
      if (!(await stillAuthorized())) {
        return unauthorized();
      }
      return { ok: true as const, reasoningPass: result };
    } catch {
      return fallback("reasoning_adapter_unavailable");
    }
  };
}
