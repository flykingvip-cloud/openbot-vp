import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_RENDER_URL = new URL("./app-render.ts", import.meta.url);

async function readAppRenderSource() {
  return readFile(fileURLToPath(APP_RENDER_URL), "utf8");
}

describe("app-render console boundary", () => {
  it("does not route app rendering through the retired ops port shell", async () => {
    const source = await readAppRenderSource();

    expect(source).not.toContain('from "./ports/ops/action-state.ts"');
    expect(source).not.toContain('from "./ports/ops/port-state.ts"');
    expect(source).not.toContain('from "./ports/ops/render-actions.ts"');
    expect(source).not.toContain('from "./ports/ops/render-model.ts"');
    expect(source).not.toContain('from "./ports/ops/views/ops-shell.ts"');
    expect(source).not.toContain("const opsActionState = adaptOpsPortActionState(state);");
    expect(source).not.toContain("const opsState = adaptOpsPortState(state);");
    expect(source).not.toContain("const opsActions = createOpsPortActions(");
    expect(source).not.toContain("const opsRenderModel = buildOpsPortRenderModel(");
    expect(source).not.toContain("renderOpsPortShell(opsRenderModel)");
  });

  it("routes platform flows through the platform port shell", async () => {
    const source = await readAppRenderSource();

    expect(source).toContain('from "./ports/cross-port-shell-lazy.ts"');
    expect(source).toContain("resolvePlatformPortBundle");
    expect(source).toContain("platformBundle.adaptPlatformPortActionState(state)");
    expect(source).toContain("platformBundle.adaptPlatformPortState(state)");
    expect(source).toContain("platformBundle.createPlatformPortActions(");
    expect(source).toContain("platformBundle.buildPlatformPortRenderModel(");
    expect(source).toContain("platformBundle.renderPlatformPortShell(platformRenderModel)");
  });

  it("routes enterprise flows through the enterprise port shell", async () => {
    const source = await readAppRenderSource();

    expect(source).toContain('from "./ports/enterprise/action-state.ts"');
    expect(source).toContain('from "./ports/enterprise/port-state.ts"');
    expect(source).toContain('from "./ports/enterprise/render-actions.ts"');
    expect(source).toContain('from "./ports/enterprise/render-model.ts"');
    expect(source).toContain('from "./ports/enterprise/views/enterprise-shell.ts"');
    expect(source).toContain(
      "const enterpriseActionState = adaptEnterprisePortActionState(state);",
    );
    expect(source).toContain("const enterpriseState = adaptEnterprisePortState(state);");
    expect(source).toContain("const enterpriseActions = createEnterprisePortActions(");
    expect(source).toContain("const enterpriseRenderModel = buildEnterprisePortRenderModel(");
    expect(source).toContain("renderEnterprisePortShell(enterpriseRenderModel)");
  });

  it("does not route app rendering through the retired builder port shell", async () => {
    const source = await readAppRenderSource();

    expect(source).not.toContain('from "./ports/builder/action-state.ts"');
    expect(source).not.toContain('from "./ports/builder/port-state.ts"');
    expect(source).not.toContain('from "./ports/builder/render-actions.ts"');
    expect(source).not.toContain('from "./ports/builder/render-model.ts"');
    expect(source).not.toContain('from "./ports/builder/views/builder-shell.ts"');
    expect(source).not.toContain("adaptBuilderPortActionState");
    expect(source).not.toContain("adaptBuilderPortState");
    expect(source).not.toContain("createBuilderPortActions");
    expect(source).not.toContain("buildBuilderPortRenderModel");
    expect(source).not.toContain("renderBuilderPortShell");
  });

  it("does not pass the full app state into port action wiring", async () => {
    const source = await readAppRenderSource();

    expect(source).not.toContain("consoleState: state");
    expect(source).not.toContain("state,\n      consoleState: state");
  });

  it("does not directly import console controller modules", async () => {
    const source = await readAppRenderSource();

    const forbiddenImports = [
      "./app-render-usage-tab.ts",
      "./controllers/agent-files.ts",
      "./controllers/agent-identity.ts",
      "./controllers/agent-skills.ts",
      "./controllers/agents.ts",
      "./controllers/debug.ts",
      "./controllers/devices.ts",
      "./controllers/exec-approvals.ts",
      "./controllers/logs.ts",
      "./controllers/nodes.ts",
      "./controllers/presence.ts",
      "./controllers/skills.ts",
      "./views/agents.ts",
      "./views/channels.ts",
      "./views/enterprise-tenant-resolver.ts",
      "./views/skills.ts",
    ];

    for (const specifier of forbiddenImports) {
      expect(source).not.toContain(specifier);
    }
  });

  it("does not inline console controller action wiring", async () => {
    const source = await readAppRenderSource();

    expect(source).not.toMatch(
      /\b(loadAgents|loadAgentIdentity|loadAgentIdentities|loadAgentFiles|loadAgentFileContent|saveAgentFile|loadNodes|loadPresence|loadLogs|loadDebug|callDebugMethod|loadSkills|updateSkillEnabled|updateSkillEdit|saveSkillApiKey|installSkill|approveDevicePairing|rejectDevicePairing|rotateDeviceToken|revokeDeviceToken|loadExecApprovals|saveExecApprovals|removeExecApprovalsFormValue|updateExecApprovalsFormValue)\b/,
    );
    expect(source).not.toMatch(
      /\b(addCronJob|startCronEdit|startCronClone|cancelCronEdit|toggleCronJob|runCronJob|removeCronJob|loadCronRuns|loadMoreCronJobs|loadMoreCronRuns|reloadCronJobs|updateCronJobsFilter|updateCronRunsFilter|normalizeCronFormState|validateCronForm)\b/,
    );
    expect(source).not.toContain("renderCron({");
    expect(source).not.toContain("renderNodes({");
    expect(source).not.toContain("renderConfig({");
    expect(source).not.toContain("renderDebug({");
    expect(source).not.toContain("renderLogs({");
    expect(source).not.toContain("renderSessions({");
    expect(source).not.toContain("renderChannels({");
    expect(source).not.toContain("renderAgents({");
    expect(source).not.toContain("renderSkills({");
    expect(source).not.toContain("renderUsageTab(state)");
    expect(source).not.toContain("renderEnterpriseTenantResolver({");
  });

  it("filters nav groups through the shared permission matrix", async () => {
    const source = await readAppRenderSource();

    expect(source).toContain('from "./routing/port-permissions.ts"');
    expect(source).toContain("const visibleTabs = filterTabsByPermission(state, group.tabs);");
  });

  it("wires employee workbench compose to compact mode with the knowledge capsule", async () => {
    const source = await readAppRenderSource();
    const gateStart = source.indexOf("const workbenchChatProps =");
    const gateEnd = source.indexOf("const workbenchChat =");
    expect(gateStart).toBeGreaterThan(0);
    expect(gateEnd).toBeGreaterThan(gateStart);
    const gate = source.slice(gateStart, gateEnd);
    expect(gate).toContain('renderMode: "workbench-compact"');
    expect(gate).not.toContain('renderMode: "full"');
    expect(gate).not.toContain("hideContextScope");
  });

  it("wires meeting confirm card through threadEpilogue instead of prelude", async () => {
    const source = await readAppRenderSource();
    expect(source).toContain("workbenchThreadEpilogue");
    expect(source).toContain("threadEpilogue: normalizeThreadPrelude(workbenchThreadEpilogue)");
    expect(source).toContain("renderMeetingConfirmationCard");
    const preludeCall = source.indexOf("renderDaibaiThreadPrelude(");
    const epilogueAssign = source.indexOf("const workbenchThreadEpilogue");
    expect(preludeCall).toBeGreaterThan(0);
    expect(epilogueAssign).toBeGreaterThan(preludeCall);
  });

  it("suppresses the global update banner on platform surfaces", async () => {
    const source = await readAppRenderSource();

    expect(source).toContain("const showGlobalUpdateBanner = !isPlatformSurface;");
    expect(source).toContain("availableUpdate && showGlobalUpdateBanner");
  });

  it("does not auto-send daibai onboarding on workspace home", async () => {
    const source = await readAppRenderSource();

    expect(source).not.toContain("shouldAutoAskDaibai(");
    expect(source).not.toContain("handleSendChat(DAIBAI_ONBOARDING_GUIDE_PROMPT)");
  });

  it("gates platform surfaces behind the dedicated platform login page", async () => {
    const source = await readAppRenderSource();

    // Unauthenticated platform visitors (admin.openbot.love) must see the dedicated
    // login page (renderAuthHome, entryVariant "platform") instead of the content
    // shell + topbar login popup. The guard reuses the existing platformLogin branch.
    expect(source).toContain('from "./ports/platform/platform-auth-session.ts"');
    expect(source).toContain("shouldShowPlatformLoginEntry");
    expect(source).toContain(
      "const platformSurfaceRequiresLogin = isPlatformSurface && shouldShowPlatformLoginEntry(state);",
    );
    expect(source).toContain("platformSurfaceRequiresLogin");
    expect(source).toContain(
      'const isPlatformLogin = state.tab === "platformLogin" || platformSurfaceRequiresLogin;',
    );
    // The content shell must not be reached before the guard's early return.
    const guardIndex = source.indexOf("const platformSurfaceRequiresLogin =");
    const shellIndex = source.indexOf(
      "platformBundle.renderPlatformPortShell(platformRenderModel)",
    );
    expect(guardIndex).toBeGreaterThan(0);
    expect(shellIndex).toBeGreaterThan(guardIndex);
  });
});
