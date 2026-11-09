# Design intent preservation before retirement

## Required evidence per retired path

Deletion requires all five entries, not just a zero-reference search:

1. Original problem and design intent: history, design notes and executable tests. If the first available commit is a snapshot, state that earlier motivation is unknown.
2. Capability and invariant inventory: functional output, ordering, failure recovery, authorization, trust, state and delivery behavior.
3. New-mainline owner: exact component, actual production caller and the retained contract; identify any old capability deliberately not retained.
4. Evidence: migration comparison plus consumer, regression and scenario coverage. Source availability is not production enablement evidence.
5. Retirement/rollback: public SDK/export/packaging/external consumers reviewed; preserve required compatibility or restore adapter if evidence is incomplete. No deletion of live configuration/assets without usage and replacement evidence.

## Decisions

- KEEP: necessary capability or independent legitimate scope; retain implementation or adapter.
- MIGRATE: intent still necessary; implement and validate in the new owner before retiring old control.
- RETIRE: redundant implementation or consumed adapter; required intent already covered and consumer checks complete.
- UNKNOWN: stop deletion; investigate or keep compatibility. Missing references alone cannot establish obsolete intent.

## No silent feature removal

The runtime migration may replace how a feature is controlled but must not silently remove its purpose. Shared collaboration contracts, owner private plans, transcript authority, approval cards, protocol isolation and cancellation each have distinct original responsibilities. A duplicate-looking loop/file/name is not enough to merge or delete them.

Capabilities missing from the new chain become explicit correctness work with red/green evidence and domain ownership. Do not fill the gap by installing a second orchestration system or an arbitrary script in configuration.

## Scope of earlier shell removals

Three paths removed in 105f901bc were already compatibility exports after their implementations had moved. Their underlying capability was not deleted. The retrospective intent audit must still bind original purposes to new owners and record uncertainty about external direct source consumers. If such a consumer is verified, restore an appropriate compatibility entry; do not duplicate implementation.
