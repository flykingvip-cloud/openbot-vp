/** Join interaction interpretation to prepared shared inference; never starts task execution. */
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type { OpenBotConfig } from "../../config/config.js";
import type { InteractionModelInput } from "../contracts/interaction.js";
import { invokeInteractionCompletion, type createAuthorizedModelSession } from "../model/index.js";
import { routeInteraction } from "./route-interaction.js";

export async function runPreparedInteraction(
  params: {
    input: InteractionModelInput;
    config: OpenBotConfig;
    provider: string;
    model: string;
    agentDir?: string;
    agentId?: string;
    creditUserId?: string;
    fallbacksOverride?: string[];
    timeoutMs: number;
    maxTokens: number;
  },
  session: ReturnType<typeof createAuthorizedModelSession>,
  resolveCandidate: (
    provider: string,
    model: string,
  ) => Promise<{ model: Model<Api>; apiKey?: string }>,
  admission: {
    captured: Parameters<typeof routeInteraction>[1];
    ports: Parameters<typeof routeInteraction>[2]["admission"];
  },
) {
  const inference = {
    infer: async (input: InteractionModelInput) => {
      const started = Date.now();
      const result = await session.infer({
        cfg: params.config,
        provider: params.provider,
        model: params.model,
        agentDir: params.agentDir,
        fallbacksOverride: params.fallbacksOverride,
        taskText: input.message,
        signal: input.abortSignal,
        run: async (provider, model) => {
          const candidate = await resolveCandidate(provider, model);
          return invokeInteractionCompletion({
            input,
            ...candidate,
            timeoutMs: params.timeoutMs,
            maxTokens: params.maxTokens,
          });
        },
      });
      await session.recordUsage({
        provider: result.provider,
        model: result.model,
        usage: result.result.response.usage,
        agentId: params.agentId,
        creditUserId: params.creditUserId,
        durationMs: Date.now() - started,
        toolCallCount: 0,
        toolClasses: [],
        fallbackAttemptsRaw: result.attempts,
      });
      return result.result.readDecision();
    },
  };
  // Route the same completion, never run a second classification inference.
  return routeInteraction(params.input, admission.captured, {
    inference,
    admission: admission.ports,
  });
}
