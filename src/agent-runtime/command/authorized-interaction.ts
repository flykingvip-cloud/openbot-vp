import type { createAuthorizedModelSession } from "../model/index.js";
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
  consume: () => Promise<T>,
) {
  try {
    params.input.abortSignal?.throwIfAborted();
    const gate = await ports.session.authorize(ports.authorization);
    params.input.abortSignal?.throwIfAborted();
    if (!gate.acquired && !gate.skipped) {
      return { kind: "respond" as const, text: gate.message, clarification: false };
    }
    ports.prepare(ports.session);
    return await consume();
  } finally {
    await ports.session.dispose();
  }
}

/** Interpretation only. Group state authority must apply its own admission afterward. */
export function runAuthorizedUnderstanding(params: Params, ports: UnderstandingPorts) {
  return withAuthorizedInteraction(params, ports, async () => ({
    kind: "understood" as const,
    decision: await interpretInteraction(
      params.input,
      createPreparedInteractionInference(params, ports.session, ports.candidate),
    ),
  }));
}

/** Interaction owns its model lease, but never starts an executor or a tool loop. */
export function runAuthorizedInteraction(
  params: Params,
  ports: UnderstandingPorts & {
    admission: Parameters<typeof runPreparedInteraction>[3];
  },
) {
  return withAuthorizedInteraction(params, ports, () =>
    runPreparedInteraction(params, ports.session, ports.candidate, ports.admission),
  );
}
