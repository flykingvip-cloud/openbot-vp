import { html, type TemplateResult } from "lit";

/**
 * Lazy loaders for employee/platform port shells.
 *
 * Enterprise (biz.*) cold boot must not statically import these trees —
 * together they are ~3MB of the Control UI entry. Use the same
 * resolve-or-placeholder pattern as enterprise-surface-lazy.ts.
 */

export type EmployeeWorkbenchBundle = {
  renderWorkbench: typeof import("./employee/views/workbench.ts").renderWorkbench;
  buildEmployeeWorkbenchProps: typeof import("./employee/render-model.ts").buildEmployeeWorkbenchProps;
  openEmployeeCronTaskDetail: typeof import("./employee/render-actions.ts").openEmployeeCronTaskDetail;
  switchEmployeeWorkbenchSession: typeof import("./employee/render-actions.ts").switchEmployeeWorkbenchSession;
  renderDaibaiThreadPrelude: typeof import("./employee/views/workbench-stage-assistant.ts").renderDaibaiThreadPrelude;
  renderMeetingConfirmationCard: typeof import("./employee/views/workbench-stage-assistant.ts").renderMeetingConfirmationCard;
  renderWorkbenchGrowthThreadPrelude: typeof import("./employee/growth-prelude-wire.ts").renderWorkbenchGrowthThreadPrelude;
};

export type PlatformPortBundle = {
  adaptPlatformPortState: typeof import("./platform/port-state.ts").adaptPlatformPortState;
  adaptPlatformPortActionState: typeof import("./platform/action-state.ts").adaptPlatformPortActionState;
  createPlatformPortActions: typeof import("./platform/render-actions.ts").createPlatformPortActions;
  buildPlatformPortRenderModel: typeof import("./platform/render-model.ts").buildPlatformPortRenderModel;
  renderPlatformPortShell: typeof import("./platform/views/platform-shell.ts").renderPlatformPortShell;
};

const readyListeners = new Set<() => void>();
let employeeBundle: EmployeeWorkbenchBundle | null = null;
let employeeInFlight: Promise<EmployeeWorkbenchBundle> | null = null;
let platformBundle: PlatformPortBundle | null = null;
let platformInFlight: Promise<PlatformPortBundle> | null = null;

export function subscribeCrossPortShellReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
}

function notifyReady() {
  for (const listener of readyListeners) {
    try {
      listener();
    } catch {
      // Host re-render must not break chunk load completion.
    }
  }
}

export async function preloadEmployeeWorkbenchBundle(): Promise<EmployeeWorkbenchBundle> {
  if (employeeBundle) {
    return employeeBundle;
  }
  if (employeeInFlight) {
    return employeeInFlight;
  }
  employeeInFlight = (async () => {
    // Styles travel with the shell so enterprise cold boot skips ~600KB workbench CSS.
    await Promise.all([
      import("../../styles/workbench.css"),
      import("../employee-shell/employee-embed.css"),
    ]);
    const [workbenchMod, renderModelMod, renderActionsMod, daibaiMod, growthMod] =
      await Promise.all([
        import("./employee/views/workbench.ts"),
        import("./employee/render-model.ts"),
        import("./employee/render-actions.ts"),
        import("./employee/views/workbench-stage-assistant.ts"),
        import("./employee/growth-prelude-wire.ts"),
      ]);
    const bundle: EmployeeWorkbenchBundle = {
      renderWorkbench: workbenchMod.renderWorkbench,
      buildEmployeeWorkbenchProps: renderModelMod.buildEmployeeWorkbenchProps,
      openEmployeeCronTaskDetail: renderActionsMod.openEmployeeCronTaskDetail,
      switchEmployeeWorkbenchSession: renderActionsMod.switchEmployeeWorkbenchSession,
      renderDaibaiThreadPrelude: daibaiMod.renderDaibaiThreadPrelude,
      renderMeetingConfirmationCard: daibaiMod.renderMeetingConfirmationCard,
      renderWorkbenchGrowthThreadPrelude: growthMod.renderWorkbenchGrowthThreadPrelude,
    };
    employeeBundle = bundle;
    employeeInFlight = null;
    notifyReady();
    return bundle;
  })().catch((err) => {
    employeeInFlight = null;
    throw err;
  });
  return employeeInFlight;
}

export async function preloadPlatformPortBundle(): Promise<PlatformPortBundle> {
  if (platformBundle) {
    return platformBundle;
  }
  if (platformInFlight) {
    return platformInFlight;
  }
  platformInFlight = (async () => {
    await Promise.all([
      import("../../styles/platform-agents-runtime.css"),
      import("../../styles/platform-productization.css"),
      import("../../styles/platform-pricing-comparison.css"),
      import("../../styles/pricing-v3.css"),
      import("../../styles/cost-budget.css"),
      import("../../styles/cost-budget-v2.css"),
    ]);
    const [portStateMod, actionStateMod, renderActionsMod, renderModelMod, shellMod] =
      await Promise.all([
        import("./platform/port-state.ts"),
        import("./platform/action-state.ts"),
        import("./platform/render-actions.ts"),
        import("./platform/render-model.ts"),
        import("./platform/views/platform-shell.ts"),
      ]);
    const bundle: PlatformPortBundle = {
      adaptPlatformPortState: portStateMod.adaptPlatformPortState,
      adaptPlatformPortActionState: actionStateMod.adaptPlatformPortActionState,
      createPlatformPortActions: renderActionsMod.createPlatformPortActions,
      buildPlatformPortRenderModel: renderModelMod.buildPlatformPortRenderModel,
      renderPlatformPortShell: shellMod.renderPlatformPortShell,
    };
    platformBundle = bundle;
    platformInFlight = null;
    notifyReady();
    return bundle;
  })().catch((err) => {
    platformInFlight = null;
    throw err;
  });
  return platformInFlight;
}

export function resolveEmployeeWorkbenchBundle(): EmployeeWorkbenchBundle | null {
  if (employeeBundle) {
    return employeeBundle;
  }
  void preloadEmployeeWorkbenchBundle().catch((err) => {
    console.error("[cross-port-shell] failed to load employee workbench", err);
  });
  return null;
}

export function resolvePlatformPortBundle(): PlatformPortBundle | null {
  if (platformBundle) {
    return platformBundle;
  }
  void preloadPlatformPortBundle().catch((err) => {
    console.error("[cross-port-shell] failed to load platform port", err);
  });
  return null;
}

export function renderCrossPortShellLoadingPlaceholder(
  port: "employee" | "platform",
): TemplateResult {
  const label = port === "employee" ? "员工工作台" : "平台控制台";
  return html`
    <section class="card" data-cross-port-shell-loading=${port}>
      <p class="card-sub">正在加载${label}…</p>
    </section>
  `;
}
