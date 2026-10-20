// @vitest-environment jsdom
/**
 * Standalone enterprise Decision Surface element tests. The element is
 * imported here directly. The enterprise Mesh page also imports it, behind the
 * closed runtime gate (D3.3 mount, see enterprise-evolution-decision-mount.node.test.ts).
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import {
  captureEvolutionDecisionCommandRecord,
  routeEvolutionDecisionSurface,
  type EvolutionDecisionPrincipal,
  type EvolutionEnterpriseDecisionFact,
} from "@openbot/evolution-core";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import "./enterprise-evolution-decision-surface.ts";
import { EVOLUTION_ENTERPRISE_DECISION_COPY } from "../evolution-decision/copy.ts";
import {
  ENTERPRISE_DECISION_INTERNAL_CONTRACT_TOKENS,
  PERSONAL_SECRETS,
  PLATFORM_SECRETS,
  canaryParticipationFact,
  enterpriseFact,
  enterpriseHistory,
  enterprisePrincipal,
  enterpriseSubmitContext,
  enterpriseUserVisibleText,
  failingEnterpriseHistorySource,
  personalParticipationFact,
  sequentialCommandIds,
  staticEnterpriseHistorySource,
} from "../evolution-decision/evolution-decision-test-fixtures.ts";
import { enterpriseEvolutionDecisionSurfaceMountEnabled } from "../evolution-decision/runtime-gate.ts";
import type {
  EvolutionEnterpriseDecisionCommandIdFactory,
  EvolutionEnterpriseDecisionHistorySource,
  EvolutionEnterpriseDecisionSubmitContext,
} from "../evolution-decision/types.ts";

const TAG = "enterprise-evolution-decision-surface";
const COPY = EVOLUTION_ENTERPRISE_DECISION_COPY;

type MountInput = {
  current?: EvolutionEnterpriseDecisionFact[];
  prior?: EvolutionEnterpriseDecisionFact[] | null;
  source?: EvolutionEnterpriseDecisionHistorySource | null;
  principal?: EvolutionDecisionPrincipal | null;
  contexts?: Map<string, EvolutionEnterpriseDecisionSubmitContext>;
  commandIdFactory?: EvolutionEnterpriseDecisionCommandIdFactory | null;
};

async function mountSurface(input: MountInput = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const el = document.createElement(TAG);
  el.principal = input.principal === undefined ? enterprisePrincipal() : input.principal;
  el.historySource =
    input.source === undefined
      ? staticEnterpriseHistorySource(
          enterpriseHistory(
            input.current ?? [enterpriseFact()],
            input.prior === undefined ? [enterpriseFact()] : input.prior,
          ),
        )
      : input.source;
  el.submitContexts = input.contexts ?? new Map();
  el.commandIdFactory =
    input.commandIdFactory === undefined ? sequentialCommandIds() : input.commandIdFactory;
  host.append(el);
  await el.updateComplete;
  if (el.principal && el.historySource && el.querySelector(".enterprise-evolution-decision")) {
    await vi.waitFor(() => {
      expect(el.querySelector("[data-phase], [data-wow-availability]")).not.toBeNull();
    });
  }
  await el.updateComplete;
  return { host, el };
}

function rowOf(host: Element, decisionId: string): HTMLElement {
  const row = host.querySelector<HTMLElement>(`[data-decision-id='${decisionId}']`);
  if (!row) {
    throw new Error(`row ${decisionId} not rendered`);
  }
  return row;
}

function text(node: Element | null | undefined): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function fieldText(row: Element, field: string): string {
  return text(row.querySelector(`[data-field='${field}']`));
}

function fieldTexts(row: Element, field: string): string[] {
  return [...row.querySelectorAll(`[data-field='${field}']`)].map((node) => text(node));
}

function buttonLabels(row: Element): string[] {
  return [...row.querySelectorAll(".enterprise-evolution-decision__action")].map((button) =>
    text(button),
  );
}

async function click(el: HTMLElement & { updateComplete: Promise<boolean> }, selector: string) {
  const button = el.querySelector<HTMLButtonElement>(selector);
  if (!button) {
    throw new Error(`button ${selector} not rendered`);
  }
  button.click();
  await el.updateComplete;
}

function receiptOf(host: Element): HTMLElement | null {
  return host.querySelector<HTMLElement>(".enterprise-evolution-decision__receipt");
}

afterEach(() => {
  document.body.innerHTML = "";
});

// Lit dev mode warns (once per element) when state set in updated() schedules
// another update: https://lit.dev/msg/change-in-update. Any test that makes
// this element do so fails here.
let consoleWarn: MockInstance<typeof console.warn> | null = null;
beforeEach(() => {
  consoleWarn = vi.spyOn(console, "warn");
});
afterEach(() => {
  const calls: unknown[][] = consoleWarn?.mock.calls ?? [];
  const changeInUpdate = calls
    .map((args: unknown[]) => args.map(String).join(" "))
    .filter((message: string) => message.includes("change-in-update"));
  consoleWarn?.mockRestore();
  consoleWarn = null;
  expect(changeInUpdate).toEqual([]);
});

describe("enterprise decision surface wiring", () => {
  it("renders injected snapshots on its own", async () => {
    const { host } = await mountSurface();
    const section = host.querySelector(".enterprise-evolution-decision");
    expect(section?.getAttribute("data-evolution-decision")).toBe("code-present");
    expect(section?.getAttribute("data-runtime-enabled")).toBe("false");
    expect(section?.getAttribute("data-production-proven")).toBe("false");
    expect(section?.getAttribute("data-e52")).toBe("false");
    expect(text(host.querySelector(".enterprise-evolution-decision__title"))).toBe("需要企业决定");
    expect(text(host.querySelector(".enterprise-evolution-decision__subtitle"))).toBe(
      "查看需要企业管理员参与的进化事项。提交的请求只做规则校验，不会直接修改数字人或系统。",
    );
    expect(host.querySelector("[data-decision-id='dec-k']")).not.toBeNull();
  });

  it("renders nothing and reads nothing without principal, source, or enterprise identity", async () => {
    const cases: MountInput[] = [
      { principal: null },
      { source: null },
      { principal: enterprisePrincipal({ enterpriseAdmin: false }) },
      { principal: enterprisePrincipal({ trustedTenantId: null }) },
      { principal: enterprisePrincipal({ trustedTenantId: "  " }) },
    ];
    for (const input of cases) {
      const source = staticEnterpriseHistorySource(enterpriseHistory([enterpriseFact()], []));
      const { el } = await mountSurface({ source, ...input });
      await el.updateComplete;
      expect(el.children).toHaveLength(0);
      expect((el.textContent ?? "").trim()).toBe("");
      expect(el.querySelector(".enterprise-evolution-decision")).toBeNull();
      if (input.source !== null) {
        expect(source.calls).toBe(0);
      }
    }
  });

  it("clears itself when the principal loses enterprise identity", async () => {
    const { el } = await mountSurface();
    expect(el.querySelector("[data-decision-id='dec-k']")).not.toBeNull();
    el.principal = enterprisePrincipal({ enterpriseAdmin: false });
    await el.updateComplete;
    await el.updateComplete;
    expect((el.textContent ?? "").trim()).toBe("");
    expect(el.querySelector("[data-decision-id]")).toBeNull();
  });

  it("reads the snapshot source once on mount and again after a reconnect", async () => {
    const source = staticEnterpriseHistorySource(
      enterpriseHistory([enterpriseFact()], [enterpriseFact()]),
    );
    const { host, el } = await mountSurface({ source });
    expect(source.calls).toBe(1);

    el.remove();
    host.append(el);
    await vi.waitFor(() => {
      expect(source.calls).toBe(2);
    });
    await el.updateComplete;
    expect(el.querySelector("[data-decision-id='dec-k']")).not.toBeNull();
  });

  it("reports a failed load as unknown, not empty or healthy", async () => {
    const { host } = await mountSurface({ source: failingEnterpriseHistorySource() });
    const phase = host.querySelector("[data-phase]");
    expect(phase?.getAttribute("data-phase")).toBe("load-fail");
    expect(text(phase)).toBe("进化事项读取失败，当前状态未知，请稍后再试。");
    expect(host.querySelector("[data-wow-availability]")).toBeNull();
    expect(host.querySelector("[data-decision-id]")).toBeNull();
    expect(host.textContent).not.toContain(COPY.empty);
  });

  it("marks empty and evidence-unavailable snapshots as such", async () => {
    const empty = await mountSurface({ current: [] });
    expect(text(empty.host.querySelector("[data-phase='empty']"))).toBe(COPY.empty);

    const noEvidence = await mountSurface({
      current: [enterpriseFact({ item: { sourceEvidenceRefs: [], sourceFindingIds: [] } })],
    });
    expect(text(noEvidence.host.querySelector("[data-phase='evidence-unavailable']"))).toBe(
      COPY.evidenceUnavailable,
    );
    expect(fieldText(rowOf(noEvidence.host, "dec-k"), "evidence")).toBe("依据：摘要暂不可用");
  });
});

describe("enterprise-owned decisions", () => {
  it("shows knowledge, capability, organization, and delegated agent decisions", async () => {
    const { host } = await mountSurface({
      current: [
        enterpriseFact(),
        enterpriseFact({
          item: {
            decisionId: "dec-capability",
            target: { domain: "capability", skillId: "skill-1" },
            surfaceId: "capability.skill-spec",
          },
          routeInput: { ownership: { kind: "capability_enterprise_private" } },
        }),
        enterpriseFact({
          item: {
            decisionId: "dec-org",
            target: { domain: "organization", groupId: "group-1" },
            surfaceId: "organization.task-routing",
          },
          routeInput: { ownership: { kind: "organization_enterprise" } },
        }),
        enterpriseFact({
          item: {
            decisionId: "dec-agent",
            target: { domain: "agent", agentId: "agent-1" },
            surfaceId: "agent.working-dna",
          },
          routeInput: { ownership: { kind: "agent_enterprise", delegated: true } },
        }),
      ],
    });
    const targets = {
      "dec-k": "影响对象：知识 · 经验胶囊",
      "dec-capability": "影响对象：能力 · 技能说明",
      "dec-org": "影响对象：组织 · 任务分派",
      "dec-agent": "影响对象：数字人 · 工作方式",
    };
    for (const [decisionId, target] of Object.entries(targets)) {
      const row = rowOf(host, decisionId);
      expect(fieldText(row, "decision-type")).toBe("暂停或恢复");
      expect(fieldText(row, "status")).toBe("待企业决定");
      expect(fieldText(row, "target")).toBe(target);
      expect(fieldText(row, "times")).toBe("创建 2026-09-21 · 更新 2026-09-28 · 截止 2026-10-05");
      expect(fieldText(row, "required-authority")).toBe("需要谁处理：企业管理员");
      expect(buttonLabels(row)).toEqual(["暂停", "拒绝", "启动实验"]);
      expect(fieldText(row, "evidence")).toBe("依据：1 条引用 · 1 条发现 · 无关联案例");
    }
  });

  it("renders exactly the row actions the judge accepts, with Chinese reasons for the rest", async () => {
    const { host } = await mountSurface({
      current: [
        enterpriseFact({
          item: { allowedActions: ["hold", "reject", "start_experiment", "promote"] },
        }),
        enterpriseFact({ item: { decisionId: "dec-no-grant" }, grant: { status: "missing" } }),
        enterpriseFact({ item: { decisionId: "dec-done", status: "resolved" } }),
      ],
    });
    const limited = rowOf(host, "dec-k");
    expect(
      [...limited.querySelectorAll("[data-action]")].map((node) =>
        node.getAttribute("data-action"),
      ),
    ).toContain("hold");
    expect(buttonLabels(limited)).toEqual(["暂停", "拒绝", "启动实验"]);
    expect(fieldTexts(limited, "action-reason")).toEqual(["暂不可执行：推广（超出授权范围）"]);

    const noGrant = rowOf(host, "dec-no-grant");
    expect(buttonLabels(noGrant)).toEqual([]);
    expect(fieldText(noGrant, "status")).toBe("当前受阻");
    expect(fieldText(noGrant, "allowed-actions").replace(/\s/g, "")).toBe(
      "可执行动作：当前没有可执行动作",
    );
    expect(fieldTexts(noGrant, "action-reason")).toEqual([
      "暂不可执行：暂停（缺少有效授权）",
      "暂不可执行：拒绝（缺少有效授权）",
      "暂不可执行：启动实验（缺少有效授权）",
    ]);

    const done = rowOf(host, "dec-done");
    expect(fieldText(done, "status")).toBe("已完成");
    expect(buttonLabels(done)).toEqual([]);
    expect(fieldText(done, "not-actionable")).toBe("当前不可操作：事项已处理完毕");
    expect(fieldTexts(done, "action-reason")).toEqual([]);
  });

  it("keeps who decides separate from what can be done", async () => {
    const { host } = await mountSurface({
      current: [enterpriseFact(), personalParticipationFact(), canaryParticipationFact()],
    });
    expect(host.textContent).not.toContain("所需权限");
    for (const row of host.querySelectorAll(".enterprise-evolution-decision__row")) {
      expect(row.querySelector("[data-field='required-authority'] button")).toBeNull();
      expect(
        row.querySelector("[data-field='allowed-actions'] [data-field='required-authority']"),
      ).toBeNull();
    }
    expect(fieldText(rowOf(host, "dec-canary"), "required-authority")).toBe(
      "需要谁处理：平台管理员，并需企业确认参与灰度",
    );
  });
});

describe("employee personal-asset participation", () => {
  it("shows the change redacted and waiting for the employee", async () => {
    const { host } = await mountSurface({ current: [personalParticipationFact()] });
    const row = rowOf(host, "dec-personal");
    expect(fieldText(row, "status")).toBe("等待本人最终授权");
    expect(fieldText(row, "required-authority")).toBe(
      "需要谁处理：企业管理员，并需员工本人最终授权",
    );
    expect(fieldText(row, "evidence")).toBe("相关依据由员工本人或授权系统保管，这里不展示明细。");
    expect(buttonLabels(row)).toEqual(["暂停", "拒绝"]);
    expect(row.querySelector("[data-action='employee_final_authorization']")).toBeNull();
    expect(fieldTexts(row, "action-reason")).toEqual([
      "暂不可执行：启动实验（需要员工本人最终授权）",
      "暂不可执行：灰度应用（需要员工本人最终授权）",
      "暂不可执行：推广（需要员工本人最终授权）",
    ]);
    const markup = host.innerHTML;
    for (const secret of [...PERSONAL_SECRETS, "条引用", "条发现", "关联案例"]) {
      expect(markup).not.toContain(secret);
    }
  });

  it("opens the judge's forward actions only after the employee authorizes", async () => {
    const { host } = await mountSurface({
      current: [
        personalParticipationFact({ authorityFacts: { employeeFinalAuthorization: true } }),
      ],
    });
    const row = rowOf(host, "dec-personal");
    expect(fieldText(row, "status")).toBe("待企业决定");
    expect(buttonLabels(row)).toEqual(["暂停", "拒绝", "启动实验", "灰度应用", "推广"]);
    expect(row.querySelector("[data-action='employee_final_authorization']")).toBeNull();
    expect(fieldText(row, "evidence")).toBe("相关依据由员工本人或授权系统保管，这里不展示明细。");
  });
});

describe("platform canary participation", () => {
  it("offers only the canary confirmation and shows no platform detail", async () => {
    const { host } = await mountSurface({ current: [canaryParticipationFact()] });
    const row = rowOf(host, "dec-canary");
    expect(fieldText(row, "status")).toBe("需要参与平台灰度");
    expect(fieldText(row, "decision-type")).toBe("灰度参与");
    expect(fieldText(row, "target")).toBe("影响对象：系统 · 运行绑定治理");
    expect(fieldText(row, "evidence")).toBe("平台变更将影响本企业，需要确认是否参与灰度。");
    expect(buttonLabels(row)).toEqual(["参与平台灰度"]);
    expect(fieldTexts(row, "action-reason")).toEqual([]);
    const markup = host.innerHTML;
    for (const secret of PLATFORM_SECRETS) {
      expect(markup).not.toContain(secret);
    }
  });

  it("watches with no action once the enterprise has confirmed", async () => {
    const { host } = await mountSurface({
      current: [
        canaryParticipationFact({ authorityFacts: { enterpriseCanaryAcknowledged: true } }),
      ],
    });
    const row = rowOf(host, "dec-canary");
    expect(row.getAttribute("data-ui-status")).toBe("watching");
    expect(fieldText(row, "status")).toBe("观察中");
    expect(buttonLabels(row)).toEqual([]);
    expect(fieldText(row, "evidence")).toBe("平台变更将影响本企业，本企业已确认参与灰度。");
    expect(fieldTexts(row, "action-reason")).toEqual([
      "暂不可执行：参与平台灰度（已经确认过，不需要重复确认）",
    ]);
  });

  it("leaves no id, count, or hint of other tenants and platform-wide items", async () => {
    const { host } = await mountSurface({
      current: [
        enterpriseFact(),
        enterpriseFact({
          item: {
            decisionId: "dec-other-tenant",
            tenantScope: "tenant-b",
            sourceEvidenceRefs: ["ev-b-secret"],
          },
        }),
        canaryParticipationFact({ item: { decisionId: "dec-platform-wide", tenantScope: null } }),
        canaryParticipationFact({
          item: { decisionId: "dec-repeat" },
          routeInput: { crossTenantRepeat: true },
        }),
      ],
      prior: [enterpriseFact()],
    });
    expect(
      [...host.querySelectorAll("[data-decision-id]")].map((row) =>
        row.getAttribute("data-decision-id"),
      ),
    ).toEqual(["dec-k"]);
    const markup = host.innerHTML;
    for (const hidden of [
      "dec-other-tenant",
      "tenant-b",
      "ev-b-secret",
      "dec-platform-wide",
      "dec-repeat",
      ...PLATFORM_SECRETS,
    ]) {
      expect(markup).not.toContain(hidden);
    }
    expect(host.querySelector("[data-wow-status='total']")?.textContent).toContain(
      "事项总数：上周 1 项，本周 1 项，没有变化",
    );
  });
});

describe("week-over-week", () => {
  it("shows every category, the total, and per-decision transitions", async () => {
    const { host } = await mountSurface({
      prior: [enterpriseFact(), personalParticipationFact(), canaryParticipationFact()],
      current: [
        enterpriseFact({ item: { status: "resolved" } }),
        personalParticipationFact({ authorityFacts: { employeeFinalAuthorization: true } }),
        canaryParticipationFact({ authorityFacts: { enterpriseCanaryAcknowledged: true } }),
      ],
    });
    const wow = host.querySelector("[data-wow-availability]");
    expect(wow?.getAttribute("data-wow-availability")).toBe("available");
    expect(text(wow?.querySelector("[data-field='wow-period']"))).toBe(
      "上周 2026-09-21 → 本周 2026-09-28",
    );
    expect(
      [...(wow?.querySelectorAll("[data-wow-status]") ?? [])].map((node) => text(node)),
    ).toEqual([
      "企业待决定：上周 1 项，本周 1 项，没有变化",
      "等待员工最终授权：上周 1 项，本周 0 项，减少 1 项",
      "参与平台灰度：上周 1 项，本周 0 项，减少 1 项",
      "观察中：上周 0 项，本周 1 项，增加 1 项",
      "已完成：上周 0 项，本周 1 项，增加 1 项",
      "阻断：上周 0 项，本周 0 项，没有变化",
      "过期：上周 0 项，本周 0 项，没有变化",
      "事项总数：上周 3 项，本周 3 项，没有变化",
    ]);
    expect(
      [...(wow?.querySelectorAll("[data-field='wow-transitions'] li") ?? [])].map((node) =>
        text(node),
      ),
    ).toEqual([
      "「暂停或恢复」：待企业决定 → 已完成",
      "「暂停或恢复」：等待本人最终授权 → 待企业决定",
      "「灰度参与」：需要参与平台灰度 → 观察中",
    ]);
  });

  it("says history is unavailable instead of showing zero counts", async () => {
    const cases = [
      await mountSurface({ prior: null }),
      await mountSurface({
        source: staticEnterpriseHistorySource(
          enterpriseHistory([enterpriseFact()], [enterpriseFact()], {
            prior: "2026-09-26T12:00:00.000Z",
          }),
        ),
      }),
      await mountSurface({
        source: staticEnterpriseHistorySource(
          enterpriseHistory([enterpriseFact()], [enterpriseFact()], { prior: "not-a-date" }),
        ),
      }),
    ];
    for (const { host } of cases) {
      const wow = host.querySelector("[data-wow-availability]");
      expect(wow?.getAttribute("data-wow-availability")).toBe("history-unavailable");
      const lines = [...(wow?.querySelectorAll(".enterprise-evolution-decision__line") ?? [])].map(
        (line) => text(line),
      );
      expect(lines).toEqual(["暂无足够历史数据，不能形成企业周度对比。"]);
      expect(wow?.querySelector("[data-wow-status]")).toBeNull();
      expect(text(wow)).not.toMatch(/\d/);
      expect(host.querySelector("[data-decision-id='dec-k']")).not.toBeNull();
    }
    expect(
      cases.map(({ host }) =>
        host.querySelector("[data-wow-availability]")?.getAttribute("data-wow-reason"),
      ),
    ).toEqual(["prior_snapshot_missing", "prior_snapshot_not_weekly", "snapshot_as_of_invalid"]);
  });
});

describe("submit", () => {
  it("an accepted click is a rule-check receipt, not an effect", async () => {
    const fact = enterpriseFact();
    const ids = sequentialCommandIds();
    const { host, el } = await mountSurface({
      contexts: new Map([["dec-k", enterpriseSubmitContext(fact)]]),
      commandIdFactory: ids,
    });
    await click(el, "[data-decision-id='dec-k'] [data-action='hold']");
    const receipt = receiptOf(host);
    expect(ids.issued).toEqual(["cmd-ent-1"]);
    expect(receipt?.getAttribute("data-outcome")).toBe("accepted");
    expect(receipt?.getAttribute("data-code")).toBe("admissible");
    expect(receipt?.getAttribute("data-command-id")).toBe("cmd-ent-1");
    expect(receipt?.getAttribute("data-executed")).toBe("false");
    expect(receipt?.getAttribute("data-effect-proof")).toBe("false");
    expect(receipt?.getAttribute("data-writes")).toBe("0");
    expect(receipt?.getAttribute("data-audit-receipt-ref")).toBe("decision-plan:cmd-ent-1");
    expect(text(receipt)).toBe("请求已通过规则校验，但尚未执行。");
  });

  it("recognises a replay, refuses a rebind, and never executes", async () => {
    const fact = enterpriseFact();
    const context = enterpriseSubmitContext(fact);
    const fixed = () => "cmd-ent-fixed";
    const { host, el } = await mountSurface({
      contexts: new Map([["dec-k", context]]),
      commandIdFactory: fixed,
    });
    await click(el, "[data-decision-id='dec-k'] [data-action='hold']");
    const first = receiptOf(host);
    expect(first?.getAttribute("data-outcome")).toBe("accepted");
    const record = captureEvolutionDecisionCommandRecord({
      command: {
        commandId: "cmd-ent-fixed",
        decisionId: "dec-k",
        action: "hold",
        expectedVersion: "dv-1",
      },
      item: fact.item,
      principal: context.principal,
      auditReceiptRef: first?.getAttribute("data-audit-receipt-ref") ?? "",
      route: routeEvolutionDecisionSurface(fact.routeInput),
    });
    el.submitContexts = new Map([["dec-k", { ...context, prior: [record] }]]);
    await el.updateComplete;

    await click(el, "[data-decision-id='dec-k'] [data-action='hold']");
    let receipt = receiptOf(host);
    expect(receipt?.getAttribute("data-outcome")).toBe("idempotent_replay");
    expect(receipt?.getAttribute("data-audit-receipt-ref")).toBe("decision-plan:cmd-ent-fixed");
    expect(receipt?.getAttribute("data-writes")).toBe("0");
    expect(text(receipt)).toBe("重复请求已识别；原请求尚未执行。");

    await click(el, "[data-decision-id='dec-k'] [data-action='reject']");
    receipt = receiptOf(host);
    expect(receipt?.getAttribute("data-code")).toBe("command_rebind");
    expect(receipt?.getAttribute("data-executed")).toBe("false");
    expect(text(receipt)).toBe(
      "请求未通过规则校验：同一请求编号不能改作其他操作。没有执行任何变更。",
    );
  });

  it("refuses a second canary confirmation in Chinese", async () => {
    const first = canaryParticipationFact();
    const acknowledged = canaryParticipationFact({
      authorityFacts: { enterpriseCanaryAcknowledged: true },
    });
    // The row still offers the confirmation from an earlier snapshot, but the
    // server-resolved context now says it is already done.
    const { host, el } = await mountSurface({
      current: [first],
      contexts: new Map([["dec-canary", enterpriseSubmitContext(acknowledged)]]),
    });
    await click(el, "[data-decision-id='dec-canary'] [data-action='participate_canary']");
    const receipt = receiptOf(host);
    expect(receipt?.getAttribute("data-code")).toBe("participation_already_satisfied");
    expect(receipt?.getAttribute("data-writes")).toBe("0");
    expect(text(receipt)).toBe(
      "请求未通过规则校验：已经确认过，不需要重复确认。没有执行任何变更。",
    );
  });

  it("fails closed without a submit context or a command id", async () => {
    const noContext = await mountSurface();
    await click(noContext.el, "[data-decision-id='dec-k'] [data-action='hold']");
    let receipt = receiptOf(noContext.host);
    expect(receipt?.getAttribute("data-code")).toBe("submit_context_unavailable");
    expect(receipt?.getAttribute("data-executed")).toBe("false");
    expect(text(receipt)).toBe("请求未通过规则校验：暂时无法提交，请稍后再试。没有执行任何变更。");

    for (const factory of [null, () => "", () => "   "]) {
      document.body.innerHTML = "";
      const noId = await mountSurface({
        contexts: new Map([["dec-k", enterpriseSubmitContext(enterpriseFact())]]),
        commandIdFactory: factory,
      });
      await click(noId.el, "[data-decision-id='dec-k'] [data-action='hold']");
      receipt = receiptOf(noId.host);
      expect(receipt?.getAttribute("data-code")).toBe("command_id_unavailable");
      expect(receipt?.getAttribute("data-writes")).toBe("0");
    }
  });

  it("refuses actions outside the enterprise map or not on the row", async () => {
    const { host, el } = await mountSurface({
      current: [personalParticipationFact()],
      contexts: new Map([["dec-personal", enterpriseSubmitContext(personalParticipationFact())]]),
    });
    const onAction = (el as unknown as { onAction: (row: unknown, action: string) => void })
      .onAction;
    const row = { decisionId: "dec-personal", decisionVersion: "dv-1", allowedActions: ["hold"] };
    onAction.call(el, row, "employee_final_authorization");
    await el.updateComplete;
    expect(receiptOf(host)?.getAttribute("data-code")).toBe("endpoint_action_forbidden");
    expect(text(receiptOf(host))).toBe(
      "请求未通过规则校验：企业管理员不能执行这个操作。没有执行任何变更。",
    );

    onAction.call(el, row, "apply_canary");
    await el.updateComplete;
    expect(receiptOf(host)?.getAttribute("data-code")).toBe("action_not_allowed");
    expect(receiptOf(host)?.getAttribute("data-writes")).toBe("0");
  });

  it("never describes a receipt as applied or completed", async () => {
    const fact = enterpriseFact();
    const { host, el } = await mountSurface({
      contexts: new Map([["dec-k", enterpriseSubmitContext(fact)]]),
    });
    await click(el, "[data-decision-id='dec-k'] [data-action='hold']");
    const receiptText = text(receiptOf(host));
    for (const claim of ["已应用", "已完成", "已生效", "已执行", "成功", "已修改"]) {
      expect(receiptText).not.toContain(claim);
    }
  });
});

describe("admin-visible text", () => {
  it("keeps internal contract words out of what an admin can read", async () => {
    const personal = personalParticipationFact();
    const { host, el } = await mountSurface({
      current: [
        enterpriseFact(),
        personal,
        canaryParticipationFact(),
        enterpriseFact({ item: { decisionId: "dec-done", status: "resolved" } }),
        enterpriseFact({ item: { decisionId: "dec-exp", status: "expired" } }),
      ],
      prior: [enterpriseFact(), enterpriseFact({ item: { decisionId: "dec-done" } })],
      contexts: new Map([
        ["dec-k", enterpriseSubmitContext(enterpriseFact())],
        ["dec-personal", enterpriseSubmitContext(personal)],
      ]),
    });
    const texts = [enterpriseUserVisibleText(host)];
    await click(el, "[data-decision-id='dec-k'] [data-action='hold']");
    texts.push(enterpriseUserVisibleText(host));
    await click(el, "[data-decision-id='dec-personal'] [data-action='reject']");
    texts.push(enterpriseUserVisibleText(host));
    await click(el, "[data-decision-id='dec-canary'] [data-action='participate_canary']");
    texts.push(enterpriseUserVisibleText(host));
    expect(receiptOf(host)?.getAttribute("data-code")).toBe("submit_context_unavailable");

    for (const visible of texts) {
      expect(visible).not.toMatch(/[A-Za-z]/);
      for (const token of ENTERPRISE_DECISION_INTERNAL_CONTRACT_TOKENS) {
        expect(visible).not.toContain(token);
      }
    }
    // Contract values stay available to tooling through data-* only.
    expect(rowOf(host, "dec-k").getAttribute("data-decision-type")).toBe("hold_or_resume");
    expect(rowOf(host, "dec-k").getAttribute("data-surface-id")).toBe(
      "knowledge.experience-capsule",
    );
  });
});

describe("one gated mount and no side channels", () => {
  const COMPONENT = "ui/src/ui/ports/enterprise/views/enterprise-evolution-decision-surface.ts";
  const COMPONENT_TEST =
    "ui/src/ui/ports/enterprise/views/enterprise-evolution-decision-surface.node.test.ts";
  const OWN_DIR = "ui/src/ui/ports/enterprise/evolution-decision/";
  const CORE = "ui/src/ui/ports/enterprise/views/enterprise-surfaces-core.ts";
  const MOUNT_TEST =
    "ui/src/ui/ports/enterprise/views/enterprise-evolution-decision-mount.node.test.ts";

  function listTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        out.push(...listTsFiles(path));
      } else if (entry.isFile() && path.endsWith(".ts")) {
        out.push(path);
      }
    }
    return out;
  }

  /** Repo-relative targets of the file's relative imports and re-exports. */
  function relativeImports(file: string, source: string): string[] {
    const specifiers = [
      ...source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g),
    ].map((match) => match[1] ?? "");
    return specifiers
      .filter((specifier) => specifier.startsWith("."))
      .map((specifier) =>
        relative(process.cwd(), normalize(join(process.cwd(), dirname(file), specifier))),
      );
  }

  /** Code only: block and line comments removed. */
  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("is reached only by the Mesh page mount and its test while the gate is closed", () => {
    expect(enterpriseEvolutionDecisionSurfaceMountEnabled()).toBe(false);

    const reaching: string[] = [];
    for (const file of listTsFiles("ui/src")) {
      if (file === COMPONENT || file === COMPONENT_TEST || file.startsWith(OWN_DIR)) {
        continue;
      }
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const componentModule = COMPONENT.replace(/\.ts$/, "");
      const reachesSurface = relativeImports(file, source).some(
        (target) =>
          target.startsWith(OWN_DIR) || target.replace(/\.(ts|js)$/, "") === componentModule,
      );
      if (
        reachesSurface ||
        source.includes("enterprise-evolution-decision-surface") ||
        source.includes("enterpriseEvolutionDecisionSurfaceMountEnabled")
      ) {
        reaching.push(file);
      }
    }
    // The Mesh page is the one mount; the mount test checks how it is gated.
    expect(reaching.toSorted()).toEqual([CORE, MOUNT_TEST].toSorted());
  });

  it("does not reach Gateway, storage, the URL, Perception, or an Adapter", () => {
    const code = withoutComments(readFileSync(join(process.cwd(), COMPONENT), "utf8"));
    for (const token of [
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      ".request(",
      "localStorage",
      "sessionStorage",
      "cookie",
      "location",
      "URLSearchParams",
      "process.env",
      "import.meta",
      "evolution.proposals",
      "evolution.applications",
      "evolution.delegation",
      "evolution.perception",
      "evolution-perception",
      "Adapter",
    ]) {
      expect([token, code.includes(token)]).toEqual([token, false]);
    }
  });

  it("builds commands from the four client fields only and never rewrites the context", () => {
    const code = withoutComments(readFileSync(join(process.cwd(), COMPONENT), "utf8"));
    expect(code).not.toMatch(
      /\b(tenantId|enterpriseId|trustedTenantId|principalRef|audience|enterpriseAdmin|grant|delegation|authorityFacts|employeeFinalAuthorization|enterpriseCanaryAcknowledged|sourceEvidenceRefs|evidenceRefs|adapter|adapterParams)\s*:/,
    );
    expect(code).not.toMatch(/\bcontext\.\w+\s*=[^=]/);
    expect(code).toMatch(
      /command: \{\s*commandId,\s*decisionId: row\.decisionId,\s*action: action as EvolutionDecisionAction,\s*expectedVersion: row\.decisionVersion,\s*\},\s*context,\s*\}/,
    );
  });

  it("reaches the evolution contract only through the browser-safe boundary", () => {
    const BOUNDARY = "ui/src/ui/evolution-decision-contract.ts";
    const DECISION_SURFACE_ENTRY = "packages/evolution-core/src/decision-surface/index.ts";

    /** Only `import type` / `export type` statements are erased by the build. */
    function importStatements(source: string): { specifier: string; typeOnly: boolean }[] {
      const code = withoutComments(source);
      const statements: { specifier: string; typeOnly: boolean }[] = [];
      for (const match of code.matchAll(
        /\b(?:import|export)\s+(type\s+)?[\w*${}\s,]*?\s*from\s*["']([^"']+)["']/g,
      )) {
        statements.push({ specifier: match[2] ?? "", typeOnly: Boolean(match[1]) });
      }
      for (const match of code.matchAll(/\bimport\s*(?:\(\s*)?["']([^"']+)["']/g)) {
        statements.push({ specifier: match[1] ?? "", typeOnly: false });
      }
      return statements;
    }

    function resolveTs(fromFile: string, specifier: string): string | null {
      const base = normalize(join(dirname(fromFile), specifier));
      for (const candidate of [
        base,
        base.replace(/\.js$/, ".ts"),
        `${base}.ts`,
        join(base, "index.ts"),
      ]) {
        if (candidate.endsWith(".ts") && existsSync(join(process.cwd(), candidate))) {
          return candidate;
        }
      }
      return null;
    }

    // Mount code: the element and the gate the Mesh page reads.
    const queue = [COMPONENT, `${OWN_DIR}runtime-gate.ts`];
    const seen = new Set<string>();
    const rootRuntimeImports: string[] = [];
    const packageEdges: string[] = [];
    while (queue.length > 0) {
      const file = queue.shift() ?? "";
      if (seen.has(file)) {
        continue;
      }
      seen.add(file);
      for (const statement of importStatements(readFileSync(join(process.cwd(), file), "utf8"))) {
        if (statement.typeOnly) {
          continue;
        }
        if (
          statement.specifier === "@openbot/evolution-core" ||
          statement.specifier.startsWith("@openbot/evolution-core/")
        ) {
          rootRuntimeImports.push(file);
        }
        const target = statement.specifier.startsWith(".")
          ? resolveTs(file, statement.specifier)
          : null;
        if (target?.startsWith("packages/")) {
          packageEdges.push(`${file} -> ${target}`);
        } else if (target?.startsWith("ui/src/")) {
          queue.push(target);
        }
      }
    }
    expect(seen).toContain(`${OWN_DIR}client.ts`);
    expect(rootRuntimeImports).toEqual([]);
    expect(packageEdges).toEqual([`${BOUNDARY} -> ${DECISION_SURFACE_ENTRY}`]);
  });
});
