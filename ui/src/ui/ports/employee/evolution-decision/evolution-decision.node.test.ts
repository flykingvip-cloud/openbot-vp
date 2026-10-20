// @vitest-environment jsdom
/**
 * Employee Decision Surface adapter, runtime gate, and display contract tests.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EVOLUTION_DECISION_ACTIONS,
  EVOLUTION_DECISION_REQUIRED_AUTHORITIES,
  EVOLUTION_DECISION_TYPES,
  EVOLUTION_EMPLOYEE_ACTION_UNAVAILABLE_CODES,
  EVOLUTION_EMPLOYEE_DECISION_UI_STATUSES,
  captureEvolutionDecisionCommandRecord,
  listEvolutionSurfaces,
} from "@openbot/evolution-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  isEmployeeDecisionActionAllowedByMap,
  loadEvolutionEmployeeDecisionSurface,
  submitEvolutionEmployeeDecisionAction,
} from "./client.ts";
import { EVOLUTION_DECISION_COPY, EVOLUTION_DECISION_REASON_LABELS } from "./copy.ts";
import {
  evolutionDecisionActionLabel,
  evolutionDecisionAuthorityLabel,
  evolutionDecisionReasonLabel,
  evolutionDecisionReceiptText,
  evolutionDecisionStatusLabel,
  evolutionDecisionTargetLabel,
  evolutionDecisionTypeLabel,
  evolutionDecisionWowLines,
} from "./display.ts";
import {
  decisionFact,
  decisionGrant,
  decisionHistory,
  decisionItem,
  decisionPrincipal,
  decisionRouteInput,
  decisionSubmitContext,
  failingHistorySource,
  participationDecisionFact,
  staticHistorySource,
} from "./evolution-decision-test-fixtures.ts";
import { employeeEvolutionDecisionSurfaceMountEnabled } from "./runtime-gate.ts";

const CJK = /[\u4e00-\u9fff]/u;
const ASCII_LETTER = /[A-Za-z]/;

function expectChineseLabel(label: string): void {
  expect(label).toMatch(CJK);
  expect(label).not.toMatch(ASCII_LETTER);
}

/** Codes the D1 judge, authority resolver, and grant gate can return. */
const D1_REFUSAL_CODES = [
  "invalid_command",
  "client_authority_forbidden",
  "version_required",
  "adapter_forbidden",
  "perception_readonly",
  "daibai_chat_not_approval",
  "unmapped_action",
  "control_plane_action_unavailable",
  "replay_binding_mismatch",
  "command_rebind",
  "expired",
  "not_pending",
  "version_mismatch",
  "decision_version_required",
  "route_binding_mismatch",
  "forbidden_surface",
  "unknown_surface",
  "surface_not_registered",
  "inconsistent_target",
  "decision_mismatch",
  "action_not_allowed",
  "tenant_mismatch",
  "enterprise_admin_required",
  "platform_operator_required",
  "enterprise_not_core_approver",
  "wrong_endpoint",
  "endpoint_action_forbidden",
  "cross_tenant_mutation_forbidden",
  "owner_unproven",
  "owner_mismatch",
  "employee_authorization_required",
  "enterprise_canary_required",
  "participation_required",
  "participation_already_satisfied",
  "scope_widened",
  "authorization_required",
  "grant_expired",
  "grant_revoked",
  "grant_inactive",
  "operation_forbidden",
  "platform_approval_required",
] as const;

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  document.body.innerHTML = "";
});

describe("employee decision runtime gate", () => {
  it("is closed and takes no client input", () => {
    expect(employeeEvolutionDecisionSurfaceMountEnabled.length).toBe(0);
    expect(employeeEvolutionDecisionSurfaceMountEnabled()).toBe(false);

    window.history.replaceState(
      null,
      "",
      "/?evolutionEmployeeDecisionRuntime=1&EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED=true#decision=on",
    );
    window.localStorage.setItem("EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED", "true");
    window.sessionStorage.setItem("evolutionEmployeeDecisionRuntime", "1");
    document.cookie = "evolutionEmployeeDecisionRuntime=1";
    document.body.innerHTML = `
      <form><input name="EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED" value="true" /></form>
    `;
    expect(employeeEvolutionDecisionSurfaceMountEnabled()).toBe(false);
  });

  it("does not read URL, storage, cookies, or forms", () => {
    const source = readFileSync(
      join(process.cwd(), "ui/src/ui/ports/employee/evolution-decision/runtime-gate.ts"),
      "utf8",
    );
    for (const token of [
      "location",
      "localStorage",
      "sessionStorage",
      "URLSearchParams",
      "document",
      "window",
      "cookie",
      "FormData",
      "process.env",
    ]) {
      expect(source).not.toContain(token);
    }
    expect(source).toContain("return EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED;");
  });
});

