import fs from "node:fs";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { openSessionManager } from "../../agents/pi-sdk/session.js";
import { makeZeroUsageSnapshot } from "../../agents/usage.js";
import { SESSION_TASK_BOARD_LOCK_OPTIONS, withFileLockSync } from "../../infra/file-lock.js";

/** Caller supplies the authorized session path. Messages always use SessionManager. */
export function persistInteractionMessage(input: {
  sessionFile: string;
  sessionId: string;
  cwd: string;
  messageId: string;
  role: "user" | "assistant";
  text: string;
}): void {
  fs.mkdirSync(path.dirname(input.sessionFile), { recursive: true });
  withFileLockSync(
    `${input.sessionFile}.interaction-write`,
    SESSION_TASK_BOARD_LOCK_OPTIONS,
    () => {
      if (!fs.existsSync(input.sessionFile)) {
        // Only the initial header is materialized directly; no raw message entries.
        fs.writeFileSync(
          input.sessionFile,
          JSON.stringify({
            type: "session",
            version: CURRENT_SESSION_VERSION,
            id: input.sessionId,
            timestamp: new Date().toISOString(),
            cwd: input.cwd,
          }) + "\n",
          { flag: "wx", mode: 0o600 },
        );
      }
      const manager = openSessionManager(input.sessionFile);
      const key = input.role === "user" ? input.messageId : `${input.messageId}:assistant`;
      if (
        manager
          .getEntries()
          .some(
            (entry) =>
              entry.type === "message" &&
              (entry.message as unknown as { idempotencyKey?: string }).idempotencyKey === key,
          )
      ) {
        return;
      }
      const common = {
        content: [{ type: "text" as const, text: input.text }],
        timestamp: Date.now(),
        idempotencyKey: key,
      };
      if (input.role === "user") {
        manager.appendMessage({ role: "user", ...common });
      } else {
        manager.appendMessage({
          role: "assistant",
          ...common,
          api: "openai-completions",
          provider: "openbot",
          model: "interaction",
          stopReason: "stop",
          usage: makeZeroUsageSnapshot(),
        });
      }
    },
  );
}
