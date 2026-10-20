import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/tencent-meeting");

export type TencentMeetingScheduleOutboundChannel = "api" | "mcp" | "bridge";

export type TencentMeetingScheduleOutboundMeta = {
  channel: TencentMeetingScheduleOutboundChannel;
  action: string;
  subject?: string;
  startTime?: string | number;
  endTime?: string | number;
  timeZone?: string;
  meetingId?: string;
  startAtMs?: number;
  requestUri?: string;
  toolName?: string;
};

type ScheduleLogSink = (message: string, meta: TencentMeetingScheduleOutboundMeta) => void;

let testSink: ScheduleLogSink | null = null;

/** Test-only hook; production uses subsystem logger. */
export function setTencentMeetingScheduleLogSinkForTests(sink: ScheduleLogSink | null): void {
  testSink = sink;
}

/**
 * Build a desensitized outbound schedule log payload.
 * Never include tokens, secrets, signatures, or raw auth headers.
 */
export function buildTencentMeetingScheduleOutboundMeta(
  input: TencentMeetingScheduleOutboundMeta,
): TencentMeetingScheduleOutboundMeta {
  const meta: TencentMeetingScheduleOutboundMeta = {
    channel: input.channel,
    action: input.action,
  };
  if (input.subject !== undefined) {
    meta.subject = input.subject;
  }
  if (input.startTime !== undefined) {
    meta.startTime = input.startTime;
  }
  if (input.endTime !== undefined) {
    meta.endTime = input.endTime;
  }
  if (input.timeZone !== undefined) {
    meta.timeZone = input.timeZone;
  }
  if (input.meetingId !== undefined) {
    meta.meetingId = input.meetingId;
  }
  if (input.startAtMs !== undefined) {
    meta.startAtMs = input.startAtMs;
  }
  if (input.requestUri !== undefined) {
    meta.requestUri = input.requestUri;
  }
  if (input.toolName !== undefined) {
    meta.toolName = input.toolName;
  }
  return meta;
}

export function logTencentMeetingScheduleOutbound(input: TencentMeetingScheduleOutboundMeta): void {
  const meta = buildTencentMeetingScheduleOutboundMeta(input);
  const message = "tencent-meeting schedule outbound";
  if (testSink) {
    testSink(message, meta);
    return;
  }
  log.info(message, meta);
}
