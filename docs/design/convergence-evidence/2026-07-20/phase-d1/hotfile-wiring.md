# Phase D1 — hotfile wiring

## Touched hotfiles

| File                           | Diff                                                                                                   | Separate commit?             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `src/gateway/method-scopes.ts` | +1 line: `"enterprise.organization.snapshot"` in operator read group (after `enterprise.notices.list`) | **Yes** — `chore(scopes): …` |

## Not touched (intentionally)

- `server-methods.ts` / `server.impl.ts` / `package.json` / `app.ts` / i18n
- Rejected concurrent WIP that tried to add `enterprise.organization.monthly-seat-usage` + monthly handlers into the same hotfiles

## Diff summary (`method-scopes.ts`)

```diff
+    "enterprise.organization.snapshot",
```

No whole-file overwrite; no adoption of unrelated monthly-usage WIP.
