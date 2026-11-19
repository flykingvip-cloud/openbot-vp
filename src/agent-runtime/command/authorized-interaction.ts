import type { createAuthorizedModelSession } from "../model/index.js";
import {
  createInteractionResourceBudget,
  formatInteractionFailureReply,
  isInteractionUserAbort,
  INTERACTION_QUEUE_TIMEOUT_TEXT,
  raceVisibleInteraction,
} from "../model/index.js";
import { respondIfRestrictedDecision } from "./interaction-sources.js";
import { interpretInteraction } from "./interpret-interaction.js";
import {
  runPreparedInteraction,
  createPreparedInteractionInference,
} from "./prepared-interaction.js";

type ModelSession = ReturnType<typeof createAuthorizedModelSession>;
type Params = Parameters<typeof runPreparedInteraction>[0];
type UnderstandingPorts = {
  session: ModelSession;
  authorization: Parameters<ModelSession["authorize"]>[0];
  prepare: (session: ModelSession) => void;
  candidate: Parameters<typeof runPreparedInteraction>[2];
};

/** Shared lease lifecycle. Scene-specific admission runs inside the same lease. */
async function withAuthorizedInteraction<T>(
  params: Params,
  ports: UnderstandingPorts,
  consume: (bounded: Params) => Promise<T>,
) {
  const resourceBudget =
    params.resourceBudget ?? createInteractionResourceBudget({ overrideMs: params.timeoutMs });
  const remainingMs = resourceBudget.remainingMs();
  const deadlineSignal =
    remainingMs <= 0
      ? AbortSignal.abort(Object.assign(new Error("timeout"), { name: "TimeoutError" }))
      : AbortSignal.timeout(remainingMs);
  const abortSignal = params.input.abortSignal
    ? AbortSignal.any([params.input.abortSignal, deadlineSignal])
    : deadlineSignal;
  const bounded: Params = {
    ...params,
    input: { ...params.input, abortSignal },
    resourceBudget,
  };

  type Visible = T | { kind: "respond"; text: string; clarification: false };
  const work: Promise<Visible> = (async () => {
    abortSignal.throwIfAborted();
    const gate = await ports.session.authorize(ports.authorization);
    // An explicitly managed caller must never consume a legacy skipped gate.
    // Do not resolve credentials or choose an alternative model after this denial.
    if (gate.skipped && ports.authorization.enterpriseId?.trim()) {
      return {
        kind: "respond" as const,
        text: "企业模型准入未完成，本轮未启动执行。请联系管理员检查模型授权。",
        clarification: false,
      };
    }
    if (!gate.acquired && !gate.skipped) {
      // A cooperative queue wait may settle slightly after the signal
      // due to poll interval; keep that factual gate result.
      const text =
        "reason" in gate && gate.reason === "CONCURRENCY_QUEUE_TIMEOUT"
          ? gate.message.trim() || INTERACTION_QUEUE_TIMEOUT_TEXT
          : gate.message;
      return { kind: "respond" as const, text, clarification: false };
    }
    abortSignal.throwIfAborted();
    ports.prepare(ports.session);
    return await consume(bounded);
  })();

  let visible: Visible;
  try {
    // Race the caller's cancel/deadline signal. A cooperative queue wait
    // already has its own bound and must be allowed to return that fact;
    // remainingMs is only a backstop when neither a caller signal nor a
    // queue wait bound exists. The bound signal still stops late admission.
    const callerSignal = params.input.abortSignal;
    const queueWaitBound = ports.authorization.queueMaxWaitMs;
    visible = await raceVisibleInteraction(work, {
      signal: callerSignal,
      remainingMs:
        callerSignal || (typeof queueWaitBound === "number" && queueWaitBound > 0)
          ? undefined
          : remainingMs,
    });
  } catch (error) {
    // Keep the background work attached so late usage/admission checks can run.
    void work.catch(() => undefined);
    if (isInteractionUserAbort(error)) {
      const cleanup = ports.session.dispose();
      void cleanup.catch(() => undefined);
      throw error;
    }
    visible = {
      kind: "respond" as const,
      text: formatInteractionFailureReply(error),
      clarification: false,
    };
  }

  // Cleanup must start now so a late acquire still releases once, but a
  // hanging release must not block the visible receipt.
  const cleanup = ports.session.dispose();
  void cleanup.catch(() => undefined);
  return visible;
}

/** Interpretation only. Group state authority must apply its own admission afterward. */
export function runAuthorizedUnderstanding(params: Params, ports: UnderstandingPorts) {
  return withAuthorizedInteraction(params, ports, async (bounded) => {
    const decision = await interpretInteraction(
      bounded.input,
      createPreparedInteractionInference(bounded, ports.session, ports.candidate),
    );
    const restricted = respondIfRestrictedDecision(bounded.input.availability, decision.kind);
    if (restricted) {
      return restricted;
    }
    return { kind: "understood" as const, decision };
  });
}

/** Interaction owns its model lease, but never starts an executor or a tool loop. */
export function runAuthorizedInteraction(
  params: Params,
  ports: UnderstandingPorts & {
    admission: Parameters<typeof runPreparedInteraction>[3];
  },
) {
  return withAuthorizedInteraction(params, ports, (bounded) =>
    runPreparedInteraction(bounded, ports.session, ports.candidate, ports.admission),
  );
}
