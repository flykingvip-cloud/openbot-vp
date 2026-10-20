import type { EnterpriseOperationalIdentityCredentialSecret } from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import {
  cancelTencentMeeting,
  getTencentMeeting,
  getTencentMeetingByCode,
  listTencentMeetings,
  normalizeTencentMeetingExecutionResult,
  resolveTencentMeetingClientConfigFromSecret,
  scheduleTencentMeeting,
} from "./enterprise-operational-identity-tencent-meeting-api.js";
import { hasTencentMeetingAkSk } from "./enterprise-operational-identity-tencent-meeting-credential.js";
import {
  callTencentMeetingMcpTool,
  resolveTencentMeetingMcpToken,
} from "./enterprise-operational-identity-tencent-meeting-mcp.js";

export type EnterpriseOperationalIdentityTencentMeetingPayload = {
  subject?: string;
  title?: string;
  startTime?: number;
  endTime?: number;
  type?: number;
  userid?: string;
  instanceid?: number;
  password?: string;
  timeZone?: string;
  meetingId?: string;
  meetingCode?: string;
  page?: number;
  pageSize?: number;
  inviteeUserIds?: string[];
  reasonCode?: number;
  reasonDetail?: string;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseInviteeUserIds(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const ids = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
    return ids.length > 0 ? ids : undefined;
  }
  const raw = stringValue(value);
  if (!raw) {
    return undefined;
  }
  const ids = raw
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

export function parseEnterpriseOperationalIdentityTencentMeetingPayload(
  value: unknown,
): EnterpriseOperationalIdentityTencentMeetingPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    subject: stringValue(record.subject) || stringValue(record.title) || undefined,
    title: stringValue(record.title) || undefined,
    startTime: numberValue(record.startTime ?? record.start_time),
    endTime: numberValue(record.endTime ?? record.end_time),
    type: numberValue(record.type),
    userid: stringValue(record.userid) || undefined,
    instanceid: numberValue(record.instanceid ?? record.instance_id),
    password: stringValue(record.password) || undefined,
    timeZone: stringValue(record.timeZone ?? record.time_zone) || undefined,
    meetingId: stringValue(record.meetingId ?? record.meeting_id) || undefined,
    meetingCode: stringValue(record.meetingCode ?? record.meeting_code) || undefined,
    page: numberValue(record.page),
    pageSize: numberValue(record.pageSize ?? record.page_size),
    inviteeUserIds: parseInviteeUserIds(record.inviteeUserIds ?? record.invitees),
    reasonCode: numberValue(record.reasonCode ?? record.reason_code),
    reasonDetail: stringValue(record.reasonDetail ?? record.reason_detail) || undefined,
  };
}

function resolveTencentMeetingConfig(params: {
  secret: EnterpriseOperationalIdentityCredentialSecret;
  externalAccountId?: string;
}) {
  const config = resolveTencentMeetingClientConfigFromSecret({
    accessToken: params.secret.accessToken,
    metadata: params.secret.metadata,
    externalAccountId:
      params.externalAccountId?.trim() || params.secret.metadata?.defaultUserId?.trim(),
  });
  if (!config) {
    throw new Error("腾讯会议企业应用凭证不完整；请配置 SecretId、SecretKey 与默认操作员 userid。");
  }
  return config;
}

function toIsoTime(value: number): string {
  const ms = value < 1e12 ? value * 1000 : value;
  return new Date(ms).toISOString();
}

function meetingFromMcpData(data: Record<string, unknown>): Record<string, unknown> {
  return normalizeTencentMeetingExecutionResult({
    meeting_id: typeof data.meeting_id === "string" ? data.meeting_id : undefined,
    meeting_code: typeof data.meeting_code === "string" ? data.meeting_code : undefined,
    subject: typeof data.subject === "string" ? data.subject : undefined,
    join_url: typeof data.join_url === "string" ? data.join_url : undefined,
    start_time: typeof data.start_time === "string" ? data.start_time : undefined,
    end_time: typeof data.end_time === "string" ? data.end_time : undefined,
    ...data,
  });
}

