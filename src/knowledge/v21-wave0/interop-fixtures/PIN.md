# W2 interop golden fixture pin

This directory pins Team A Sync-W2-1 golden fixture bytes for Wave-V21-2
W2B-2 default-off end-to-end interop tests.

- Source repository: knowledge-sdk
- Source branch: `feat/v21-wave2-e2e-interop`
- Source commit (Team A fixture publication): `37c982546f49bb8312670ad01be995d91f345043`
  (parent exact `207953963872a4a7e65731def077c469b685f4e2`)
- Fixture path in knowledge-sdk: `sandbox/v21_reuse_v1/fixtures/w2_interop_golden.json`
- Pinned file: `w2_interop_golden.json`
- Independent raw-byte SHA-256: `f8033a902af06b005fa591ab872a74f9569a3783fd3e7cef90c6dc94cf9d0fef`
- Size: 33863 bytes
- Git blob SHA-1: `5afaff1616ddd77dca604dc498fc691ae4a4f37b`

A later tip of the same branch was observed at
`4d546272cd51605edeed5b80b4e3adc278608e94` (docs/handoff only). The fixture
bytes at that tip were independently re-hashed and remained identical to
the pin above. The recorded source commit for this pin is `37c98254`.

`contracts/v21-reuse-v1/` and OpenBot `src/knowledge/v21-wave0/contracts-pin/`
are unchanged by this pin. Do not copy or rewrite the frozen
FROZEN_V21_REUSE_V1 manifest (SHA-256
`212537fd41bd4cc4d9d7343cacafaea225ee98b6586df716bf036a397cb2a382`).
Zero `V21-DELTA-*`. Formal T-01–T-27 stays `NOT_RUN_NOT_ACCEPTED`.
