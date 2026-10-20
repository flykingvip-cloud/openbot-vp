# Account sandbox skill visibility (P0) + incubation continuity

Date: 2026-10-15

## Problem

LIVE Account Worker exec leases (`aw-exec`) mounted only workspace + artifacts.
Shared skills never appeared at `/account/skills:ro` because
`RuntimeController.buildSpec` called `buildAccountSandboxMountPlan` without
`sharedSkillsDir` / `sharedCanvasDir` (unlike `applyAccountSandboxConfig`).

Prompt `<location>` values still pointed at host paths (`~/.openbot/skills/…`,
`/app/skills/…`), which are not readable inside the Account sandbox.

The sandbox image `openbot-sandbox:bookworm-slim` lacked `nodejs`/`npm`, so
skills such as cyber-ppt (PptxGenJS) could not run even after a successful read.

## Product rules

1. **Skill chain must be clear**: prompt-visible → sandbox-readable → correct engine executable.
   - Account sandbox locations: `/account/skills/<name>/SKILL.md` (managed ∪ bundled; managed preferred in the mount tree).
   - Forbidden excuses for stopping: "sandbox missing libs", "cannot see /app", host skill paths.
2. **Missing capability → incubation, not surrender**: route to
   `openbot-platform-ops` → `references/skill-asset-incubation.md`
   (fetch / create / bind), then continue the user task.
   `[[capability_gap:…]]` only after incubation/bind was attempted or is impossible.

## Implementation

| Layer | Change |
| --- | --- |
| Mount plan | `resolveSharedAccountMountDirs` (+ managed∪bundled materialize) shared by `applyAccountSandboxConfig` and `RuntimeController.buildSpec` |
| Prompt | `resolveSkillsPromptForRun({ accountSandboxLocations: true })` remaps `<location>` to `/account/skills/…` when container workdir is `/account/workspace` |
| Image (P1) | `Dockerfile.sandbox` installs `nodejs` and `npm` |
| Prompt / steward | System prompt Skills section + steward behavior rules encode the chain and incubation continuity |
| Skill ops | `skills/openbot-platform-ops/references/skill-asset-incubation.md` Account sandbox section |

## DIGEST / ops note

After this lands and DIGEST promotes the tip, **rebuild aw-exec leases**.
Existing containers do not self-heal mounts. No ROUTER / SHADOW / PROMOTE bake
into image or env defaults; keep SHADOW/EVAL as today; ROUTER stays off.

## Verification

- Unit: `account-shared-mounts.test.ts`, updated `runtime-controller.test.ts`
- LIVE: new aw-exec shows `/account/skills:ro`; session skills prompt locations under `/account/skills/…`; `node -v` / `npm -v` inside sandbox image
