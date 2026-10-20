import { describe, expect, it } from "vitest";
import {
  buildClaimConflictOptions,
  dedupeClaimCandidates,
  formatClaimSlotLabel,
  isPlaceholderClaimValue,
  resolveAdoptedClaimChoice,
  scoreClaimValueQuality,
} from "./knowledge-universe-governance-claim-conflict.ts";

describe("knowledge-universe-governance-claim-conflict", () => {
  it("detects placeholder claim values", () => {
    expect(isPlaceholderClaimValue("{{ 加入链接 }}")).toBe(true);
    expect(isPlaceholderClaimValue("https://meet.example.com")).toBe(false);
    expect(scoreClaimValueQuality("https://meet.example.com")).toBeGreaterThan(
      scoreClaimValueQuality("{{ 密码 }}"),
    );
  });

  it("dedupes candidates by display value and recommends the best option", () => {
    const options = dedupeClaimCandidates([
      { claimId: "c1", value: "https://meet.example.com", chunkId: "ch1" },
      { claimId: "c2", value: "https://meet.example.com", chunkId: "ch2" },
      { claimId: "c3", value: "{{ 加入链接 }}", chunkId: "ch3" },
      { claimId: "c4", value: "{{ 加入链接 }}", chunkId: "ch4" },
    ]);

    expect(options).toHaveLength(2);
    expect(options[0]?.displayValue).toBe("https://meet.example.com");
    expect(options[0]?.recommended).toBe(true);
    expect(options[0]?.sourceCount).toBe(2);
    expect(options[1]?.isPlaceholder).toBe(true);
    expect(options[1]?.recommended).toBe(false);
  });

  it("formats slot labels from subject or normalized key", () => {
    expect(formatClaimSlotLabel({ subject: "会议链接" })).toBe("会议链接");
    expect(formatClaimSlotLabel({ normalizedKey: "meeting:link" })).toBe("meeting · link");
  });

  it("builds options from governance task payload", () => {
    const { meta, options } = buildClaimConflictOptions({
      taskType: "claim_conflict",
      proposedResolution: {
        subject: "会议密码",
        normalizedKey: "pwd:key",
        candidates: [
          { claimId: "a", value: "无", chunkId: "1", claimText: "会议密码：无" },
          { claimId: "b", value: "{{ 密码 }}", chunkId: "2", claimText: "会议密码：{{ 密码 }}" },
        ],
      },
    });

    expect(meta.subject).toBe("会议密码");
    expect(options).toHaveLength(2);
    expect(options.find((option) => option.displayValue === "无")?.recommended).toBe(true);
  });

  it("resolves adopted claim choice for success notice copy", () => {
    const task = {
      taskType: "claim_conflict",
      proposedResolution: {
        subject: "会议链接",
        candidates: [
          { claimId: "c1", value: "https://meet.example.com", chunkId: "ch1" },
          { claimId: "c2", value: "{{ 加入链接 }}", chunkId: "ch2" },
        ],
      },
    };
    expect(resolveAdoptedClaimChoice(task, "c1")).toEqual({
      slotLabel: "会议链接",
      displayValue: "https://meet.example.com",
    });
    expect(resolveAdoptedClaimChoice(task, "c2")?.displayValue).toBe("{{ 加入链接 }}");
  });
});
