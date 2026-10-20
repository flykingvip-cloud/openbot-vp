---
summary: "Uninstall OpenBot completely (CLI, service, state, workspace)"
read_when:
  - You want to remove OpenBot from a machine
  - The gateway service is still running after uninstall
title: "Uninstall"
---

# Uninstall

Two paths:

- **Easy path** if `openbot` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
openbot uninstall
```

Non-interactive (automation / npx):

```bash
openbot uninstall --all --yes --non-interactive
npx -y openbot uninstall --all --yes --non-interactive
```

Manual steps (same result):

1. Stop the gateway service:

```bash
openbot gateway stop
```

2. Uninstall the gateway service (launchd/systemd/schtasks):

```bash
openbot gateway uninstall
```

3. Delete state + config:

```bash
rm -rf "${OPENBOT_STATE_DIR:-$HOME/.openbot}"
```

If you set `OPENBOT_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4. Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/.openbot/workspace
```

5. Remove the CLI install (pick the one you used):

```bash
npm rm -g openbot
pnpm remove -g openbot
bun remove -g openbot
```

6. If you installed the macOS app:

```bash
rm -rf /Applications/OpenBot.app
```

Notes:

- If you used profiles (`--profile` / `OPENBOT_PROFILE`), repeat step 3 for each state dir (defaults are `~/.openbot-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `openbot` is missing.

### macOS (launchd)

Default label is `ai.openbot.gateway` (or `ai.openbot.<profile>`; legacy `ai.openbot.*` and `com.openbot.*` may still exist):

```bash
launchctl bootout gui/$UID/ai.openbot.gateway
rm -f ~/Library/LaunchAgents/ai.openbot.gateway.plist
```

If you used a profile, replace the label and plist name with `ai.openbot.<profile>`. Remove any legacy `ai.openbot.*` or `com.openbot.*` plists if present.

### Linux (systemd user unit)

Default unit name is `openbot-gateway.service` (or `openbot-gateway-<profile>.service`):

```bash
systemctl --user disable --now openbot-gateway.service
rm -f ~/.config/systemd/user/openbot-gateway.service
systemctl --user daemon-reload
```

### Windows (Scheduled Task)

Default task name is `OpenBot Gateway` (or `OpenBot Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "OpenBot Gateway"
Remove-Item -Force "$env:USERPROFILE\.openbot\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.openbot-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (install.sh / npm / pnpm / bun)

If you used `https://<install-host>/install.sh` or `install.ps1`, the CLI was installed with `npm install -g openbot@latest`.
Remove it with `npm rm -g openbot` (or `pnpm remove -g` / `bun remove -g` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `openbot ...` / `bun run openbot ...`):

1. Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2. Delete the repo directory.
3. Remove state + workspace as shown above.
