/** Join interaction interpretation to prepared shared inference; never starts task execution. */
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import type { OpenBotConfig } from "../../config/config.js";
import type { InteractionModelInput } from "../contracts/interaction.js";
import { invokeInteractionCompletion, type createAuthorizedModelSession } from "../model/index.js";
import { interpretInteraction } from "./interpret-interaction.js";

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
) {
  return interpretInteraction(params.input, {
    infer: async (input) => {
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
  });
}
