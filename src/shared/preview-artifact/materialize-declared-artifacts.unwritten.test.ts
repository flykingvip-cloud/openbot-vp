import { describe, expect, it } from "vitest";
import { declaredDeliverableArtifactFields } from "./materialize-declared-artifacts.js";
import { resolvePreviewArtifactRecords } from "./resolve-preview-artifact.js";

function metaOf(artifact: unknown): Record<string, unknown> {
  const record = artifact as { providerMetadata?: Record<string, unknown> } | null | undefined;
  return record?.providerMetadata ?? {};
}

describe("declared deliverable unwritten/settle metadata", () => {
  it("unwritten declaration retains blocked delivery metadata (previewUnavailable)", () => {
    const result = declaredDeliverableArtifactFields(
      '<<DELIVERABLE title="缺失报告" file="missing.pdf" unwritten="true">>短概述<</DELIVERABLE>>',
    );
    expect(result.artifact).toBeTruthy();
    const meta = metaOf(result.artifact);
    expect(meta.declared).toBe(true);
    expect(meta.workspaceFilename).toBe("missing.pdf");
    expect(meta.workspaceUnwritten).toBe(true);
    expect(meta.previewUnavailable).toBe(true);
  });

  it("settle=declared maps to workspaceUnwritten + previewUnavailable", () => {
    const result = declaredDeliverableArtifactFields(
      '<<DELIVERABLE title="底稿" file="analysis/model.md" settle="declared">>短概述<</DELIVERABLE>>',
    );
    const meta = metaOf(result.artifact);
    expect(meta.workspaceUnwritten).toBe(true);
    expect(meta.previewUnavailable).toBe(true);
  });

  it("retryable and conflict stay blocked; confirmed stays openable", () => {
    const retryable = declaredDeliverableArtifactFields(
      '<<DELIVERABLE title="底稿" file="analysis/model.md" settle="retryable">>短概述<</DELIVERABLE>>',
    );
    expect(metaOf(retryable.artifact).previewUnavailable).toBe(true);
    expect(metaOf(retryable.artifact).deliveryUndelivered).toBe(true);
    expect(metaOf(retryable.artifact).settleRetryable).toBe(true);

    const conflict = declaredDeliverableArtifactFields(
      '<<DELIVERABLE title="底稿" file="analysis/model.md" settle="conflict">>短概述<</DELIVERABLE>>',
    );
    expect(metaOf(conflict.artifact).previewUnavailable).toBe(true);
    expect(metaOf(conflict.artifact).settleConflict).toBe(true);

    const confirmed = declaredDeliverableArtifactFields(
      '<<DELIVERABLE title="报告" file="ok.md" settle="confirmed">>短概述<</DELIVERABLE>>',
    );
    const confirmedMeta = metaOf(confirmed.artifact);
    expect(confirmedMeta.settleConfirmed).toBe(true);
    expect(confirmedMeta.previewUnavailable).toBeUndefined();
    expect(confirmedMeta.workspaceUnwritten).toBeUndefined();
  });

  it("multi-artifact per-item status is correct", () => {
    const text = [
      '<<DELIVERABLE title="缺失" file="missing.pdf" unwritten="true">>概述A<</DELIVERABLE>>',
      '<<DELIVERABLE title="已写" file="ok.md" settle="confirmed">>概述B<</DELIVERABLE>>',
    ].join("\n");
    const records = resolvePreviewArtifactRecords({
      role: "assistant",
      content: [{ type: "text", text }],
      timestamp: 1,
    });
    expect(records.length).toBeGreaterThanOrEqual(2);
    const byFile = new Map(
      records.map((r) => {
        const filename = metaOf(r).workspaceFilename;
        const key = typeof filename === "string" ? filename : "";
        return [key, metaOf(r)] as const;
      }),
    );
    expect(byFile.get("missing.pdf")?.previewUnavailable).toBe(true);
    expect(byFile.get("missing.pdf")?.workspaceUnwritten).toBe(true);
    expect(byFile.get("ok.md")?.settleConfirmed).toBe(true);
    expect(byFile.get("ok.md")?.previewUnavailable).toBeUndefined();
  });
});
