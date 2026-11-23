import { expect, it } from "vitest";
import type { TaskActivitySnapshot } from "../../../../src/shared/task-activity.ts";
import { parseTaskActivitySnapshot, resolveTaskActivityLine } from "./task-activity-state.ts";
const snapshot = (
  health: NonNullable<TaskActivitySnapshot["task"]>["health"],
): TaskActivitySnapshot => ({
  sessionKey: "session-a",
  observedAtMs: 1_000,
  task: { taskId: "task-a", lifecycle: "active", health },
});
it("separates lifecycle from live health and only animates fresh running observations", () => {
  const line = (s: TaskActivitySnapshot) =>
    resolveTaskActivityLine({
      snapshot: s,
      sessionKey: "session-a",
      connected: true,
      nowMs: 2_000,
    });
  expect(line(snapshot("running"))).toMatchObject({ animate: true });
  for (const health of ["waiting_dependency", "recovering", "needs_user", "unknown"] as const) {
    expect(line(snapshot(health))).toMatchObject({ animate: false });
  }
  for (const lifecycle of ["paused", "terminal"] as const) {
    const s = snapshot("running");
    s.task!.lifecycle = lifecycle;
    expect(line(s)).toBeNull();
  }
  expect(line({ ...snapshot("running"), task: null })).toBeNull();
});
it("does not turn reply completion or unfinished state into execution and isolates sessions", () => {
  expect(
    resolveTaskActivityLine({
      snapshot: snapshot("unknown"),
      sessionKey: "session-a",
      connected: true,
      nowMs: 2_000,
    }),
  ).toMatchObject({ phase: "unknown", animate: false });
  expect(
    resolveTaskActivityLine({
      snapshot: snapshot("running"),
      sessionKey: "session-b",
      connected: true,
      nowMs: 2_000,
    }),
  ).toBeNull();
  expect(
    resolveTaskActivityLine({
      snapshot: snapshot("running"),
      sessionKey: "session-a",
      connected: false,
      nowMs: 2_000,
    }),
  ).toMatchObject({ phase: "uncertain", animate: false });
  expect(
    resolveTaskActivityLine({
      snapshot: snapshot("running"),
      sessionKey: "session-a",
      connected: true,
      nowMs: 20_000,
    }),
  ).toMatchObject({ phase: "uncertain", animate: false });
});
it("rejects foreign or malformed RPC responses instead of inventing task state", () => {
  expect(parseTaskActivitySnapshot(snapshot("running"), "session-b")).toBeNull();
  expect(
    parseTaskActivitySnapshot({ ...snapshot("running"), observedAtMs: NaN }, "session-a"),
  ).toBeNull();
  expect(
    parseTaskActivitySnapshot(
      {
        ...snapshot("running"),
        task: { taskId: "x", lifecycle: "active", health: "hallucinated" },
      },
      "session-a",
    ),
  ).toBeNull();
});

it("preserves valid dependency facts and treats future observations as uncertain", () => {
  const s = snapshot("waiting_dependency");
  s.task = { ...s.task!, waitingCount: 2, nextWakeAtMs: 5_000 };
  expect(parseTaskActivitySnapshot(s, "session-a")?.task).toMatchObject({
    waitingCount: 2,
    nextWakeAtMs: 5_000,
  });
  expect(
    resolveTaskActivityLine({
      snapshot: snapshot("running"),
      sessionKey: "session-a",
      connected: true,
      nowMs: 999,
    }),
  ).toMatchObject({ phase: "uncertain", animate: false });
});
