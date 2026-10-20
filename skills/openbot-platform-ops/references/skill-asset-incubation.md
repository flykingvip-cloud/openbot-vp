# Skill and asset incubation

## When

User wants to save a workflow as a skill, quick-save a capability, record guidance outcomes as reusable assets, or **纳入资产 / 收录为资产 / 通过技能资产注册流程导入**.

## Paths

| Path                     | RPC / tool                                                          | Notes                                          |
| ------------------------ | ------------------------------------------------------------------- | ---------------------------------------------- |
| **Agent → 我的资产**     | agent tool `skill_asset_save`                                       | **Solver default** when user asks to 纳入资产  |
| Extract lifecycle skill  | `skill-lifecycle.extract`, `skill-lifecycle.save`                   | Formal packaging (UI / human RPC context)      |
| Employee quick save      | `employee-capability.quick-save`                                    | Workbench accumulation (UI)                    |
| Guidance completion hook | `guidance_event` tool                                               | After `user-guidance-protocol` success/failure |
| Pattern → draft skill    | `pattern-detection.ingest-sample`, `approve`, `publish-draft-skill` | Platform pattern pipeline                      |
| Authoring spec           | skill `skill-creator`                                               | AgentSkills layout and validation              |

Asset incubation session store: `asset-incubation.session-events.*`, `asset-incubation.guidance.record`

## Workflow

1. Complete the underlying task first (guidance, configuration, or skill authoring under workspace `skills/<name>/SKILL.md`).
2. When the user asks to **纳入资产 / 收录为资产 / 注册为技能资产**: call `skill_asset_save` with `skillPath` (workspace-relative) and `confirmed=true`. Do **not** copy into `/account/skills` (read remount only) and do **not** invent gateway RPC names.
3. On success, tell the user the asset is in **我的资产** (draft). They can refine, install to a robot, then submit-to-enterprise for org-wide reuse.
4. On guidance-protocol success/failure, call `guidance_event` with outcome metadata.
5. For new skill directories, follow `skill-creator` — place under workspace `skills/<name>/`.

## Confirm

- Medium: `skill_asset_save` (requires `confirmed=true`); publishing or sharing capability to group/enterprise
- High: submit-to-enterprise / submit-to-platform

## Not responsible for

ClawHub publish CLI — see skill `openbot-skills` only when user explicitly asks for ClawHub.

## Account sandbox / missing skill — do not stop

When the user task needs a skill or engine that is not yet available:

1. **Do not** admit a permanent capability gap and stop.
2. **Do not** use excuses such as "sandbox missing libs", "cannot see `/app/skills`", or host paths (`~/.openbot/skills`, `/app/skills`) as a reason to abandon the task.
3. In Account sandbox, skills are prompt-visible → readable at `/account/skills/<name>/SKILL.md` → executable with the skill's engine (e.g. `node`/`npm` for cyber-ppt / PptxGenJS). Prefer those container paths for **reads/exec**, not for registering assets.
4. Route here: `skill_asset_save` / extract-save / employee quick-save / pattern draft / `skill-creator`, then **bind** the skill to the robot and **continue** the original task.
5. Only after incubation/bind was attempted (or is truly impossible under policy) may you emit `[[capability_gap:…]]` once.
