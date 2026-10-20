# Runtime Examples

This document shows the two reference flows currently supported by the package.

## Example 1: Minimal Usage

File:

- `packages/cogniweave-sdk/examples/minimal.ts`

What it shows:

- engine initialization
- task framing
- reasoning
- write-back
- package trace

## Example 2: Partial Success and Repair

File:

- `packages/cogniweave-sdk/examples/writeback-repair.ts`

What it shows:

- forcing derived sync failure
- observing `PARTIAL_SUCCESS`
- reading the write journal
- running `repairIndexes()`
- verifying recovery

## Suggested Reading Order

1. `quickstart.md`
2. `examples/minimal.ts`
3. `examples/writeback-repair.ts`
