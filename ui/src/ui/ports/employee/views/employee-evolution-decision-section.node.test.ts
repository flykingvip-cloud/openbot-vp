// @vitest-environment jsdom
/**
 * Employee Decision Surface section and settings-page mount tests.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 */
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, normalize } from "node:path";
import type { EvolutionEmployeeDecisionFact } from "@openbot/evolution-core";
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./employee-evolution-decision-section.ts";
import type {
  EvolutionDecisionHistorySource,
  EvolutionDecisionSubmitContext,
} from "../evolution-decision/client.ts";
import {
  EVOLUTION_DECISION_ACTION_LABELS,
  EVOLUTION_DECISION_COPY,
} from "../evolution-decision/copy.ts";
import {
  DECISION_INTERNAL_CONTRACT_TOKENS,
  decisionFact,
  decisionHistory,
  decisionItem,
  decisionPrincipal,
  decisionSubmitContext,
  failingHistorySource,
  participationDecisionFact,
  staticHistorySource,
  userVisibleText,
} from "../evolution-decision/evolution-decision-test-fixtures.ts";
import { EVOLUTION_PERCEPTION_COPY } from "../evolution-perception/copy.ts";
import { renderModuleContentPage } from "./workbench-stage-module.ts";

const SECTION_SELECTOR = "employee-evolution-decision-section";

type Call = { method: string; params: Record<string, unknown> };

function perceptionClient() {
  const calls: Call[] = [];
  const client = {
    connected: true,
    async request(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      if (method === "evolution.perception.query") {
        return {
          access: "read-only",
          persisted: false,
          intent: "learned_this_week",
          denial: null,
          result: { items: [], platformItems: [], unresolvedIntents: [], completeness: "empty" },
          narration: null,
          narrationGuard: null,
        };
      }
      return {
        access: "read-only",
        operation: params.operation,
        persisted: false,
        projection: {
          items: [],
          learnedItems: [],
          actions: [],
          digitalHumanItems: [],
          platformItems: [],
          completeness: "empty",
        },
      };
    },
  };
  return { calls, client };
}

function renderEvolutionSettings(client: unknown, extraSettings: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  render(
    renderModuleContentPage(
      {
        settings: {
          view: "system",
          systemTab: "evolution",
          client,
          connected: true,
          onSystemTabChange: () => {},
          ...extraSettings,
        },
      } as never,
      { primaryModule: "settings" } as never,
      "设置",
      "",
    ),
    container,
  );
  return container;
}

