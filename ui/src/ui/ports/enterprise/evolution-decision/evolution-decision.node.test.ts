// @vitest-environment jsdom
/**
 * Enterprise Decision Surface adapter, runtime gate, and display contract tests.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EVOLUTION_DECISION_ACTIONS,
  EVOLUTION_DECISION_REQUIRED_AUTHORITIES,
  EVOLUTION_DECISION_TYPES,
  EVOLUTION_ENTERPRISE_DECISION_DENIALS,
  EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED,
  EVOLUTION_ENTERPRISE_DECISION_UI_STATUSES,
  captureEvolutionDecisionCommandRecord,
  listEvolutionSurfaces,
  routeEvolutionDecisionSurface,
  type EvolutionDecisionCommand,
  type EvolutionEnterpriseDecisionFact,
} from "@openbot/evolution-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  hasEnterpriseDecisionIdentity,
  isEnterpriseDecisionActionAllowedByMap,
  loadEvolutionEnterpriseDecisionSurface,
  submitEvolutionEnterpriseDecisionAction,
} from "./client.ts";
import {
  EVOLUTION_ENTERPRISE_DECISION_ACTION_LABELS,
  EVOLUTION_ENTERPRISE_DECISION_AUTHORITY_LABELS,
  EVOLUTION_ENTERPRISE_DECISION_COPY,
  EVOLUTION_ENTERPRISE_DECISION_REASON_LABELS,
  EVOLUTION_ENTERPRISE_DECISION_STATUS_LABELS,
  EVOLUTION_ENTERPRISE_DECISION_WOW_LABELS,
} from "./copy.ts";
import {
  enterpriseDecisionActionLabel,
  enterpriseDecisionAuthorityLabel,
  enterpriseDecisionEvidenceAvailabilityLabel,
  enterpriseDecisionEvidenceText,
  enterpriseDecisionReasonLabel,
  enterpriseDecisionReceiptText,
  enterpriseDecisionStatusLabel,
  enterpriseDecisionTargetLabel,
  enterpriseDecisionTimesText,
  enterpriseDecisionTypeLabel,
  enterpriseDecisionUnavailableActionLines,
  enterpriseDecisionWowDisplay,
} from "./display.ts";
import {
  PERSONAL_SECRETS,
  PLATFORM_SECRETS,
  canaryParticipationFact,
  enterpriseFact,
  enterpriseHistory,
  enterprisePrincipal,
  enterpriseSubmitContext,
  failingEnterpriseHistorySource,
  personalParticipationFact,
  staticEnterpriseHistorySource,
} from "./evolution-decision-test-fixtures.ts";
import { enterpriseEvolutionDecisionSurfaceMountEnabled } from "./runtime-gate.ts";
import type {
  EvolutionEnterpriseDecisionRow,
  EvolutionEnterpriseDecisionSubmitReceipt,
} from "./types.ts";

const CJK = /[\u4e00-\u9fff]/u;
const ASCII_LETTER = /[A-Za-z]/;

function expectChineseLabel(label: string): void {
  expect(label).toMatch(CJK);
  expect(label).not.toMatch(ASCII_LETTER);
}

/** Codes the D1 judge, authority resolver, router, and grant gate can return. */
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

async function projectRows(
  current: readonly EvolutionEnterpriseDecisionFact[],
): Promise<EvolutionEnterpriseDecisionRow[]> {
  const view = await loadEvolutionEnterpriseDecisionSurface({
    source: staticEnterpriseHistorySource(enterpriseHistory(current, [])),
    principal: enterprisePrincipal(),
  });
  return view.rows;
}

function rowOf(
  rows: readonly EvolutionEnterpriseDecisionRow[],
  decisionId: string,
): EvolutionEnterpriseDecisionRow {
  const row = rows.find((entry) => entry.decisionId === decisionId);
  if (!row) {
    throw new Error(`row ${decisionId} missing`);
  }
  return row;
}

const DIR = "ui/src/ui/ports/enterprise/evolution-decision";

function readSource(file: string): string {
  return readFileSync(join(process.cwd(), DIR, file), "utf8");
}

