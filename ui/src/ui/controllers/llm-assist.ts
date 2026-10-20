import { extractText } from "../chat/message-extract.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { generateUUID } from "../uuid.ts";

export function extractLatestAssistantText(messages: unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const role =
      message && typeof message === "object" && !Array.isArray(message)
        ? (message as { role?: unknown }).role
        : null;
    if (role !== "assistant") {
      continue;
    }
    const text = extractText(message);
    if (text?.trim()) {
      return text.trim();
    }
  }
  return null;
}

export function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  return candidate.slice(start, end + 1);
}

export async function requestLlmAssistantText(params: {
  client: GatewayBrowserClient;
  sessionKey: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const sessionKey = params.sessionKey.trim();
  if (!sessionKey) {
    return null;
  }
  const runId = generateUUID();
  try {
    await params.client.request("chat.send", {
      sessionKey,
      message: params.prompt,
      deliver: false,
      idempotencyKey: runId,
    });
  } catch {
    return null;
  }
  try {
    const waitResult = await params.client.request<{ status?: string }>("agent.wait", {
      runId,
      timeoutMs: params.timeoutMs ?? 90_000,
    });
    if (waitResult?.status === "error") {
      return null;
    }
    const history = await params.client.request<{ messages?: unknown[] }>("chat.history", {
      sessionKey,
      limit: 12,
    });
    const messages = Array.isArray(history.messages) ? history.messages : [];
    return extractLatestAssistantText(messages);
  } catch {
    return null;
  }
}
