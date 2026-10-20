# Build reproducibility

## Local Path A (`pnpm build`)

| Field                | Value                                                     |
| -------------------- | --------------------------------------------------------- |
| Command              | `pnpm build`                                              |
| Exit                 | **0**                                                     |
| Wall clock           | ~39.7s (2026-07-20T12:24Z)                                |
| Node / pnpm          | v22.18.0 / 10.23.0                                        |
| Worktree             | `/Users/daniel/AI项目/openbot-convergence` @ `08027a7006` |
| UI artifact (sample) | `dist/control-ui/assets/index-BrtEWITL.js`                |

## Relation to production Dockerfile (Path B)

Read-only from shared production tree:

`deploy/production/Dockerfile.runtime-safety-v69`

| Aspect         | `pnpm build` (Path A)             | Production v69 Dockerfile (Path B)                                                                     |
| -------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Base           | Fresh monorepo compile            | `FROM openbot:rc-amd64-v68` layer                                                                      |
| What lands     | Full `dist/` + Control UI rebuild | Copies **backend** `dist` only; **strips** `control-ui` from the copied tree (`rm -rf .../control-ui`) |
| UI             | This tip’s Control UI             | Retains **v68** Control UI from base image                                                             |
| LABEL revision | N/A                               | Hard-coded `85eee3e7…` (LOCKED_BASE / prod cutover SHA)                                                |
| Equivalence    | **Not equivalent**                | Incremental runtime-safety layer, not a full tip rebuild                                               |

### Implication for RC0 staging

- Staging that wants **convergence tip behavior including Control UI** must use a **full image rebuild** from `RECOMMENDED_RC0_TIP`, not the v69 layer Dockerfile as-is.
- Suggested image name (pending build): `openbot:rc-convergence-20260720`
- Image digest: **pending** (no `docker push` this wave)

## Docker build this wave

**Not run** — environment/time; no registry push. Blocker: intentional (PROD_CUTOVER forbidden; staging image optional and maintainer-gated).
