# Self-Hosted Runner Configuration

## Current Setup

**Runner Name**: `kiro-temp-runner`  
**Status**: Online  
**Host**: macOS ARM64 (personal laptop)  
**Location**: `/tmp/gh-runner`  
**Start Method**: Manual (`./run.sh` in tmux/terminal session)

## Limitations

⚠️ **Current runner is temporary and has the following limitations:**

1. **Not persistent across reboots** - Runner process must be manually restarted after system restart
2. **Depends on user session** - Stops when user logs out (if not running in background service)
3. **Host availability** - Runs on personal laptop, not guaranteed to be online 24/7
4. **Single runner** - No redundancy; if this runner goes offline, all CI jobs will queue

## Making the Runner Persistent

### Option 1: LaunchAgent (macOS - Recommended for Development)

Create a LaunchAgent plist to auto-start the runner on login:

```bash
cat > ~/Library/LaunchAgents/com.github.actions.runner.openbot.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.github.actions.runner.openbot</string>
    <key>ProgramArguments</key>
    <array>
        <string>/tmp/gh-runner/run.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/gh-runner/runner.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/gh-runner/runner.error.log</string>
    <key>WorkingDirectory</key>
    <string>/tmp/gh-runner</string>
</dict>
</plist>
EOF

# Load the agent
launchctl load ~/Library/LaunchAgents/com.github.actions.runner.openbot.plist

# Verify
launchctl list | grep github.actions.runner
```

**Note**: `/tmp` is cleared on reboot on macOS. For true persistence, move runner to a permanent location first:

```bash
# Move to permanent location
sudo mkdir -p /opt/github-runner
sudo mv /tmp/gh-runner/* /opt/github-runner/
sudo chown -R $(whoami):staff /opt/github-runner

# Update LaunchAgent plist to use /opt/github-runner
# Then load the agent
```

### Option 2: LaunchDaemon (macOS - Production)

For system-level service (runs even when no user is logged in):

```bash
sudo cat > /Library/LaunchDaemons/com.github.actions.runner.openbot.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.github.actions.runner.openbot</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/github-runner/run.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/opt/github-runner/runner.log</string>
    <key>StandardErrorPath</key>
    <string>/opt/github-runner/runner.error.log</string>
    <key>WorkingDirectory</key>
    <string>/opt/github-runner</string>
    <key>UserName</key>
    <string>daniel</string>
</dict>
</plist>
EOF

sudo launchctl load /Library/LaunchDaemons/com.github.actions.runner.openbot.plist
```

### Option 3: Dedicated Always-On Host (Production - Recommended)

For production use, run the runner on a dedicated always-on host:

**Cloud VM Options:**

- DigitalOcean macOS VM (if ARM64 needed)
- AWS EC2 Mac instances (mac2.metal for ARM64)
- Hetzner Cloud (x86_64 Linux alternative)
- GitHub Hosted Runners (if Blacksmith resolves)

**Setup Steps:**

1. Provision VM with required specs (8GB RAM, 4 vCPU minimum for CI workloads)
2. Install Node.js 22+, pnpm, and other dependencies
3. Configure runner with token from: <https://github.com/gmood2008/openbot/settings/actions/runners/new>
4. Set up systemd service (Linux) or launchd service (macOS)
5. Configure monitoring (Datadog, CloudWatch, etc.)
6. Set up log rotation and disk space alerts

## Monitoring

Current runner status can be checked via:

```bash
# GitHub API
gh api /repos/gmood2008/openbot/actions/runners

# Local process
ps aux | grep Runner.Listener

# Recent jobs
gh run list --limit 5
```

## Troubleshooting

### Runner offline after system restart

```bash
# If using LaunchAgent
launchctl list | grep github.actions.runner
launchctl start com.github.actions.runner.openbot

# If running manually
cd /tmp/gh-runner  # or /opt/github-runner
./run.sh
```

### Runner stuck in "offline" state

```bash
# Remove and re-register
cd /tmp/gh-runner
./config.sh remove --token <REMOVAL_TOKEN>

# Get new token from: https://github.com/gmood2008/openbot/settings/actions/runners/new
./config.sh --url https://github.com/gmood2008/openbot --token <NEW_TOKEN>
./run.sh
```

## CI Workflow Configuration

Workflows using this runner should specify:

```yaml
jobs:
  job-name:
    runs-on: self-hosted
```

Current workflows using self-hosted runner:

- `.github/workflows/ci-gate.yml` (check and delivery guard jobs)
- `.github/workflows/memory-workspace-freeze.yml` (pending merge)

## GitHub Actions Minutes Budget

**Current status**: 3000/3000 used (exhausted)

Self-hosted runners do NOT consume GitHub Actions minutes, which is why they were added.

**Alternative options if migrating back to GitHub-hosted runners:**

1. Increase minutes quota (requires billing permissions)
2. Subscribe to Blacksmith (third-party runner service, not yet configured)
3. Optimize CI to reduce minutes usage (caching, conditional jobs, etc.)

## Security Considerations

⚠️ **Self-hosted runners can execute arbitrary code from PRs**

**Current mitigation:**

- Ruleset `require-pr-on-trunk` requires PR approval before merge
- No bypass actors configured
- Review thread resolution required

**Additional recommendations:**

1. Only use self-hosted runners for trusted repositories
2. Consider ephemeral runners (new VM per job) for production
3. Use webhook validation for PR events
4. Restrict runner to specific workflows if possible (GitHub Enterprise feature)

## References

- [GitHub Self-Hosted Runner Setup](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/adding-self-hosted-runners)
- [macOS LaunchAgents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [GitHub Actions Runner Releases](https://github.com/actions/runner/releases)

---

**Last updated**: 2026-08-15  
**Maintained by**: kiro-loom (repo infrastructure agent)
