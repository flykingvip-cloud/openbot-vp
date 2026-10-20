# Handoff — Security Reviewer (parallel)

reviewerStableId: security-reviewer:profile-ab-tenant
target: reviews/security-review.md
Material Owner (amanuensis only): grok-bot — will paste your receipt verbatim; will not draft findings.

## Frozen digests (must cite exactly)

reviewedMainSha: d8379ed919424c50d04c3be92cd2ef671f5e4580
reviewPackageDigest: a165bde3d0516a4f6a99a34c98eb9d3b8ca5bf97c421b1d4e7bfc220e439c9ae
reviewPackageCombinedDigest: 9982ab2bcb65bd7022064065c05590bd7cc2134b48a37fb0fa87f5a5fa43764c
ownerDecisionDigest: 06e14b8b1c3b6f1633f47db2380b8a84c4163c55302035158a561ae4c1ff4e21
phaseCFrozenCombinedDigest: c5e527340f8d551e0569e62a956d6d615b241e92ebdee4e53d8320eae0c73a20

## Packet location (Mac)

/Users/daniel/AI VP/openbot-main/.codex-review/constitutional-phase-d-governance-ratification/

## Must examine

- Profile A/B isolation
- sessionKey routing-only
- receipt ≠ proof; plugin installed ≠ capability authorization
- Constitutional flags default-off; flag combinations fail-closed
- execute stub: no tenant/ledger/gateway side effects
- no env alias bypass of defaults
- Owner SUPERSEDE = retention only

## Required success shape (if you agree)

decision: AGREE_BOUNDED_RETENTION
conditions: none
Plus explicit: retention-only; no extension / gateway wiring / flag enable / live execute / deploy; claim ceiling unchanged; runtimeEnabled=false; productionProven=unknown.

If REVISE / DISAGREE / open conditions → overall stays REVISE.
