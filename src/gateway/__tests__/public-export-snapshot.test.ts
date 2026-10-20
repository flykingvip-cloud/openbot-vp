// Public-export snapshot verifier — gateway layer.
//
// Spec: gateway-plugins-monolith-decomposition (Task 1.2, Req 2.1, 2.3, 2.4).
//
// For every snapshot under
// `.kiro/specs/gateway-plugins-monolith-decomposition/baseline/` whose
// target path starts with `src/gateway/`, this suite re-extracts the live
// `(name, kind, signature)` triple from the post-refactor module and asserts
// that every name in the snapshot still exports with a structurally
// compatible TypeScript type. Snapshots whose basename ends in
// `-consumers` or `-closure-probe` use a different schema and are skipped.
//
// The suite passes vacuously today because no qualifying snapshot has been
// committed yet — Task 2.1 (and similar) own the official baseline files.

import { describe, expect, it } from "vitest";
import {
  discoverSnapshotFiles,
  extractLiveExports,
  type SnapshotFile,
} from "../../../scripts/architecture/public-export-surface-verifier.js";

const TARGET_PREFIX = "src/gateway/";

const snapshots: readonly SnapshotFile[] = discoverSnapshotFiles(TARGET_PREFIX);

describe("gateway public-export snapshot", () => {
  if (snapshots.length === 0) {
    it("has no public-export snapshots yet", () => {
      // Vacuous pass: the suite extends automatically when a baseline file
      // for `src/gateway/<target>.ts` is committed.
      expect(snapshots).toHaveLength(0);
    });
    return;
  }

  describe.each(snapshots.map((snapshot) => ({ snapshot })))(
    "$snapshot.targetRel",
    ({ snapshot }) => {
      const liveExports = extractLiveExports(snapshot.targetAbs);

      it.each(snapshot.rows.map((row) => ({ row })))(
        "$row.exportName matches the live $row.kind signature",
        ({ row }) => {
          const live = liveExports.get(row.exportName);
          expect(
            live,
            `Export "${row.exportName}" missing from ${snapshot.targetRel}`,
          ).toBeDefined();
          if (live === undefined) {
            return;
          }
          expect(live.kind, `Kind drift for "${row.exportName}"`).toBe(row.kind);
          expect(live.signature, `Signature drift for "${row.exportName}"`).toBe(row.signature);
        },
      );
    },
  );
});
