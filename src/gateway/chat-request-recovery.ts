/** Durable accepted-request receipts. Recovery reports uncertainty; never replays work. */
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const bootId = randomUUID();
export const CHAT_RESTART_INTERRUPTED_TEXT =
  "服务重启中断了本轮回复。是否已发生业务动作仍需核对，本轮不会自动重做。";

type Receipt = { runId: string; sessionKey: string; bootId: string; acceptedAt: string };
function directory(sessionKey: string, root = resolveStateDir()): string {
  return path.join(
    root,
    "chat-request-recovery",
    createHash("sha256").update(sessionKey).digest("hex"),
  );
}
function filename(runId: string): string {
  return `${createHash("sha256").update(runId).digest("hex")}.json`;
}
export function recordAcceptedChatRequest(runId: string, sessionKey: string, root?: string): void {
  const dir = directory(sessionKey, root);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dest = path.join(dir, filename(runId));
  const temp = `${dest}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(
      temp,
      JSON.stringify({ runId, sessionKey, bootId, acceptedAt: new Date().toISOString() }),
      { mode: 0o600 },
    );
    // Preserve a prior request identity on duplicate acceptance.
    try {
      fs.linkSync(temp, dest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
export function completeAcceptedChatRequest(
  runId: string,
  sessionKey: string,
  root?: string,
): void {
  fs.rmSync(path.join(directory(sessionKey, root), filename(runId)), { force: true });
}
export async function recoverInterruptedChatRequests(input: {
  sessionKey: string;
  root?: string;
  currentBootId?: string;
  hasDurableReply?: (runId: string) => boolean | Promise<boolean>;
  append: (text: string, idempotencyKey: string) => Promise<{ ok: boolean }>;
}): Promise<number> {
  const dir = directory(input.sessionKey, input.root);
  if (!fs.existsSync(dir)) {
    return 0;
  }
  let recovered = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) {
      continue;
    }
    let receipt: Receipt;
    try {
      receipt = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as Receipt;
    } catch {
      // Preserve damaged records for investigation without breaking chat history.
      continue;
    }
    if (!receipt || typeof receipt.runId !== "string" || typeof receipt.bootId !== "string") {
      continue;
    }
    if (
      receipt.sessionKey !== input.sessionKey ||
      !receipt.runId ||
      name !== filename(receipt.runId)
    ) {
      continue;
    }
    if (receipt.bootId === (input.currentBootId ?? bootId)) {
      continue;
    }
    if (await input.hasDurableReply?.(receipt.runId)) {
      completeAcceptedChatRequest(receipt.runId, input.sessionKey, input.root);
      continue;
    }
    const result = await input.append(
      CHAT_RESTART_INTERRUPTED_TEXT,
      `${receipt.runId}:restart-interrupted`,
    );
    if (result.ok) {
      completeAcceptedChatRequest(receipt.runId, input.sessionKey, input.root);
      recovered += 1;
    }
  }
  return recovered;
}
