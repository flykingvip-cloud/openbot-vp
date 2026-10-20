# Packages Boundary Notes

This directory currently contains two different kinds of package workstreams. They should not be treated as one undifferentiated workspace surface.

## Promoted Workspace Packages

These packages already look like proper workspace boundaries:

- `collaboration-core`
- `collaboration-openbot-adapter`
- `collaboration-runtime`
- `cogniweave-sdk`
- `evolution-core`

Promotion criteria:

- has `package.json`
- has `tsconfig.json`
- has a coherent `src/` tree
- has local tests or a realistic local quality gate

These packages are suitable candidates for package-local CI and package-local ownership.

## Incubating Draft Packages

These directories currently look like package imports or partial SDK drops, not fully promoted workspace packages:

- `presentation-ai-sdk`
- `smart-schedule-sdk`
- `meetingos-sdk`

Current characteristics:

- incomplete or partial source closure
- generated `dist/` may exist near incomplete `src/`
- package-local `package.json` / `tsconfig.json` may be missing

These packages should be treated as incubating drafts until they become self-contained.

## Repository Rules

- Root product gates validate the main OpenClaw product surface first.
- A package should not block the root repository quality gate until it is self-contained.
- If a package is incubating, keep its quality gate local to the package workstream.
- If a package is promoted, give it explicit ownership and package-local CI.
