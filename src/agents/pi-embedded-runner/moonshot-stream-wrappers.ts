import type { StreamFn } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { ThinkLevel } from "../../auto-reply/thinking.js";

type MoonshotThinkingType = "enabled" | "disabled";

function normalizeMoonshotThinkingType(value: unknown): MoonshotThinkingType | undefined {
  if (typeof value === "boolean") {
    return value ? "enabled" : "disabled";
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["enabled", "enable", "on", "true"].includes(normalized)) {
      return "enabled";
    }
    if (["disabled", "disable", "off", "false"].includes(normalized)) {
      return "disabled";
    }
    return undefined;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return normalizeMoonshotThinkingType((value as Record<string, unknown>).type);
  }
  return undefined;
}

function isMoonshotToolChoiceCompatible(toolChoice: unknown): boolean {
  if (toolChoice == null || toolChoice === "auto" || toolChoice === "none") {
    return true;
  }
  if (typeof toolChoice === "object" && !Array.isArray(toolChoice)) {
    const typeValue = (toolChoice as Record<string, unknown>).type;
    return typeValue === "auto" || typeValue === "none";
  }
  return false;
}

export function shouldApplySiliconFlowThinkingOffCompat(params: {
  provider: string;
  modelId: string;
  thinkingLevel?: ThinkLevel;
}): boolean {
  return (
    params.provider === "siliconflow" &&
    params.thinkingLevel === "off" &&
    params.modelId.startsWith("Pro/")
  );
}

export function createSiliconFlowThinkingWrapper(baseStreamFn: StreamFn | undefined): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    const originalOnPayload = options?.onPayload;
    return underlying(model, context, {
      ...options,
      onPayload: (payload) => {
        if (payload && typeof payload === "object") {
          const payloadObj = payload as Record<string, unknown>;
          if (payloadObj.thinking === "off") {
            payloadObj.thinking = null;
          }
        }
        return originalOnPayload?.(payload, model);
      },
    });
  };
}

export function resolveMoonshotThinkingType(params: {
  configuredThinking: unknown;
  thinkingLevel?: ThinkLevel;
}): MoonshotThinkingType | undefined {
  const configured = normalizeMoonshotThinkingType(params.configuredThinking);
  if (configured) {
    return configured;
  }
  if (!params.thinkingLevel) {
    return undefined;
  }
  return params.thinkingLevel === "off" ? "disabled" : "enabled";
}

export function createMoonshotThinkingWrapper(
  baseStreamFn: StreamFn | undefined,
  thinkingType?: MoonshotThinkingType,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) => {
    const originalOnPayload = options?.onPayload;
    return underlying(model, context, {
      ...options,
      onPayload: (payload) => {
        if (payload && typeof payload === "object") {
          const payloadObj = payload as Record<string, unknown>;
          let effectiveThinkingType = normalizeMoonshotThinkingType(payloadObj.thinking);

          if (thinkingType) {
            payloadObj.thinking = { type: thinkingType };
            effectiveThinkingType = thinkingType;
          }

          if (
            effectiveThinkingType === "enabled" &&
            !isMoonshotToolChoiceCompatible(payloadObj.tool_choice)
          ) {
            payloadObj.tool_choice = "auto";
          }
        }
        return originalOnPayload?.(payload, model);
      },
    });
  };
}

function isOfficialDeepSeekApiHost(baseUrl?: string): boolean {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    return host === "api.deepseek.com" || host.endsWith(".deepseek.com");
  } catch {
    return false;
  }
}

/**
 * DeepSeek V4 defaults thinking to enabled. For OpenBot agent turns we must send an
 * explicit `thinking` object so non-thinking chats (and tool calls) stay stable.
 */
export function shouldApplyDeepSeekThinkingCompat(params: {
  provider: string;
  modelId: string;
  baseUrl?: string;
}): boolean {
  const modelId = params.modelId.trim().toLowerCase();
  const isV4 =
    modelId === "deepseek-v4-flash" ||
    modelId === "deepseek-v4-pro" ||
    modelId.startsWith("deepseek-v4-");
  if (!isV4) {
    return false;
  }
  if (isOfficialDeepSeekApiHost(params.baseUrl)) {
    return true;
  }
  const provider = params.provider.trim().toLowerCase();
  return provider.includes("deepseek");
}

export function resolveDeepSeekThinkingType(params: {
  configuredThinking: unknown;
  thinkingLevel?: ThinkLevel;
  modelReasoning?: boolean;
}): MoonshotThinkingType {
  const configured = normalizeMoonshotThinkingType(params.configuredThinking);
  if (configured) {
    return configured;
  }
  if (params.thinkingLevel) {
    return params.thinkingLevel === "off" ? "disabled" : "enabled";
  }
  // Legacy deepseek-chat mapped models set reasoning=false; reasoner maps set true.
  return params.modelReasoning ? "enabled" : "disabled";
}

export function createDeepSeekThinkingWrapper(
  baseStreamFn: StreamFn | undefined,
  thinkingType: MoonshotThinkingType,
): StreamFn {
  return createMoonshotThinkingWrapper(baseStreamFn, thinkingType);
}
