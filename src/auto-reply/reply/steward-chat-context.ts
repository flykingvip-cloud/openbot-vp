import { buildStewardSystemPreamble } from "../../agents/builtin-steward/behavior-rules.js";
import { extractEmployeeStewardUserIdFromSessionKey } from "../../agents/builtin-steward/employee-isolation.js";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";

/** Employee per-user steward session → inject D2 persona into chat agent system prompt. */
export function buildEmployeeStewardChatSystemPrompt(params: {
  agentId?: string;
  sessionKey?: string;
}): string | undefined {
  const agentId = params.agentId?.trim();
  const sessionKey = params.sessionKey?.trim();
  if (!agentId || !sessionKey || !isBuiltinStewardAgent(agentId)) {
    return undefined;
  }
  if (!extractEmployeeStewardUserIdFromSessionKey(sessionKey)) {
    return undefined;
  }
  return buildStewardSystemPreamble();
}
