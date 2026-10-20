// @vitest-environment jsdom
import { render } from "lit";
import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { zh_CN } from "../../i18n/locales/zh-CN.ts";
import {
  renderArtifactGovernanceTrustBadge,
  renderEvidenceTrustBadges,
  renderKnowledgeBaseRuntimeBadges,
  renderSearchHitTrustBadges,
  resolveEvidenceDtoTrustStatus,
} from "./knowledge-universe-trust-badges.ts";

beforeAll(async () => {
  i18n.registerTranslation("zh-CN", zh_CN);
  await i18n.setLocale("zh-CN");
});

describe("knowledge universe trust badges", () => {
  it("resolves evidence dto trust status from governance flags", () => {
    expect(
      resolveEvidenceDtoTrustStatus({
        governanceClaimConflict: true,
      }),
    ).toBe("conflict");
    expect(
      resolveEvidenceDtoTrustStatus({
        governanceStatus: "pending",
      }),
    ).toBe("pending");
    expect(
      resolveEvidenceDtoTrustStatus({
        governanceStatus: "confirmed",
      }),
    ).toBe("verified");
  });

  it("renders pending governance badge with runtime trust semantics", () => {
    const container = document.createElement("div");
    render(renderArtifactGovernanceTrustBadge("pending"), container);
    const badge = container.querySelector('[data-governance="pending"]');
    expect(badge?.textContent).toContain("待治理");
    expect(badge?.getAttribute("title")).toContain("尚未入库");
  });

  it("renders search hit governance and score badges", () => {
    const container = document.createElement("div");
    render(
      renderSearchHitTrustBadges({
        id: "hit-1",
        group: "knowledge",
        title: "Policy",
        governanceStatus: "conflict",
        score: 0.82,
      }),
      container,
    );
    expect(container.querySelector('[data-governance="conflict"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-search-hit-score"]')).toBeTruthy();
  });

  it("renders library runtime badges with status, conflicts, and health", () => {
    const container = document.createElement("div");
    render(
      renderKnowledgeBaseRuntimeBadges({
        id: "kb-1",
        title: "销售手册库",
        description: "",
        documentCount: 3,
        conflictCount: 2,
        healthScore: 74,
        governanceStatus: "conflict",
        visibility: "private",
        updatedAtMs: Date.now(),
      }),
      container,
    );
    expect(container.querySelector('[data-runtime-status="conflict"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-library-runtime-conflicts"]')).toBeTruthy();
    expect(
      container.querySelector('[data-testid="ku-library-runtime-health"]')?.textContent,
    ).toContain("74");
  });

  it("renders evidence trust badges for claim conflicts", () => {
    const container = document.createElement("div");
    render(
      renderEvidenceTrustBadges({
        sourceKind: "knowledge",
        docId: "doc-1",
        docTitle: "Policy",
        kbId: "kb-1",
        versionId: "v1",
        score: 0.66,
        chunkText: "chunk",
        sourceUri: "ku://kb/kb-1/doc/doc-1@v1",
        governanceClaimConflict: true,
      }),
      container,
    );
    expect(container.querySelector('[data-testid="ku-evidence-governance-badge"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-evidence-score"]')).toBeTruthy();
  });
});
