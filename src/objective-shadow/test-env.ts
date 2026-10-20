import { OBJECTIVE_SHADOW_FLAG_ENV, OBJECTIVE_SHADOW_HMAC_KEY_ENV } from "./feature.js";

export const SHADOW_EVIDENCE_LOG_ENV = "OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_EVIDENCE_LOG";

export function resolveShadowTestLogPath(tmpLog: string): string {
  return process.env[SHADOW_EVIDENCE_LOG_ENV]?.trim() || tmpLog;
}

export function enableObjectiveShadowForTest(testHmac: string): void {
  process.env[OBJECTIVE_SHADOW_FLAG_ENV] = "1";
  if (!process.env[SHADOW_EVIDENCE_LOG_ENV]?.trim()) {
    process.env[OBJECTIVE_SHADOW_HMAC_KEY_ENV] = testHmac;
  }
}
