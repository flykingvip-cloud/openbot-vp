import { createHmac, randomInt } from "node:crypto";
import { logTencentMeetingScheduleOutbound } from "./enterprise-operational-identity-tencent-meeting-logging.js";

export const TENCENT_MEETING_API_BASE = "https://api.meeting.qq.com";

export type TencentMeetingClientConfig = {
  secretId: string;
  secretKey: string;
  sdkId?: string;
  defaultUserId: string;
  defaultInstanceId: number;
  defaultTimeZone: string;
};

type TencentMeetingApiErrorPayload = {
  error_info?: {
    error_code?: number;
    message?: string;
  };
};

export type TencentMeetingInfo = {
  meeting_id?: string;
  meeting_code?: string;
  subject?: string;
  join_url?: string;
  start_time?: string;
  end_time?: string;
  [key: string]: unknown;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveTencentMeetingClientConfig(params: {
  secretId?: string;
  secretKey?: string;
  sdkId?: string;
  defaultUserId?: string;
  defaultInstanceId?: string;
  defaultTimeZone?: string;
}): TencentMeetingClientConfig | null {
  const secretId = params.secretId?.trim() ?? "";
  const secretKey = params.secretKey?.trim() ?? "";
  const defaultUserId = params.defaultUserId?.trim() ?? "";
  if (!secretId || !secretKey || !defaultUserId) {
    return null;
  }
  const instanceRaw = params.defaultInstanceId?.trim();
  const defaultInstanceId = instanceRaw ? Number(instanceRaw) : 1;
  return {
    secretId,
    secretKey,
    ...(params.sdkId?.trim() ? { sdkId: params.sdkId.trim() } : {}),
    defaultUserId,
    defaultInstanceId: Number.isFinite(defaultInstanceId) ? defaultInstanceId : 1,
    defaultTimeZone: params.defaultTimeZone?.trim() || "Asia/Shanghai",
  };
}

export function resolveTencentMeetingClientConfigFromSecret(params: {
  accessToken?: string;
  metadata?: Record<string, string>;
  externalAccountId?: string;
}): TencentMeetingClientConfig | null {
  return resolveTencentMeetingClientConfig({
    secretId: params.metadata?.secretId,
    secretKey: params.accessToken,
    sdkId: params.metadata?.sdkId,
    defaultUserId: params.metadata?.defaultUserId || params.externalAccountId,
    defaultInstanceId: params.metadata?.defaultInstanceId,
    defaultTimeZone: params.metadata?.defaultTimeZone,
  });
}

export function buildTencentMeetingSignature(params: {
  secretId: string;
  secretKey: string;
  httpMethod: string;
  requestUri: string;
  requestBody?: string;
  timestamp?: string;
  nonce?: string;
}): { timestamp: string; nonce: string; signature: string } {
  const timestamp = params.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = params.nonce ?? String(randomInt(1_000_000, 9_999_999_999));
  const headerSignStr = `X-TC-Key=${params.secretId}&X-TC-Nonce=${nonce}&X-TC-Timestamp=${timestamp}`;
  const signStr = [
    params.httpMethod.toUpperCase(),
    headerSignStr,
    params.requestUri,
    params.requestBody ?? "",
  ].join("\n");
  const digestHex = createHmac("sha256", params.secretKey).update(signStr).digest("hex");
  const signature = Buffer.from(digestHex, "utf8").toString("base64");
  return { timestamp, nonce, signature };
}

function parseTencentMeetingError(payload: TencentMeetingApiErrorPayload): string | null {
  const code = payload.error_info?.error_code;
  if (code == null) {
    return null;
  }
  const message = payload.error_info?.message?.trim();
  return message ? `${message} (${code})` : `Tencent Meeting API error ${code}`;
}

export async function tencentMeetingApiRequest<T extends Record<string, unknown>>(params: {
  config: TencentMeetingClientConfig;
  method: "GET" | "POST" | "PUT" | "DELETE";
  requestUri: string;
  body?: Record<string, unknown>;
  registered?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const bodyText =
    params.body && Object.keys(params.body).length > 0 ? JSON.stringify(params.body) : "";
  const { timestamp, nonce, signature } = buildTencentMeetingSignature({
    secretId: params.config.secretId,
    secretKey: params.config.secretKey,
    httpMethod: params.method,
    requestUri: params.requestUri,
    requestBody: bodyText,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-TC-Key": params.config.secretId,
    "X-TC-Timestamp": timestamp,
    "X-TC-Nonce": nonce,
    "X-TC-Signature": signature,
  };
  if (params.config.sdkId) {
    headers.SdkId = params.config.sdkId;
  }
  if (params.registered) {
    headers["X-TC-Registered"] = "1";
  }
  const response = await fetchImpl(`${TENCENT_MEETING_API_BASE}${params.requestUri}`, {
    method: params.method,
    headers,
    ...(bodyText ? { body: bodyText } : {}),
  });
  const rawText = await response.text();
  let payload: T & TencentMeetingApiErrorPayload = {} as T & TencentMeetingApiErrorPayload;
  if (rawText.trim()) {
    payload = JSON.parse(rawText) as T & TencentMeetingApiErrorPayload;
  }
  const apiError = parseTencentMeetingError(payload);
  if (!response.ok) {
    throw new Error(
      apiError ?? `Tencent Meeting API HTTP ${response.status}: ${params.requestUri}`,
    );
  }
  if (apiError) {
    throw new Error(apiError);
  }
  return payload;
}

export async function verifyTencentMeetingCredentials(params: {
  config: TencentMeetingClientConfig;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true }> {
  const query = new URLSearchParams({
    userid: params.config.defaultUserId,
    instanceid: String(params.config.defaultInstanceId),
    page: "1",
    page_size: "1",
  });
  await tencentMeetingApiRequest({
    config: params.config,
    method: "GET",
    requestUri: `/v1/meetings?${query.toString()}`,
    fetchImpl: params.fetchImpl,
  });
  return { ok: true };
}

export async function scheduleTencentMeeting(params: {
  config: TencentMeetingClientConfig;
  subject: string;
  startTime: number;
  endTime: number;
  type?: number;
  userid?: string;
  instanceid?: number;
  password?: string;
  timeZone?: string;
  invitees?: Array<{ userid: string }>;
  fetchImpl?: typeof fetch;
}): Promise<{ meetingInfoList: TencentMeetingInfo[] }> {
  const userid = params.userid?.trim() || params.config.defaultUserId;
  const instanceid = params.instanceid ?? params.config.defaultInstanceId;
  const body: Record<string, unknown> = {
    userid,
    instanceid,
    subject: params.subject,
    type: params.type ?? 0,
    start_time: String(params.startTime),
    end_time: String(params.endTime),
    time_zone: params.timeZone?.trim() || params.config.defaultTimeZone,
  };
  if (params.password?.trim()) {
    body.password = params.password.trim();
  }
  if (params.invitees?.length) {
    body.invitees = params.invitees;
  }
  logTencentMeetingScheduleOutbound({
    channel: "api",
    action: "schedule_meeting",
    subject: params.subject,
    startTime: body.start_time as string,
    endTime: body.end_time as string,
    timeZone: body.time_zone as string,
    requestUri: "/v1/meetings",
  });
  const payload = await tencentMeetingApiRequest<{
    meeting_info_list?: TencentMeetingInfo[];
  }>({
    config: params.config,
    method: "POST",
    requestUri: "/v1/meetings",
    body,
    registered: true,
    fetchImpl: params.fetchImpl,
  });
  return { meetingInfoList: payload.meeting_info_list ?? [] };
}

export async function cancelTencentMeeting(params: {
  config: TencentMeetingClientConfig;
  meetingId: string;
  userid?: string;
  instanceid?: number;
  reasonCode?: number;
  reasonDetail?: string;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const meetingId = params.meetingId.trim();
  if (!meetingId) {
    throw new Error("cancel_meeting 需要 meetingId。");
  }
  const userid = params.userid?.trim() || params.config.defaultUserId;
  const instanceid = params.instanceid ?? params.config.defaultInstanceId;
  const query = new URLSearchParams({
    userid,
    instanceid: String(instanceid),
  });
  const body: Record<string, unknown> = {
    reason_code: params.reasonCode ?? 1,
  };
  if (params.reasonDetail?.trim()) {
    body.reason_detail = params.reasonDetail.trim();
  }
  return await tencentMeetingApiRequest({
    config: params.config,
    method: "DELETE",
    requestUri: `/v1/meetings/${encodeURIComponent(meetingId)}?${query.toString()}`,
    body,
    fetchImpl: params.fetchImpl,
  });
}

export async function getTencentMeeting(params: {
  config: TencentMeetingClientConfig;
  meetingId: string;
  userid?: string;
  instanceid?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ meetingInfoList: TencentMeetingInfo[] }> {
  const meetingId = params.meetingId.trim();
  if (!meetingId) {
    throw new Error("get_meeting 需要 meetingId。");
  }
  const userid = params.userid?.trim() || params.config.defaultUserId;
  const instanceid = params.instanceid ?? params.config.defaultInstanceId;
  const query = new URLSearchParams({
    userid,
    instanceid: String(instanceid),
  });
  const payload = await tencentMeetingApiRequest<{
    meeting_info_list?: TencentMeetingInfo[];
  }>({
    config: params.config,
    method: "GET",
    requestUri: `/v1/meetings/${encodeURIComponent(meetingId)}?${query.toString()}`,
    fetchImpl: params.fetchImpl,
  });
  return { meetingInfoList: payload.meeting_info_list ?? [] };
}

export async function getTencentMeetingByCode(params: {
  config: TencentMeetingClientConfig;
  meetingCode: string;
  userid?: string;
  instanceid?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ meetingInfoList: TencentMeetingInfo[] }> {
  const meetingCode = params.meetingCode.trim();
  if (!meetingCode) {
    throw new Error("get_meeting_by_code 需要 meetingCode。");
  }
  const userid = params.userid?.trim() || params.config.defaultUserId;
  const instanceid = params.instanceid ?? params.config.defaultInstanceId;
  const query = new URLSearchParams({
    meeting_code: meetingCode,
    userid,
    instanceid: String(instanceid),
  });
  const payload = await tencentMeetingApiRequest<{
    meeting_info_list?: TencentMeetingInfo[];
  }>({
    config: params.config,
    method: "GET",
    requestUri: `/v1/meetings?${query.toString()}`,
    fetchImpl: params.fetchImpl,
  });
  return { meetingInfoList: payload.meeting_info_list ?? [] };
}

export async function listTencentMeetings(params: {
  config: TencentMeetingClientConfig;
  userid?: string;
  instanceid?: number;
  page?: number;
  pageSize?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ meetingNumber: number; meetingInfoList: TencentMeetingInfo[] }> {
  const userid = params.userid?.trim() || params.config.defaultUserId;
  const instanceid = params.instanceid ?? params.config.defaultInstanceId;
  const query = new URLSearchParams({
    userid,
    instanceid: String(instanceid),
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 20),
  });
  const payload = await tencentMeetingApiRequest<{
    meeting_number?: number;
    meeting_info_list?: TencentMeetingInfo[];
  }>({
    config: params.config,
    method: "GET",
    requestUri: `/v1/meetings?${query.toString()}`,
    fetchImpl: params.fetchImpl,
  });
  return {
    meetingNumber: payload.meeting_number ?? 0,
    meetingInfoList: payload.meeting_info_list ?? [],
  };
}

export function normalizeTencentMeetingExecutionResult(
  meeting: TencentMeetingInfo,
): Record<string, unknown> {
  return {
    meetingId: stringValue(meeting.meeting_id) || undefined,
    meetingCode: stringValue(meeting.meeting_code) || undefined,
    subject: stringValue(meeting.subject) || undefined,
    joinUrl: stringValue(meeting.join_url) || undefined,
    startTime: stringValue(meeting.start_time) || undefined,
    endTime: stringValue(meeting.end_time) || undefined,
    meeting,
  };
}
