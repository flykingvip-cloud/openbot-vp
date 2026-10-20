# Candidate tip

## RECOMMENDED_RC0_TIP

```text
RECOMMENDED_RC0_TIP=9aceda7349da2190e00bb2fbb029175a517ecde7
```

Short: `9aceda7349`

| Field         | Value                                                                              |
| ------------- | ---------------------------------------------------------------------------------- |
| Subject       | `docs(convergence): Phase D4 knowledge import matrix evidence and handoff`         |
| Agent trailer | `Agent: cursor-convergence-phase-d4`                                               |
| Why           | Last clean D0–D4 convergence tip **before** unrelated org monthly-usage UI commits |

## Ancestry

```bash
git merge-base --is-ancestor 85eee3e7b987b14b3f83301e3f200b3e1d797cc6 9aceda7349
# → exit 0 (LOCKED_BASE is ancestor)
git rev-list --count 85eee3e7b987b14b3f83301e3f200b3e1d797cc6..9aceda7349
# → 51
```

## Branch tip at RC0-PREP capture (NOT recommended for tag)

| Field                   | Value                                      |
| ----------------------- | ------------------------------------------ |
| HEAD                    | `08027a70063c218190e234f11be2f81990cf43a1` |
| Count LOCKED_BASE..HEAD | **57**                                     |
| Extra vs D4             | **6** commits (pollution)                  |

## Pollution commits (`9aceda7349..HEAD`)

| SHA          | Subject                                                         | Paths (summary)                                              |
| ------------ | --------------------------------------------------------------- | ------------------------------------------------------------ |
| `a478f29e29` | UI: keep seat usage runtimeStatus null for mesh fallback.       | `ui/.../organization-position-usage.ts`                      |
| `37e9f1a453` | UI: aggregate organization seat mesh runtime across bots.       | `ui/.../enterprise-organization-surface.ts`                  |
| `7200f5c05a` | UI: wire organization refresh through enterprise action state.  | `ui/.../action-state.ts`                                     |
| `b7306c980d` | UI: add refreshEnterpriseOrganization app shell action.         | `ui/app.ts`, shell slices                                    |
| `e522938115` | UI: cover organization refresh routing to monthly shell reload. | org-refresh node test                                        |
| `08027a7006` | Spec: note acceptance follow-ups for org monthly usage.         | `.kiro/specs/enterprise-organization-monthly-usage/tasks.md` |

**Tag guidance:** Prefer tagging **`9aceda7349`**. Do **not** treat `08027a7006` as RC0 tip unless maintainers explicitly accept monthly-usage UI into the candidate.

## Tag suggestion

```text
rc-convergence-2026-07-20-d4
# or
openbot:rc-convergence-20260720 @ 9aceda7349
```
