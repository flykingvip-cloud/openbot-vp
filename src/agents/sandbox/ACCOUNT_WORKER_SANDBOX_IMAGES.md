# Account Worker real sandbox images + browser lifecycle

Status: **wiring + mocked lifecycle + gated real-daemon e2e** (not production cutover).

Feature flags (**P6b**): unset defaults **ON**; set `0`/`false`/`off` to roll back:

- `OPENBOT_ACCOUNT_WORKER`
- `OPENBOT_ACCOUNT_WORKER_DOCKER`

Product path still requires `managed_enterprise` + shared tenant addressing. See `docs/design/account-computer-p6b-production-default-on-2026-10-17.md`.

## Images (operator-controlled only)

| Role                             | Default tag                              | Dockerfile                   | Build                              |
| -------------------------------- | ---------------------------------------- | ---------------------------- | ---------------------------------- |
| Exec / sleep                     | `openbot-sandbox:bookworm-slim`          | `Dockerfile.sandbox`         | `scripts/sandbox-setup.sh`         |
| Browser (Chromium + CDP + noVNC) | `openbot-sandbox-browser:bookworm-slim` | `Dockerfile.sandbox-browser` | `scripts/sandbox-browser-setup.sh` |

Resolution order (`resolveAccountWorkerImages`):

1. `OPENBOT_ACCOUNT_WORKER_EXEC_IMAGE` / `OPENBOT_ACCOUNT_WORKER_BROWSER_IMAGE`
2. Operator config (`agents.defaults.sandbox.docker.image` / `.browser.image`)
3. Legacy `OPENBOT_ACCOUNT_WORKER_DOCKER_IMAGE` **exec only** (alpine smoke)
4. Defaults above

Gateway request bodies **cannot** supply `image`, mounts, or docker params
(`RuntimeController` forbidden fields).

## Lifecycle covered by the docker driver

Cold start → warm attach → idle reclaim → crash relaunch remain on
`AccountWorker` / `AccountWorkerLifecycle`. The docker driver:

- Builds create argv only from the controller spec
- Uses **distinct** exec vs browser images
- Mounts profile at `/account/browser` and artifacts at `/account/artifacts`
- Sets browser env so `scripts/sandbox-browser-entrypoint.sh` uses the profile,
  `--no-sandbox`, a desktop session, and loopback CDP + noVNC (Control UI iframe)
- Refuses `docker.sock` mounts
- Recreates on name conflict (crash relaunch)

Device-bound REAUTH (`device-bound` marker → `REAUTH_REQUIRED`) is unchanged.

## Build steps (large images; optional for unit tests)

```bash
# Exec image is Debian 13 trixie (tag stays bookworm-slim) with Node 20,
# Chromium, poppler, and fonts-noto-cjk. Digest-pinned base. ~1GB+.
./scripts/sandbox-setup.sh
./scripts/sandbox-browser-setup.sh
docker image inspect openbot-sandbox:bookworm-slim
# temporary alias of the same image
docker image inspect openclaw-sandbox:bookworm-slim
docker image inspect openbot-sandbox-browser:bookworm-slim
# temporary alias of the same browser image
docker image inspect openclaw-sandbox-browser:bookworm-slim
```

## Clean preview and dock desktop

The Control UI preview iframe is pinned to the stage (`position: absolute; inset: 0`)
so the wallpaper color shows through instead of a dark letterbox. The chrome-less
noVNC page fits the 1280×800 framebuffer with one scale and paints the spare band
in the wallpaper tone (`#e7e7eb`). x11vnc refuses `resize=remote`. Stock noVNC chrome stays
out of the iframe. The VNC password stays on the relay grant. Fixing the page or
the Control UI CSS does not require rebuilding the sandbox image.

The dock desktop (light wallpaper, OpenBot logo, Chrome / files / terminal) is drawn
inside `openbot-sandbox-browser:bookworm-slim` by
`scripts/sandbox-browser-desktop.py`. The logo is the official mark
`ui/public/openbot-logo.png`. There is no center open-browser button and no dock
tray: the three glyphs sit on the wallpaper. Each glyph is its own click window
(button press and release both launch, so an Openbox Focus/Raise grab on
ButtonPress still activates the icon). The folder glyph is dark gold so it
stays visible on `#e7e7eb`. The Chrome dock icon loads
`file:///usr/local/share/openbot/desktop/index.html` (OpenBot 云电脑).
The files icon opens Thunar at the sandbox home (`thunar <absolute path>`, with `xdg-open` only if Thunar is missing), and the terminal icon opens xterm.
None of that is in a running container until the image is rebuilt and the
browser container is recreated:

```bash
./scripts/sandbox-browser-setup.sh
docker image inspect openbot-sandbox-browser:bookworm-slim
# temporary alias of the same browser image
docker image inspect openclaw-sandbox-browser:bookworm-slim
```

