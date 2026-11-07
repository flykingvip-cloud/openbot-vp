import type { createAuthorizedModelSession } from "../model/index.js";
import { runPreparedInteraction } from "./prepared-interaction.js";

type ModelSession = ReturnType<typeof createAuthorizedModelSession>;

/** Interaction owns its model lease, but never starts an executor or a tool loop. */
export async function runAuthorizedInteraction(
  params: Parameters<typeof runPreparedInteraction>[0],
  ports: {
    session: ModelSession;
    authorization: Parameters<ModelSession["authorize"]>[0];
    prepare: (session: ModelSession) => void;
    candidate: Parameters<typeof runPreparedInteraction>[2];
    admission: Parameters<typeof runPreparedInteraction>[3];
  },
) {
  try {
    params.input.abortSignal?.throwIfAborted();
    const gate = await ports.session.authorize(ports.authorization);
    params.input.abortSignal?.throwIfAborted();
    if (!gate.acquired && !gate.skipped) {
      return { kind: "respond" as const, text: gate.message, clarification: false };
    }
    ports.prepare(ports.session);
    return await runPreparedInteraction(params, ports.session, ports.candidate, ports.admission);
  } finally {
    await ports.session.dispose();
  }
}
