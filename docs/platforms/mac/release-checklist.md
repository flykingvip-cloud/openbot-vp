---
summary: "Concise macOS Sparkle release checklist (openbot.love feed, notarization, verification)"
read_when:
  - Cutting or validating an OpenBot macOS release
  - Uploading a Sparkle appcast or zip to openbot.love
title: "macOS Release Checklist"
---

# macOS release checklist

Production Sparkle feed: `https://www.openbot.love/downloads/appcast.xml`.

Download prefix: `https://www.openbot.love/downloads/`.

Repo root `appcast.xml` mirrors that production feed. `raw.githubusercontent.com/gmood2008/openbot/...` is not the acceptance URL.

Current live release: **1.0.4** / build **1502**. Do not publish rc builds to the production appcast without product version sign-off.

Long-form packaging notes: [macOS release](/platforms/mac/release).

## Before you package

- [ ] Developer ID Application cert is installed (`Developer ID Application: <Developer Name> (<TEAMID>)`).
- [ ] Keychain profile `openbot-notary` exists. Pass it as `NOTARYTOOL_PROFILE=openbot-notary`. Create it once from the App Store Connect API env vars; see [macOS release](/platforms/mac/release).
- [ ] `SPARKLE_PRIVATE_KEY_FILE` points at the Sparkle ed25519 private key (usually exported from `~/.profile`).

## Package and appcast

- [ ] Package with notarization:

```bash
NOTARIZE=1 NOTARYTOOL_PROFILE=openbot-notary \
BUNDLE_ID=ai.openbot.mac \
APP_VERSION=<version> \
BUILD_CONFIG=release \
SIGN_IDENTITY="Developer ID Application: <Developer Name> (<TEAMID>)" \
scripts/package-mac-dist.sh
```

- [ ] Generate the feed entry (`SPARKLE_DOWNLOAD_URL_PREFIX` defaults to `https://www.openbot.love/downloads/`):

```bash
SPARKLE_PRIVATE_KEY_FILE=/path/to/ed25519-private-key \
  scripts/make_appcast.sh dist/OpenBot-<version>.zip \
  https://www.openbot.love/downloads/appcast.xml
```

- [ ] Confirm enclosure URLs use the `https://www.openbot.love/downloads/` prefix.
- [ ] Leave rc builds off the production appcast until product signs off the version.

## Upload and verify

- [ ] Upload `OpenBot-<version>.zip` (and the dSYM zip if you ship symbols) to `https://www.openbot.love/downloads/`.
- [ ] Upload `appcast.xml` to `https://www.openbot.love/downloads/appcast.xml`.
- [ ] `curl -fsSL -o /dev/null -w "%{http_code}\n" https://www.openbot.love/downloads/appcast.xml` prints `200`, and the newest item is the signed-off version.
- [ ] `curl -I https://www.openbot.love/downloads/OpenBot-<version>.zip` returns 200.
- [ ] On a previous public build, use Check for Updates in the About tab and confirm the in-app update installs.
