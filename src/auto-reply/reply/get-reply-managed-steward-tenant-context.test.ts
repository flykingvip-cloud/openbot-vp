import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("get-reply Managed steward Handle vs helper split", () => {
  it("helper is shadow-only; production locator is Handle; missing tenant fail-closed", () => {
    const getReply = readFileSync(join(__dirname, "get-reply.ts"), "utf-8");
    const bridge = readFileSync(
      join(__dirname, "../../gateway/workspace/handler-bridge.ts"),
      "utf-8",
    );

    // S29 Handle must use the full trusted locator builder (not cfg-only).
    expect(bridge).toContain("resolveAgentsHandlerWorkspaceLocator");
    expect(bridge).toMatch(/purpose:\s*"trusted\.agent\.locator"/);
    expect(bridge).not.toMatch(/resolveWorkspaceLocator\(\{\s*cfg:\s*params\.cfg\s*\}\)/);

    // Steward exception must still call resolveTrustedAgentLocator (Handle).
    expect(bridge).toMatch(/if \(params\.stewardException\)/);
    expect(bridge).not.toMatch(/resolveEmployeeBuiltinStewardWorkspaceDir/);
    expect(bridge).toMatch(/stewardWorkspaceDir/);
    expect(bridge).not.toMatch(/locator = helper/);
    expect(bridge).toMatch(/locator = await resolveTrustedAgentLocator/);
    expect(bridge).toMatch(/if \(!helper\)/);
    expect(bridge).toMatch(/code: "missing_tenant"/);
    expect(bridge).toMatch(/trusted tenant context required/);
    expect(bridge).toMatch(/profile\.profile === "managed_enterprise"/);

    // get-reply: do not reopen managed authz via employeeOwnerId substitute.
    expect(getReply).toMatch(/const cwdUserId = knowledgeContext\.userId \?\? null/);
    expect(getReply).not.toMatch(/stewardException \? employeeOwnerId/);

    // Helper is computed for S01 shadow comparison only, not as user-visible managed cwd.
    expect(getReply).toMatch(/stewardHelperCwd/);
    expect(getReply).toMatch(/resolveRobotWriteRoot/);
    expect(getReply).not.toMatch(/resolveEmployeeBuiltinStewardWorkspaceDir/);
    expect(getReply).toMatch(/helperCwd:\s*stewardHelperCwd \?\? workspaceDirRaw/);
    expect(getReply).not.toMatch(/helperCwd:\s*workspaceDirRaw\b/);
    expect(getReply).toMatch(/resolveWorkspaceDirAfterAuthorization/);
    expect(getReply).not.toMatch(/evaluateS01AuthorizedToolCwd/);
    expect(getReply).toMatch(/runS01GetReplyStewardCwdShadowFromEntry/);
    expect(getReply).toMatch(/workspace_authorization_failed:\$\{reason\}/);
    expect(getReply).toMatch(/workspace_authorization_failed/);
    expect(getReply).not.toMatch(/Managed Enterprise does not fall back to legacy workspace paths/);
  });
});
