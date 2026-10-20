# Phase D0 — hotfile delta

| File                                                         | Touched? | Notes                                                              |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------------ |
| `package.json`                                               | **yes**  | scripts.build one-line prefix only; see `package-scripts-delta.md` |
| `pnpm-lock.yaml`                                             | no       |                                                                    |
| `method-scopes.ts` / `server-methods*.ts` / `server.impl.ts` | no       | (other agents have dirty WIP in tree — **not** staged by D0)       |
| i18n `en.ts` / `zh-CN.ts`                                    | no       |                                                                    |
| `ui/src/ui/app.ts`                                           | no       | dirty in worktree from others — left alone                         |

No whole-file hotfile rewrites.
