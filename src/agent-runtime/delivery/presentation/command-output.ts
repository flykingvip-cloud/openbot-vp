import {
  isSilentReplyPrefixText,
  isSilentReplyText,
  SILENT_REPLY_TOKEN,
} from "../../../auto-reply/tokens.js";
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

export function createAcpVisibleTextAccumulator() {
  let pendingSilentPrefix = "";
  let visibleText = "";
  const startsWithWordChar = (chunk: string): boolean => /^[\p{L}\p{N}]/u.test(chunk);

  const resolveNextCandidate = (base: string, chunk: string): string => {
    if (!base) {
      return chunk;
    }
    if (
      isSilentReplyText(base, SILENT_REPLY_TOKEN) &&
      !chunk.startsWith(base) &&
      startsWithWordChar(chunk)
    ) {
      return chunk;
    }
    // Some ACP backends emit cumulative snapshots even on text_delta-style hooks.
    // Accept those only when they strictly extend the buffered text.
    if (chunk.startsWith(base) && chunk.length > base.length) {
      return chunk;
    }
    return `${base}${chunk}`;
  };

  const mergeVisibleChunk = (base: string, chunk: string): { text: string; delta: string } => {
    if (!base) {
      return { text: chunk, delta: chunk };
    }
    if (chunk.startsWith(base) && chunk.length > base.length) {
      const delta = chunk.slice(base.length);
      return { text: chunk, delta };
    }
    return {
      text: `${base}${chunk}`,
      delta: chunk,
    };
  };

  return {
    consume(chunk: string): { text: string; delta: string } | null {
      if (!chunk) {
        return null;
      }

      if (!visibleText) {
        const leadCandidate = resolveNextCandidate(pendingSilentPrefix, chunk);
        const trimmedLeadCandidate = leadCandidate.trim();
        if (
          isSilentReplyText(trimmedLeadCandidate, SILENT_REPLY_TOKEN) ||
          isSilentReplyPrefixText(trimmedLeadCandidate, SILENT_REPLY_TOKEN)
        ) {
          pendingSilentPrefix = leadCandidate;
          return null;
        }
        if (pendingSilentPrefix) {
          pendingSilentPrefix = "";
          visibleText = leadCandidate;
          return {
            text: visibleText,
            delta: leadCandidate,
          };
        }
      }

      const nextVisible = mergeVisibleChunk(visibleText, chunk);
      visibleText = nextVisible.text;
      return nextVisible.delta ? nextVisible : null;
    },
    finalize(): string {
      return visibleText.trim();
    },
    finalizeRaw(): string {
      return visibleText;
    },
  };
}
