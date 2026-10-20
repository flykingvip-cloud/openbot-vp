/**
 * P24.5 — live conversation inbound/outbound adapter for P6 diagnosis runs.
 * Binds to the same user-visible chat.send channel as Da Bai workbench traffic.
 */
import { DiagnosisContractError } from "./types.js";

/** Keep in sync with DIAGNOSIS_P24_5_CANARY_TENANT (Path B 2026-10-19). */
const DEFAULT_CANARY_TENANT = "001";

export type ConversationLiveChatSend = (input: {
  sessionKey: string;
  tenantId: string;
  text: string;
}) => Promise<"accepted" | "unavailable">;

export type ConversationLiveChatBinding = {
  sessionKey: string;
  tenantId: string;
  send: ConversationLiveChatSend;
};

export type ConversationLiveChatOutbound = {
  publish(text: string): Promise<"accepted" | "unavailable">;
  messages: string[];
};

const FORBIDDEN_USER_VISIBLE = [
  /\bapproval[_\s-]?code\b/i,
  /\bsandbox\b/i,
  /\btool[_\s-]?call\b/i,
  /\bexec[_\s-]?host\b/i,
  /批准码/,
  /沙箱/,
  /工具调用/,
];

export function sanitizeConversationUserVisibleText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new DiagnosisContractError(
      "conversation_text_empty",
      "conversation outbound text must not be empty",
      "text",
    );
  }
  for (const pattern of FORBIDDEN_USER_VISIBLE) {
    if (pattern.test(trimmed)) {
      throw new DiagnosisContractError(
        "conversation_text_forbidden",
        "conversation outbound must not expose tools, sandbox, or approval codes",
        "text",
      );
    }
  }
  if (/^#+\s*根因分析/m.test(trimmed) || /^##+\s*RCA/m.test(trimmed)) {
    throw new DiagnosisContractError(
      "conversation_formal_rca_forbidden",
      "conversation outbound must not emit formal RCA headings",
      "text",
    );
  }
  return trimmed;
}

export function createConversationLiveChatOutbound(
  binding: ConversationLiveChatBinding,
): ConversationLiveChatOutbound {
  const messages: string[] = [];
  return {
    messages,
    async publish(text) {
      if (binding.tenantId !== DEFAULT_CANARY_TENANT) {
        return "unavailable";
      }
      const sanitized = sanitizeConversationUserVisibleText(text);
      const result = await binding.send({
        sessionKey: binding.sessionKey,
        tenantId: binding.tenantId,
        text: sanitized,
      });
      if (result === "accepted") {
        messages.push(sanitized);
      }
      return result;
    },
  };
}

export function formatConversationDiagnosisQuestion(text: string): string {
  return sanitizeConversationUserVisibleText(`【诊断对话】${text}`);
}

export function formatConversationDiagnosisStatus(input: {
  state: string;
  summary: string;
}): string {
  return sanitizeConversationUserVisibleText(`【诊断进展】${input.state} · ${input.summary}`);
}
