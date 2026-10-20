# Phase D0 — package.json scripts delta

| Field             | Value                         |
| ----------------- | ----------------------------- |
| File              | `package.json` (scripts only) |
| Lockfile touched? | **no**                        |
| Commit            | `62cce75600`                  |

## Change

`scripts.build` prefix:

```diff
- "build": "pnpm canvas:a2ui:bundle && ...
+ "build": "pnpm build:collaboration:packages && pnpm canvas:a2ui:bundle && ...
```

Aligns root `pnpm build` with `build:docker` / `build:plugin-sdk:dts` so collab `dist/` exists before tsdown.
