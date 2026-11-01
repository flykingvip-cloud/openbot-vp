/**
 * Enterprise connection, role, and gateway-error copy.
 *
 * Initial `connected === false` during hello is a loading phase, not a terminal
 * disconnect. Once a payload has arrived, transient rebind errors must not keep
 * the severe empty-state banner.
 */

import { formatSourceActionMismatchMessage } from "./views/enterprise-data-capability/product-wizard.ts";

const TRANSIENT_GATEWAY_ERROR =
  /gateway rebinding|gateway not connected|gateway closed|please retry|enterprise capability request timed out/i;

export function isTransientGatewayDisconnectError(message: string | null | undefined): boolean {
  const text = message?.trim() ?? "";
  if (!text) {
    return false;
  }
  return TRANSIENT_GATEWAY_ERROR.test(text);
}

/** Map developer gateway strings to a short retry hint. Non-matching text is kept. */
export function localizeEnterpriseGatewayError(message: string | null | undefined): string | null {
  const text = message?.trim() ?? "";
  if (!text) {
    return null;
  }
  if (/gateway rebinding/i.test(text)) {
    return "网关正在重新绑定控制台，请稍后重试。";
  }
  if (/gateway not connected|gateway closed|^disconnected\b/i.test(text)) {
    return "网关未连接，请稍后重试。";
  }
  if (/^unauthorized\b/i.test(text)) {
    return "登录状态无效，请重新登录后再试。";
  }
  if (/enterprise capability request timed out/i.test(text)) {
    return "企业能力数据加载超时，请稍后重试。";
  }
  const sourceActionMismatch = text.match(
    /^Action\s+(\S+@\S+)\s+must align with a linked DataSource connectorId\.?$/i,
  );
  if (sourceActionMismatch?.[1]) {
    return formatSourceActionMismatchMessage([sourceActionMismatch[1]]);
  }
  if (
    /must align with a linked DataSource connectorId|DATA_CAPABILITY_SOURCE_ACTION_MISMATCH/i.test(
      text,
    )
  ) {
    return formatSourceActionMismatchMessage([]);
  }
  return text;
}

function readGatewayDetailCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("details" in error)) {
    return null;
  }
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== "object" || !("code" in details)) {
    return null;
  }
  const code = (details as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}

export function localizeEnterpriseGatewayThrown(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (readGatewayDetailCode(error) === "DATA_CAPABILITY_SOURCE_ACTION_MISMATCH") {
    const localized = localizeEnterpriseGatewayError(raw);
    if (localized && localized !== raw.trim()) {
      return localized;
    }
    return formatSourceActionMismatchMessage([]);
  }
  return localizeEnterpriseGatewayError(raw) ?? fallback;
}

export type EnterpriseConnectionPhase = "loading" | "ready" | "disconnected";

export type EnterpriseConnectionView = {
  phase: EnterpriseConnectionPhase;
  label: string;
  tone: "neutral" | "ok" | "warn";
  showBanner: boolean;
  bannerBody: string;
};

export function resolveEnterpriseConnectionView(input: {
  connected?: boolean;
  connectionPhase?: string | null;
  lastError?: string | null;
  payloadReady?: boolean;
  authIssue?: boolean;
}): EnterpriseConnectionView {
  const phase = input.connectionPhase ?? null;
  const payloadReady = input.payloadReady === true;
  const authIssue = input.authIssue === true;
  const terminal = phase === "unreachable" || phase === "blocked";
  const loadingPhase = phase === "connecting" || phase === "reconnecting" || phase === "idle";
  const localized = localizeEnterpriseGatewayError(input.lastError);
  const transient = isTransientGatewayDisconnectError(input.lastError);

  if (authIssue && input.connected === false) {
    return {
      phase: "disconnected",
      label: "未连接",
      tone: "warn",
      showBanner: true,
      bannerBody: "网关认证未完成。完成登录后会自动加载企业数据。",
    };
  }

  // Omitted `connected` is not a disconnect. Only an explicit false flag can banner.
  if (input.connected !== false) {
    return {
      phase: "ready",
      label: "已连接",
      tone: "ok",
      showBanner: false,
      bannerBody: "",
    };
  }

  if (payloadReady) {
    if (loadingPhase) {
      return {
        phase: "ready",
        label: "重连中",
        tone: "neutral",
        showBanner: false,
        bannerBody: "",
      };
    }
    if (terminal && !transient) {
      return {
        phase: "ready",
        label: "最近成功加载",
        tone: "warn",
        showBanner: false,
        bannerBody: "",
      };
    }
    return {
      phase: "ready",
      label: "已连接",
      tone: "ok",
      showBanner: false,
      bannerBody: "",
    };
  }

  if (loadingPhase || (!input.lastError && !terminal)) {
    return {
      phase: "loading",
      label: "连接中",
      tone: "neutral",
      showBanner: false,
      bannerBody: "",
    };
  }

  return {
    phase: "disconnected",
    label: "未连接",
    tone: "warn",
    showBanner: true,
    bannerBody:
      localized && !transient
        ? localized
        : (localized ?? "网关未连接。当前不能确认成员、代理与策略是否为最新。"),
  };
}

/** Hide transient rebind text once data is on screen; otherwise show localized copy. */
export function displayEnterpriseLastError(input: {
  connected?: boolean;
  connectionPhase?: string | null;
  lastError?: string | null;
  payloadReady?: boolean;
  authIssue?: boolean;
}): string | null {
  const raw = input.lastError?.trim() ?? "";
  if (!raw) {
    return null;
  }
  const view = resolveEnterpriseConnectionView(input);
  if (view.phase !== "disconnected" && isTransientGatewayDisconnectError(raw)) {
    return null;
  }
  return localizeEnterpriseGatewayError(raw);
}

const ROLE_LABELS: Record<string, string> = {
  "enterprise-admin": "企业管理员",
  "platform-admin": "平台管理员",
  "platform-super-admin": "平台超级管理员",
  admin: "管理员",
  operator: "操作员",
  viewer: "查看者",
  member: "成员",
};

export function formatEnterpriseRoleLabel(role: string | null | undefined): string {
  const key = role?.trim() ?? "";
  if (!key) {
    return "—";
  }
  return ROLE_LABELS[key] ?? key;
}

const STATUS_LABELS: Record<string, string> = {
  active: "正常",
  unknown: "未知",
  online: "在线",
  offline: "离线",
  normal: "正常",
  vacant: "空闲",
  occupied: "已占用",
  pending: "待确认",
};

export function formatEnterpriseStatusLabel(status: string | null | undefined): string {
  const key = status?.trim() ?? "";
  if (!key) {
    return "未知";
  }
  return STATUS_LABELS[key.toLowerCase()] ?? STATUS_LABELS[key] ?? key;
}

export function formatEnterpriseRuntimeLabel(status: string | null | undefined): string {
  if (status === "online" || status === "ONLINE") {
    return "在线";
  }
  if (status === "offline" || status === "OFFLINE") {
    return "离线";
  }
  return "未知";
}

export function resolveIdleSeatCount(seatCount: number, occupiedSeatCount: number): number {
  if (!Number.isFinite(seatCount) || !Number.isFinite(occupiedSeatCount)) {
    return 0;
  }
  return Math.max(0, seatCount - occupiedSeatCount);
}
