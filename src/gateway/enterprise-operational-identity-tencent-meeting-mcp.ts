import { logTencentMeetingScheduleOutbound } from "./enterprise-operational-identity-tencent-meeting-logging.js";
import { recordOrNull as asRecord } from "./records.js";

export const TENCENT_MEETING_MCP_URL = "https://mcp.meeting.tencent.com/mcp/wemeet-open/v1";
export const TENCENT_MEETING_MCP_SKILL_VERSION = "v1.0.11";

export type TencentMeetingMcpCallResult = {
  raw: Record<string, unknown>;
  data: Record<string, unknown>;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

/**
 * Tencent MCP tool text is often `{ data: { body: "<api json>" } }`.
 * The meeting list lives in that inner JSON, not on the outer object.
 */
export function unwrapTencentMeetingMcpPayload(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const nested = asRecord(data.data);
  const body = nested && "body" in nested ? nested.body : data.body;
  if (typeof body === "string") {
    if (!body.trim()) {
      return data;
    }
    return parseJsonRecord(body) ?? data;
  }
  return asRecord(body) ?? data;
}

function businessErrorMessage(data: Record<string, unknown>): string | null {
  const info = asRecord(data.error_info);
  const code = info?.error_code ?? data.error_code;
  const numeric =
    typeof code === "number"
      ? code
      : typeof code === "string" && /^-?\d+$/.test(code.trim())
        ? Number(code)
        : null;
  if (numeric == null || numeric === 0) {
    return null;
  }
  const message = stringValue(info?.message) || stringValue(data.message) || stringValue(data.msg);
  return message ? `${message} (${numeric})` : `腾讯会议业务错误 (${numeric})`;
}

function parseMcpError(payload: Record<string, unknown>): string | null {
  const error = asRecord(payload.error);
  if (!error) {
    return null;
  }
  const message = stringValue(error.message) || stringValue(error.msg);
  const code =
    typeof error.code === "string" || typeof error.code === "number" ? String(error.code) : "";
  if (message && code) {
    return `${message} (${code})`;
  }
  return message || "腾讯会议 Token 无效。";
}

export function resolveTencentMeetingMcpToken(params: {
  accessToken?: string;
  metadata?: Record<string, string>;
}): string {
  return params.accessToken?.trim() || params.metadata?.token?.trim() || "";
}

export async function tencentMeetingMcpRequest(params: {
  token: string;
  method: string;
  rpcParams?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const token = params.token.trim();
  if (!token) {
    throw new Error("缺少腾讯会议 Token。");
  }
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(TENCENT_MEETING_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tencent-Meeting-Token": token,
      "X-Skill-Version": TENCENT_MEETING_MCP_SKILL_VERSION,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: params.method,
      params: params.rpcParams ?? {},
    }),
  });
  const rawText = await response.text();
  let payload: Record<string, unknown> = {};
  if (rawText.trim()) {
    payload = JSON.parse(rawText) as Record<string, unknown>;
  }
  const rpcError = parseMcpError(payload);
  if (!response.ok) {
    throw new Error(rpcError ?? `腾讯会议 MCP HTTP ${response.status}`);
  }
  if (rpcError) {
    throw new Error(rpcError);
  }
  return payload;
}

export async function verifyTencentMeetingMcpToken(params: {
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true }> {
  const payload = await tencentMeetingMcpRequest({
    token: params.token,
    method: "tools/list",
    fetchImpl: params.fetchImpl,
  });
  const result = asRecord(payload.result);
  const tools = result?.tools;
  if (Array.isArray(tools) && tools.length === 0) {
    throw new Error("腾讯会议 Token 可用，但未返回任何工具。");
  }
  return { ok: true };
}

export async function callTencentMeetingMcpTool(params: {
  token: string;
  name: string;
  arguments?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<TencentMeetingMcpCallResult> {
  if (params.name === "schedule_meeting") {
    const args = params.arguments ?? {};
    logTencentMeetingScheduleOutbound({
      channel: "mcp",
      action: "schedule_meeting",
      toolName: params.name,
      subject: typeof args.subject === "string" ? args.subject : undefined,
      startTime:
        typeof args.start_time === "string" || typeof args.start_time === "number"
          ? args.start_time
          : undefined,
      endTime:
        typeof args.end_time === "string" || typeof args.end_time === "number"
          ? args.end_time
          : undefined,
    });
  }
  const payload = await tencentMeetingMcpRequest({
    token: params.token,
    method: "tools/call",
    rpcParams: {
      name: params.name,
      arguments: {
        ...params.arguments,
        _client_info: {
          os: process.platform,
          agent: "openbot",
          model: "enterprise-identity",
        },
      },
    },
    fetchImpl: params.fetchImpl,
  });
  const result = asRecord(payload.result) ?? {};
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.map((entry) => stringValue(asRecord(entry)?.text)).find(Boolean);
  let data: Record<string, unknown> = result;
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      data = asRecord(parsed) ?? { rawText: text };
    } catch {
      data = { rawText: text };
    }
    const envelope = asRecord(data.data);
    const statusCode = typeof envelope?.status_code === "number" ? envelope.status_code : undefined;
    data = unwrapTencentMeetingMcpPayload(data);
    if (statusCode != null && statusCode >= 400) {
      throw new Error(businessErrorMessage(data) ?? `腾讯会议 MCP HTTP ${statusCode}`);
    }
    const businessError = businessErrorMessage(data);
    if (businessError) {
      throw new Error(businessError);
    }
  }
  return { raw: payload, data };
}
