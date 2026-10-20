# Formal SBOM (CycloneDX via @cyclonedx/cdxgen)

Stage 6 inventory artifact for `@upbeyond/openbot`.

## Artifact

- `sbom/openbot.cdx.json` — committed CycloneDX **1.6** BOM
- Generator: **OWASP** [`@cyclonedx/cdxgen@12.8.5`](https://www.npmjs.com/package/@cyclonedx/cdxgen) (standard tooling)
- Wrapper: `scripts/generate-cyclonedx-sbom.ts` → `pnpm dlx @cyclonedx/cdxgen@12.8.5 …`
- Entry: `pnpm sbom:cyclonedx`

This file is **not** an audit verdict. `pnpm audit --prod` remains a separate Stage 6 axis.
Presence of a formal SBOM does **not** make Stage 6 product PASS.

## Regenerate

```bash
pnpm sbom:cyclonedx
```

Equivalent:

```bash
pnpm dlx @cyclonedx/cdxgen@12.8.5 \
  -t js --spec-version 1.6 --no-recurse --no-install-deps --json-pretty --validate \
  -o sbom/openbot.cdx.json .
```

`cdxgen` embeds a wall-clock `metadata.timestamp` / `serialNumber`, so the file is **not** bit-identical across runs. Regeneratability means: same lockfile/install tree → same component `purl` set (and tool identity `@cyclonedx/cdxgen`).

Evidence tests assert tool identity + component purl-set equality, not byte identity.

## Legacy

`scripts/generate-cyclonedx-sbom.lockfile-legacy.ts` is a prior custom lockfile emitter kept only as supporting history. It is **not** the formal Stage 6 path.
