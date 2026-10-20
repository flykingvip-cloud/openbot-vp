# Contributing to OpenBot

Welcome to OpenBot.

## Quick Links

- **GitHub:** https://github.com/gmood2008/openbot
- **Vision:** [`VISION.md`](VISION.md)
- **Discord:** https://discord.gg/qkhbAGHRBT

## Before You Contribute

1. **Bug fixes / focused improvements**: open a PR directly.
2. **Large features / architectural changes**: start a GitHub Discussion first, or align in Discord before implementation.
3. **Questions / help**: use Discord support channels or GitHub Discussions.

## Before You Open a PR

- Test locally against your current OpenBot setup.
- Run:
  - `pnpm build`
  - `pnpm check`
  - `pnpm test`
- If you have access to Codex, run `codex review --base origin/main` and address the findings before requesting review.
- Keep the PR focused. Do not mix unrelated changes.
- Explain both **what** changed and **why**.
- Resolve or reply to bot review conversations you addressed before asking for review again.
- Include screenshots for UI / visual changes: one before, one after.

## Review Conversations Are Author-Owned

If a bot leaves review conversations on your PR, you are expected to clean them up:

- Resolve the conversation yourself once the code or explanation fully addresses it.
- Leave it open only when reviewer or maintainer judgment is still needed.
- Do not leave “fixed” bot conversations for maintainers to clean up.
- If Codex leaves comments, address every relevant one or resolve it with a short explanation when it is not applicable.

## Control UI Decorators

The Control UI uses Lit with legacy decorators.

Use:

```ts
@state() foo = "bar";
@property({ type: Number }) count = 0;
```

The root `tsconfig.json` is configured for legacy decorators (`experimentalDecorators: true`) with `useDefineForClassFields: false`. Do not switch this unless the UI build tooling is updated accordingly.

## AI-Assisted PRs

AI-assisted contributions are welcome. Please be transparent:

- Mark the PR as AI-assisted in the title or description.
- State the testing depth: untested / lightly tested / fully tested.
- Share prompts or session logs when practical.
- Confirm you understand the submitted code.
- If you have Codex access, run `codex review --base origin/main` and address the results.
- Resolve or reply to bot review conversations after you address them.

## Current Focus

We are currently prioritizing:

- Stability in gateway and channel behavior
- Workbench and collaboration UX quality
- Capability / skill lifecycle improvements
- Performance and token efficiency

Check the GitHub issue tracker for current opportunities:

- Issues: https://github.com/gmood2008/openbot/issues
- Discussions: https://github.com/gmood2008/openbot/discussions

## Maintainers

We are selective about expanding the maintainer group.

If you are an experienced contributor who wants to help shape OpenBot through code, docs, triage, or community work, reach out with:

- Links to your PRs in this repository
- Other open source projects you maintain or contribute to
- A short intro covering background, strengths, and areas of interest
- Your realistic availability

Please use the project’s public GitHub Discussions or Discord to start the conversation unless a maintainer asked you to use another route.

## Report a Vulnerability

We take security reports seriously.

- **Core CLI, gateway, web UI, desktop/mobile app code in this repository:** https://github.com/gmood2008/openbot
- **Trust and threat model:** see [`SECURITY.md`](SECURITY.md)

If you are unsure whether an issue is security-relevant, open a private security report through GitHub Security Advisories for this repository when possible, or follow the guidance in `SECURITY.md`.

### Include in Security Reports

1. Title
2. Severity assessment
3. Impact
4. Affected component
5. Technical reproduction
6. Demonstrated impact
7. Environment
8. Remediation advice

Reports without reproduction steps, demonstrated impact, and remediation advice may be deprioritized.