Account Computer Files lists the container home and desktop logs under `/tmp`.
Those names are OpenBot branding (`openbot-home`, `openbot-desktop.log`,
`openbot-openbox.log`), written by `scripts/sandbox-browser-entrypoint.sh`.
The in-container binaries are `/usr/local/bin/openbot-sandbox-browser` and
`/usr/local/bin/openbot-sandbox-desktop`. Both COPY lines are the image tip:
`scripts/sandbox-browser-setup.sh` rebuilds that tip and reuses the apt layer.
A container started from an older tip still shows `openclaw-*` until it is
recreated. That rebuild is not a production cutover.

## Gateway image client

`OPENBOT_ACCOUNT_WORKER_DOCKER=1` creates sibling containers. The gateway
process needs either:

1. the `docker` command on `PATH` (`docker build --build-arg OPENCLAW_INSTALL_DOCKER_CLI=1`,
   or `OPENBOT_DOCKER_BIN` / `OPENCLAW_DOCKER_BIN`), or
2. a mounted engine socket (`/var/run/docker.sock`, `/run/docker.sock`,
   `/run/podman/podman.sock`, `/var/run/podman/podman.sock`, or `DOCKER_HOST=unix://...`).

The CLI is preferred (`OPENBOT_DOCKER_BIN` / `OPENCLAW_DOCKER_BIN`, then
`docker` on PATH). If the CLI is missing and a socket is mounted, account
worker create/start/stop/rm/inspect/ps/port, plus `image inspect` and `tag`
for the openbot/openclaw alias, use the Engine API on that socket (Podman
speaks the same API). A verb the client does not implement returns stderr and
a non-zero code when the caller passed `allowFailure`, and is logged; it does
not abort the turn by throwing past that contract. `docker exec` (sandbox
filesystem bridge) is still the CLI. If both the CLI and a socket are absent, the turn does
not die as an empty collaboration reply: the cloud computer shows the failure,
and exec continues on the gateway host without creating sandbox containers.
A socket that is mounted but refuses the connection (permission, daemon down)
stays an error and does not run on the host. Rebuild the gateway image with
`OPENCLAW_INSTALL_DOCKER_CLI=1` to put the CLI back.
`docker-setup.sh` sets that build arg when `OPENBOT_ACCOUNT_WORKER_DOCKER` or
`OPENBOT_SANDBOX` is on.

`OPENBOT_ACCOUNT_WORKER` and `OPENBOT_ACCOUNT_WORKER_DOCKER` default ON when unset (P6b); set `0` to opt out.
Do not treat this image rebuild alone as a signed live cutover. Opt out of the dock with
`OPENBOT_BROWSER_DESKTOP=0` (headed Chromium on `about:blank` again).

Local accept, after the gateway is on this change and the image is rebuilt:

1. Open the account computer preview. The stage should be the light wallpaper, the OpenBot logo, and the three icons on the wallpaper, with no white dock tray, no center open-browser button, no black letterbox, and no noVNC control bar or connection banner. The folder icon is dark gold, not a near-white tile.
2. The Chrome dock icon opens a browser window on the local OpenBot 云电脑 page. The files icon opens the container home folder. The terminal icon opens a terminal window.
3. Pointer and keys still require 接管. Hand-back returns the stream to view-only.
4. `streamUrl` stays a same-origin `/sandbox/novnc?token=` URL. The page must not contain the VNC password, `127.0.0.1`, or the container port.

## Acceptance commands

```bash
# Mocked + image-resolution (no daemon required)
pnpm exec vitest run src/agents/sandbox/account-worker-driver.test.ts \
  src/agents/sandbox/account-worker.test.ts \
  src/agents/sandbox/account-worker-lifecycle.test.ts \
  src/agents/sandbox/runtime-controller.test.ts

# Gated real-daemon e2e (prefers local real images when present)
# Vitest isolates HOME; Docker Desktop may need DOCKER_HOST, e.g.
#   export DOCKER_HOST="unix://${HOME}/.docker/run/docker.sock"
# When E2E=1 the suite auto-detects that sock if unset, or fails loud if the
# daemon is unreachable (no soft-pass). See account-worker-driver.test.ts.
OPENBOT_ACCOUNT_WORKER_DOCKER_E2E=1 pnpm exec vitest run \
  src/agents/sandbox/account-worker-driver.test.ts
```

Cutover checklist (P6a): `docs/design/account-computer-p6a-production-cutover-checklist-2026-10-17.md`.

This is **not** full production cutover until real-image e2e PASSes with the
account lifecycle (cold/warm/idle/crash + CDP) against the real browser image
in a managed-enterprise path with flags still reviewed for default-off.
