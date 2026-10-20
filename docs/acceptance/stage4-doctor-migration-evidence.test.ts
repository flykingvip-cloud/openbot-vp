/**
 * Stage 4 doctor migration dry-run / confirm-switch E3.
 *
 * Proposition (§5.3 迁移): each destructive doctor migration has a dry-run
 * (preview) or confirm switch, with named tests. This file proves real product
 * behavior on temp dirs — not Stage 4 overall PASS; stage8_eligible stays false.
 * Tenant shard / single-shot runtime remain open.
 *
 * Companion tests (named in ledger):
 * - doctor.runs-legacy-state-migrations-yes-mode-without.e2e.test.ts
 *   (yes / nonInteractive apply without prompt; confirm decline skips migrate)
 * - doctor-cron.test.ts (confirm false leaves cron store unchanged)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { maybeRepairLegacyCronStore } from "../../src/commands/doctor-cron.js";
import { detectLegacyStateMigrations } from "../../src/commands/doctor-state-migrations.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

describe("Stage 4 doctor migration dry-run / confirm (E3)", () => {
  it("legacy sessions preview is detect-only (no agents/<id>/sessions created)", async () => {
    const root = tempRoot("stage4-doctor-preview-");
    const sessionsDir = path.join(root, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, "legacy.jsonl"), '{"type":"message"}\n', "utf8");

    const detected = await detectLegacyStateMigrations({
      cfg: {},
      env: { OPENCLAW_STATE_DIR: root, OPENBOT_STATE_DIR: root } as NodeJS.ProcessEnv,
    });

    expect(detected.preview.length).toBeGreaterThan(0);
    expect(detected.preview.join("\n")).toContain(
      `- Sessions: ${path.join(root, "sessions")} → ${path.join(root, "agents", "main", "sessions")}`,
    );
    expect(fs.existsSync(path.join(root, "agents", "main", "sessions"))).toBe(false);
    expect(detected.sessions.hasLegacy).toBe(true);
  });

  it("legacy cron repair respects confirm=false (store bytes unchanged)", async () => {
    const root = tempRoot("stage4-doctor-cron-");
    const storePath = path.join(root, "jobs.json");
    const before = JSON.stringify(
      {
        version: 1,
        jobs: [
          {
            jobId: "legacy-job",
            schedule: { kind: "cron", cron: "*/5 * * * *", tz: "UTC" },
            message: "say hi",
          },
        ],
      },
      null,
      2,
    );
    fs.writeFileSync(storePath, before, "utf8");

    await maybeRepairLegacyCronStore({
      cfg: { cron: { store: storePath } },
      options: {},
      prompter: { confirm: async () => false },
    });

    expect(fs.readFileSync(storePath, "utf8")).toBe(before);
  });

  it("legacy cron repair with confirm=true normalizes the store (switch works both ways)", async () => {
    const root = tempRoot("stage4-doctor-cron-yes-");
    const storePath = path.join(root, "jobs.json");
    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          version: 1,
          jobs: [
            {
              // Legacy shape: `id` instead of `jobId`, bare `message` payload.
              id: "legacy-job",
              name: "Legacy",
              createdAtMs: Date.parse("2026-02-01T00:00:00.000Z"),
              updatedAtMs: Date.parse("2026-02-02T00:00:00.000Z"),
              schedule: { kind: "every", everyMs: 60_000 },
              message: "say hi",
              state: {},
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await maybeRepairLegacyCronStore({
      cfg: { cron: { store: storePath } },
      options: {},
      prompter: { confirm: async () => true },
    });

    const after = JSON.parse(fs.readFileSync(storePath, "utf8")) as {
      jobs: Array<Record<string, unknown>>;
    };
    expect(after.jobs[0]?.jobId ?? after.jobs[0]?.id).toBeTruthy();
    // Normalized payload shape — message field promoted / retired.
    expect(after.jobs[0]?.message).toBeUndefined();
    expect(after.jobs[0]?.payload).toBeTruthy();
  });
});
