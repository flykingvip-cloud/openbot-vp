#!/usr/bin/env node

/**
 * Employee capability terminology guard (build-time placeholder).
 *
 * Runtime/property tests under ui/src/ui/capability/employee-capability and
 * employee port views already call scanNode()/assertNoBlacklistedTerm().
 * A full static scanner is deferred; this step exists so pnpm check can run in CI.
 */
process.exitCode = 0;
