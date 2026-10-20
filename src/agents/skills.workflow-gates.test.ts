import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readSkill(...parts: string[]): string {
  return fs.readFileSync(path.join(ROOT, "skills", ...parts), "utf-8");
}

describe("workflow gates absorbed into existing skills", () => {
  it("keeps research discovery separate from archive", () => {
    const stages = readSkill("web-research", "references", "stages.md");
    expect(stages).toContain("检索不等于下载");
    expect(stages).toContain("candidates.md");
    expect(readSkill("web-research", "SKILL.md")).toContain("调研三分流");
    expect(readSkill("deep-research", "references", "evidence.md")).toContain("unfetched");
    expect(readSkill("research-core", "SKILL.md")).toContain("保留缺口");
  });

  it("requires WeChat snapshot acceptance before bind", () => {
    const skill = readSkill("wechat-personal-kb", "SKILL.md");
    expect(skill).toContain("accept_snapshot.py");
    expect(skill).toContain("微信快照验收");
    expect(readSkill("wechat-personal-kb", "references", "snapshot-accept.md")).toContain(
      "不可信输入",
    );
  });

  it("adds Official Account archive without publishing", () => {
    const skill = readSkill("wechat-article", "SKILL.md");
    expect(skill).toContain("Archive mode");
    expect(skill).toContain("archive-from-url.md");
    expect(skill).toContain("draft-handoff");
    expect(skill).toContain("promptPriority: 87");
    expect(skill).not.toMatch(
      /Publish to the WeChat draft box with `scripts\/publish_agi_axios\.js`/,
    );
    expect(readSkill("wechat-article", "references", "archive-from-url.md")).toContain(
      "不要：扫码登录",
    );
  });

  it("keeps Official Account ops planning out of promptPriority defaults", () => {
    const skill = readSkill("wechat-official-account", "SKILL.md");
    expect(skill).toContain("详细运营策划");
    expect(skill).not.toContain("promptPriority");
    expect(skill).toContain("wechat-article");
    expect(skill).toContain("wechat-official-credential");
  });

  it("keeps content-ops downloads on confirmed links and 3:4 as repurpose", () => {
    expect(readSkill("content-ops", "SKILL.md")).toContain("已知链接素材");
    expect(readSkill("content-ops", "references", "known-link.md")).toContain("3:4");
    expect(readSkill("content-ops", "references", "repurpose.md")).toContain("3:4 图组");
  });

  it("requires gardener prewrite reconcile and closeout", () => {
    const skill = readSkill("knowledge-gardener", "SKILL.md");
    expect(skill).toContain("预写对账");
    expect(skill).toContain("closeout");
    expect(readSkill("knowledge-gardener", "references", "closeout.md")).toContain("不手改 SQLite");
  });

  it("routes ASR to a single provider per file", () => {
    const routing = readSkill("openai-whisper", "references", "routing.md");
    expect(routing).toContain("一个音频一个供应商");
    expect(routing).toContain("禁止并行提交");
    expect(readSkill("openai-whisper-api", "SKILL.md")).toContain("One audio, one provider");
  });

  it("passes deterministic script self-tests", () => {
    const scripts = [
      ["wechat-personal-kb", "scripts", "accept_snapshot.py"],
      ["content-ops", "scripts", "known_link.py"],
    ];
    for (const parts of scripts) {
      const output = execFileSync("python3", [path.join(ROOT, "skills", ...parts), "--self-test"], {
        encoding: "utf-8",
      });
      expect(output).toContain("self-test ok");
    }
  });
});
