// @vitest-environment jsdom
// Feature: enterprise-capability-usage-management
// Property 1 (DOM end-to-end): 术语黑名单守卫

import * as fc from "fast-check";
import { html, render } from "lit-html";
import { describe, expect, it } from "vitest";
import { scanNode } from "../../../capability/runtime-projection/term-blacklist.ts";
import type {
  RobotCapabilityUsageView,
  RobotDetail,
} from "../../../capability/runtime-projection/types.ts";
import { HEALTH_STATUSES } from "../../../capability/runtime-projection/types.ts";
import { renderRobotCapabilityTable } from "../robot-capability-table.ts";
import { renderRobotDetailPanel } from "../robot-detail-panel.ts";

const robotViewArb: fc.Arbitrary<RobotCapabilityUsageView> = fc.record({
  robotId: fc
    .string({ minLength: 1, maxLength: 16 })
    .filter((s) => /^[a-z0-9-]+$/.test(s) && s.length > 0),
  robotName: fc.constantFrom("CRM 助手", "财务机器人", "HR 小助手", "客服机器人", "数据分析助手"),
  capabilityCount: fc.nat({ max: 100 }),
  monthlyExecutions: fc.nat({ max: 100000 }),
  employeeCoverage: fc.nat({ max: 1000 }),
  successRate: fc.double({ min: 0, max: 1, noNaN: true }),
  healthStatus: fc.constantFrom(...HEALTH_STATUSES, "暂无数据" as const),
  topCapabilities: fc.array(
    fc.constantFrom("客户跟进", "邮件草稿", "会议纪要", "财务报表", "审批流程"),
    { maxLength: 5 },
  ),
});

describe("Property 1 (DOM end-to-end): no blacklist tokens in rendered output", () => {
  it("renderRobotCapabilityTable rendered DOM contains no blacklist tokens", () => {
    fc.assert(
      fc.property(fc.array(robotViewArb, { minLength: 1, maxLength: 5 }), (items) => {
        const container = document.createElement("div");
        render(
          renderRobotCapabilityTable({
            items,
            sorting: { field: "monthlyExecutions", direction: "desc" },
            onSort: () => {},
            onViewDetail: () => {},
          }),
          container,
        );
        const hit = scanNode(container);
        expect(hit, `blacklist hit: ${hit}`).toBeNull();
      }),
      { numRuns: 50 },
    );
  });

  it("renderRobotDetailPanel rendered DOM contains no blacklist tokens", () => {
    fc.assert(
      fc.property(robotViewArb, (item) => {
        const detail: RobotDetail = {
          robotId: item.robotId,
          robotName: item.robotName,
          healthStatus: item.healthStatus,
          lastActiveAt: Date.now(),
          capabilities: [],
          trend30d: { dates: [], dailyExecutions: [] },
          employeeCoverage: item.employeeCoverage,
          topCapabilities: item.topCapabilities,
        };
        const container = document.createElement("div");
        render(
          renderRobotDetailPanel({
            data: detail,
            loading: false,
            onClose: () => {},
          }),
          container,
        );
        const hit = scanNode(container);
        expect(hit, `blacklist hit: ${hit}`).toBeNull();
      }),
      { numRuns: 50 },
    );
  });

  it("empty state message contains no blacklist tokens", () => {
    const container = document.createElement("div");
    render(
      html`
        <div>当前筛选条件下没有匹配的机器人</div>
      `,
      container,
    );
    expect(scanNode(container)).toBeNull();
  });

  it("malformed input with downgraded health status renders cleanly", () => {
    const malformed: RobotCapabilityUsageView = {
      robotId: "r1",
      robotName: "Test Bot",
      capabilityCount: 0,
      monthlyExecutions: 0,
      employeeCoverage: 0,
      successRate: 0,
      healthStatus: "暂无数据",
      topCapabilities: [],
    };
    const container = document.createElement("div");
    render(
      renderRobotCapabilityTable({
        items: [malformed],
        sorting: { field: "monthlyExecutions", direction: "desc" },
        onSort: () => {},
        onViewDetail: () => {},
      }),
      container,
    );
    expect(scanNode(container)).toBeNull();
    expect(container.textContent).toContain("暂无数据");
  });
});
