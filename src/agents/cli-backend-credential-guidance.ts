/**
 * cli-backend-credential-guidance.ts — conversational onboarding guidance when a
 * CLI backend run fails for a missing/invalid API key (cli-backend-onboarding
 * Task 10 / R3.4).
 *
 * Guidance branches on CredentialPolicy:
 * - enterprise_shared → platform/enterprise admin configures shared API Key
 * - local_ide_login → employee re-authenticates in local IDE (Node Agent path)
 */

import type { CredentialPolicy } from "../fabric/worker/types.js";
import { defaultWorkerExecutionProfile } from "../gateway/supervisor/worker-profiles.js";

/** Auth/credential failure signatures emitted by coding-agent CLIs. */
const CREDENTIAL_ERROR_PATTERNS: RegExp[] = [
  /\b401\b/,
  /\b403\b/,
  /unauthor/i,
  /authentication (failed|error|required)/i,
  /\bnot logged in\b/i,
  /\bplease (log\s?in|login|sign in)\b/i,
  /\b(invalid|missing|no).{0,20}api[\s_-]?key\b/i,
  /\bapi[\s_-]?key.{0,20}(invalid|missing|required|not set|not found)\b/i,
  /\b(ANTHROPIC|OPENAI|OPENROUTER)_API_KEY\b/,
  /\bcredentials?\b.{0,20}(missing|not found|required|invalid)\b/i,
];

/** True when an error string looks like a CLI-backend credential/auth failure. */
export function isLikelyCredentialError(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  return CREDENTIAL_ERROR_PATTERNS.some((re) => re.test(text));
}

function resolveGuidancePolicy(
  backendId: string,
  credentialPolicy?: CredentialPolicy,
): CredentialPolicy {
  return credentialPolicy ?? defaultWorkerExecutionProfile(backendId).credentialPolicy;
}

function buildEnterpriseSharedGuidance(name: string): string {
  return [
    `⚠️ 无法调用「${name}」：还没有配置可用的 API Key。`,
    "",
    "这通常是一次性设置：请联系你的平台 / 企业管理员，在控制台",
    "「高级治理 → 协作工具 → 凭证」为你的企业配置共享 API Key（或为你的席位配置个人 Key）。",
    "配置完成后再发一次消息即可，无需你在本机执行任何命令行操作。",
  ].join("\n");
}

function buildLocalIdeLoginGuidance(name: string): string {
  return [
    `⚠️ 无法调用「${name}」：本机 IDE / CLI 尚未登录或登录已过期。`,
    "",
    "请在安装该工具的本机（Cursor / Devin Desktop / Grok CLI 等）重新登录或刷新授权（Grok 可运行 `grok login`），",
    "并确保 OpenBot Node Agent 已连接（开发监督者会通过你的本机 CLI 执行）。",
    "完成后回到这里再试一次；无需在平台控制台配置 API Key。",
  ].join("\n");
}

/**
 * Build the conversational guidance shown when a CLI-backend run fails for a
 * missing/invalid key. Never asks the user to paste secrets into chat.
 */
export function buildCliBackendCredentialGuidance(
  backendId: string,
  options?: { credentialPolicy?: CredentialPolicy },
): string {
  const name = backendId.trim() || "该工具";
  const policy = resolveGuidancePolicy(backendId, options?.credentialPolicy);
  if (policy === "local_ide_login") {
    return buildLocalIdeLoginGuidance(name);
  }
  return buildEnterpriseSharedGuidance(name);
}
