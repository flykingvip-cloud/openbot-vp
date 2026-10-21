import { describe, expect, it } from "vitest";
import { buildExecutionPreflight } from "../execution-preflight/resolve.js";
import { isSilentExecFishingStop, settleTurnCompletion } from "../turn-completion/contract.js";
import {
  formatActiveSkillGlossary,
  isActiveSkillTerminologyStopAsk,
  parseSkillTerminologyField,
  resolveActiveSkillGlossary,
} from "./glossary.js";

const OAUTH_ASK = "绑定方向指哪一侧：微信运营身份、邮箱，还是知识源？";
const CONTINUE = "沙箱已经具备 Playwright 和 Node 20 这个条件了，请继续尝试";

describe("active skill glossary", () => {
  it("parses a skill manifest terminology hook", () => {
    expect(parseSkillTerminologyField("口径=本次评审使用的统计口径|价格/支付")).toEqual([
      { term: "口径", meaning: "本次评审使用的统计口径", not: ["价格", "支付"] },
    ]);
  });

  it("injects consulting-report 绑定 for a smoke trial and not for ordinary chat", () => {
    const trial = formatActiveSkillGlossary({ userText: "请做技能试跑，只要样张" });
    expect(trial).toContain("sha256");
    expect(trial).toContain("不是微信、邮箱、知识源、OAuth、运营身份");
    expect(trial).not.toMatch(/绑定方向是微信还是邮箱/);
    expect(formatActiveSkillGlossary({ userText: "今天吃什么" })).toBe("");
  });

  it("lets a bound skill replace the platform term", () => {
    const entries = resolveActiveSkillGlossary({
      boundSkillIds: ["consulting-report-forge"],
      manifests: [
        {
          skillId: "consulting-report-forge",
          frontmatter: {
            terminology: "绑定=只对照 task.json 的 sha256|微信/邮箱",
          },
        },
      ],
    });
    expect(entries[0]?.terms[0]?.meaning).toBe("只对照 task.json 的 sha256");
  });

  it("does not stop-ask OAuth 绑定 during a skill trial", () => {
    expect(isActiveSkillTerminologyStopAsk(OAUTH_ASK, "analysis-review task.json sha256")).toBe(
      true,
    );
    expect(isSilentExecFishingStop(OAUTH_ASK, CONTINUE)).toBe(true);
    const prompt = buildExecutionPreflight({
      taskId: "task-skill",
      sessionId: "session-skill",
      message: `${CONTINUE}。这是 consulting-report-forge 技能试跑。`,
      skills: [],
      policyToolNames: ["read", "write"],
      qualify: () => ({ kind: "short_action", reasons: ["test"] }),
    }).bindingPrompt;
    expect(prompt).toContain("sha256");
    expect(prompt).toContain("不是微信");
    expect(prompt ?? "").not.toMatch(/请选择微信|绑定方向是微信还是邮箱/);

    const settled = settleTurnCompletion({
      userText: `${CONTINUE}。analysis-review 的绑定是 task.json sha256。`,
      assistantText: OAUTH_ASK,
      skillSmoke: true,
    });
    expect(settled.contract?.state).not.toBe("true_fork");
    expect(settled.visibleText).not.toMatch(/微信|邮箱|知识源/);
  });
});
