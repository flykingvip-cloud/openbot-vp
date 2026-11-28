# Wave-V21-1 contract pin (OpenBot side, read-only)

This directory is a **byte-identical pin** of `knowledge-sdk`
`contracts/v21-reuse-v1/` at promotion commit
`116877f0e837a3c3cfc96327e9ae05c22feb2a0a` (`FROZEN_V21_REUSE_V1`). The same
pack tree is unchanged at isolation-branch tip
`207953963872a4a7e65731def077c469b685f4e2` (`git diff` on this folder is empty
between those two commits). Independently recomputed manifest SHA-256 (VB-4
algorithm: POSIX relative paths, stable sort, raw-byte SHA-256; manifest
excluded from itself; also exclude `node_modules/`, `ts-generated/`,
`package-lock.json`, `__pycache__/`, `*.pyc`, and dotfiles):

`212537fd41bd4cc4d9d7343cacafaea225ee98b6586df716bf036a397cb2a382`

The previous draft pin `6da567e0f376fee7b6b2b033e6666cbd5eba7bc3d67b93089e49e6edb759906d`
is superseded by this frozen pin. The five schema groups and 51 vectors remain
byte-identical to `9d25ea96b75b5ab528a2d2670b5419d9a217e39e`.

Do not edit these files to “fix” a test. Register disagreements as `V21-DELTA-*`.
This pin is not a Knowledge SDK checkout, not a production route, and not formal
Wave-V21-1 acceptance or a Gate 3/4 signoff.
