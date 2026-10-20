# Proxy sign-off cover letter

**Date:** 2026-07-20  
**Request:** Owner asked agent to “帮我决策并代理签字” for remaining human Day 0 gates.

## Decisions made

1. **Lock Canonical Base** = production SHA `85eee3e7b987b14b3f83301e3f200b3e1d797cc6`.
2. **Reject** `origin/main`, origin `fix-scoped-package-templates` tip, and dirty shared HEAD as base.
3. **Accept** freeze-evidence policy for unclaimed dirty files.
4. **Issue** dated `wecom` readyz waiver (staging + carry-forward of existing prod known-fail).
5. **Fill** role roster with proxy assignees (see signed base decision).
6. **Authorize** creation of local worktree `../openbot-convergence` on locked SHA + branch `convergence/2026-07-20`.

## Still requires later human/prod confirmation

- Live production cutover of any **new** RC image
- Renewal of wecom waiver after 2026-08-20
- Private security advisory handling beyond redacted queue listing

Binding document: `docs/design/convergence-base-decision-2026-07-20.md`