async function mountSection(
  input: {
    current?: EvolutionEmployeeDecisionFact[];
    prior?: EvolutionEmployeeDecisionFact[] | null;
    source?: EvolutionDecisionHistorySource;
    contexts?: Map<string, EvolutionDecisionSubmitContext>;
    wired?: boolean;
  } = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const el = document.createElement(SECTION_SELECTOR);
  if (input.wired !== false) {
    el.principal = decisionPrincipal();
    el.historySource =
      input.source ??
      staticHistorySource(
        decisionHistory(
          input.current ?? [decisionFact()],
          input.prior === undefined ? [decisionFact()] : input.prior,
        ),
      );
  }
  el.submitContexts = input.contexts ?? new Map();
  host.append(el);
  await el.updateComplete;
  if (input.wired !== false) {
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

function fieldText(row: Element, field: string): string {
  return (row.querySelector(`[data-field='${field}']`)?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldTexts(row: Element, field: string): string[] {
  return [...row.querySelectorAll(`[data-field='${field}']`)].map((node) =>
    (node.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
}

function buttonLabels(row: Element): string[] {
  return [...row.querySelectorAll<HTMLButtonElement>(".employee-evolution-decision__action")].map(
    (button) => (button.textContent ?? "").trim(),
  );
}

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  document.body.innerHTML = "";
});

describe("settings page runtime gate", () => {
  it("does not mount the Decision Surface while the gate is closed", () => {
    const { client } = perceptionClient();
    const container = renderEvolutionSettings(client);
    expect(container.querySelector("employee-evolution-perception-section")).not.toBeNull();
    expect(container.querySelector(SECTION_SELECTOR)).toBeNull();
    expect(container.querySelector(".employee-evolution-decision")).toBeNull();
    expect(container.querySelector("[data-evolution-decision]")).toBeNull();
    expect(container.textContent).not.toContain(EVOLUTION_DECISION_COPY.title);
    expect(container.textContent).not.toContain("code-present");
    expect(container.textContent).not.toContain("runtime-enabled");
  });

  it("ignores URL, storage, cookies, forms, and client claims", () => {
    window.history.replaceState(
      null,
      "",
      "/?evolutionEmployeeDecisionRuntime=1&EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED=true",
    );
    window.localStorage.setItem("EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED", "true");
    window.sessionStorage.setItem("evolutionEmployeeDecisionRuntime", "1");
    document.cookie = "evolutionEmployeeDecisionRuntime=1";
    const form = document.createElement("form");
    form.innerHTML = `<input name="EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED" value="true" />`;
    document.body.append(form);

    const { client } = perceptionClient();
    const container = renderEvolutionSettings(client, {
      evolutionDecisionRuntimeEnabled: true,
      evolutionDecisionPrincipal: decisionPrincipal(),
      runtimeEnabled: true,
    });
    expect(container.querySelector(SECTION_SELECTOR)).toBeNull();
    expect(container.textContent).not.toContain(EVOLUTION_DECISION_COPY.title);
  });

  it("leaves the Perception panel mounted, wired, and read-only", async () => {
    const { calls, client } = perceptionClient();
    const container = renderEvolutionSettings(client);
    const perception = container.querySelector("employee-evolution-perception-section") as
      | (HTMLElement & { client: unknown; connected: boolean })
      | null;
    expect(perception).not.toBeNull();
    expect(perception?.client).toBe(client);
    expect(perception?.connected).toBe(true);
    await vi.waitFor(() => {
      expect(calls.some((call) => call.method === "evolution.perception.query")).toBe(true);
    });
    expect(container.querySelector("[data-evolution-perception]")).not.toBeNull();
    expect(container.textContent).toContain(EVOLUTION_PERCEPTION_COPY.weekChangeTitle);
    expect(calls.every((call) => call.method.startsWith("evolution.perception."))).toBe(true);
  });

  it("gates the only mount point in the settings module", () => {
    const source = readFileSync(
      join(process.cwd(), "ui/src/ui/ports/employee/views/workbench-stage-module.ts"),
      "utf8",
    );
    expect(source.match(/<employee-evolution-decision-section[\s>]/g)).toHaveLength(1);
    expect(source).toMatch(
      /employeeEvolutionDecisionSurfaceMountEnabled\(\)\s*\?\s*html`\s*<employee-evolution-decision-section>/,
    );
  });
});

describe("employee evolution decision section", () => {
  it("renders injected snapshots on its own", async () => {
    const { host } = await mountSection({ current: [decisionFact()], prior: [decisionFact()] });
    const section = host.querySelector(".employee-evolution-decision");
    expect(section?.getAttribute("data-evolution-decision")).toBe("code-present");
    expect(section?.getAttribute("data-runtime-enabled")).toBe("false");
    expect(section?.getAttribute("data-production-proven")).toBe("false");
    expect(section?.getAttribute("data-e52")).toBe("false");
    expect(host.textContent).toContain(EVOLUTION_DECISION_COPY.title);
    expect(host.querySelector("[data-decision-id='dec-1']")).not.toBeNull();
  });

  it("renders nothing until a principal and snapshot source are injected", async () => {
    const { el } = await mountSection({ wired: false });
    expect(el.querySelector(".employee-evolution-decision")).toBeNull();
    expect((el.textContent ?? "").trim()).toBe("");

    el.principal = decisionPrincipal();
    await el.updateComplete;
    expect(el.querySelector(".employee-evolution-decision")).toBeNull();
    expect((el.textContent ?? "").trim()).toBe("");
  });

  it("keeps internal contract words out of employee-visible text", async () => {
    const own = decisionItem();
    const { host, el } = await mountSection({
      current: [
        decisionFact(),
        participationDecisionFact(),
        decisionFact({ item: { decisionId: "dec-done", status: "resolved" } }),
        decisionFact({ item: { decisionId: "dec-exp", status: "expired" } }),
        decisionFact({
          item: { decisionId: "dec-noev", sourceEvidenceRefs: [], sourceFindingIds: [] },
        }),
      ],
      prior: [decisionFact(), decisionFact({ item: { decisionId: "dec-done" } })],
      contexts: new Map([["dec-1", decisionSubmitContext(own)]]),
    });
    const texts = [userVisibleText(host)];

    rowOf(host, "dec-1").querySelector<HTMLButtonElement>("[data-action='hold']")?.click();
    await el.updateComplete;
    const receipt = host.querySelector(".employee-evolution-decision__receipt");
    // The machine ref stays in data-* only.
    expect(receipt?.getAttribute("data-audit-receipt-ref")).toMatch(/^decision-plan:/);
    texts.push(userVisibleText(host));

    (el as unknown as { onAction: (row: unknown, action: string) => void }).onAction(
      { decisionId: "dec-1", decisionVersion: "dv-1" },
      "apply_canary",
    );
    await el.updateComplete;
    texts.push(userVisibleText(host));

    for (const text of texts) {
      expect(text).not.toMatch(/[A-Za-z]/);
      for (const token of DECISION_INTERNAL_CONTRACT_TOKENS) {
        expect(text).not.toContain(token);
      }
    }
    // Contract values are still available to tooling through data-*.
    expect(rowOf(host, "dec-1").getAttribute("data-decision-type")).toBe("hold_or_resume");
    expect(rowOf(host, "dec-1").getAttribute("data-surface-id")).toBe("agent.working-dna");
  });

  it("shows action, reason, authority, and target as Chinese labels", async () => {
    const { host } = await mountSection({
      current: [
        decisionFact(),
        participationDecisionFact(),
        decisionFact({ item: { decisionId: "dec-done", status: "resolved" } }),
        decisionFact({ item: { decisionId: "dec-exp", status: "expired" } }),
      ],
    });
    const own = rowOf(host, "dec-1");
    expect(own.querySelector(".employee-evolution-decision__row-title")?.textContent).toContain(
      "暂停或恢复",
    );
    expect(fieldText(own, "target")).toBe("影响对象：我的数字人 · 工作方式");
    expect(fieldText(own, "required-authority")).toBe("需要谁处理：本人");
    expect(buttonLabels(own)).toEqual(["暂停", "拒绝"]);
    expect(fieldText(own, "evidence")).toBe("依据：1 条引用 · 1 条发现 · 无关联案例");

    const participation = rowOf(host, "dec-final");
    expect(fieldText(participation, "required-authority")).toBe(
      "需要谁处理：企业管理员，并需本人最终授权",
    );
    expect(buttonLabels(participation)).toEqual(["本人最终授权"]);
    expect(fieldTexts(participation, "action-reason")).toEqual([
      "暂不可执行：暂停（这一步由企业管理员处理）",
      "暂不可执行：拒绝（这一步由企业管理员处理）",
    ]);
    expect(fieldText(participation, "evidence")).toBe("依据：由企业管理员掌握，这里不展示明细。");

    const done = rowOf(host, "dec-done");
    expect(buttonLabels(done)).toEqual([]);
    expect(fieldText(done, "allowed-actions").replace(/\s/g, "")).toBe(
      "可执行动作：当前没有可执行动作",
    );
    expect(fieldText(done, "not-actionable")).toBe("当前不可操作：事项已处理完毕");
    expect(fieldText(rowOf(host, "dec-exp"), "not-actionable")).toBe("当前不可操作：事项已过期");
  });

  it("offers no second final authorization once the owner has given it", async () => {
    const { host } = await mountSection({
      current: [participationDecisionFact({}, { employeeFinalAuthorization: true })],
    });
    const participation = rowOf(host, "dec-final");
    expect(buttonLabels(participation)).toEqual([]);
    expect(fieldTexts(participation, "action-reason")).toEqual([
      "暂不可执行：暂停（这一步由企业管理员处理）",
      "暂不可执行：拒绝（这一步由企业管理员处理）",
      "暂不可执行：本人最终授权（已经确认过，不需要重复确认）",
    ]);
  });

  it("separates who decides from what can be done", async () => {
    const { host } = await mountSection({
      current: [decisionFact(), participationDecisionFact()],
    });
    expect(host.textContent).not.toContain("所需权限");
    const actionLabels = Object.values(EVOLUTION_DECISION_ACTION_LABELS);
    for (const row of host.querySelectorAll(".employee-evolution-decision__row")) {
      const authority = fieldText(row, "required-authority");
      expect(authority.startsWith(`${EVOLUTION_DECISION_COPY.authorityLabel}：`)).toBe(true);
      const role = authority.slice(EVOLUTION_DECISION_COPY.authorityLabel.length + 1);
      expect(actionLabels).not.toContain(role);
      expect(row.querySelector("[data-field='required-authority'] button")).toBeNull();
      const actions = [...row.querySelectorAll("[data-field='allowed-actions'] [data-action]")];
      for (const button of actions) {
        expect(actionLabels).toContain((button.textContent ?? "").trim());
      }
    }
  });

  it("shows the weekly change of one decision from pending to done", async () => {
    const { host } = await mountSection({
      prior: [decisionFact()],
      current: [decisionFact({ item: { status: "resolved", allowedActions: [] } })],
    });
    const wow = host.querySelector("[data-wow-availability]");
    expect(wow?.getAttribute("data-wow-availability")).toBe("available");
    const text = wow?.textContent ?? "";
    expect(text).toContain("待我确认：上周 1 项，本周 0 项，减少 1 项");
    expect(text).toContain("系统已完成：上周 0 项，本周 1 项，增加 1 项");
    expect(text).toContain("事项总数：上周 1 项，本周 1 项，没有变化");
    expect(text).toContain("「暂停或恢复」：待我确认 → 系统已完成");
  });

  it("says history is unavailable instead of showing zero counts", async () => {
    const { host } = await mountSection({ current: [decisionFact()], prior: null });
    const wow = host.querySelector("[data-wow-availability]");
    expect(wow?.getAttribute("data-wow-availability")).toBe("history-unavailable");
    expect(wow?.getAttribute("data-wow-reason")).toBe("prior_snapshot_missing");
    const lines = [...(wow?.querySelectorAll(".employee-evolution-decision__line") ?? [])].map(
      (line) => (line.textContent ?? "").trim(),
    );
    expect(lines).toEqual(["暂无足够历史数据，不能形成周度对比。"]);
    expect(wow?.textContent ?? "").not.toMatch(/\d/);
    expect(host.querySelector("[data-decision-id='dec-1']")).not.toBeNull();
  });

  it("empty / load-fail / evidence-unavailable are not healthy", async () => {
    const empty = await mountSection({ current: [] });
    expect(empty.host.querySelector('[data-phase="empty"]')?.textContent).toContain(
      EVOLUTION_DECISION_COPY.empty,
    );

    const failed = await mountSection({ source: failingHistorySource() });
    expect(failed.host.querySelector('[data-phase="load-fail"]')?.textContent).toContain(
      EVOLUTION_DECISION_COPY.loadFail,
    );
    expect(failed.host.querySelector("[data-wow-availability]")).toBeNull();

    const noEvidence = await mountSection({
      current: [decisionFact({ item: { sourceEvidenceRefs: [], sourceFindingIds: [] } })],
    });
    expect(noEvidence.host.querySelector('[data-phase="evidence-unavailable"]')).not.toBeNull();
  });

  it("an accepted click is a rule-check receipt, not an effect", async () => {
    const { host, el } = await mountSection({
      contexts: new Map([["dec-1", decisionSubmitContext(decisionItem())]]),
    });
    rowOf(host, "dec-1").querySelector<HTMLButtonElement>("[data-action='hold']")?.click();
    await el.updateComplete;
    const receipt = host.querySelector(".employee-evolution-decision__receipt");
    expect(receipt?.getAttribute("data-outcome")).toBe("accepted");
    expect(receipt?.getAttribute("data-executed")).toBe("false");
    expect(receipt?.getAttribute("data-effect-proof")).toBe("false");
    expect(receipt?.getAttribute("data-writes")).toBe("0");
    expect(receipt?.getAttribute("data-audit-receipt-ref")).toMatch(/^decision-plan:/);
    expect((receipt?.textContent ?? "").trim()).toBe("请求已通过规则校验，但尚未执行。");
  });

  it("refuses actions outside the employee map and missing submit contexts", async () => {
    const { host, el } = await mountSection();
    (el as unknown as { onAction: (row: unknown, action: string) => void }).onAction(
      { decisionId: "dec-1", decisionVersion: "dv-1" },
      "apply_canary",
    );
    await el.updateComplete;
    let receipt = host.querySelector(".employee-evolution-decision__receipt");
    expect(receipt?.getAttribute("data-code")).toBe("endpoint_action_forbidden");
    expect(receipt?.getAttribute("data-executed")).toBe("false");
    expect(receipt?.getAttribute("data-effect-proof")).toBe("false");
    expect((receipt?.textContent ?? "").trim()).toBe(
      "请求未通过规则校验：你的角色不能执行这个操作。没有执行任何变更。",
    );

    rowOf(host, "dec-1").querySelector<HTMLButtonElement>("[data-action='hold']")?.click();
    await el.updateComplete;
    receipt = host.querySelector(".employee-evolution-decision__receipt");
    expect(receipt?.getAttribute("data-code")).toBe("submit_context_unavailable");
    expect((receipt?.textContent ?? "").trim()).toBe(
      "请求未通过规则校验：暂时无法提交，请稍后再试。没有执行任何变更。",
    );
  });

  it("does not turn Perception into approval UI", () => {
    const source = readFileSync(
      join(process.cwd(), "ui/src/ui/ports/employee/views/employee-evolution-decision-section.ts"),
      "utf8",
    );
    expect(source).not.toContain("evolution.perception.query");
    expect(source).not.toContain("evolution.perception.project");
    expect(source).not.toContain("employee-evolution-perception");
    expect(source).toContain("data-evolution-decision=");
    expect(source).toContain("data-effect-proof=");
    expect(source).toContain("data-executed=");
  });
});

describe("browser-safe evolution contract boundary", () => {
  const BOUNDARY = "ui/src/ui/evolution-decision-contract.ts";
  const DECISION_SURFACE_ENTRY = "packages/evolution-core/src/decision-surface/index.ts";
  const PACKAGE_ROOT_BARREL = "packages/evolution-core/src/index.ts";

  type ImportStatement = { specifier: string; typeOnly: boolean };

  function read(file: string): string {
    return readFileSync(join(process.cwd(), file), "utf8");
  }

  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  /**
   * Import and re-export statements. Only `import type` / `export type`
   * statements are erased by the build; inline `type` specifiers alone still
   * leave a runtime import, so they count as runtime.
   */
  function importStatements(source: string): ImportStatement[] {
    const code = withoutComments(source);
    const statements: ImportStatement[] = [];
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

  /** Files reachable through runtime imports from the entries, within `prefix`. */
  function runtimeClosure(
    entries: readonly string[],
    prefix: string,
  ): Map<string, ImportStatement[]> {
    const closure = new Map<string, ImportStatement[]>();
    const queue = [...entries];
    while (queue.length > 0) {
      const file = queue.shift() ?? "";
      if (closure.has(file)) {
        continue;
      }
      const statements = importStatements(read(file));
      closure.set(file, statements);
      for (const statement of statements) {
        const next =
          !statement.typeOnly && statement.specifier.startsWith(".")
            ? resolveTs(file, statement.specifier)
            : null;
        if (next?.startsWith(prefix)) {
          queue.push(next);
        }
      }
    }
    return closure;
  }

  function isEvolutionPackageRoot(specifier: string): boolean {
    return (
      specifier === "@openbot/evolution-core" || specifier.startsWith("@openbot/evolution-core/")
    );
  }

  it("keeps mounted D2 code off the package root and inside the boundary", () => {
    const closure = runtimeClosure(
      [
        "ui/src/ui/ports/employee/views/employee-evolution-decision-section.ts",
        "ui/src/ui/ports/employee/evolution-decision/runtime-gate.ts",
      ],
      "ui/src/",
    );
    const rootRuntimeImports: string[] = [];
    const packageEdges: string[] = [];
    for (const [file, statements] of closure) {
      for (const statement of statements) {
        if (statement.typeOnly) {
          continue;
        }
        if (isEvolutionPackageRoot(statement.specifier)) {
          rootRuntimeImports.push(file);
        }
        const target = statement.specifier.startsWith(".")
          ? resolveTs(file, statement.specifier)
          : null;
        if (target?.startsWith("packages/")) {
          packageEdges.push(`${file} -> ${target}`);
        }
      }
    }
    expect(rootRuntimeImports).toEqual([]);
    // Everything from the evolution package arrives through the one boundary edge.
    expect(packageEdges).toEqual([`${BOUNDARY} -> ${DECISION_SURFACE_ENTRY}`]);

    const mount = importStatements(
      read("ui/src/ui/ports/employee/views/workbench-stage-module.ts"),
    );
    expect(
      mount.filter(
        (statement) => !statement.typeOnly && isEvolutionPackageRoot(statement.specifier),
      ),
    ).toEqual([]);
  });

  it("re-exports only the decision-surface entry, which stays browser-safe", () => {
    expect(withoutComments(read(BOUNDARY)).trim()).toBe(
      `export * from "../../../${DECISION_SURFACE_ENTRY}";`,
    );

    const closure = runtimeClosure([DECISION_SURFACE_ENTRY], "packages/evolution-core/src/");
    expect([...closure.keys()]).not.toContain(PACKAGE_ROOT_BARREL);
    const nodeOnly: string[] = [];
    for (const [file, statements] of closure) {
      for (const { specifier } of statements) {
        const bare = specifier.replace(/^node:/, "").split("/")[0] ?? "";
        if (specifier.startsWith("node:") || builtinModules.includes(bare)) {
          nodeOnly.push(`${file} imports ${specifier}`);
        }
      }
      if (
        /\b(?:process\.|Buffer\b|__dirname\b|__filename\b|require\()/.test(
          withoutComments(read(file)),
        )
      ) {
        nodeOnly.push(`${file} uses a Node global`);
      }
    }
    expect(nodeOnly).toEqual([]);
  });
});
