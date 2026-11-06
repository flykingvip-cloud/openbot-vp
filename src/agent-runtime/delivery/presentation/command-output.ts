import type { RuntimeEnv } from "../../../runtime.js";
export type CommandOutputIdentity = {
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  messageChannel?: string;
  channel?: string;
  to?: string;
  accountId?: string;
};
const NESTED_LOG_PREFIX = "[agent:nested]";

function formatNestedLogPrefix(opts: CommandOutputIdentity, sessionKey?: string): string {
  const parts = [NESTED_LOG_PREFIX];
  const session = sessionKey ?? opts.sessionKey ?? opts.sessionId;
  if (session) {
    parts.push(`session=${session}`);
  }
  if (opts.runId) {
    parts.push(`run=${opts.runId}`);
  }
  const channel = opts.messageChannel ?? opts.channel;
  if (channel) {
    parts.push(`channel=${channel}`);
  }
  if (opts.to) {
    parts.push(`to=${opts.to}`);
  }
  if (opts.accountId) {
    parts.push(`account=${opts.accountId}`);
  }
  return parts.join(" ");
}

export function logNestedCommandOutput(
  runtime: RuntimeEnv,
  opts: CommandOutputIdentity,
  output: string,
  sessionKey?: string,
) {
  const prefix = formatNestedLogPrefix(opts, sessionKey);
  for (const line of output.split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    runtime.log(`${prefix} ${line}`);
  }
}
