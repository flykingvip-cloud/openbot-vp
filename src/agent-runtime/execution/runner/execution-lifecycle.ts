import type { OpenBotConfig } from "../../../config/config.js";
import { createAuthorizedModelSession } from "../../model/index.js";
import type { AdmittedTurnHost } from "./admitted-turn-host.js";
import { createExecutionScope } from "./execution-scope.js";

type Session = ReturnType<typeof createAuthorizedModelSession>;
type Host = Pick<AdmittedTurnHost, "admission" | "model" | "accounting">;

/** Shared execution admission, routing and provider-session lifetime.
 * Scene adapters retain task ownership, candidate parameters and delivery.
 * This is host code, never executable configuration or a new scheduler. */
export function createExecutionLifecycle(runId: string, host: Host) {
  const session = createAuthorizedModelSession(runId, host);
  const scope = createExecutionScope({
    async prepare(input: {
      config: OpenBotConfig;
      authorization: Parameters<Session["authorize"]>[0];
      actorId?: string;
      signal?: AbortSignal;
    }) {
      input.signal?.throwIfAborted();
      const admission = await session.authorize(input.authorization);
      input.signal?.throwIfAborted();
      if (!admission.acquired && !admission.skipped) {
        return { kind: "denied" as const, message: admission.message };
      }
      const gate = session.gate;
      const routing = host.model.resolveExecutionRoutingFromCapabilityPlan({
        allowlist: gate?.allowlist,
        preferredModelOrder: gate?.preferredModelOrder,
        capabilityPlan: gate?.capabilityPlan,
      });
      const capability = host.model.consumeCapabilityRoutingResult({
        planFailure: routing.planFailure,
        outcomeClaim: routing.outcomeClaim,
        executionSurface: routing.executionSurface,
        capabilityPlan: routing.capabilityPlan,
      });
      if (routing.planFailure.kind === "no_executable_candidates") {
        return {
          kind: "unavailable" as const,
          gate,
          capability,
          message: routing.planFailure.message,
        };
      }
      session.prepareModelSet({ config: input.config, actorId: input.actorId, routing });
      input.signal?.throwIfAborted();
      return { kind: "ready" as const, gate, capability };
    },
    infer<T>(input: Parameters<typeof session.infer<T>>[0]) {
      return session.infer(input);
    },
    dispose() {
      return session.dispose();
    },
  });
  return {
    ...scope,
    recordUsage(input: Parameters<Session["recordUsage"]>[0]) {
      return session.recordUsage(input);
    },
  };
}
