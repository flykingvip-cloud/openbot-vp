import { normalizeAgentId } from "../../routing/session-key.js";

export const PERSONAL_MAIL_ASSISTANT_NAME = "邮件助手" as const;
export const PERSONAL_MAIL_ASSISTANT_TEMPLATE_ID = "personal_mail_assistant" as const;
export const PERSONAL_MAIL_ASSISTANT_EMOJI = "✉️" as const;
export const PERSONAL_MAIL_ASSISTANT_AVATAR = "邮" as const;

export function buildPersonalMailAssistantAgentId(ownerId: string): string {
  const normalized = ownerId.trim().toLowerCase();
  const slug = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  const suffix = slug || "user";
  return normalizeAgentId(`mail-asst-${suffix}`);
}

export function isPersonalMailAssistantAgent(agentId: string | null | undefined): boolean {
  if (typeof agentId !== "string" || !agentId.trim()) {
    return false;
  }
  return normalizeAgentId(agentId).startsWith("mail-asst-");
}
