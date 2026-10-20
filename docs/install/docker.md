---
summary: "Optional Docker-based setup and onboarding for OpenBot"
read_when:
  - You want a containerized gateway instead of local installs
  - You are validating the Docker flow
title: "Docker"
---

# Docker (optional)

Docker is **optional**. Use it only if you want a containerized gateway or to validate the Docker flow.

## Is Docker right for me?

- **Yes**: you want an isolated, throwaway gateway environment or to run OpenBot on a host without local installs.
- **No**: you’re running on your own machine and just want the fastest dev loop. Use the normal install flow instead.
- **Sandboxing note**: agent sandboxing uses Docker too, but it does **not** require the full gateway to run in Docker. See [Sandboxing](/gateway/sandboxing).

This guide covers:

- Containerized Gateway (full OpenBot in Docker)
- Per-session Agent Sandbox (host gateway + Docker-isolated agent tools)

Sandboxing details: [Sandboxing](/gateway/sandboxing)

## Requirements

- Docker Desktop (or Docker Engine) + Docker Compose v2
- At least 2 GB RAM for image build (`pnpm install` may be OOM-killed on 1 GB hosts with exit 137)
- Enough disk for images + logs
- If running on a VPS/public host, review
  [Security hardening for network exposure](/gateway/security#04-network-exposure-bind--port--firewall),
  especially Docker `DOCKER-USER` firewall policy.

## Containerized Gateway (Docker Compose)

### Quick start (recommended)

<Note>
Docker defaults here assume bind modes (`lan`/`loopback`), not host aliases. Use bind
mode values in `gateway.bind` (for example `lan` or `loopback`), not host aliases like
`0.0.0.0` or `localhost`.
</Note>

From repo root:

```bash
./docker-setup.sh
```

This script:

- builds the gateway image locally (or pulls a remote image if `OPENBOT_IMAGE` is set)
- runs the onboarding wizard
- prints optional provider setup hints
- starts the gateway via Docker Compose
- generates a gateway token and writes it to `.env`

Optional env vars:

- `OPENBOT_IMAGE` — use a remote image instead of building locally (e.g. `ghcr.io/gmood2008/openbot:latest`)
- `OPENBOT_DOCKER_APT_PACKAGES` — install extra apt packages during build
- `OPENBOT_EXTENSIONS` — pre-install additional extension dependencies at build time (space-separated extension names). `diagnostics-otel` and `matrix` are already installed from the lockfile in every image.
- `OPENBOT_EXTRA_MOUNTS` — add extra host bind mounts
- `OPENBOT_HOME_VOLUME` — persist `/home/node` in a named volume
- `OPENBOT_SANDBOX` — opt in to Docker gateway sandbox bootstrap. Only explicit truthy values enable it: `1`, `true`, `yes`, `on`
- `OPENBOT_INSTALL_DOCKER_CLI` / `OPENCLAW_INSTALL_DOCKER_CLI` — build arg for Docker CLI in the image (Dockerfile defaults to `1` so multitenant sandbox does not hit `spawn docker ENOENT`; pass empty to opt out). Alias `OPENBOT_INSTALL_DOCKER_CLI` is accepted by `docker-setup.sh`. `docker-setup.sh` sets this automatically when `OPENBOT_SANDBOX=1` or `OPENBOT_ACCOUNT_WORKER_DOCKER=1` for local builds. A gateway image that mounts `docker.sock` or `podman.sock` without the CLI can still start account-worker containers over the engine socket. That client implements create, start, stop, rm, inspect, ps, port, `image inspect`, and `tag`. It does not replace `docker exec`. Host exec is only used when both the CLI and a socket are absent. A mounted socket that cannot be reached stays a visible error and does not run the turn on the gateway host. The cloud computer shows that failure instead of a blank pane.
- `OPENBOT_DOCKER_SOCKET` — override Docker socket path (default: `DOCKER_HOST=unix://...` path, else `/var/run/docker.sock`)
- `OPENBOT_ALLOW_INSECURE_PRIVATE_WS=1` — break-glass: allow trusted private-network
  `ws://` targets for CLI/onboarding client paths (default is loopback-only)
- `OPENBOT_BROWSER_DISABLE_GRAPHICS_FLAGS=0` — disable container browser hardening flags
  `--disable-3d-apis`, `--disable-software-rasterizer`, `--disable-gpu` when you need
  WebGL/3D compatibility.
- `OPENBOT_BROWSER_DISABLE_EXTENSIONS=0` — keep extensions enabled when browser
  flows require them (default keeps extensions disabled in sandbox browser).
- `OPENBOT_BROWSER_RENDERER_PROCESS_LIMIT=<N>` — set Chromium renderer process
  limit; set to `0` to skip the flag and use Chromium default behavior.

After it finishes:

- Open `http://127.0.0.1:18789/` in your browser.
- Paste the token into the Control UI (Settings → token).
- Need the URL again? Run `docker compose run --rm openbot-cli dashboard --no-open`.

### Enable agent sandbox for Docker gateway (opt-in)

`docker-setup.sh` can also bootstrap `agents.defaults.sandbox.*` for Docker
deployments.

Enable with:

```bash
export OPENBOT_SANDBOX=1
./docker-setup.sh
```

Custom socket path (for example rootless Docker):

```bash
export OPENBOT_SANDBOX=1
export OPENBOT_DOCKER_SOCKET=/run/user/1000/docker.sock
./docker-setup.sh
```

Notes:

- The script mounts `docker.sock` only after sandbox prerequisites pass.
- If sandbox setup cannot be completed, the script resets
  `agents.defaults.sandbox.mode` to `off` to avoid stale/broken sandbox config
  on reruns.
- If `Dockerfile.sandbox` is missing, the script prints a warning and continues;
  build `openbot-sandbox:bookworm-slim` with `scripts/sandbox-setup.sh` if
  needed.
- For non-local `OPENBOT_IMAGE` values, the image must already contain Docker
  CLI support for sandbox execution.

### Automation/CI (non-interactive, no TTY noise)

For scripts and CI, disable Compose pseudo-TTY allocation with `-T`:

```bash
docker compose run -T --rm openbot-cli gateway probe
docker compose run -T --rm openbot-cli devices list --json
```

If your automation exports no Claude session vars, leaving them unset now resolves to
empty values by default in `docker-compose.yml` to avoid repeated "variable is not set"
warnings.

### Shared-network security note (CLI + gateway)

`openbot-cli` uses `network_mode: "service:openbot-gateway"` so CLI commands can
reliably reach the gateway over `127.0.0.1` in Docker.

Treat this as a shared trust boundary: loopback binding is not isolation between these two
containers. If you need stronger separation, run commands from a separate container/host
network path instead of the bundled `openbot-cli` service.

To reduce impact if the CLI process is compromised, the compose config drops
`NET_RAW`/`NET_ADMIN` and enables `no-new-privileges` on `openbot-cli`.

It writes config/workspace on the host:

- `~/.openbot/`
- `~/.openbot/workspace`

Running on a VPS? See [Hetzner (Docker VPS)](/install/hetzner).

### Use a remote image (skip local build)

Official pre-built images are published at:

- [GitHub Container Registry package](https://github.com/gmood2008/openbot/pkgs/container/openclaw)

Use image name `ghcr.io/gmood2008/openbot` (not similarly named Docker Hub
images).

Common tags:

- `main` — latest build from `main`
- `<version>` — release tag builds (for example `2026.2.26`)
- `latest` — latest stable release tag

### Base image metadata

The main Docker image currently uses:

- `node:22-bookworm`

The docker image now publishes OCI base-image annotations (sha256 is an example,
and points at the pinned multi-arch manifest list for that tag):

- `org.opencontainers.image.base.name=docker.io/library/node:22-bookworm`
- `org.opencontainers.image.base.digest=sha256:b501c082306a4f528bc4038cbf2fbb58095d583d0419a259b2114b5ac53d12e9`
- `org.opencontainers.image.source=https://github.com/gmood2008/openbot`
- `org.opencontainers.image.url=https://<product-host>`
- `org.opencontainers.image.documentation=https://<docs-host>/install/docker`
- `org.opencontainers.image.licenses=MIT`
- `org.opencontainers.image.title=OpenBot`
- `org.opencontainers.image.description=OpenBot gateway and CLI runtime container image`
- `org.opencontainers.image.revision=<git-sha>`
- `org.opencontainers.image.version=<tag-or-main>`
- `org.opencontainers.image.created=<rfc3339 timestamp>`

Reference: [OCI image annotations](https://github.com/opencontainers/image-spec/blob/main/annotations.md)

Release context: this repository's tagged history already uses Bookworm in
`v2026.2.22` and earlier 2026 tags (for example `v2026.2.21`, `v2026.2.9`).

By default the setup script builds the image from source. To pull a pre-built
image instead, set `OPENBOT_IMAGE` before running the script:

```bash
export OPENBOT_IMAGE="ghcr.io/gmood2008/openbot:latest"
./docker-setup.sh
```

The script detects that `OPENBOT_IMAGE` is not the default `openclaw:local` and
runs `docker pull` instead of `docker build`. Everything else (onboarding,
gateway start, token generation) works the same way.

`docker-setup.sh` still runs from the repository root because it uses the local
`docker-compose.yml` and helper files. `OPENBOT_IMAGE` skips local image build
time; it does not replace the compose/setup workflow.

### Shell Helpers (optional)

For easier day-to-day Docker management, install `ClawDock`:

```bash
mkdir -p ~/.clawdock && curl -sL https://raw.githubusercontent.com/gmood2008/openbot/main/scripts/shell-helpers/clawdock-helpers.sh -o ~/.clawdock/clawdock-helpers.sh
```

**Add to your shell config (zsh):**

```bash
echo 'source ~/.clawdock/clawdock-helpers.sh' >> ~/.zshrc && source ~/.zshrc
```

Then use `clawdock-start`, `clawdock-stop`, `clawdock-dashboard`, etc. Run `clawdock-help` for all commands.

See [`ClawDock` Helper README](https://github.com/gmood2008/openbot/blob/main/scripts/shell-helpers/README.md) for details.

### Manual flow (compose)

```bash
docker build -t openclaw:local -f Dockerfile .
docker compose run --rm openbot-cli onboard
docker compose up -d openbot-gateway
```

Note: run `docker compose ...` from the repo root. If you enabled
`OPENBOT_EXTRA_MOUNTS` or `OPENBOT_HOME_VOLUME`, the setup script writes
`docker-compose.extra.yml`; include it when running Compose elsewhere:

```bash
docker compose -f docker-compose.yml -f docker-compose.extra.yml <command>
```

### Control UI token + pairing (Docker)

If you see “unauthorized” or “disconnected (1008): pairing required”, fetch a
fresh dashboard link and approve the browser device:

```bash
docker compose run --rm openbot-cli dashboard --no-open
docker compose run --rm openbot-cli devices list
docker compose run --rm openbot-cli devices approve <requestId>
```

More detail: [Dashboard](/web/dashboard), [Devices](/cli/devices).

### Extra mounts (optional)

If you want to mount additional host directories into the containers, set
`OPENBOT_EXTRA_MOUNTS` before running `docker-setup.sh`. This accepts a
comma-separated list of Docker bind mounts and applies them to both
`openbot-gateway` and `openbot-cli` by generating `docker-compose.extra.yml`.

Example:

```bash
export OPENBOT_EXTRA_MOUNTS="$HOME/.codex:/home/node/.codex:ro,$HOME/github:/home/node/github:rw"
./docker-setup.sh
```

Notes:

- Paths must be shared with Docker Desktop on macOS/Windows.
- Each entry must be `source:target[:options]` with no spaces, tabs, or newlines.
- If you edit `OPENBOT_EXTRA_MOUNTS`, rerun `docker-setup.sh` to regenerate the
  extra compose file.
- `docker-compose.extra.yml` is generated. Don’t hand-edit it.

### Persist the entire container home (optional)

If you want `/home/node` to persist across container recreation, set a named
volume via `OPENBOT_HOME_VOLUME`. This creates a Docker volume and mounts it at
`/home/node`, while keeping the standard config/workspace bind mounts. Use a
named volume here (not a bind path); for bind mounts, use
`OPENBOT_EXTRA_MOUNTS`.

Example:

```bash
export OPENBOT_HOME_VOLUME="openclaw_home"
./docker-setup.sh
```

You can combine this with extra mounts:

```bash
export OPENBOT_HOME_VOLUME="openclaw_home"
export OPENBOT_EXTRA_MOUNTS="$HOME/.codex:/home/node/.codex:ro,$HOME/github:/home/node/github:rw"
./docker-setup.sh
```

Notes:

- Named volumes must match `^[A-Za-z0-9][A-Za-z0-9_.-]*$`.
- If you change `OPENBOT_HOME_VOLUME`, rerun `docker-setup.sh` to regenerate the
  extra compose file.
- The named volume persists until removed with `docker volume rm <name>`.

### Install extra apt packages (optional)

If you need system packages inside the image (for example, build tools or media
libraries), set `OPENBOT_DOCKER_APT_PACKAGES` before running `docker-setup.sh`.
This installs the packages during the image build, so they persist even if the
container is deleted.

Example:

```bash
export OPENBOT_DOCKER_APT_PACKAGES="ffmpeg build-essential"
./docker-setup.sh
```

Notes:

- This accepts a space-separated list of apt package names.
- If you change `OPENBOT_DOCKER_APT_PACKAGES`, rerun `docker-setup.sh` to rebuild
  the image.

### Pre-install extension dependencies

`diagnostics-otel` and `matrix` are installed from `pnpm-lock.yaml` in every
image, including `docker build .` with no extension build-arg. Their runtime
packages are the same versions typecheck resolves.

Other extensions with their own `package.json` (for example `msteams`) install
their npm dependencies on first load. To bake those dependencies into the image
instead, set `OPENBOT_EXTENSIONS` before running `docker-setup.sh`:

```bash
export OPENBOT_EXTENSIONS="diagnostics-otel matrix"
./docker-setup.sh
```

Or when building directly:

```bash
docker build --build-arg OPENBOT_EXTENSIONS="diagnostics-otel matrix" .
```

Notes:

- This accepts a space-separated list of extension directory names (under `extensions/`).
- Only extensions with a `package.json` are affected; lightweight plugins without one are ignored.
- If you change `OPENBOT_EXTENSIONS`, rerun `docker-setup.sh` to rebuild
  the image.

### Build surface and base image variant

`OPENCLAW_VARIANT` chooses the Debian base image. It is orthogonal to the
Control UI surface. The only shipping surface is SaaS `full`: Gateway plus
the employee, enterprise, platform, and diagnosis ports. `OPENBOT_SURFACE`
records that surface. Leave it unset or set `OPENBOT_SURFACE=full`. Any other
value fails the image build and `pnpm ui:build`. There is no second shell.

| OPENCLAW_VARIANT    | Base image              | Bundled UI ports                          |
| ------------------- | ----------------------- | ----------------------------------------- |
| `default` (default) | `node:22-bookworm`      | employee, enterprise, platform, diagnosis |
| `slim`              | `node:22-bookworm-slim` | employee, enterprise, platform, diagnosis |

```bash
docker build .
docker build --build-arg OPENCLAW_VARIANT=default .
docker build --build-arg OPENCLAW_VARIANT=slim .
```

The runtime image records `OPENBOT_SURFACE=full` and the OCI label
`openbot.surface`.

### Power-user / full-featured container (opt-in)

The default Docker image is **security-first** and runs as the non-root `node`
user. This keeps the attack surface small, but it means:

- no system package installs at runtime
- no Homebrew by default
- no bundled Chromium/Playwright browsers

If you want a more full-featured container, use these opt-in knobs:

1. **Persist `/home/node`** so browser downloads and tool caches survive:

```bash
export OPENBOT_HOME_VOLUME="openclaw_home"
./docker-setup.sh
```

2. **Bake system deps into the image** (repeatable + persistent):

```bash
export OPENBOT_DOCKER_APT_PACKAGES="git curl jq"
./docker-setup.sh
```

3. **Install Playwright browsers without `npx`** (avoids npm override conflicts):

```bash
docker compose run --rm openbot-cli \
  node /app/node_modules/playwright-core/cli.js install chromium
```

If you need Playwright to install system deps, rebuild the image with
`OPENBOT_DOCKER_APT_PACKAGES` instead of using `--with-deps` at runtime.

4. **Persist Playwright browser downloads**:

- Set `PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright` in
  `docker-compose.yml`.
- Ensure `/home/node` persists via `OPENBOT_HOME_VOLUME`, or mount
  `/home/node/.cache/ms-playwright` via `OPENBOT_EXTRA_MOUNTS`.

### Permissions + EACCES

The image runs as `node` (uid 1000). If you see permission errors on
`/home/node/.openclaw`, make sure your host bind mounts are owned by uid 1000.

Example (Linux host):

```bash
sudo chown -R 1000:1000 /path/to/openclaw-config /path/to/openclaw-workspace
```

If you choose to run as root for convenience, you accept the security tradeoff.

### Faster rebuilds (recommended)

To speed up rebuilds, order your Dockerfile so dependency layers are cached.
This avoids re-running `pnpm install` unless lockfiles change:

```dockerfile
FROM node:22-bookworm

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

# Cache dependencies unless package metadata changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
RUN pnpm ui:install
RUN pnpm ui:build

ENV NODE_ENV=production

CMD ["node","dist/index.js"]
```

### Channel setup (optional)

Use the CLI container to configure channels, then restart the gateway if needed.

WhatsApp (QR):

```bash
docker compose run --rm openbot-cli channels login
```

Telegram (bot token):

```bash
docker compose run --rm openbot-cli channels add --channel telegram --token "<token>"
```

Discord (bot token):

```bash
docker compose run --rm openbot-cli channels add --channel discord --token "<token>"
```

Docs: [WhatsApp](/channels/whatsapp), [Telegram](/channels/telegram), [Discord](/channels/discord)

### OpenAI Codex OAuth (headless Docker)

If you pick OpenAI Codex OAuth in the wizard, it opens a browser URL and tries
to capture a callback on `http://127.0.0.1:1455/auth/callback`. In Docker or
headless setups that callback can show a browser error. Copy the full redirect
URL you land on and paste it back into the wizard to finish auth.

### Health checks

Container probe endpoints (no auth required):

```bash
curl -fsS http://127.0.0.1:18789/healthz
curl -fsS http://127.0.0.1:18789/readyz
```

Aliases: `/health` and `/ready`.

`/healthz` is a shallow liveness probe for "the gateway process is up".
`/readyz` stays ready during startup grace, then becomes `503` only if required
managed channels are still disconnected after grace or disconnect later.

The Docker image includes a built-in `HEALTHCHECK` that pings `/healthz` in the
background. In plain terms: Docker keeps checking if OpenBot is still
responsive. If checks keep failing, Docker marks the container as `unhealthy`,
and orchestration systems (Docker Compose restart policy, Swarm, Kubernetes,
etc.) can automatically restart or replace it.

Authenticated deep health snapshot (gateway + channels):

```bash
docker compose exec openbot-gateway node dist/index.js health --token "$OPENBOT_GATEWAY_TOKEN"
```

### E2E smoke test (Docker)

```bash
scripts/e2e/onboard-docker.sh
```

### QR import smoke test (Docker)

```bash
pnpm test:docker:qr
```

### LAN vs loopback (Docker Compose)

`docker-setup.sh` defaults `OPENBOT_GATEWAY_BIND=lan` so host access to
`http://127.0.0.1:18789` works with Docker port publishing.

- `lan` (default): host browser + host CLI can reach the published gateway port.
- `loopback`: only processes inside the container network namespace can reach
  the gateway directly; host-published port access may fail.

The setup script also pins `gateway.mode=local` after onboarding so Docker CLI
commands default to local loopback targeting.

Legacy config note: use bind mode values in `gateway.bind` (`lan` / `loopback` /
`custom` / `tailnet` / `auto`), not host aliases (`0.0.0.0`, `127.0.0.1`,
`localhost`, `::`, `::1`).

If you see `Gateway target: ws://172.x.x.x:18789` or repeated `pairing required`
errors from Docker CLI commands, run:

```bash
docker compose run --rm openbot-cli config set gateway.mode local
docker compose run --rm openbot-cli config set gateway.bind lan
docker compose run --rm openbot-cli devices list --url ws://127.0.0.1:18789
```

### Notes

- Gateway bind defaults to `lan` for container use (`OPENBOT_GATEWAY_BIND`).
- **Production image CMD does not pass `--allow-unconfigured`.** The process requires a real config with `gateway.mode=local` (see `./docker-setup.sh` for first-time local setup, or `deploy/production/` for prod templates). Dev/e2e scripts may still pass `--allow-unconfigured` explicitly.
- The gateway container is the source of truth for sessions (`~/.openbot/agents/<agentId>/sessions/`).

### Storage model

- **Persistent host data:** Docker Compose bind-mounts `OPENBOT_CONFIG_DIR` to `/home/node/.openclaw` and `OPENBOT_WORKSPACE_DIR` to `/home/node/.openbot/workspace`, so those paths survive container replacement.
- **Ephemeral sandbox tmpfs:** when `agents.defaults.sandbox` is enabled, the sandbox containers use `tmpfs` for `/tmp`, `/var/tmp`, and `/run`. Those mounts are separate from the top-level Compose stack and disappear with the sandbox container.
- **Disk growth hotspots:** watch `media/`, `agents/<agentId>/sessions/sessions.json`, transcript JSONL files, `cron/runs/*.jsonl`, and rolling file logs under `/tmp/openclaw/` (or your configured `logging.file`). If you also run the macOS app outside Docker, its service logs are separate again: `~/.openbot/logs/gateway.log`, `~/.openbot/logs/gateway.err.log`, and `/tmp/gmood2008/openbot-gateway.log`.

## Agent Sandbox (host gateway + Docker tools)

Deep dive: [Sandboxing](/gateway/sandboxing)

### What it does

When `agents.defaults.sandbox` is enabled, **non-main sessions** run tools inside a Docker
container. The gateway stays on your host, but the tool execution is isolated:

- scope: `"agent"` by default (one container + workspace per agent)
- scope: `"session"` for per-session isolation
- per-scope workspace folder mounted at `/workspace`
- optional agent workspace access (`agents.defaults.sandbox.workspaceAccess`)
- allow/deny tool policy (deny wins)
- inbound media is copied into the active sandbox workspace (`media/inbound/*`) so tools can read it (with `workspaceAccess: "rw"`, this lands in the agent workspace)

Warning: `scope: "shared"` disables cross-session isolation. All sessions share
one container and one workspace.

### Per-agent sandbox profiles (multi-agent)

If you use multi-agent routing, each agent can override sandbox + tool settings:
`agents.list[].sandbox` and `agents.list[].tools` (plus `agents.list[].tools.sandbox.tools`). This lets you run
mixed access levels in one gateway:

- Full access (personal agent)
- Read-only tools + read-only workspace (family/work agent)
- No filesystem/shell tools (public agent)

See [Multi-Agent Sandbox & Tools](/tools/multi-agent-sandbox-tools) for examples,
precedence, and troubleshooting.

### Default behavior

- Image: `openbot-sandbox:bookworm-slim`
- One container per agent
- Agent workspace access: `workspaceAccess: "none"` (default) uses `~/.openbot/sandboxes`
  - `"ro"` keeps the sandbox workspace at `/workspace` and mounts the agent workspace read-only at `/agent` (disables `write`/`edit`/`apply_patch`)
  - `"rw"` mounts the agent workspace read/write at `/workspace`
- Auto-prune: idle > 24h OR age > 7d
- Network: `none` by default (explicitly opt-in if you need egress)
  - `host` is blocked.
  - `container:<id>` is blocked by default (namespace-join risk).
- Default allow: `exec`, `process`, `read`, `write`, `edit`, `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `session_status`
- Default deny: `browser`, `canvas`, `nodes`, `cron`, `discord`, `gateway`

### Enable sandboxing

If you plan to install packages in `setupCommand`, note:

- Default `docker.network` is `"none"` (no egress).
- `docker.network: "host"` is blocked.
- `docker.network: "container:<id>"` is blocked by default.
- Break-glass override: `agents.defaults.sandbox.docker.dangerouslyAllowContainerNamespaceJoin: true`.
- `readOnlyRoot: true` blocks package installs.
- `user` must be root for `apt-get` (omit `user` or set `user: "0:0"`).
  OpenBot auto-recreates containers when `setupCommand` (or docker config) changes
  unless the container was **recently used** (within ~5 minutes). Hot containers
  log a warning with the exact `openbot sandbox recreate ...` command.

```json5
{
  agents: {
    defaults: {
      sandbox: {
        mode: "non-main", // off | non-main | all
        scope: "agent", // session | agent | shared (agent is default)
        workspaceAccess: "none", // none | ro | rw
        workspaceRoot: "~/.openbot/sandboxes",
        docker: {
          image: "openbot-sandbox:bookworm-slim",
          workdir: "/workspace",
          readOnlyRoot: true,
          tmpfs: ["/tmp", "/var/tmp", "/run"],
          network: "none",
          user: "1000:1000",
          capDrop: ["ALL"],
          env: { LANG: "C.UTF-8" },
          setupCommand: "apt-get update && apt-get install -y git curl jq",
          pidsLimit: 256,
          memory: "1g",
          memorySwap: "2g",
          cpus: 1,
          ulimits: {
            nofile: { soft: 1024, hard: 2048 },
            nproc: 256,
          },
          seccompProfile: "/path/to/seccomp.json",
          apparmorProfile: "openbot-sandbox",
          dns: ["1.1.1.1", "8.8.8.8"],
          extraHosts: ["internal.service:10.0.0.5"],
        },
        prune: {
          idleHours: 24, // 0 disables idle pruning
          maxAgeDays: 7, // 0 disables max-age pruning
        },
      },
    },
  },
  tools: {
    sandbox: {
      tools: {
        allow: [
          "exec",
          "process",
          "read",
          "write",
          "edit",
          "sessions_list",
          "sessions_history",
          "sessions_send",
          "sessions_spawn",
          "session_status",
        ],
        deny: ["browser", "canvas", "nodes", "cron", "discord", "gateway"],
      },
    },
  },
}
```

Hardening knobs live under `agents.defaults.sandbox.docker`:
`network`, `user`, `pidsLimit`, `memory`, `memorySwap`, `cpus`, `ulimits`,
`seccompProfile`, `apparmorProfile`, `dns`, `extraHosts`,
`dangerouslyAllowContainerNamespaceJoin` (break-glass only).

Multi-agent: override `agents.defaults.sandbox.{docker,browser,prune}.*` per agent via `agents.list[].sandbox.{docker,browser,prune}.*`
(ignored when `agents.defaults.sandbox.scope` / `agents.list[].sandbox.scope` is `"shared"`).

### Build the default sandbox image

```bash
scripts/sandbox-setup.sh
```

This builds `openbot-sandbox:bookworm-slim` using `Dockerfile.sandbox`.
The same build tags `openclaw-sandbox:bookworm-slim` as a temporary alias, so a
config or host that still names the previous image keeps resolving. A machine
that already has only the alias is retagged to the canonical name instead of
failing the next sandbox start.

### Sandbox common image (optional)

If you want a sandbox image with common build tooling (Node, Go, Rust, etc.), build the common image:

```bash
scripts/sandbox-common-setup.sh
```

This builds `openbot-sandbox-common:bookworm-slim`. To use it:

```json5
{
  agents: {
    defaults: {
      sandbox: { docker: { image: "openbot-sandbox-common:bookworm-slim" } },
    },
  },
}
```

### Sandbox browser image

To run the browser tool inside the sandbox, build the browser image:

```bash
scripts/sandbox-browser-setup.sh
docker image inspect openbot-sandbox-browser:bookworm-slim
```

This builds `openbot-sandbox-browser:bookworm-slim` using
`Dockerfile.sandbox-browser`. The same build tags
`openclaw-sandbox-browser:bookworm-slim` as a temporary alias, so a config or
host that still names the previous browser image keeps resolving. A machine
that already has only the alias is retagged to the canonical name. Unlike the
exec image, a host with neither tag does not fall back to `debian:bookworm-slim`.
The container runs Chromium with CDP enabled and
an optional noVNC observer (headful via Xvfb). Headed containers also start a
minimal dock desktop (light wallpaper, OpenBot logo, Chrome / files / terminal).
The dock icons launch Chromium, a home-folder window, and a terminal. There is no
center open-browser button. Opening Chrome shows a local OpenBot 云电脑 page
instead of `about:blank`. Rebuild the image locally with `scripts/sandbox-browser-setup.sh`
and recreate the browser container before expecting that desktop. Rebuilding is
not a production cutover, and account-worker flags stay default off.

Notes:

- Headful (Xvfb, 1280×800) reduces bot blocking vs headless.
- Headless can still be used by setting `agents.defaults.sandbox.browser.headless=true`. Headless skips the dock desktop.
- `OPENBOT_BROWSER_DESKTOP=0` keeps the previous single Chromium window on `about:blank`. The default for a headed container is the dock desktop. The Chrome dock icon opens `file:///usr/local/share/openbot/desktop/index.html`. The files icon opens the container home folder (`/tmp/openbot-home`), and the terminal icon opens xterm. Going up to `/tmp` lists `openbot-home`, `openbot-desktop.log`, and `openbot-openbox.log`. Those names are in the image tip (the COPY of `scripts/sandbox-browser-entrypoint.sh`). Recreate the browser container after `scripts/sandbox-browser-setup.sh` or the file list still shows the previous `openclaw-*` names.
- No full desktop environment (GNOME) is installed. Openbox only keeps the wallpaper window below Chromium.
- Control UI previews fit that framebuffer with one scale and paint the spare band in the wallpaper tone (`#e7e7eb`). x11vnc does not accept client resize (`resize=remote`). The observer page does not load the stock noVNC control bar, and the VNC password stays on the relay grant. A CSS or observer change does not require rebuilding the sandbox image.
- Browser containers default to a dedicated Docker network (`openbot-sandbox-browser`) instead of global `bridge`.
- Optional `agents.defaults.sandbox.browser.cdpSourceRange` restricts container-edge CDP ingress by CIDR (for example `172.21.0.1/32`).
- noVNC observer access is password-protected by default. OpenBot serves a short-lived same-origin token URL. The bootstrap page never receives the VNC password; the relay keeps it on the grant.
- Browser container startup defaults are conservative for shared/container workloads, including:
  - `--remote-debugging-address=127.0.0.1`
  - `--remote-debugging-port=<derived from OPENBOT_BROWSER_CDP_PORT>`
  - `--user-data-dir=${HOME}/.chrome`
  - `--no-first-run`
  - `--no-default-browser-check`
  - `--disable-3d-apis`
  - `--disable-software-rasterizer`
  - `--disable-gpu`
  - `--disable-dev-shm-usage`
  - `--disable-background-networking`
  - `--disable-features=TranslateUI`
  - `--disable-breakpad`
  - `--disable-crash-reporter`
  - `--metrics-recording-only`
  - `--renderer-process-limit=2`
  - `--no-zygote`
  - `--disable-extensions`
  - If `agents.defaults.sandbox.browser.noSandbox` is set, `--no-sandbox` and
    `--disable-setuid-sandbox` are also appended.
  - The three graphics hardening flags above are optional. If your workload needs
    WebGL/3D, set `OPENBOT_BROWSER_DISABLE_GRAPHICS_FLAGS=0` to run without
    `--disable-3d-apis`, `--disable-software-rasterizer`, and `--disable-gpu`.
  - Extension behavior is controlled by `--disable-extensions` and can be disabled
    (enables extensions) via `OPENBOT_BROWSER_DISABLE_EXTENSIONS=0` for
    extension-dependent pages or extensions-heavy workflows.
  - `--renderer-process-limit=2` is also configurable with
    `OPENBOT_BROWSER_RENDERER_PROCESS_LIMIT`; set `0` to let Chromium choose its
    default process limit when browser concurrency needs tuning.

Defaults are applied by default in the bundled image. If you need different
Chromium flags, use a custom browser image and provide your own entrypoint.

Use config:

```json5
{
  agents: {
    defaults: {
      sandbox: {
        browser: { enabled: true },
      },
    },
  },
}
```

Custom browser image:

```json5
{
  agents: {
    defaults: {
      sandbox: { browser: { image: "my-openclaw-browser" } },
    },
  },
}
```

When enabled, the agent receives:

- a sandbox browser control URL (for the `browser` tool)
- a noVNC URL (if enabled and headless=false)

Remember: if you use an allowlist for tools, add `browser` (and remove it from
deny) or the tool remains blocked.
Prune rules (`agents.defaults.sandbox.prune`) apply to browser containers too.

### Custom sandbox image

Build your own image and point config to it:

```bash
docker build -t my-openclaw-sbx -f Dockerfile.sandbox .
```

```json5
{
  agents: {
    defaults: {
      sandbox: { docker: { image: "my-openclaw-sbx" } },
    },
  },
}
```

### Tool policy (allow/deny)

- `deny` wins over `allow`.
- If `allow` is empty: all tools (except deny) are available.
- If `allow` is non-empty: only tools in `allow` are available (minus deny).

### Pruning strategy

Two knobs:

- `prune.idleHours`: remove containers not used in X hours (0 = disable)
- `prune.maxAgeDays`: remove containers older than X days (0 = disable)

Example:

- Keep busy sessions but cap lifetime:
  `idleHours: 24`, `maxAgeDays: 7`
- Never prune:
  `idleHours: 0`, `maxAgeDays: 0`

### Security notes

- Hard wall only applies to **tools** (exec/read/write/edit/apply_patch).
- Host-only tools like browser/camera/canvas are blocked by default.
- Allowing `browser` in sandbox **breaks isolation** (browser runs on host).

## Troubleshooting

- Image missing: build with [`scripts/sandbox-setup.sh`](https://github.com/gmood2008/openbot/blob/main/scripts/sandbox-setup.sh) or set `agents.defaults.sandbox.docker.image`.
- Container not running: it will auto-create per session on demand.
- Permission errors in sandbox: set `docker.user` to a UID:GID that matches your
  mounted workspace ownership (or chown the workspace folder).
- Custom tools not found: OpenBot runs commands with `sh -lc` (login shell), which
  sources `/etc/profile` and may reset PATH. Set `docker.env.PATH` to prepend your
  custom tool paths (e.g., `/custom/bin:/usr/local/share/npm-global/bin`), or add
  a script under `/etc/profile.d/` in your Dockerfile.

## Production HA Dual Controller (opt-in)

Stage 5 inventory wiring: the Dual Controller under `deploy/ha/controller/` is
available as an **opt-in** sidecar on the production compose file. It is **not**
started by a plain `docker compose … up -d`.

- Compose: `deploy/production/docker-compose.prod.yml` service `openbot-ha-controller`
- Profile: `ha`
- Image build context: `deploy/ha/controller/Dockerfile`
- Default command: `python -m controller heartbeat-loop` (lease heartbeat only)
- Mode: `HA_CONTROLLER_MODE=manual` (default). Production Auto Failover remains
  **NOT APPROVED**; `mode=auto` is refused by the CLI.

Enable only after CommitSafety SQL is applied and `DATABASE_URL` /
`HA_CONTROLLER_ID` / `HA_FAILURE_DOMAIN` are set (see
`deploy/production/env.production.example`):

```bash
docker compose -f deploy/production/docker-compose.prod.yml \
  --env-file /path/to/.env --profile ha up -d
```

Manual failover stays an explicit operator CLI (`run-once`), not an automatic
compose health action. Full controller docs: `deploy/ha/controller/README.md`.
