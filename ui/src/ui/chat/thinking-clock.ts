import { isLiveThinkingClockActive } from "./thinking-elapsed.ts";

export type ThinkingClockHost = {
  chatSending: boolean;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatThinkingNowMs: number;
};

const timers = new WeakMap<object, ReturnType<typeof setInterval>>();

export function syncChatThinkingClock(host: ThinkingClockHost): void {
  const live = isLiveThinkingClockActive({
    sending: host.chatSending,
    streamStartedAt: host.chatStreamStartedAt,
    stream: host.chatStream,
  });
  const existing = timers.get(host);
  if (live) {
    if (!existing) {
      host.chatThinkingNowMs = Date.now();
      const timer = setInterval(() => {
        host.chatThinkingNowMs = Date.now();
      }, 1000);
      timers.set(host, timer);
    }
    return;
  }
  if (existing) {
    clearInterval(existing);
    timers.delete(host);
  }
}

export function stopChatThinkingClock(host: ThinkingClockHost): void {
  const existing = timers.get(host);
  if (!existing) {
    return;
  }
  clearInterval(existing);
  timers.delete(host);
}
