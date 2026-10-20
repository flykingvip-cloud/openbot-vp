import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteTeamCronTaskTemplate,
  listTeamCronTaskTemplates,
  resolveTeamCronTemplateFileName,
  upsertTeamCronTaskTemplate,
} from "./task-templates-store.js";

const tenantId = "tenant-acme";

function baseTemplate(id: string) {
  return {
    id,
    name: `Template ${id}`,
    summary: "summary",
    category: "ops",
    intentText: "do something",
    goal: "deliver output",
    acceptanceRules: ["rule-1"],
    schedulePreset: "daily",
    dailyTime: "09:00",
    suggestedAgents: ["agent-1"],
    suggestedGroups: ["space:group-1"],
    priority: "normal",
  };
}

describe("task-templates-store", () => {
  let stateDir = "";

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (stateDir) {
      await fs.rm(stateDir, { recursive: true, force: true });
      stateDir = "";
    }
  });

  async function setupStateDir() {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-cron-templates-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
  }

  it("sanitizes tenant id in file name", () => {
    expect(resolveTeamCronTemplateFileName("tenant/acme")).toBe("team__tenant_acme.json");
  });

  it("returns empty list when store file is missing", async () => {
    await setupStateDir();
    await expect(listTeamCronTaskTemplates(tenantId)).resolves.toEqual([]);
  });

  it("upserts, lists newest first, and deletes templates", async () => {
    await setupStateDir();
    const first = await upsertTeamCronTaskTemplate({
      tenantId,
      template: { ...baseTemplate("tpl-1"), updatedAtMs: 100 },
    });
    const second = await upsertTeamCronTaskTemplate({
      tenantId,
      template: { ...baseTemplate("tpl-2"), updatedAtMs: 200 },
    });

    expect(first.scope).toBe("team");
    expect(second.scope).toBe("team");

    const listed = await listTeamCronTaskTemplates(tenantId);
    expect(listed.map((entry) => entry.id)).toEqual(["tpl-2", "tpl-1"]);

    const updatedFirst = await upsertTeamCronTaskTemplate({
      tenantId,
      template: { ...baseTemplate("tpl-1"), name: "Updated", updatedAtMs: 300 },
    });
    expect(updatedFirst.name).toBe("Updated");
    expect((await listTeamCronTaskTemplates(tenantId)).map((entry) => entry.id)).toEqual([
      "tpl-1",
      "tpl-2",
    ]);

    await expect(deleteTeamCronTaskTemplate({ tenantId, templateId: "missing" })).resolves.toBe(
      false,
    );
    await expect(deleteTeamCronTaskTemplate({ tenantId, templateId: "tpl-2" })).resolves.toBe(true);
    expect(await listTeamCronTaskTemplates(tenantId)).toHaveLength(1);
  });

  it("persists template dataBindings", async () => {
    await setupStateDir();
    const saved = await upsertTeamCronTaskTemplate({
      tenantId,
      template: {
        ...baseTemplate("tpl-bindings"),
        dataBindings: [
          {
            bindingId: "runtime-today",
            kind: "runtime_date",
            resourceId: "today",
            label: "今天日期",
          },
        ],
      },
    });
    expect(saved.dataBindings).toHaveLength(1);
    const listed = await listTeamCronTaskTemplates(tenantId);
    expect(listed[0]?.dataBindings?.[0]?.bindingId).toBe("runtime-today");
  });

  it("caps team templates at 48 entries", async () => {
    await setupStateDir();
    for (let index = 0; index < 50; index += 1) {
      await upsertTeamCronTaskTemplate({
        tenantId,
        template: { ...baseTemplate(`tpl-${index}`), updatedAtMs: index },
      });
    }
    const listed = await listTeamCronTaskTemplates(tenantId);
    expect(listed).toHaveLength(48);
    expect(listed[0]?.id).toBe("tpl-49");
    expect(listed.at(-1)?.id).toBe("tpl-2");
  });
});
