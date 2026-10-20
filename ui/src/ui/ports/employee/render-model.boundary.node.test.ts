import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RENDER_MODEL_URL = new URL("./render-model.ts", import.meta.url);

async function readRenderModelSource() {
  return readFile(fileURLToPath(RENDER_MODEL_URL), "utf8");
}

describe("employee render-model boundary", () => {
  it("routes outer ui controller bridges through render-model-actions", async () => {
    const source = await readRenderModelSource();

    expect(source).toContain('from "./render-model-actions.ts"');
    expect(source).toContain("updateEmployeeWorkbenchSpaceMembers");
  });

  it("routes creator and member-governance interactions through the workbench action factory", async () => {
    const source = await readRenderModelSource();

    expect(source).toContain('from "./render-model-workbench-actions.ts"');
    expect(source).toContain(
      "const workbenchInteractionProps = buildEmployeeWorkbenchInteractionProps(",
    );
    expect(source).toContain("...workbenchInteractionProps,");
    expect(source).not.toContain("onOpenAgentCreator:");
    expect(source).not.toContain("onMemberGovernancePromptChange:");
    expect(source).not.toContain("onOpenFilePreview:");
  });

  it("routes governance detail interactions through the governance action factory", async () => {
    const source = await readRenderModelSource();

    expect(source).toContain('from "./render-model-governance-actions.ts"');
    expect(source).toContain("const workbenchGovernanceInteractionProps =");
    expect(source).toContain("buildEmployeeWorkbenchGovernanceInteractionProps({");
    expect(source).toContain("...workbenchGovernanceInteractionProps,");
    expect(source).not.toContain("onGroupProfileViewChange:");
    expect(source).not.toContain("onOpenGovernanceObjectDetail:");
    expect(source).not.toContain("onDecisionOptionDraftChange:");
    expect(source).not.toContain("onTransitionGovernanceObject:");
  });

  it("routes shell and workbench entry actions through the shell action factory", async () => {
    const source = await readRenderModelSource();

    expect(source).toContain('from "./render-model-shell-actions.ts"');
    expect(source).toContain(
      "const workbenchShellActionProps = buildEmployeeWorkbenchShellActionProps({",
    );
    expect(source).toContain("...workbenchShellActionProps,");
    expect(source).not.toContain("onLogout:");
    expect(source).not.toContain("onPrimaryModuleChange:");
    expect(source).not.toContain("onSelectSession:");
    expect(source).not.toContain("onAskDaibai:");
    expect(source).not.toContain("onBrandLogoFileChange:");
  });

  it("does not directly import outer ui controllers", async () => {
    const source = await readRenderModelSource();

    expect(source).not.toContain('from "../../controllers/agents.ts"');
    expect(source).not.toContain('from "../../controllers/spaces.ts"');
  });
});
