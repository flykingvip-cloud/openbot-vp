const SANDBOX_ACCOUNT_PROBE_MARKER =
  "Managed multitenant sandbox requires a server-derived account";

/**
 * Platform catalog probes can fail before the model is called, when the
 * managed sandbox refuses a run that has no server-derived tenant account.
 * Show that as an operator note instead of the raw English exception.
 */
export function formatOperatorProbeMessage(message: string): string {
  if (message.includes(SANDBOX_ACCOUNT_PROBE_MARKER)) {
    return "这次探测没有带上服务端租户身份（tenantId 与 userId），调用没有到达模型。不能据此判断密钥或模型不可用。";
  }
  return message;
}
