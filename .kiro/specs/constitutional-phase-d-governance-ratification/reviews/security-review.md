# Security Review — Phase D Governance Ratification

reviewerStableId: security-reviewer:profile-ab-tenant
reviewedAt: 2026-09-27
reviewedMainSha: d8379ed919424c50d04c3be92cd2ef671f5e4580
reviewPackageDigest: a165bde3d0516a4f6a99a34c98eb9d3b8ca5bf97c421b1d4e7bfc220e439c9ae
reviewPackageCombinedDigest: 9982ab2bcb65bd7022064065c05590bd7cc2134b48a37fb0fa87f5a5fa43764c
ownerDecisionDigest: 06e14b8b1c3b6f1633f47db2380b8a84c4163c55302035158a561ae4c1ff4e21
phaseCFrozenCombinedDigest: c5e527340f8d551e0569e62a956d6d615b241e92ebdee4e53d8320eae0c73a20

decision: AGREE_BOUNDED_RETENTION
conditions: none

## Findings

1. Profile A and Profile B remain distinct labels. Constitutional contracts carry one explicit profile per row, `crossDomainWriter` is fixed to `false`, and the reviewed surfaces provide no writer, tenant bridge, or mechanism that promotes a personal-local fact into managed-enterprise authority. The retained code is a read-only projection and report surface, not a cross-profile authorization service.

2. `sessionKey` remains routing-only. The legal-path selector explicitly discards `sessionKey`, workflow, Lobster, AOR, Fabric, and dormant-orchestration aliases. None of those values can become a declared Path, authorize selection, or authorize execution.

3. Receipt and proof remain structurally non-equivalent. Receipt-only evidence cannot carry a proof grade, validation receipts remain `receiptOnly`, model text cannot become proof, and in-request traces cannot become verified proof.

4. Plugin installation and capability authorization remain structurally non-equivalent. Plugin-registry records always project with `capabilityAuthorized: false`; capability authorization requires a separate grant-ledger source; the plugin registry is explicitly rejected as an authorization ledger.

5. The Constitutional switches are fail-closed in the retained scope. Shadow, path-gap reporting, legal-path selection, and package-local execute require explicit caller options or a caller-supplied environment snapshot. The reviewed modules do not read `process.env` themselves. Enforce, live invoke, Fabric default-on, readiness to tighten, and C5 pass remain hard false.

6. No environment alias bypass was found. Only the named caller-supplied snapshot keys are recognized, with a bounded truthy set. Merely setting process environment variables does not activate these package functions unless a caller deliberately reads and forwards that snapshot. No production caller performing that forwarding was found.

7. `executeLegalPath` remains a package-local stub. It can return `executed: true` only after declared-path selection and explicit execute opt-in, and its only side-effect value is the in-memory audit marker `package-local-execute-allowed`. It performs no gateway, tenant, identity, capability, ledger, network, tool, enqueue, or live-invoke operation and does not mutate the legal-path registry or its input.

8. No package-external caller of `selectLegalPath` or `executeLegalPath` was found. The two observe facades remain outside gateway, dispatch, preflight-builder, trace-writer, and completion hot paths. The reviewed code therefore does not presently introduce a production authorization bypass or a new production authority FSM.

9. The Owner decision is sufficiently limited for retention only. It supersedes only the Phase C freeze language needed to retain the already-merged, default-off and unwired surfaces. It does not authorize extension, gateway wiring, flag enablement, live execution, Fabric default-on, deployment, tenant effects, or a higher claim level.

10. The Constitutional paths were unchanged between the reviewed baseline and the independently checked current recovery-worktree HEAD. The frozen review-package files and their combined digest were independently recomputed and matched.

## Security Decision

Security agrees only to bounded retention of the precise, already-merged surfaces listed in `scope-freeze.md`.

The claim ceiling remains:

- code-present
- default-off
- not-wired
- not-runtime-enabled
- not-production-proven

This receipt does not authorize:

- further Phase D or constitutional-contracts development
- new Path or Gate authority
- Profile A/B merging
- sessionKey-based authorization
- receipt-to-proof promotion
- plugin-install-based capability authorization
- gateway, dispatch, preflight, CTR, tool, ACP, AOR, or tenant wiring
- flag enablement
- live execute
- Fabric default-on
- ledger writes
- deployment
- a production-proven claim

`runtimeEnabled` remains `false`.

`productionProven` remains `unknown`.

Any change to the frozen package, facade, flag, schema, authorization, tenant, identity, capability, or hot-path scope requires a new Security review and makes this receipt insufficient for the changed surface.