describe("employee decision client", () => {
  it("only allows D1 employee command-map actions", () => {
    expect(isEmployeeDecisionActionAllowedByMap("hold")).toBe(true);
    expect(isEmployeeDecisionActionAllowedByMap("reject")).toBe(true);
    expect(isEmployeeDecisionActionAllowedByMap("rollback")).toBe(true);
    expect(isEmployeeDecisionActionAllowedByMap("employee_final_authorization")).toBe(true);
    expect(isEmployeeDecisionActionAllowedByMap("apply_canary")).toBe(false);
    expect(isEmployeeDecisionActionAllowedByMap("authorize")).toBe(false);
    expect(isEmployeeDecisionActionAllowedByMap("promote")).toBe(false);
  });

  it("projects injected snapshots and omits other owners and tenants without Evidence", async () => {
    const view = await loadEvolutionEmployeeDecisionSurface({
      source: staticHistorySource(
        decisionHistory(
          [
            decisionFact(),
            decisionFact({
              item: {
                decisionId: "dec-x",
                tenantScope: "tenant-b",
                sourceEvidenceRefs: ["secret"],
              },
            }),
            decisionFact({
              item: {
                decisionId: "dec-y",
                target: { domain: "agent", agentId: "agent-9" },
                sourceEvidenceRefs: ["secret-2"],
              },
            }),
          ],
          [],
        ),
      ),
      principal: decisionPrincipal(),
    });
    expect(view.rows.map((row) => row.decisionId)).toEqual(["dec-1"]);
    expect(JSON.stringify(view.omitted)).not.toContain("secret");
    expect(view.runtimeEnabled).toBe(false);
    expect(view.productionProven).toBe(false);
    expect(view.e52Open).toBe(false);
  });

  it("treats a failed snapshot load as load-fail, not an empty list", async () => {
    const view = await loadEvolutionEmployeeDecisionSurface({
      source: failingHistorySource(),
      principal: decisionPrincipal(),
    });
    expect(view.phase).toBe("load-fail");
    expect(view.weekOverWeek.availability).toBe("history-unavailable");
  });

  it("submit keeps writes empty and executed / effectProof false", () => {
    const receipt = submitEvolutionEmployeeDecisionAction({
      command: {
        commandId: "cmd-ui-1",
        decisionId: "dec-1",
        action: "hold",
        expectedVersion: "dv-1",
      },
      context: decisionSubmitContext(decisionItem()),
    });
    expect(receipt.outcome).toBe("accepted");
    expect(receipt.auditReceiptRef).toBe("decision-plan:cmd-ui-1");
    expect(receipt.executed).toBe(false);
    expect(receipt.effectProof).toBe(false);
    expect(receipt.writes).toEqual([]);
  });

  it("expectedVersion and route binding mismatches stay zero-write", () => {
    const versionMismatch = submitEvolutionEmployeeDecisionAction({
      command: {
        commandId: "cmd-v",
        decisionId: "dec-1",
        action: "hold",
        expectedVersion: "wrong",
      },
      context: decisionSubmitContext(decisionItem()),
    });
    expect(versionMismatch.code).toBe("version_mismatch");
    expect(versionMismatch.outcome).toBe("rejected");
    expect(versionMismatch.writes).toEqual([]);
    expect(versionMismatch.executed).toBe(false);
    expect(versionMismatch.effectProof).toBe(false);

    const routeMismatch = submitEvolutionEmployeeDecisionAction({
      command: { commandId: "cmd-r", decisionId: "dec-1", action: "hold", expectedVersion: "dv-1" },
      context: decisionSubmitContext(decisionItem(), {
        routeInput: decisionRouteInput({ surfaceId: "agent.capsule" }),
      }),
    });
    expect(routeMismatch.code).toBe("route_binding_mismatch");
    expect(routeMismatch.writes).toEqual([]);
    expect(routeMismatch.executed).toBe(false);
    expect(routeMismatch.effectProof).toBe(false);
  });

  it("commandId replay is idempotent and a rebind fails closed", () => {
    const command = {
      commandId: "cmd-replay",
      decisionId: "dec-1",
      action: "hold",
      expectedVersion: "dv-1",
    } as const;
    const first = submitEvolutionEmployeeDecisionAction({
      command,
      context: decisionSubmitContext(decisionItem()),
    });
    expect(first.outcome).toBe("accepted");
    const prior = [
      captureEvolutionDecisionCommandRecord({
        command,
        item: decisionItem(),
        principal: decisionPrincipal(),
        auditReceiptRef: first.auditReceiptRef,
      }),
    ];
    const replay = submitEvolutionEmployeeDecisionAction({
      command,
      context: decisionSubmitContext(decisionItem(), { prior }),
    });
    expect(replay.outcome).toBe("idempotent_replay");
    expect(replay.auditReceiptRef).toBe(first.auditReceiptRef);
    expect(replay.writes).toEqual([]);
    expect(replay.executed).toBe(false);

    const rebind = submitEvolutionEmployeeDecisionAction({
      command: { ...command, action: "reject" },
      context: decisionSubmitContext(decisionItem(), {
        prior,
        grant: decisionGrant(["hold", "reject"]),
      }),
    });
    expect(rebind.code).toBe("command_rebind");
    expect(rebind.outcome).toBe("rejected");
    expect(rebind.writes).toEqual([]);
    expect(rebind.executed).toBe(false);
    expect(rebind.effectProof).toBe(false);
  });
});

