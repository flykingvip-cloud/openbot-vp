import { describe, expect, it } from "vitest";
import { GatewayRequestError } from "../../gateway.ts";
import {
  packSkillReviewSubmitParams,
  readPackSkillReviewInstallBlock,
} from "./pack-skill-review-install.ts";

describe("pack skill review install CTA", () => {
  it("reads the structured next step and builds a create payload without install fields", () => {
    const block = readPackSkillReviewInstallBlock(
      new GatewayRequestError({
        code: "INVALID_REQUEST",
        message: "该技能需要企业审核。请先提交审核，管理员批准并开通后才能安装。",
        details: {
          code: "PACK_SKILL_REVIEW_REQUIRED",
          nextStep: "submit_pack_skill_review",
          packId: "cn-office",
          skillKey: "feishu-integration",
          targetRobotId: "robot-1",
          capabilityId: "urn:openbot:skill:feishu-integration@1.0.0",
        },
      }),
    );
    expect(block?.nextStep).toBe("submit_pack_skill_review");
    expect(packSkillReviewSubmitParams(block!)).toEqual({
      category: "pack_skill_review",
      packId: "cn-office",
      skillKey: "feishu-integration",
      targetRobotId: "robot-1",
      reason: "申请安装需企业审核的技能包能力",
    });
    expect(packSkillReviewSubmitParams(block!)).not.toHaveProperty("fulfillmentMode");
  });

  it("ignores unrelated install errors", () => {
    expect(readPackSkillReviewInstallBlock(new Error("扫描未通过"))).toBeNull();
  });
});