/** Code only: block and line comments removed. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function command(overrides: Partial<EvolutionDecisionCommand> = {}): EvolutionDecisionCommand {
  return {
    commandId: "cmd-ent-1",
    decisionId: "dec-k",
    action: "hold",
    expectedVersion: "dv-1",
    ...overrides,
  };
}

function expectZeroWrite(receipt: EvolutionEnterpriseDecisionSubmitReceipt): void {
  expect(receipt.writes).toEqual([]);
  expect(receipt.executed).toBe(false);
  expect(receipt.effectProof).toBe(false);
}

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  document.cookie = "evolutionEnterpriseDecisionRuntime=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  document.body.innerHTML = "";
  delete (globalThis as Record<string, unknown>).EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED;
});

describe("enterprise decision runtime gate", () => {
  it("is the closed core constant and takes no input", () => {
    expect(EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED).toBe(false);
    expect(enterpriseEvolutionDecisionSurfaceMountEnabled.length).toBe(0);
    expect(enterpriseEvolutionDecisionSurfaceMountEnabled()).toBe(false);
  });

  it("stays closed whatever the URL, query, hash, storage, cookie, form, or globals say", () => {
    window.history.replaceState(
      null,
      "",
      "/?evolutionEnterpriseDecisionRuntime=1&EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED=true#EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED=true",
    );
    window.localStorage.setItem("EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED", "true");
    window.sessionStorage.setItem("evolutionEnterpriseDecisionRuntime", "1");
    document.cookie = "evolutionEnterpriseDecisionRuntime=1";
    document.body.innerHTML = `
      <form><input name="EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED" value="true" /></form>
    `;
    (globalThis as Record<string, unknown>).EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED = true;
    expect(window.location.search).toContain("EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED");
    expect(window.location.hash).toContain("EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED");
    expect(enterpriseEvolutionDecisionSurfaceMountEnabled()).toBe(false);

    // A field a Gateway response reports about itself cannot reach it either.
    const withClaim = enterpriseEvolutionDecisionSurfaceMountEnabled as unknown as (
      claim: unknown,
    ) => boolean;
    expect(withClaim({ runtimeEnabled: true, evolutionEnterpriseDecisionRuntime: true })).toBe(
      false,
    );
  });

  it("only returns the core constant", () => {
    const code = withoutComments(readSource("runtime-gate.ts"));
    for (const token of [
      "location",
      "hash",
      "search",
      "URLSearchParams",
      "localStorage",
      "sessionStorage",
      "cookie",
      "document",
      "window",
      "globalThis",
      "FormData",
      "process",
      "import.meta",
      "request",
      "fetch",
    ]) {
      expect(code).not.toContain(token);
    }
    expect(code).toMatch(
      /export function enterpriseEvolutionDecisionSurfaceMountEnabled\(\): boolean \{\s*return EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED;\s*\}/,
    );
    expect(code.match(/\breturn\b/g)).toHaveLength(1);
  });
});

describe("enterprise decision client", () => {
  it("only allows the D1 enterprise command-map actions", () => {
    for (const action of [
      "hold",
      "reject",
      "rollback",
      "start_experiment",
      "approve_application",
      "apply_canary",
      "verify",
      "promote",
      "participate_canary",
    ]) {
      expect(isEnterpriseDecisionActionAllowedByMap(action)).toBe(true);
    }
    for (const action of [
      "employee_final_authorization",
      "authorize",
      "working-dna",
      "capsule",
      "managed-memory",
      "",
    ]) {
      expect(isEnterpriseDecisionActionAllowedByMap(action)).toBe(false);
    }
  });

  it("needs a trusted tenant and the enterprise admin role", () => {
    expect(hasEnterpriseDecisionIdentity(enterprisePrincipal())).toBe(true);
    expect(hasEnterpriseDecisionIdentity(null)).toBe(false);
    expect(hasEnterpriseDecisionIdentity(undefined)).toBe(false);
    expect(hasEnterpriseDecisionIdentity(enterprisePrincipal({ enterpriseAdmin: false }))).toBe(
      false,
    );
    expect(hasEnterpriseDecisionIdentity(enterprisePrincipal({ trustedTenantId: null }))).toBe(
      false,
    );
    expect(hasEnterpriseDecisionIdentity(enterprisePrincipal({ trustedTenantId: " " }))).toBe(
      false,
    );
  });

  it("projects injected snapshots and leaves no trace of hidden decisions", async () => {
    const source = staticEnterpriseHistorySource(
      enterpriseHistory(
        [
          enterpriseFact(),
          enterpriseFact({
            item: {
              decisionId: "dec-other-tenant",
              tenantScope: "tenant-b",
              sourceEvidenceRefs: ["ev-b-secret"],
            },
          }),
          canaryParticipationFact({ item: { decisionId: "dec-platform-wide", tenantScope: null } }),
        ],
        [],
      ),
    );
    const view = await loadEvolutionEnterpriseDecisionSurface({
      source,
      principal: enterprisePrincipal(),
    });
    expect(source.calls).toBe(1);
    expect(view.phase).toBe("loaded");
    expect(view.rows.map((row) => row.decisionId)).toEqual(["dec-k"]);
    expect(view.runtimeEnabled).toBe(false);
    expect(view.productionProven).toBe(false);
    expect(view.e52Open).toBe(false);
    const json = JSON.stringify(view);
    for (const hidden of ["dec-other-tenant", "tenant-b", "ev-b-secret", "dec-platform-wide"]) {
      expect(json).not.toContain(hidden);
    }
    expect(view).not.toHaveProperty("omitted");
  });

  it("never reads the source for a principal without enterprise identity", async () => {
    for (const principal of [
      enterprisePrincipal({ enterpriseAdmin: false }),
      enterprisePrincipal({ trustedTenantId: null }),
    ]) {
      const source = staticEnterpriseHistorySource(enterpriseHistory([enterpriseFact()], []));
      const view = await loadEvolutionEnterpriseDecisionSurface({ source, principal });
      expect(source.calls).toBe(0);
      expect(view.phase).toBe("denied");
      expect(view.rows).toEqual([]);
      expect(view.asOf).toBeNull();
      expect(JSON.stringify(view)).not.toContain("dec-k");
    }
  });

  it("treats a failed snapshot load as load-fail, not an empty list", async () => {
    const view = await loadEvolutionEnterpriseDecisionSurface({
      source: failingEnterpriseHistorySource(),
      principal: enterprisePrincipal(),
    });
    expect(view.phase).toBe("load-fail");
    expect(view.rows).toEqual([]);
    expect(view.weekOverWeek).toEqual({
      schemaVersion: 1,
      availability: "history-unavailable",
      reason: "snapshot_load_failed",
    });
  });

  it("keeps a projected participation row redacted", async () => {
    const view = await loadEvolutionEnterpriseDecisionSurface({
      source: staticEnterpriseHistorySource(
        enterpriseHistory([personalParticipationFact(), canaryParticipationFact()], []),
      ),
      principal: enterprisePrincipal(),
    });
    expect(
      view.rows.map((row) => [row.decisionId, row.uiStatus, row.evidence.availability]),
    ).toEqual([
      ["dec-personal", "waiting-employee-authorization", "withheld"],
      ["dec-canary", "participate-platform-canary", "withheld"],
    ]);
    const json = JSON.stringify(view);
    for (const secret of [...PERSONAL_SECRETS, ...PLATFORM_SECRETS]) {
      expect(json).not.toContain(secret);
    }
  });
});

describe("enterprise decision submit", () => {
  it("accepts a plan without executing it", () => {
    const receipt = submitEvolutionEnterpriseDecisionAction({
      command: command(),
      context: enterpriseSubmitContext(enterpriseFact()),
    });
    expect(receipt.outcome).toBe("accepted");
    expect(receipt.code).toBe("admissible");
    expect(receipt.auditReceiptRef).toBe("decision-plan:cmd-ent-1");
    expectZeroWrite(receipt);
  });

  it("replays the same commandId, refuses a rebind, and stays zero-write", () => {
    const fact = enterpriseFact();
    const first = submitEvolutionEnterpriseDecisionAction({
      command: command(),
      context: enterpriseSubmitContext(fact),
    });
    const prior = [
      captureEvolutionDecisionCommandRecord({
        command: command(),
        item: fact.item,
        principal: enterprisePrincipal(),
        auditReceiptRef: first.auditReceiptRef,
        route: routeEvolutionDecisionSurface(fact.routeInput),
      }),
    ];
    const replay = submitEvolutionEnterpriseDecisionAction({
      command: command(),
      context: enterpriseSubmitContext(fact, { prior }),
    });
    expect(replay.outcome).toBe("idempotent_replay");
    expect(replay.auditReceiptRef).toBe(first.auditReceiptRef);
    expectZeroWrite(replay);

    const rebind = submitEvolutionEnterpriseDecisionAction({
      command: command({ action: "reject" }),
      context: enterpriseSubmitContext(fact, { prior }),
    });
    expect(rebind.code).toBe("command_rebind");
    expect(rebind.outcome).toBe("rejected");
    expectZeroWrite(rebind);

    const stale = submitEvolutionEnterpriseDecisionAction({
      command: command({ commandId: "cmd-ent-stale", expectedVersion: "dv-0" }),
      context: enterpriseSubmitContext(fact),
    });
    expect(stale.code).toBe("version_mismatch");
    expectZeroWrite(stale);
  });

  it("refuses a second canary confirmation with a new commandId", () => {
    const acknowledged = canaryParticipationFact({
      authorityFacts: { enterpriseCanaryAcknowledged: true },
    });
    const repeat = submitEvolutionEnterpriseDecisionAction({
      command: command({
        commandId: "cmd-ent-canary-2",
        decisionId: "dec-canary",
        action: "participate_canary",
      }),
      context: enterpriseSubmitContext(acknowledged),
    });
    expect(repeat.code).toBe("participation_already_satisfied");
    expect(repeat.outcome).toBe("blocked");
    expectZeroWrite(repeat);
  });

  it("refuses identity, grant, delegation, participation, evidence, and adapter fields", () => {
    const refusals: Record<string, string> = {
      tenantId: "client_authority_forbidden",
      enterpriseId: "client_authority_forbidden",
      trustedTenantId: "client_authority_forbidden",
      enterpriseAdmin: "client_authority_forbidden",
      principalRef: "client_authority_forbidden",
      role: "client_authority_forbidden",
      audience: "client_authority_forbidden",
      grant: "client_authority_forbidden",
      delegation: "client_authority_forbidden",
      evidence: "client_authority_forbidden",
      sourceEvidenceRefs: "client_authority_forbidden",
      adapter: "client_authority_forbidden",
      adapterParams: "client_authority_forbidden",
      approval: "client_authority_forbidden",
      messageText: "client_authority_forbidden",
      // Not identity names in D1, so they are unknown command fields.
      authorityFacts: "invalid_command",
      employeeFinalAuthorization: "invalid_command",
      enterpriseCanaryAcknowledged: "invalid_command",
    };
    for (const [field, code] of Object.entries(refusals)) {
      const smuggled = { ...command({ commandId: `cmd-${field}` }), [field]: true };
      const receipt = submitEvolutionEnterpriseDecisionAction({
        command: smuggled as unknown as EvolutionDecisionCommand,
        context: enterpriseSubmitContext(enterpriseFact()),
      });
      expect([field, receipt.code]).toEqual([field, code]);
      expect(receipt.outcome).toBe("rejected");
      expectZeroWrite(receipt);
    }
  });

  it("uses only server-resolved context for identity and participation", () => {
    const personal = personalParticipationFact();
    const apply = submitEvolutionEnterpriseDecisionAction({
      command: command({ decisionId: "dec-personal", action: "apply_canary" }),
      context: enterpriseSubmitContext(personal),
    });
    expect(apply.code).toBe("employee_authorization_required");
    expectZeroWrite(apply);

    const onBehalf = submitEvolutionEnterpriseDecisionAction({
      command: command({ decisionId: "dec-personal", action: "employee_final_authorization" }),
      context: enterpriseSubmitContext(personal),
    });
    expect(onBehalf.code).toBe("endpoint_action_forbidden");
    expectZeroWrite(onBehalf);

    const nonAdmin = submitEvolutionEnterpriseDecisionAction({
      command: command(),
      context: enterpriseSubmitContext(enterpriseFact(), {
        principal: enterprisePrincipal({ enterpriseAdmin: false }),
      }),
    });
    expect(nonAdmin.code).toBe("enterprise_admin_required");
    expectZeroWrite(nonAdmin);
  });

  it("never reaches a network, storage, or Adapter API", () => {
    for (const file of ["client.ts", "types.ts", "runtime-gate.ts"]) {
      const code = withoutComments(readSource(file));
      for (const token of [
        "fetch(",
        "XMLHttpRequest",
        "WebSocket",
        ".request(",
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "node:fs",
        "evolution.proposals",
        "evolution.applications",
        "evolution.delegation",
        "evolution.perception",
        "Adapter",
      ]) {
        expect([file, code.includes(token)]).toEqual([file, false]);
      }
    }
  });
});

describe("Chinese business labels", () => {
  it("maps every enterprise status to its business label", () => {
    expect(EVOLUTION_ENTERPRISE_DECISION_STATUS_LABELS).toEqual({
      "pending-enterprise-decision": "待企业决定",
      "waiting-employee-authorization": "等待本人最终授权",
      "participate-platform-canary": "需要参与平台灰度",
      watching: "观察中",
      completed: "已完成",
      blocked: "当前受阻",
      expired: "已过期",
    });
    for (const status of EVOLUTION_ENTERPRISE_DECISION_UI_STATUSES) {
      expectChineseLabel(enterpriseDecisionStatusLabel(status));
      expectChineseLabel(EVOLUTION_ENTERPRISE_DECISION_WOW_LABELS[status]);
    }
  });

  it("labels every action, decision type, authority, and evidence state in Chinese", () => {
    for (const action of EVOLUTION_DECISION_ACTIONS) {
      expectChineseLabel(enterpriseDecisionActionLabel(action));
      expect(enterpriseDecisionActionLabel(action)).not.toBe(
        EVOLUTION_ENTERPRISE_DECISION_COPY.fallbackAction,
      );
    }
    for (const decisionType of EVOLUTION_DECISION_TYPES) {
      expectChineseLabel(enterpriseDecisionTypeLabel(decisionType));
      expect(enterpriseDecisionTypeLabel(decisionType)).not.toBe(
        EVOLUTION_ENTERPRISE_DECISION_COPY.fallbackDecisionType,
      );
    }
    for (const authority of EVOLUTION_DECISION_REQUIRED_AUTHORITIES) {
      expectChineseLabel(enterpriseDecisionAuthorityLabel(authority));
      expect(enterpriseDecisionAuthorityLabel(authority)).not.toBe(
        EVOLUTION_ENTERPRISE_DECISION_COPY.fallbackAuthority,
      );
    }
    for (const availability of ["available", "unavailable", "withheld"]) {
      expectChineseLabel(enterpriseDecisionEvidenceAvailabilityLabel(availability));
      expect(enterpriseDecisionEvidenceAvailabilityLabel(availability)).not.toBe(
        EVOLUTION_ENTERPRISE_DECISION_COPY.fallbackEvidence,
      );
    }
  });

  it("keeps who decides apart from what can be done", () => {
    const actionLabels = new Set(Object.values(EVOLUTION_ENTERPRISE_DECISION_ACTION_LABELS));
    for (const label of Object.values(EVOLUTION_ENTERPRISE_DECISION_AUTHORITY_LABELS)) {
      expect(actionLabels.has(label)).toBe(false);
    }
  });

  it("names every registered surface and domain in Chinese", () => {
    for (const surface of listEvolutionSurfaces()) {
      const label = enterpriseDecisionTargetLabel({
        domain: surface.domain,
        surfaceId: surface.surfaceId,
      });
      expectChineseLabel(label);
      expect(label).not.toContain(EVOLUTION_ENTERPRISE_DECISION_COPY.fallbackSurface);
      expect(label).not.toContain(EVOLUTION_ENTERPRISE_DECISION_COPY.fallbackDomain);
    }
    expect(
      enterpriseDecisionTargetLabel({
        domain: "knowledge",
        surfaceId: "knowledge.experience-capsule",
      }),
    ).toBe("知识 · 经验胶囊");
  });

  it("labels every row reason, D1 refusal, denial, and UI refusal in Chinese", () => {
    const codes = [
      ...D1_REFUSAL_CODES,
      ...EVOLUTION_ENTERPRISE_DECISION_DENIALS,
      "handled",
      "blocked",
      "action_not_on_item",
      "submit_context_unavailable",
      "command_id_unavailable",
      ...Object.keys(EVOLUTION_ENTERPRISE_DECISION_REASON_LABELS),
    ];
    for (const code of codes) {
      const label = enterpriseDecisionReasonLabel(code);
      expectChineseLabel(label);
      expect([code, label === EVOLUTION_ENTERPRISE_DECISION_COPY.fallbackReason]).toEqual([
        code,
        false,
      ]);
    }
  });

  it("falls back to generic Chinese instead of echoing unknown values", () => {
    const copy = EVOLUTION_ENTERPRISE_DECISION_COPY;
    for (const unknown of ["constructor", "__proto__", "toString", "brand_new_code"]) {
      expect(enterpriseDecisionActionLabel(unknown)).toBe(copy.fallbackAction);
      expect(enterpriseDecisionReasonLabel(unknown)).toBe(copy.fallbackReason);
      expect(enterpriseDecisionTypeLabel(unknown)).toBe(copy.fallbackDecisionType);
      expect(enterpriseDecisionAuthorityLabel(unknown)).toBe(copy.fallbackAuthority);
      expect(enterpriseDecisionStatusLabel(unknown)).toBe(copy.fallbackStatus);
      expect(enterpriseDecisionEvidenceAvailabilityLabel(unknown)).toBe(copy.fallbackEvidence);
    }
    expect([
      copy.fallbackAction,
      copy.fallbackReason,
      copy.fallbackDecisionType,
      copy.fallbackAuthority,
      copy.fallbackDomain,
      copy.fallbackSurface,
      copy.fallbackStatus,
    ]).toEqual([
      "未知操作",
      "暂不可执行",
      "进化事项",
      "负责的管理员",
      "相关对象",
      "未登记对象",
      "状态未知",
    ]);
    expect(
      enterpriseDecisionTargetLabel({
        domain: "unknown" as never,
        surfaceId: "system.engineering-remediation",
      }),
    ).toBe("相关对象 · 未登记对象");
  });
});

describe("redacted rendering text", () => {
  it("shows only evidence counts for enterprise-owned decisions", async () => {
    const rows = await projectRows([
      enterpriseFact(),
      enterpriseFact({
        item: {
          decisionId: "dec-case",
          sourceEvidenceRefs: ["ev-1", "ev-1"],
          sourceCaseId: "case-enterprise-secret",
        },
      }),
      enterpriseFact({
        item: { decisionId: "dec-none", sourceEvidenceRefs: [], sourceFindingIds: [] },
      }),
    ]);
    expect(enterpriseDecisionEvidenceText(rowOf(rows, "dec-k"))).toBe(
      "依据：1 条引用 · 1 条发现 · 无关联案例",
    );
    expect(enterpriseDecisionEvidenceText(rowOf(rows, "dec-case"))).toBe(
      "依据：2 条引用 · 1 条发现 · 有关联案例",
    );
    expect(enterpriseDecisionEvidenceText(rowOf(rows, "dec-none"))).toBe("依据：摘要暂不可用");
    for (const row of rows) {
      expect(enterpriseDecisionEvidenceText(row)).not.toContain("secret");
    }
  });

  it("describes an employee personal-asset row without counts or ids", async () => {
    const row = rowOf(await projectRows([personalParticipationFact()]), "dec-personal");
    expect(enterpriseDecisionStatusLabel(row.uiStatus)).toBe("等待本人最终授权");
    expect(enterpriseDecisionEvidenceText(row)).toBe(
      "相关依据由员工本人或授权系统保管，这里不展示明细。",
    );
    expect(enterpriseDecisionAuthorityLabel(row.requiredAuthority)).toBe(
      "企业管理员，并需员工本人最终授权",
    );
    expect(row.allowedActions.map(enterpriseDecisionActionLabel)).toEqual(["暂停", "拒绝"]);
    expect(enterpriseDecisionUnavailableActionLines(row).map((line) => line.text)).toEqual([
      "暂不可执行：启动实验（需要员工本人最终授权）",
      "暂不可执行：灰度应用（需要员工本人最终授权）",
      "暂不可执行：推广（需要员工本人最终授权）",
    ]);
  });

  it("describes a platform canary row before and after confirmation", async () => {
    const pending = rowOf(await projectRows([canaryParticipationFact()]), "dec-canary");
    expect(enterpriseDecisionStatusLabel(pending.uiStatus)).toBe("需要参与平台灰度");
    expect(enterpriseDecisionEvidenceText(pending)).toBe(
      "平台变更将影响本企业，需要确认是否参与灰度。",
    );
    expect(pending.allowedActions.map(enterpriseDecisionActionLabel)).toEqual(["参与平台灰度"]);
    expect(enterpriseDecisionTargetLabel(pending.impactTarget)).toBe("系统 · 运行绑定治理");
    expect(pending.impactTarget).not.toHaveProperty("key");

    const confirmed = rowOf(
      await projectRows([
        canaryParticipationFact({ authorityFacts: { enterpriseCanaryAcknowledged: true } }),
      ]),
      "dec-canary",
    );
    expect(confirmed.uiStatus).toBe("watching");
    expect(confirmed.allowedActions).toEqual([]);
    expect(enterpriseDecisionStatusLabel(confirmed.uiStatus)).toBe("观察中");
    expect(enterpriseDecisionEvidenceText(confirmed)).toBe(
      "平台变更将影响本企业，本企业已确认参与灰度。",
    );
    expect(enterpriseDecisionUnavailableActionLines(confirmed).map((line) => line.text)).toEqual([
      "暂不可执行：参与平台灰度（已经确认过，不需要重复确认）",
    ]);

    const expired = rowOf(
      await projectRows([canaryParticipationFact({ item: { status: "expired" } })]),
      "dec-canary",
    );
    expect(enterpriseDecisionEvidenceText(expired)).toBe("平台变更将影响本企业。");
  });

  it("formats times from the ISO date as written", () => {
    expect(
      enterpriseDecisionTimesText({
        createdAt: "2026-09-21T23:30:00.000Z",
        updatedAt: "2026-09-28T12:00:00.000Z",
        expiresAt: "2026-10-05T00:00:00.000Z",
      }),
    ).toBe("创建 2026-09-21 · 更新 2026-09-28 · 截止 2026-10-05");
    expect(enterpriseDecisionTimesText({ createdAt: "soon", updatedAt: "" })).toBe(
      "创建 时间未知 · 更新 时间未知",
    );
  });
});

describe("weekly comparison display", () => {
  async function wowFor(input: {
    current: readonly EvolutionEnterpriseDecisionFact[];
    prior: readonly EvolutionEnterpriseDecisionFact[] | null;
    currentAsOf?: string;
    priorAsOf?: string;
  }) {
    const view = await loadEvolutionEnterpriseDecisionSurface({
      source: staticEnterpriseHistorySource(
        enterpriseHistory(input.current, input.prior, {
          current: input.currentAsOf,
          prior: input.priorAsOf,
        }),
      ),
      principal: enterprisePrincipal(),
    });
    return enterpriseDecisionWowDisplay(view.weekOverWeek);
  }

  it("compares the same decisions across the two snapshots", async () => {
    const wow = await wowFor({
      prior: [enterpriseFact(), personalParticipationFact(), canaryParticipationFact()],
      current: [
        enterpriseFact({ item: { status: "resolved" } }),
        personalParticipationFact({ authorityFacts: { employeeFinalAuthorization: true } }),
        canaryParticipationFact({ authorityFacts: { enterpriseCanaryAcknowledged: true } }),
        enterpriseFact({ item: { decisionId: "dec-new", status: "expired" } }),
      ],
    });
    if (wow.availability !== "available") {
      throw new Error("expected an available weekly comparison");
    }
    expect(wow.period).toBe("上周 2026-09-21 → 本周 2026-09-28");
    expect(wow.counts.map((line) => line.text)).toEqual([
      "企业待决定：上周 1 项，本周 1 项，没有变化",
      "等待员工最终授权：上周 1 项，本周 0 项，减少 1 项",
      "参与平台灰度：上周 1 项，本周 0 项，减少 1 项",
      "观察中：上周 0 项，本周 1 项，增加 1 项",
      "已完成：上周 0 项，本周 1 项，增加 1 项",
      "阻断：上周 0 项，本周 0 项，没有变化",
      "过期：上周 0 项，本周 1 项，增加 1 项",
      "事项总数：上周 3 项，本周 4 项，增加 1 项",
    ]);
    expect(wow.transitions).toEqual([
      "「暂停或恢复」：待企业决定 → 已完成",
      "「暂停或恢复」：等待本人最终授权 → 待企业决定",
      "「灰度参与」：需要参与平台灰度 → 观察中",
      "「暂停或恢复」：上周未出现 → 已过期",
    ]);
  });

  it("keeps hidden decisions out of counts and transitions", async () => {
    const hidden = [
      enterpriseFact({ item: { decisionId: "dec-other-tenant", tenantScope: "tenant-b" } }),
      canaryParticipationFact({ item: { decisionId: "dec-platform-wide", tenantScope: null } }),
      personalParticipationFact({
        item: { decisionId: "dec-undelegated", requiredAuthority: "employee" },
        routeInput: {
          ownership: { kind: "agent_enterprise", delegated: false },
          touchesEmployeePersonalAsset: false,
        },
      }),
    ];
    const wow = await wowFor({
      prior: [enterpriseFact(), ...hidden],
      current: [enterpriseFact({ item: { status: "resolved" } }), ...hidden.slice(0, 2)],
    });
    if (wow.availability !== "available") {
      throw new Error("expected an available weekly comparison");
    }
    expect(wow.counts.at(-1)?.text).toBe("事项总数：上周 1 项，本周 1 项，没有变化");
    expect(wow.transitions).toEqual(["「暂停或恢复」：待企业决定 → 已完成"]);
  });

  it("shows only the history-unavailable sentence when the prior snapshot cannot be used", async () => {
    const unusable = [
      { current: [enterpriseFact()], prior: null },
      { current: [enterpriseFact()], prior: [enterpriseFact()], priorAsOf: "last week" },
      {
        current: [enterpriseFact()],
        prior: [enterpriseFact()],
        priorAsOf: "2026-09-27T12:00:00.000Z",
      },
      {
        current: [enterpriseFact()],
        prior: [enterpriseFact()],
        priorAsOf: "2026-09-30T12:00:00.000Z",
      },
    ];
    for (const input of unusable) {
      expect(await wowFor(input)).toEqual({
        availability: "history-unavailable",
        message: "暂无足够历史数据，不能形成企业周度对比。",
      });
    }
    const failed = await loadEvolutionEnterpriseDecisionSurface({
      source: failingEnterpriseHistorySource(),
      principal: enterprisePrincipal(),
    });
    expect(enterpriseDecisionWowDisplay(failed.weekOverWeek)).toEqual({
      availability: "history-unavailable",
      message: "暂无足够历史数据，不能形成企业周度对比。",
    });
  });
});

describe("receipt copy", () => {
  it("says an accepted or replayed request has not run and names the refusal reason", () => {
    expect(enterpriseDecisionReceiptText({ outcome: "accepted", code: "admissible" })).toBe(
      "请求已通过规则校验，但尚未执行。",
    );
    expect(
      enterpriseDecisionReceiptText({ outcome: "idempotent_replay", code: "idempotent_replay" }),
    ).toBe("重复请求已识别；原请求尚未执行。");
    expect(
      enterpriseDecisionReceiptText({
        outcome: "blocked",
        code: "participation_already_satisfied",
      }),
    ).toBe("请求未通过规则校验：已经确认过，不需要重复确认。没有执行任何变更。");
    expect(enterpriseDecisionReceiptText({ outcome: "rejected", code: "brand_new_code" })).toBe(
      "请求未通过规则校验：暂不可执行。没有执行任何变更。",
    );
    const texts = [
      enterpriseDecisionReceiptText({ outcome: "accepted", code: "admissible" }),
      enterpriseDecisionReceiptText({ outcome: "idempotent_replay", code: "idempotent_replay" }),
      enterpriseDecisionReceiptText({ outcome: "rejected", code: "version_mismatch" }),
      enterpriseDecisionReceiptText({
        outcome: "blocked",
        code: "employee_authorization_required",
      }),
    ];
    for (const text of texts) {
      expectChineseLabel(text);
      for (const claim of ["已应用", "已完成", "已生效", "已执行", "成功"]) {
        expect(text).not.toContain(claim);
      }
    }
  });
});