describe("weekly comparison display", () => {
  it("shows one decision moving from pending last week to done this week", async () => {
    const view = await loadEvolutionEmployeeDecisionSurface({
      source: staticHistorySource(
        decisionHistory(
          [decisionFact({ item: { status: "resolved", allowedActions: [] } })],
          [decisionFact()],
        ),
      ),
      principal: decisionPrincipal(),
    });
    const lines = evolutionDecisionWowLines(view.weekOverWeek);
    expect(lines).toContain("上周 2026-09-21 → 本周 2026-09-28");
    expect(lines).toContain("待我确认：上周 1 项，本周 0 项，减少 1 项");
    expect(lines).toContain("系统已完成：上周 0 项，本周 1 项，增加 1 项");
    expect(lines).toContain("事项总数：上周 1 项，本周 1 项，没有变化");
    expect(lines).toContain("「暂停或恢复」：待我确认 → 系统已完成");
  });

  it("shows only the history-unavailable sentence without a prior snapshot", async () => {
    const view = await loadEvolutionEmployeeDecisionSurface({
      source: staticHistorySource(decisionHistory([decisionFact()], null)),
      principal: decisionPrincipal(),
    });
    expect(view.weekOverWeek).toEqual({
      schemaVersion: 1,
      availability: "history-unavailable",
      reason: "prior_snapshot_missing",
    });
    expect(evolutionDecisionWowLines(view.weekOverWeek)).toEqual([
      "暂无足够历史数据，不能形成周度对比。",
    ]);
    expect(EVOLUTION_DECISION_COPY.historyUnavailable).toBe("暂无足够历史数据，不能形成周度对比。");
  });
});

