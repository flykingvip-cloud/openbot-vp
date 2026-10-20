/**
 * local-ide-gateway-probe.ts — best-effort CLI login probe on the Gateway host.
 *
 * Used for environment-readiness when the seat's Node Agent is offline but the
 * developer runs Gateway on the same Mac as `grok login` / Devin auth.
 * Does not imply node_agent execution is available.
 */

import { describeCliBackends } from "../../agents/cli-backend-admin.js";
import {
  probeCliBackendCommand,
  type CliBackendProbeResult,
} from "../../agents/cli-backend-probe.js";
import type { OpenBotConfig } from "../../config/config.js";
import { stripAnsi } from "../../terminal/ansi.js";
import type { WorkerAuthProbeResult } from "./worker-auth-probe.js";

type LocalIdeGatewayProbeSpec = {
  authArgs: string[];
  isAuthenticated: (result: CliBackendProbeResult) => boolean;
  loginHint: string;
};

function combinedProbeText(result: CliBackendProbeResult): string {
  return stripAnsi(`${result.stdout ?? ""}\n${result.stderr ?? ""}`)
    .replace(/\r/g, "")
    .trim();
}

function cursorCliAuthenticated(result: CliBackendProbeResult): boolean {
  const text = combinedProbeText(result).toLowerCase();
  if (!text) {
    return false;
  }
  // Positive signals win: cursor-agent whoami prints a transient
  // "Starting login process..." banner even when already logged in.
  if (
    /login successful|logged in|pro plan|account|user id|email|@/.test(text) &&
    !/not logged in/.test(text)
  ) {
    return true;
  }
  if (/not logged in|please log in|please login/.test(text)) {
    return false;
  }
  // Bare "starting login process" without success markers => not authenticated yet.
  if (/starting login process/.test(text)) {
    return false;
  }
  return result.ok && text.length > 12;
}

function kiroCliAuthenticated(result: CliBackendProbeResult): boolean {
  const text = combinedProbeText(result).toLowerCase();
  if (!text || /not logged in|not authenticated|please run kiro-cli login/.test(text)) {
    return false;
  }
  return result.ok;
}

function traeCliAuthenticated(result: CliBackendProbeResult): boolean {
  // `traecli login status` prints "Not logged in" or a logged-in summary.
  return codexCliAuthenticated(result);
}

function codexCliAuthenticated(result: CliBackendProbeResult): boolean {
  const text = combinedProbeText(result).toLowerCase();
  if (!text) {
    return false;
  }
  if (/not logged in|not authenticated|login required|please log in|please login/.test(text)) {
    return false;
  }
  // `codex login status` prints e.g. "Logged in using an API key - sk-..."
  if (/logged in/.test(text)) {
    return true;
  }
  return result.ok && text.length > 8;
}

const LOCAL_IDE_GATEWAY_PROBE_SPECS: Record<string, LocalIdeGatewayProbeSpec> = {
  "cursor-cli": {
    authArgs: ["whoami"],
    isAuthenticated: cursorCliAuthenticated,
    loginHint: "在本机终端运行 cursor-agent login（与 Cursor 桌面登录需分别授权）",
  },
  "grok-cli": {
    authArgs: ["models"],
    isAuthenticated: (result) => /logged in/i.test(combinedProbeText(result)),
    loginHint: "在本机终端运行 grok login",
  },
  "devin-cli": {
    authArgs: ["auth", "status"],
    isAuthenticated: (result) => result.ok,
    loginHint: "在本机 Devin Desktop / devin CLI 重新登录",
  },
  "kiro-cli": {
    authArgs: ["whoami"],
    isAuthenticated: kiroCliAuthenticated,
    loginHint: "在本机终端运行 kiro-cli login（与 Kiro 桌面登录需分别授权）",
  },
  "codex-cli": {
    authArgs: ["login", "status"],
    isAuthenticated: codexCliAuthenticated,
    loginHint: "在本机终端运行 codex login（支持 ChatGPT / API key）",
  },
  "trae-cli": {
    authArgs: ["login", "status"],
    isAuthenticated: traeCliAuthenticated,
    loginHint: "在本机终端运行 traecli login（企业版旗舰套餐 SSO / PAT）",
  },
};

function looksLikeAuthError(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    "not logged in",
    "login required",
    "please log in",
    "please login",
    "unauthorized",
    "unauthenticated",
    "authentication failed",
    "invalid api key",
  ].some((needle) => lower.includes(needle));
}

/** Probe local IDE login on the Gateway host (readiness hint only). */
export async function probeLocalIdeLoginOnGateway(
  workerId: string,
  cfg?: OpenBotConfig,
): Promise<WorkerAuthProbeResult | null> {
  const normalized = workerId.trim().toLowerCase();
  const spec = LOCAL_IDE_GATEWAY_PROBE_SPECS[normalized];
  if (!spec) {
    return null;
  }

  const entry = describeCliBackends(cfg ?? ({} as OpenBotConfig)).find(
    (backend) => backend.id === normalized,
  );
  const command = entry?.effective?.command?.trim() ?? "";
  if (!command) {
    return null;
  }

  const versionArgs = normalized === "grok-cli" ? ["version"] : ["--version"];
  const versionProbe = await probeCliBackendCommand(command, versionArgs);
  const installed = versionProbe.resolved && (versionProbe.ok || versionProbe.exitCode != null);
  if (!installed) {
    return {
      installed: false,
      authenticated: false,
      status: "missing",
      source: "probe",
      reason: `${command} 未安装在 Gateway 宿主机`,
    };
  }

  const authResult = await probeCliBackendCommand(command, spec.authArgs);
  const combined = combinedProbeText(authResult);
  if (spec.isAuthenticated(authResult)) {
    return {
      installed: true,
      authenticated: true,
      status: "validated",
      source: "probe",
      reason: "Gateway 宿主机探测：CLI 已登录（Node 离线时任务仍不可执行）",
    };
  }

  if (looksLikeAuthError(combined)) {
    return {
      installed: true,
      authenticated: false,
      status: "configured",
      source: "probe",
      reason: spec.loginHint,
    };
  }

  return {
    installed: true,
    authenticated: false,
    status: "configured",
    source: "probe",
    reason: spec.loginHint,
  };
}
