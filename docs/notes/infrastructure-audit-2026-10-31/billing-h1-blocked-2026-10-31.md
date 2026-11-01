# H1 Actions minutes / spending — blocked (2026-10-31 Asia/Shanghai)

Hypothesis H1 from Batch A: hosted jobs fail with `steps=[]` / `runner_id=0` / log 404 because Actions minutes or spending limits are exhausted.

## Attempts this session

| Probe | Result |
|---|---|
| `gh api orgs/flykingvip-cloud/settings/billing/actions` (Mac, authed as `flykingvip-cloud`) | HTTP **404** Not Found |
| shared-storage billing sibling | HTTP **404** |
| Box-side earlier probes | same 404 class |

GitHub documents these endpoints, but this org token/role does not return billing payloads (common when billing is plan-gated, fine-grained PAT lacks `organization_administration`/`billing`, or org uses enterprise billing UI only).

## What would close H1 (owner UI)

From GitHub org **Billing / Plans & usage / Actions** (or Enterprise billing equivalent), export or screenshot showing for the current cycle:

- Included minutes vs used minutes (Linux/Windows/macOS split if shown)
- Spending limit / hard cap and whether Actions is blocked
- Any “billing blocked” / “budget exceeded” banner

Until then: **H1 remains 待验证**. Empty-steps are **已证实** as no-runner class; minutes exhaustion is **not** asserted.

## Related observed fact (not billing proof)

`RELEASE_RECORD.md` seq 104–107 narrative: every workflow `startup_failure` → manual amd64 GHCR build. That is consistent with runner/scheduling failure, still not a minutes counter reading.