async function executeTencentMeetingMcpAction(params: {
  action: string;
  payload: EnterpriseOperationalIdentityTencentMeetingPayload;
  secret: EnterpriseOperationalIdentityCredentialSecret;
}): Promise<Record<string, unknown>> {
  const token = resolveTencentMeetingMcpToken({
    accessToken: params.secret.accessToken,
    metadata: params.secret.metadata,
  });
  if (!token) {
    throw new Error("缺少腾讯会议 Token。");
  }

  if (params.action === "schedule_meeting") {
    const subject = params.payload.subject?.trim();
    const startTime = params.payload.startTime;
    const endTime = params.payload.endTime;
    if (!subject || startTime == null || endTime == null) {
      throw new Error("schedule_meeting 需要 subject、startTime、endTime。");
    }
    if (endTime <= startTime) {
      throw new Error("schedule_meeting 的 endTime 必须大于 startTime。");
    }
    const { data } = await callTencentMeetingMcpTool({
      token,
      name: "schedule_meeting",
      arguments: {
        subject,
        start_time: toIsoTime(startTime),
        end_time: toIsoTime(endTime),
      },
    });
    return meetingFromMcpData(data);
  }

  if (params.action === "cancel_meeting") {
    const meetingId = params.payload.meetingId?.trim();
    if (!meetingId) {
      throw new Error("cancel_meeting 需要 meetingId。");
    }
    const { data } = await callTencentMeetingMcpTool({
      token,
      name: "cancel_meeting",
      arguments: { meeting_id: meetingId },
    });
    return { meetingId, cancelled: true, ...data };
  }

  if (params.action === "get_meeting") {
    const meetingId = params.payload.meetingId?.trim();
    if (!meetingId) {
      throw new Error("get_meeting 需要 meetingId。");
    }
    const { data } = await callTencentMeetingMcpTool({
      token,
      name: "get_meeting",
      arguments: { meeting_id: meetingId },
    });
    return meetingFromMcpData(data);
  }

  if (params.action === "get_meeting_by_code") {
    const meetingCode = params.payload.meetingCode?.trim();
    if (!meetingCode) {
      throw new Error("get_meeting_by_code 需要 meetingCode。");
    }
    const { data } = await callTencentMeetingMcpTool({
      token,
      name: "get_meeting_by_code",
      arguments: { meeting_code: meetingCode },
    });
    return meetingFromMcpData(data);
  }

  if (params.action === "list_meetings") {
    const { data } = await callTencentMeetingMcpTool({
      token,
      name: "get_user_meetings",
      arguments: { is_show_all_sub_meetings: 0 },
    });
    const list = Array.isArray(data.meeting_info_list)
      ? data.meeting_info_list
      : Array.isArray(data.meetings)
        ? data.meetings
        : [];
    const meetingInfoList = list.filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    );
    return {
      meetingNumber:
        typeof data.meeting_number === "number" ? data.meeting_number : meetingInfoList.length,
      meetingInfoList,
      meetings: meetingInfoList.map((entry) => meetingFromMcpData(entry)),
    };
  }

  throw new Error(`腾讯会议不支持动作：${params.action}`);
}

export async function executeTencentMeetingOperationalAction(params: {
  action: string;
  payload: EnterpriseOperationalIdentityTencentMeetingPayload;
  secret: EnterpriseOperationalIdentityCredentialSecret;
  externalAccountId?: string;
}): Promise<Record<string, unknown>> {
  if (!hasTencentMeetingAkSk(params)) {
    return await executeTencentMeetingMcpAction(params);
  }
  const config = resolveTencentMeetingConfig(params);

  if (params.action === "schedule_meeting") {
    const subject = params.payload.subject?.trim();
    const startTime = params.payload.startTime;
    const endTime = params.payload.endTime;
    if (!subject || startTime == null || endTime == null) {
      throw new Error("schedule_meeting 需要 subject、startTime、endTime。");
    }
    if (endTime <= startTime) {
      throw new Error("schedule_meeting 的 endTime 必须大于 startTime。");
    }
    const invitees = params.payload.inviteeUserIds?.map((userid) => ({ userid }));
    const result = await scheduleTencentMeeting({
      config,
      subject,
      startTime,
      endTime,
      type: params.payload.type,
      userid: params.payload.userid,
      instanceid: params.payload.instanceid,
      password: params.payload.password,
      timeZone: params.payload.timeZone,
      invitees,
    });
    const meeting = result.meetingInfoList[0];
    if (!meeting) {
      throw new Error("腾讯会议创建成功但未返回 meeting_info。");
    }
    return normalizeTencentMeetingExecutionResult(meeting);
  }

  if (params.action === "cancel_meeting") {
    const meetingId = params.payload.meetingId?.trim();
    if (!meetingId) {
      throw new Error("cancel_meeting 需要 meetingId。");
    }
    const output = await cancelTencentMeeting({
      config,
      meetingId,
      userid: params.payload.userid,
      instanceid: params.payload.instanceid,
      reasonCode: params.payload.reasonCode,
      reasonDetail: params.payload.reasonDetail,
    });
    return { meetingId, cancelled: true, ...output };
  }

  if (params.action === "get_meeting") {
    const meetingId = params.payload.meetingId?.trim();
    if (!meetingId) {
      throw new Error("get_meeting 需要 meetingId。");
    }
    const result = await getTencentMeeting({
      config,
      meetingId,
      userid: params.payload.userid,
      instanceid: params.payload.instanceid,
    });
    const meeting = result.meetingInfoList[0];
    if (!meeting) {
      return { meetingId, meetingInfoList: result.meetingInfoList };
    }
    return normalizeTencentMeetingExecutionResult(meeting);
  }

  if (params.action === "get_meeting_by_code") {
    const meetingCode = params.payload.meetingCode?.trim();
    if (!meetingCode) {
      throw new Error("get_meeting_by_code 需要 meetingCode。");
    }
    const result = await getTencentMeetingByCode({
      config,
      meetingCode,
      userid: params.payload.userid,
      instanceid: params.payload.instanceid,
    });
    const meeting = result.meetingInfoList[0];
    if (!meeting) {
      return { meetingCode, meetingInfoList: result.meetingInfoList };
    }
    return normalizeTencentMeetingExecutionResult(meeting);
  }

  if (params.action === "list_meetings") {
    const result = await listTencentMeetings({
      config,
      userid: params.payload.userid,
      instanceid: params.payload.instanceid,
      page: params.payload.page,
      pageSize: params.payload.pageSize,
    });
    return {
      meetingNumber: result.meetingNumber,
      meetingInfoList: result.meetingInfoList,
      meetings: result.meetingInfoList.map((entry) =>
        normalizeTencentMeetingExecutionResult(entry),
      ),
    };
  }

  throw new Error(`腾讯会议不支持动作：${params.action}`);
}
