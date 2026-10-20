# Recovery Provenance — constitutional-phase-d-governance-ratification

This file is a non-frozen recovery note. It is **not** part of the frozen
`reviewPackageDigest` / `reviewPackageCombinedDigest` scope, and it does not
modify, replace, or reinterpret the Owner decision, the Architecture receipt,
or any Phase C evidence.

```yaml
reconstructedAt: 2026-09-27
reconstructedBy: grok-bot-4ab694d6
sourceType: verified-codex-review-copy
sourcePath: /Users/daniel/AI VP/openbot-main/.codex-review/constitutional-phase-d-governance-ratification/
recoveryBranch: grok-bot/constitutional-phase-d-governance-ratification-recovery
recoveryMainSha: 30fde26fdf8531259c18c4e2610c93df37206387
loomSessionId: e32c44f7-a992-4667-85ea-0dca04180d8e
predecessorSessionRecovered: false
reason: predecessor worktree and unlanded Loom registry entry were unavailable
status: REVISE
```

## Statements

- Reconstruction was authorized by the task coordinator on 2026-09-27 from the
  verified Codex review copy listed above. Only governance materials were
  restored; the original branch history was not restored, and no ruling was
  changed.
- The 14 restored files are byte-for-byte identical to the verified review
  copy. SHA-256 at restore time:

```text
f57b33d4b244577078b61ac18c21fca908798af9a25ed6fd7a46392d4ee11350  README.md
3adff2ddfb47badcc9579555f9f67586f15ee895331d3b31249dc0806268f8b0  baseline-manifest.yaml
e2a8ecf2aa066767306e4933f58924c323781797e24316e77389548cde644664  decision-digest.md
4f151d59c988244365e74f408730244127406a87a89696ff8c63367ff09e55cc  evidence/main-drift-check.md
39edb4d6d08609feabdd28a672b00ea4e13ee0ed8c83dd63beaf0b5847367a78  evidence/runtime-wiring-rg-evidence.md
242da495274b2083b00ff0e7d5cb791b5a1737153fff75b7023d68fb2dc68781  final-acceptance.md
659ea9c1c4035592edfeccbae5f72a0d8f3733e2934c3fd895a8eb4c15e47b91  handoff/EXECUTION-CHAIN-REVIEWER-HANDOFF.md
80455427459e7796266b34610a9bfd2f3cfed1aa547e141f6a32bf6df326c613  handoff/SECURITY-REVIEWER-HANDOFF.md
06e14b8b1c3b6f1633f47db2380b8a84c4163c55302035158a561ae4c1ff4e21  owner-decision.md
1e7fec3e5b41cc342cfb2076a13b4e05c3cb5f5d3f8a185b0989ae2bee430f5e  reconciliation-decision.md
a165bde3d0516a4f6a99a34c98eb9d3b8ca5bf97c421b1d4e7bfc220e439c9ae  review-package.md
effcb74784ba9190d547d16322587453e2b500d58e343026637182dbdcde90d8  reviews/architecture-review.md
fbc39890fd64b9ff1d0396c5f37cfa494652266ce7490e013f7d1625bd9fd3dc  runtime-wiring-inventory.md
87d99c06077f4b6bbe060236f4598fe7150ad7169a0470b1ad922a8ab962fd3a  scope-freeze.md
```

- The predecessor Loom session could not be recovered: the predecessor worktree
  was unavailable and its registry entry was never landed on `origin/main`. It
  must not be fabricated. No predecessor session was hand-written into the
  registry.
- A new traceable chain starts from Loom session
  `e32c44f7-a992-4667-85ea-0dca04180d8e`, task
  `constitutional-phase-d-governance-ratification:grok-bot-4ab694d6`, owner
  `grok-bot-4ab694d6`.
- Governance tooling in this worktree runs through a shared dependency symlink
  (`node_modules` pointing to `../openbot-main/node_modules`, git-ignored). This
  is not evidence of an independent `pnpm install` or of a full test pass.
- Security and Execution-chain receipts remain PENDING. Status stays `REVISE`
  until real independent reviewers deliver them.
