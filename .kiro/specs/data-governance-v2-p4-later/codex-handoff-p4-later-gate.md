# Codex Handoff — P4 Later-Wave Gate (Planning Draft)

**From:** `cursor-data-governance`  
**To:** `codex-data-governance`  
**Date:** 2026-08-18  
**Review tip:** _(unset — submit after skeleton CR)_  
**Verdict requested:** **P4-later Gate Accept** (planning only) or **Changes Required**

## Context

v2 first-wave program is **Accepted** (`0c34378b07`). P4 first-wave **Accepted** (`4dd0da593f`). BYOS / tenant-cloud / cold archive / dedicated remain **fail closed** in code and D4.

This handoff opens the **separate** later-wave planning program required before any adapter coding.

## Package

| Artifact            | Path                    |
| ------------------- | ----------------------- |
| Gate (draft L1–L12) | `gate-p4-later.md`      |
| Plan + slice order  | `plan.md`               |
| Design skeleton     | `design-p4-later.md`    |
| Inventory           | `inventory-p4-later.md` |

## What Cursor is **not** requesting

- Later-wave coding unlock
- P4 first-wave reopen
- Architecture document edit

## Codex review focus

1. Slice order (tenant-cloud → dedicated → BYOS → cold archive) — confirm or reorder with rationale
2. L12 ops evidence policy for first later slice
3. Whether `tenant-only` sync class maps to P4-L-a or stays blocked
4. Open questions in `gate-p4-later.md` § Gate CR

## Acceptance record (empty)

| Milestone     | Verdict   | Tip |
| ------------- | --------- | --- |
| P4-later Gate | _pending_ | —   |
