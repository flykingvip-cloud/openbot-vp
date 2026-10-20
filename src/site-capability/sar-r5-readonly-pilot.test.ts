/**
 * R5: read-only pilot comparison — honest fixture / protocol boundary.
 *
 * Expert §R5 requires same real account + task set SAR vs browser, correctness
 * ≥ control, and cost improvement from measured wall-clock. This environment
 * has no logged-in enterprise account-browser control bridge, so this suite
 * asserts **protocol fixture evidence only** and forbids R5-pass claims.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resetAccountBrowserCoordinatorForTests } from "./coordinator.js";
import {
  PILOT_COMPARISON_COST_CLOCK,
  PILOT_COMPARISON_EVIDENCE_KIND,
  comparePilotRead,
} from "./pilot-comparison.js";
import {
  SAR_R5_STATUS_FIXTURE_ONLY,
  buildReadonlyPilotAuditEvidence,
  formatComparisonTableRow,
  probeLiveReadonlyPilotPrerequisites,
  readonlyPilotAccountScope,
  readonlyPilotTaskSet,
} from "./readonly-pilot-audit.js";
import {
  SAR_PILOT_FIXTURE_CREDENTIALS,
  SAR_PILOT_GROUND_TRUTH,
  SAR_PILOT_STEP_MS,
  createReadonlyPilotHarness,
  type PilotHarness,
} from "./readonly-pilot.js";
import { resetDefaultSiteCapabilityRuntimeForTests } from "./runtime.js";

const harnesses: Array<{ dispose: () => void }> = [];

const REPORT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/design/sar-r5-readonly-pilot-report-2026-10-18.md",
);

afterEach(() => {
  for (const harness of harnesses) {
    harness.dispose();
  }
  harnesses.length = 0;
  resetDefaultSiteCapabilityRuntimeForTests();
  resetAccountBrowserCoordinatorForTests();
});

function harness(): PilotHarness {
  const created = createReadonlyPilotHarness();
  harnesses.push(created);
  return created;
}

describe("SAR R5 readonly pilot — protocol fixture audit", () => {
  it("builds auditable task set, account scope, and SAR vs browser comparison table", async () => {
    const created = harness();
    created.site.establishFixtureSession(
      SAR_PILOT_FIXTURE_CREDENTIALS.username,
      SAR_PILOT_FIXTURE_CREDENTIALS.password,
    );
    const evidence = await buildReadonlyPilotAuditEvidence({
      harness: created,
      fixtureSessionReady: true,
    });

    expect(evidence.r5Status).toBe(SAR_R5_STATUS_FIXTURE_ONLY);
    expect(evidence.evidenceKind).toBe(PILOT_COMPARISON_EVIDENCE_KIND);
    expect(evidence.costClock).toBe(PILOT_COMPARISON_COST_CLOCK);
    expect(evidence.stepMs).toBe(SAR_PILOT_STEP_MS);
    expect(evidence.liveNetworkRtt).toBe(false);
    expect(evidence.r5LiveSessionClaim).toBe(false);
    expect(evidence.fixtureRelaxed).toBe(false);

    const scope = readonlyPilotAccountScope();
    expect(evidence.accountScope).toEqual(scope);
    expect(evidence.taskSet).toEqual(readonlyPilotTaskSet());
    expect(evidence.comparisons).toHaveLength(2);

    for (const row of evidence.comparisons) {
      expect(row.evidenceKind).toBe("protocol_fixture");
      expect(row.liveNetworkRtt).toBe(false);
      expect(row.r5LiveSessionClaim).toBe(false);
      expect(row.fixtureRelaxed).toBe(false);
      expect(row.cost.clock).toBe("harness_step_clock");
      expect(row.cost.note).toContain("not a live network RTT");
      expect(row.conclusion).toMatch(/Not an R5 live-session claim/i);
      expect(row.correctnessAtLeastGenericBrowser).toBe(true);
      expect(row.sar.correct).toBe(true);
      expect(row.genericBrowser.correct).toBe(true);
      expect(row.cost.dispatchCountImproved).toBe(true);
      // Fixture may show harness-clock improvement; must never be sold as live.
      expect(row.cost.durationImproved).toBe(true);
      expect(formatComparisonTableRow(row)).toContain("harness_step_clock");
      expect(formatComparisonTableRow(row)).toContain("not live RTT");
    }

    expect(evidence.summary).toContain("protocol_fixture");
    expect(evidence.summary).toContain(SAR_R5_STATUS_FIXTURE_ONLY);
    expect(evidence.summary.toLowerCase()).not.toMatch(/r5 passed|r5 pass\b/);
    expect(JSON.stringify(evidence).toLowerCase()).not.toMatch(
      /r5 passed|verified enterprise external/,
    );
  });

  it("keeps comparePilotRead honesty markers on a single station", async () => {
    const created = harness();
    const bulletin = await comparePilotRead({
      harness: created,
      principal: created.principal,
      bindingId: created.bindingId,
      station: created.stations.bulletin,
      args: { desk: SAR_PILOT_GROUND_TRUTH.bulletin.desk },
      expected: SAR_PILOT_GROUND_TRUTH.bulletin,
    });
    expect(bulletin.evidenceKind).toBe("protocol_fixture");
    expect(bulletin.liveNetworkRtt).toBe(false);
    expect(bulletin.r5LiveSessionClaim).toBe(false);
    expect(bulletin.fixtureRelaxed).toBe(false);
    expect(bulletin.cost.clock).toBe("harness_step_clock");
    expect(bulletin.cost.note).toContain("not a live network RTT");
    expect(bulletin.conclusion).toContain("Not an R5 live-session claim");
  });

  it("records live-session blockers and min repro conditions", () => {
    const probe = probeLiveReadonlyPilotPrerequisites();
    expect(probe.liveBridgeAvailable).toBe(false);
    expect(probe.blockers.map((b) => b.id)).toEqual(
      expect.arrayContaining([
        "no_scope_key",
        "no_enterprise_logged_in_session",
        "cost_must_be_wall_clock",
      ]),
    );
    expect(probe.minReproConditions.length).toBeGreaterThanOrEqual(4);
    expect(probe.minReproConditions.join("\n")).toMatch(/control-bridge/i);
    expect(probe.minReproConditions.join("\n")).toMatch(/wall-clock/i);
  });

  it("ships an honest R5 report that does not claim live pass", () => {
    expect(fs.existsSync(REPORT_PATH)).toBe(true);
    const body = fs.readFileSync(REPORT_PATH, "utf8");
    expect(body).toMatch(/R5 状态[：:].*未达|仅协议夹具对照/);
    expect(body).toContain("protocol_fixture");
    expect(body).toContain("harness_step_clock");
    expect(body).toContain("not a live network RTT");
    expect(body).toContain("fixtureRelaxed");
    expect(body).toMatch(/阻塞/);
    expect(body).toMatch(/最小复现/);
    expect(body).toContain("bind-pilot-original");
    expect(body).toContain("pilot.bulletin.read");
    expect(body).toContain("pilot.inbox.summary");
    expect(body).toMatch(/R5 达标[^\n]*不可宣称|不可宣称[^\n]*R5/);
    expect(body).toMatch(/不是\*\* R5|\*\*不是\*\* R5|未达/);
    expect(body).not.toMatch(/R5 状态[：:].*已达(?!\/)/);
    expect(body.toLowerCase()).not.toMatch(/\br5 passed\b|\br5 pass\b/);
    expect(body).not.toMatch(/已验证企业外站/);
  });
});
