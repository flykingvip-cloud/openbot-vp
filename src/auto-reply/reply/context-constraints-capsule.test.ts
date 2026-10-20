import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildContextConstraintsCapsule } from "./context-constraints-capsule.js";

describe("buildContextConstraintsCapsule", () => {
  const workspaceDir = path.join(os.tmpdir(), `openbot-constraints-${Date.now()}`);

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("includes AGENTS.md red lines and retention summary", async () => {
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "AGENTS.md"),
      "## Session Startup\nAlways greet the user.\n\n## Red Lines\nNever share secrets.\n",
      "utf-8",
    );
    const text = buildContextConstraintsCapsule({
      cfg: {
        gateway: {
          tenantPolicies: {
            default: { retention: { conversation: { deleteAfterDays: 90 } } },
          },
        },
      },
      workspaceDir,
    });
    expect(text).toContain("Always greet the user");
    expect(text).toContain("Never share secrets");
    expect(text).toContain("90");
  });
});
