import { afterEach, expect, it, vi } from "vitest";
import type { TaskActivitySnapshot } from "../../../../src/shared/task-activity.ts";
import { ChatTaskActivity } from "./task-activity.ts";
const snapshot = (
  sessionKey: string,
  health: NonNullable<TaskActivitySnapshot["task"]>["health"] = "running",
): TaskActivitySnapshot => ({
  sessionKey,
  observedAtMs: Date.now(),
  task: { taskId: sessionKey + "-task", lifecycle: "active", health },
});
async function flush(el: ChatTaskActivity) {
  await el.updateComplete;
  await Promise.resolve();
  await el.updateComplete;
  await Promise.resolve();
  await el.updateComplete;
}
function mount(request: (method: string, params?: unknown) => Promise<unknown>) {
  const el = new ChatTaskActivity();
  el.sessionKey = "a";
  el.client = { request };
  el.connected = true;
  document.body.append(el);
  return el;
}
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
it("renders running → waiting → receipt/run → terminal and keeps status after a reply ends", async () => {
  let current = snapshot("a");
  const el = mount(vi.fn(async () => current));
  await flush(el);
  expect(el.shadowRoot?.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
  expect(el.shadowRoot?.querySelector(".moving")).not.toBeNull();
  el.runId = "reply-ended";
  await flush(el);
  expect(el.shadowRoot?.querySelector(".moving")).not.toBeNull();
  current = snapshot("a", "waiting_dependency");
  el.runId = "waiting";
  await flush(el);
  expect(el.shadowRoot?.querySelector('[data-phase="waiting"]')).not.toBeNull();
  expect(el.shadowRoot?.querySelector(".moving")).toBeNull();
  current = snapshot("a");
  el.runId = "receipt";
  await flush(el);
  expect(el.shadowRoot?.querySelector(".moving")).not.toBeNull();
  current = { ...snapshot("a"), task: null };
  el.runId = "complete";
  await flush(el);
  expect(el.shadowRoot?.querySelector('[role="status"]')).toBeNull();
});
it("disconnects to a static uncertain status; paused/cancelled state disappears", async () => {
  let current = snapshot("a");
  const el = mount(async () => current);
  await flush(el);
  el.connected = false;
  await flush(el);
  expect(el.shadowRoot?.querySelector('[data-phase="uncertain"]')).not.toBeNull();
  expect(el.shadowRoot?.querySelector(".moving")).toBeNull();
  for (const lifecycle of ["paused", "terminal"] as const) {
    current = { ...snapshot("a"), task: { ...snapshot("a").task!, lifecycle } };
    el.connected = true;
    el.runId = lifecycle;
    await flush(el);
    expect(el.shadowRoot?.querySelector('[role="status"]')).toBeNull();
  }
});
it("never applies an out-of-order response from the previous session", async () => {
  const pending: Array<{ sessionKey: string; resolve: (value: unknown) => void }> = [];
  const el = mount(
    (_method, params) =>
      new Promise((resolve) =>
        pending.push({ sessionKey: (params as { sessionKey: string }).sessionKey, resolve }),
      ),
  );
  await flush(el);
  el.sessionKey = "b";
  await flush(el);
  pending
    .filter((p) => p.sessionKey === "b")
    .forEach((p) => p.resolve(snapshot("b", "needs_user")));
  await flush(el);
  pending.filter((p) => p.sessionKey === "a").forEach((p) => p.resolve(snapshot("a")));
  await flush(el);
  expect(el.shadowRoot?.querySelector('[data-phase="needs-user"]')).not.toBeNull();
  expect(el.shadowRoot?.querySelector(".moving")).toBeNull();
});
it("reduced motion disables animation and user actions remain static", async () => {
  const el = mount(async () => snapshot("a", "needs_user"));
  await flush(el);
  expect(el.shadowRoot?.querySelector(".moving")).toBeNull();
  expect(ChatTaskActivity.styles.cssText).toContain("prefers-reduced-motion: reduce");
  expect(ChatTaskActivity.styles.cssText).toContain("animation: none");
});

it("has zero layout height when idle and exposes a single accessible status when active", async () => {
  let current: TaskActivitySnapshot = { ...snapshot("a"), task: null };
  const el = mount(async () => current);
  await flush(el);
  expect(el.getBoundingClientRect().height).toBe(0);
  expect(el.shadowRoot?.querySelector('[role="status"]')).toBeNull();
  current = snapshot("a");
  el.runId = "active";
  await flush(el);
  expect(el.getBoundingClientRect().height).toBeGreaterThan(0);
  expect(
    el.shadowRoot?.querySelectorAll('[role="status"][aria-live="polite"][aria-atomic="true"]'),
  ).toHaveLength(1);
});
