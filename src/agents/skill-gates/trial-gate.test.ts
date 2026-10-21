import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractDeliverableEnvelope } from "../../shared/preview-artifact/deliverable-envelope.js";
import { settleTurnCompletion } from "../turn-completion/contract.js";
import { annotateTrialDeclaration, applyTrialGate, TRIAL_DEGRADED_HTML } from "./trial-gate.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-trial-gate-"));
  tempDirs.push(dir);
  return dir;
}

describe("trial gate", () => {
  it("promotes an existing preview and annotates the batch-1 declaration", () => {
    const workspaceDir = tempWorkspace();
    fs.mkdirSync(path.join(workspaceDir, "deliverables"), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "deliverables/preview.html"), "<p>preview</p>\n");
    const decision = applyTrialGate({
      trial: true,
      narrative: "预览可以，正式交付不可。",
      workspaceDir,
      previewPath: "deliverables/preview.html",
    });
    expect(decision?.action).toBe("promote_preview");
    expect(decision?.grade).toBe("preview_promoted");
    expect(decision?.settle).toBe("confirmed");
    const patched = annotateTrialDeclaration(
      '<<DELIVERABLE file="deliverables/preview.html" settle="declared">>\n预览正文预览正文预览正文预览正文\n<</DELIVERABLE>>',
      {
        relativePath: "deliverables/preview.html",
        grade: "preview_promoted",
        settle: "confirmed",
      },
    );
    const envelope = extractDeliverableEnvelope(`${patched}\n${"body ".repeat(20)}`);
    expect(envelope?.grade).toBe("preview_promoted");
    expect(envelope?.trial).toBe("1");
    expect(envelope?.settle).toBe("confirmed");
    expect(envelope?.file).toBe("deliverables/preview.html");
  });

  it("degrades a blocked formal deliver to openable HTML during smoke", () => {
    const workspaceDir = tempWorkspace();
    const settled = settleTurnCompletion({
      userText: "技能试跑请继续",
      assistantText: "预览可以，但是正式交付不可，还不能给你正式 PDF。",
      workspaceDir,
      skillSmoke: true,
    });
    expect(settled.contract?.state).toBe("delivered");
    expect(settled.contract?.openablePath).toBe(TRIAL_DEGRADED_HTML);
    expect(settled.visibleText).toContain('grade="degraded_html"');
    expect(settled.visibleText).toContain('trial="1"');
    expect(settled.visibleText).toContain('settle="confirmed"');
    expect(fs.readFileSync(path.join(workspaceDir, TRIAL_DEGRADED_HTML), "utf8")).toContain(
      "grade: degraded_html",
    );
  });

  it("does not bypass a formal gate outside trial mode", () => {
    expect(
      applyTrialGate({
        trial: false,
        narrative: "预览可以，正式交付不可。",
        workspaceDir: tempWorkspace(),
        previewPath: "deliverables/preview.html",
      }),
    ).toBeNull();
  });
});
