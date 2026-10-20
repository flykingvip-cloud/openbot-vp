import { GatewayRequestError } from "../../gateway.ts";

type AgentCreateErrorDetails = {
  code?: string;
  scopeKind?: string;
  denyReason?: string;
};

const RELOGIN_GUIDANCE = "请退出后重新登录，再创建数字员工。";

function readDetails(error: GatewayRequestError): AgentCreateErrorDetails {
  if (!error.details || typeof error.details !== "object") {
    return {};
  }
  return error.details as AgentCreateErrorDetails;
}

function reloginMessage(details: AgentCreateErrorDetails): string {
  const scope = [details.scopeKind, details.denyReason].filter(Boolean).join("/");
  const reason = scope ? `（${scope}）` : "";
  return `当前登录没有绑定唯一的企业成员身份${reason}。${RELOGIN_GUIDANCE}`;
}

function isMissingAuthoritativeTenant(message: string, code?: string): boolean {
  return (
    code === "NO_AUTHORITATIVE_TENANT" ||
    message.includes("NO_AUTHORITATIVE_TENANT") ||
    message.includes("authenticated enterprise session") ||
    message.includes("tenantId requires") ||
    message.includes("没有唯一的企业成员身份")
  );
}

/**
 * Employee create surfaces a Chinese re-login hint when the gateway rejected
 * the tenant because the socket has no authoritative membership pair.
 * Other gateway failures keep their server message without the error class name.
 */
export function formatEmployeeAgentCreateError(error: unknown): string {
  if (error instanceof GatewayRequestError) {
    const details = readDetails(error);
    if (!isMissingAuthoritativeTenant(error.message, details.code)) {
      return error.message;
    }
    if (error.message.startsWith("无法创建企业数字员工")) {
      return error.message;
    }
    return reloginMessage(details);
  }
  const text = String(error).replace(/^GatewayRequestError:\s*/i, "");
  if (isMissingAuthoritativeTenant(text)) {
    if (text.startsWith("无法创建企业数字员工")) {
      return text;
    }
    return reloginMessage({});
  }
  return text;
}
