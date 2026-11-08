import type { ExplicitTaskControl } from "../contracts/task.js";
import { stripInboundStamp } from "./input-stamp.js";

/** Fixed syntax only; no inferred new work, task switching or side effects. */
export function parseExplicitTaskControl(text: string): ExplicitTaskControl | undefined {
  const incoming = stripInboundStamp(text);
  if (!incoming || incoming.startsWith("/")) {
    return undefined;
  }
  if (/^(?:暂停(?:当前(?:任务)?)?|先暂停)[。.!！]?$/u.test(incoming)) {
    return { scope: "current", action: "pause" };
  }
  if (/^(?:取消当前(?:任务)?|取消任务)[。.!！]?$/u.test(incoming)) {
    return { scope: "current", action: "cancel" };
  }
  const resume = incoming.match(/^(?:继续挂起|CONTINUE)\s+(\S+)/iu);
  if (resume) {
    return { scope: "parked", action: "resume", taskId: resume[1] };
  }
  const pause = incoming.match(/^暂停挂起\s+(\S+)/u);
  if (pause) {
    return { scope: "parked", action: "pause", taskId: pause[1] };
  }
  const cancel = incoming.match(/^(?:取消挂起|关闭挂起|CLOSE)\s+(\S+)/iu);
  return cancel ? { scope: "parked", action: "cancel", taskId: cancel[1] } : undefined;
}