describe("Chinese business labels", () => {
  it("labels every action, decision type, authority, and status in Chinese", () => {
    for (const action of EVOLUTION_DECISION_ACTIONS) {
      expectChineseLabel(evolutionDecisionActionLabel(action));
      expect(evolutionDecisionActionLabel(action)).not.toBe(EVOLUTION_DECISION_COPY.fallbackAction);
    }
    for (const decisionType of EVOLUTION_DECISION_TYPES) {
      expectChineseLabel(evolutionDecisionTypeLabel(decisionType));
      expect(evolutionDecisionTypeLabel(decisionType)).not.toBe(
        EVOLUTION_DECISION_COPY.fallbackDecisionType,
      );
    }
    for (const authority of EVOLUTION_DECISION_REQUIRED_AUTHORITIES) {
      expectChineseLabel(evolutionDecisionAuthorityLabel(authority));
      expect(evolutionDecisionAuthorityLabel(authority)).not.toBe(
        EVOLUTION_DECISION_COPY.fallbackAuthority,
      );
    }
    for (const status of EVOLUTION_EMPLOYEE_DECISION_UI_STATUSES) {
      expectChineseLabel(evolutionDecisionStatusLabel(status));
    }
  });

  it("names every registered surface and domain in Chinese", () => {
    for (const surface of listEvolutionSurfaces()) {
      const label = evolutionDecisionTargetLabel({
        domain: surface.domain,
        surfaceId: surface.surfaceId,
      });
      expectChineseLabel(label);
      expect(label).not.toContain(EVOLUTION_DECISION_COPY.fallbackSurface);
      expect(label).not.toContain(EVOLUTION_DECISION_COPY.fallbackDomain);
    }
    expect(evolutionDecisionTargetLabel({ domain: "agent", surfaceId: "agent.working-dna" })).toBe(
      "我的数字人 · 工作方式",
    );
  });

  it("labels every row reason and D1 refusal code in Chinese", () => {
    const codes = [
      ...EVOLUTION_EMPLOYEE_ACTION_UNAVAILABLE_CODES,
      ...D1_REFUSAL_CODES,
      "submit_context_unavailable",
      ...Object.keys(EVOLUTION_DECISION_REASON_LABELS),
    ];
    for (const code of codes) {
      const label = evolutionDecisionReasonLabel(code);
      expectChineseLabel(label);
      expect(label).not.toBe(EVOLUTION_DECISION_COPY.fallbackReason);
    }
  });

  it("falls back to generic Chinese instead of echoing unknown values", () => {
    for (const unknown of ["constructor", "__proto__", "toString", "brand_new_code"]) {
      expect(evolutionDecisionActionLabel(unknown)).toBe(EVOLUTION_DECISION_COPY.fallbackAction);
      expect(evolutionDecisionReasonLabel(unknown)).toBe(EVOLUTION_DECISION_COPY.fallbackReason);
      expect(evolutionDecisionTypeLabel(unknown)).toBe(
        EVOLUTION_DECISION_COPY.fallbackDecisionType,
      );
      expect(evolutionDecisionAuthorityLabel(unknown)).toBe(
        EVOLUTION_DECISION_COPY.fallbackAuthority,
      );
      expect(evolutionDecisionStatusLabel(unknown)).toBe(EVOLUTION_DECISION_COPY.fallbackStatus);
    }
    expectChineseLabel(
      evolutionDecisionTargetLabel({
        domain: "agent",
        surfaceId: "system.engineering-remediation",
      }),
    );
  });
});

describe("receipt copy", () => {
  it("says an accepted request passed the rule check and has not run", () => {
    expect(evolutionDecisionReceiptText({ outcome: "accepted", code: "admissible" })).toBe(
      "请求已通过规则校验，但尚未执行。",
    );
    const texts = [
      evolutionDecisionReceiptText({ outcome: "accepted", code: "admissible" }),
      evolutionDecisionReceiptText({ outcome: "idempotent_replay", code: "idempotent_replay" }),
      evolutionDecisionReceiptText({ outcome: "rejected", code: "version_mismatch" }),
      evolutionDecisionReceiptText({ outcome: "blocked", code: "wrong_endpoint" }),
    ];
    expect(texts[1]).toContain("尚未执行");
    expect(texts[2]).toBe("请求未通过规则校验：事项已经更新，请刷新后再试。没有执行任何变更。");
    for (const text of texts) {
      expectChineseLabel(text);
      for (const claim of ["已应用", "已完成", "已生效", "已执行", "成功"]) {
        expect(text).not.toContain(claim);
      }
    }
  });
});

describe("authority and action semantics", () => {
  it("shows who decides apart from which actions exist", async () => {
    const view = await loadEvolutionEmployeeDecisionSurface({
      source: staticHistorySource(
        decisionHistory([decisionFact(), participationDecisionFact()], []),
      ),
      principal: decisionPrincipal(),
    });
    const own = view.rows.find((row) => row.decisionId === "dec-1");
    const participation = view.rows.find((row) => row.decisionId === "dec-final");
    for (const row of [own, participation]) {
      expect(row).toBeDefined();
      expect(row).not.toHaveProperty("requiredPermissions");
    }
    expect(evolutionDecisionAuthorityLabel(own?.requiredAuthority ?? "")).toBe("本人");
    expect(own?.allowedActions.map(evolutionDecisionActionLabel)).toEqual(["暂停", "拒绝"]);
    expect(evolutionDecisionAuthorityLabel(participation?.requiredAuthority ?? "")).toBe(
      "企业管理员，并需本人最终授权",
    );
    expect(participation?.allowedActions.map(evolutionDecisionActionLabel)).toEqual([
      "本人最终授权",
    ]);
    const actionLabels = new Set(EVOLUTION_DECISION_ACTIONS.map(evolutionDecisionActionLabel));
    for (const authority of EVOLUTION_DECISION_REQUIRED_AUTHORITIES) {
      expect(actionLabels.has(evolutionDecisionAuthorityLabel(authority))).toBe(false);
    }
  });
});
