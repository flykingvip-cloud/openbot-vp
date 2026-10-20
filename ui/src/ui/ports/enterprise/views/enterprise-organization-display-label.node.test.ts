import { describe, expect, it } from "vitest";
import {
  buildOrganizationMemberDisplayLookup,
  isOrganizationEmailLikeLabel,
  resolveOrganizationDigitalHumanName,
  resolveOrganizationHumanLabel,
  resolveOrganizationMemberDisplayLabel,
  resolveOrganizationSeatDisplayName,
  stripOrganizationSeatIdSuffix,
} from "./enterprise-organization-display-label.ts";

describe("organization display labels", () => {
  it("does not treat a job title as an email", () => {
    expect(isOrganizationEmailLikeLabel("销售助理")).toBe(false);
    expect(resolveOrganizationSeatDisplayName("销售助理")).toBe("销售助理");
  });

  it("does not render an email as a seat title", () => {
    expect(resolveOrganizationSeatDisplayName("13126587994@163.com")).toBe("待补岗位名");
    expect(resolveOrganizationSeatDisplayName("368809901@qq.com")).toBe("待补岗位名");
    expect(resolveOrganizationSeatDisplayName("")).toBe("待补岗位名");
  });

  it("prefers a human explicit name over an email lookup", () => {
    const lookup = buildOrganizationMemberDisplayLookup([
      { user: "zhangfei@example.com", displayLabel: "张飞" },
    ]);
    expect(
      resolveOrganizationMemberDisplayLabel({
        lookup,
        userId: "zhangfei@example.com",
        explicitDisplayName: "张飞",
      }),
    ).toBe("张飞");
  });

  it("does not return a full email when lookup or explicit is an email", () => {
    const lookup = buildOrganizationMemberDisplayLookup([
      { user: "368809901@qq.com", displayLabel: "368809901@qq.com" },
    ]);
    expect(
      resolveOrganizationMemberDisplayLabel({
        lookup,
        userId: "368809901@qq.com",
        explicitDisplayName: "368809901@qq.com",
      }),
    ).toBe("368809901");
    expect(lookup.size).toBe(0);
  });

  it("uses the email local-part when the pending user is not in members", () => {
    expect(
      resolveOrganizationMemberDisplayLabel({
        lookup: new Map(),
        userId: "hedon25@126.com",
        explicitDisplayName: "hedon25@126.com",
      }),
    ).toBe("hedon25");
  });

  it("names a digital human from the position, never a role code or agent id", () => {
    expect(resolveOrganizationDigitalHumanName("销售助理")).toBe("销售助理数字人");
    expect(resolveOrganizationDigitalHumanName("CEO")).toBe("CEO数字人");
    expect(resolveOrganizationDigitalHumanName("368809901@qq.com")).toBe("待补数字人名");
    expect(resolveOrganizationDigitalHumanName("90fed19a-1c8b-4420-87e0-bcc6165e32fa")).toBe(
      "待补数字人名",
    );
  });

  it("does not render a user id as a position or person name", () => {
    expect(resolveOrganizationSeatDisplayName("1b25d120-013f-4ad5-b64a-bb0f9e1cd490")).toBe(
      "待补岗位名",
    );
    expect(resolveOrganizationHumanLabel("90fed19a-1c8b-4420-87e0-bcc6165e32fa")).toBeNull();
    expect(
      resolveOrganizationMemberDisplayLabel({
        lookup: new Map(),
        userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
        explicitDisplayName: null,
      }),
    ).toBeNull();
  });

  it("strips a stored seat id from an approval asset label", () => {
    expect(
      stripOrganizationSeatIdSuffix("客户画像能力 · 席位 1b25d120-013f-4ad5-b64a-bb0f9e1cd490"),
    ).toBe("客户画像能力");
    expect(stripOrganizationSeatIdSuffix("客户画像能力")).toBe("客户画像能力");
  });
});
