import { expect, it, vi } from "vitest";
import { renderRunSkillContext } from "./run-skills.js";
it.each([true, false])("preserves two-stage order, bytes and selection: live=%s", (live) => {
  const events: string[] = [];
  const entries = [{ name: "skill" }];
  const snapshot = { prompt: " snapshot " };
  const input = { workspaceDir: "/workspace", config: { enabled: true }, skillsSnapshot: snapshot };
  const resolve = vi.fn(() => {
    events.push("resolve");
    return { shouldLoadSkillEntries: live, skillEntries: entries, preferLiveEntries: live };
  });
  const prepared = { input, selection: resolve() };
  events.push("environment");
  const render = vi.fn((value: { entries?: typeof entries; accountSandboxLocations: boolean }) => {
    events.push("render");
    expect(value.entries).toBe(live ? entries : undefined);
    expect(value.accountSandboxLocations).toBe(true);
    return "  exact prompt\n";
  });
  const observe = vi.fn(
    (value: { skillsPrompt: string; liveEntries: typeof entries; snapshot?: typeof snapshot }) => {
      events.push("observe");
      expect(value.skillsPrompt).toBe("  exact prompt\n");
      expect(value.liveEntries).toEqual(live ? entries : []);
      expect(value.snapshot).toBe(snapshot);
    },
  );
  expect(
    renderRunSkillContext(
      prepared,
      { runId: "run", accountSandboxLocations: true },
      { render, observe },
    ),
  ).toBe("  exact prompt\n");
  expect(events).toEqual(["resolve", "environment", "render", "observe"]);
  expect(resolve).toHaveBeenCalledOnce();
  expect(render).toHaveBeenCalledOnce();
  expect(observe).toHaveBeenCalledOnce();
});
