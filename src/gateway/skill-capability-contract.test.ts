import { describe, expect, it } from "vitest";
import {
  assessSkillAvailability,
  inferCapabilityVerbsFromText,
  matchCapabilityIntent,
  resolveVerbsForSkillKey,
  skillKeysForPackRecipe,
  skillCapabilityTaskLabel,
} from "./skill-capability-contract.js";

describe("skill capability contract", () => {
  it("maps starter pack keys to verbs", () => {
    expect(resolveVerbsForSkillKey("summarize")).toEqual(["text.summarize"]);
    expect(resolveVerbsForSkillKey("meeting-notes-specialist")).toEqual([
      "meeting.notes",
      "text.summarize",
    ]);
    expect(resolveVerbsForSkillKey("openai-whisper-api")).toEqual(["speech.transcribe"]);
    expect(resolveVerbsForSkillKey("openai-whisper")).toEqual(["speech.transcribe"]);
    expect(resolveVerbsForSkillKey("web-research")).toEqual(["web.search", "research.web"]);
    expect(resolveVerbsForSkillKey("browser-scan-proxy")).toEqual(["browser.scan-proxy"]);
    expect(resolveVerbsForSkillKey("wechat-official-credential")).toEqual([
      "identity.wechat-official",
    ]);
  });

  it("infers verbs from employee language", () => {
    expect(inferCapabilityVerbsFromText("帮我写会议纪要")).toContain("meeting.notes");
    expect(inferCapabilityVerbsFromText("语音转文字")).toContain("speech.transcribe");
    expect(inferCapabilityVerbsFromText("帮我做网页调研")).toContain("research.web");
    expect(inferCapabilityVerbsFromText("你打开网页我来扫码")).toContain("browser.scan-proxy");
    expect(inferCapabilityVerbsFromText("配公众号 IP 白名单")).toContain(
      "identity.wechat-official",
    );
  });

  it("matches intent against candidates without exposing runtime names", () => {
    const matches = matchCapabilityIntent("做会议纪要", [
      {
        id: "notes",
        name: "会议纪要专家",
        summary: "整理会议纪要",
        tags: [],
        category: "productivity",
        verbs: ["meeting.notes"],
        installed: false,
        lifecycle: "published",
      },
    ]);
    expect(matches[0]?.task).toBe("整理会议纪要");
    expect(matches[0]?.assessment.status).toBe("can_use_now");
    expect(JSON.stringify(matches)).not.toContain("runtimeDefinition");
    expect(JSON.stringify(matches)).not.toContain("provider");
  });

  it("blocks secret and native installs with employee next steps", () => {
    expect(
      assessSkillAvailability({
        id: "openai-whisper-api",
        name: "语音转写",
        summary: "转写",
        tags: [],
        category: "productivity",
        verbs: ["speech.transcribe"],
        installed: false,
        secrets: true,
      }).installAllowed,
    ).toBe(false);
    expect(
      assessSkillAvailability({
        id: "openai-whisper",
        name: "本地转写",
        summary: "转写",
        tags: [],
        category: "productivity",
        verbs: ["speech.transcribe"],
        installed: false,
        native: true,
      }).nextStep,
    ).toContain("本机");
    expect(
      assessSkillAvailability({
        id: "openai-whisper-api",
        name: "语音转写",
        summary: "转写",
        tags: [],
        category: "productivity",
        verbs: ["speech.transcribe"],
        installed: false,
        lifecycle: "reviewing",
        secrets: true,
      }).installAllowed,
    ).toBe(false);
    expect(
      assessSkillAvailability({
        id: "customer-summary",
        name: "客户摘要",
        summary: "整理客户沟通",
        tags: [],
        category: "writing",
        verbs: ["text.summarize"],
        installed: false,
        lifecycle: "reviewing",
      }).installAllowed,
    ).toBe(true);
  });

  it("resolves starter meeting-followup recipe to pack skill keys", () => {
    const keys = skillKeysForPackRecipe("starter", "meeting-followup");
    expect(keys).toContain("meeting-notes-specialist");
    expect(keys).toContain("summarize");
    expect(skillCapabilityTaskLabel("text.summarize")).toBe("整理摘要");
  });
});
