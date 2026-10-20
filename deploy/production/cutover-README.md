# RC cutover status — LIVE (2026-07-22 v84)

## Current production path

- **Container**: `openbot-gateway-rc` (podman)
- **Image**: `localhost/openbot:rc-amd64-v84` / `a7bbacbaac78` (**linux/amd64**, UI layer on v83)
- **Source revision**: `95c075a6058c3e201c4092f574a59540f8eec423`
- **GitHub**: branch `fix-scoped-package-templates` · PR #83
- **Runtime base**: v83 + control-ui `index-CjuZ-UOU.js`
- **Includes**: Employee agent roster filter fix; knowledge five-channel / two-level IA
- **Previous**: `openbot-gateway-rc-prev-v83-safety` / `localhost/openbot:rc-amd64-v83`
- **Network**: host · **Bind**: loopback :18789 · **State**: `/root/.openbot`

## Smoke (post-cutover)

- healthz **200**
- readyz **ready:true**, `failing:[]`

## Rollback to v83

```bash
podman rm -f openbot-gateway-rc
podman rename openbot-gateway-rc-prev-v83-safety openbot-gateway-rc
podman start openbot-gateway-rc
```

## Restart

```bash
podman restart openbot-gateway-rc
```
