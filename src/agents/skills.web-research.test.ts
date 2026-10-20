import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACK_STARTER } from "../gateway/capability-packs/starter-packs.js";
import { parseFrontmatter, resolveOpenClawMetadata } from "./skills/frontmatter.js";

const skillRoot = path.resolve(process.cwd(), "skills", "web-research");
const scriptPath = path.join(skillRoot, "scripts", "run_research.py");

describe("skills/web-research", () => {
  it("is a valid bundled skill on the starter pack", () => {
    const skillMd = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
    const frontmatter = parseFrontmatter(skillMd);
    expect(frontmatter.name).toBe("web-research");
    expect(String(frontmatter.description ?? "")).toMatch(/意图 \+ 信息时效性 \+ 用户要求/);
    expect(resolveOpenClawMetadata(frontmatter)?.promptPriority).toBe(90);
    expect(skillMd).toMatch(/二选一即可/);
    expect(skillMd).toMatch(/web_search` 缺 key 时只记一条限制/);
    expect(PACK_STARTER.skills.some((skill) => skill.skillKey === "web-research")).toBe(true);
  });

  it("plans queries and validates the example task without network", () => {
    const plan = spawnSync(
      "python3",
      [scriptPath, "--plan", "--question", "开源智能体平台竞品", "--depth", "deep"],
      { encoding: "utf8", env: { ...process.env, MOCK_MODE: "true" } },
    );
    expect(plan.status, plan.stderr).toBe(0);
    const planned = JSON.parse(plan.stdout) as { queries: string[]; mock_mode: boolean };
    expect(planned.mock_mode).toBe(true);
    expect(planned.queries.length).toBeGreaterThanOrEqual(3);

    const exampleTask = path.join(skillRoot, "references", "example_task.json");
    const validated = spawnSync("python3", [scriptPath, "--validate", exampleTask], {
      encoding: "utf8",
    });
    expect(validated.status, validated.stderr).toBe(0);
    expect(JSON.parse(validated.stdout)).toMatchObject({
      ok: true,
      task: { research_question: expect.any(String) },
    });
  });

  it("writes mock deliverables that are marked non-evidential", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "web-research-"));
    const run = spawnSync(
      "python3",
      [scriptPath, "--question", "示例调研问题", "--depth", "quick", "--out-dir", outDir],
      { encoding: "utf8", env: { ...process.env, MOCK_MODE: "true" } },
    );
    expect(run.status, run.stderr).toBe(0);
    const payload = JSON.parse(run.stdout) as {
      mock_mode: boolean;
      limitations: string[];
      sources: Array<{ url: string }>;
    };
    expect(payload.mock_mode).toBe(true);
    expect(payload.limitations.some((item) => item.includes("MOCK_MODE"))).toBe(true);
    expect(payload.sources[0]?.url).toContain("example.com");
    expect(fs.readFileSync(path.join(outDir, "report.md"), "utf8")).toContain("MOCK_MODE");
    expect(fs.existsSync(path.join(outDir, "sources.md"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "claims.json"))).toBe(true);
  });
});
