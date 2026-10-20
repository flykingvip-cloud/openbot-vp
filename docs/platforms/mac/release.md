---
summary: "OpenBot macOS release checklist (Sparkle feed, packaging, signing)"
read_when:
  - Cutting or validating a OpenBot macOS release
  - Updating the Sparkle appcast or feed assets
title: "macOS Release"
---

# OpenBot macOS release (Sparkle)

This app now ships Sparkle auto-updates. Release builds must be Developer ID–signed, zipped, and published with a signed appcast entry.

Production Sparkle feed: `https://www.openbot.love/downloads/appcast.xml`. Download prefix: `https://www.openbot.love/downloads/`. Repo root `appcast.xml` mirrors that production feed. Short form: [macOS release checklist](/platforms/mac/release-checklist).

## Prereqs

- Developer ID Application cert installed (example: `Developer ID Application: <Developer Name> (<TEAMID>)`).
- Sparkle private key path set in the environment as `SPARKLE_PRIVATE_KEY_FILE` (path to your Sparkle ed25519 private key; public key baked into Info.plist). If it is missing, check `~/.profile`.
- Notary credentials (keychain profile or API key) for `xcrun notarytool` if you want Gatekeeper-safe DMG/zip distribution.
  - We use a Keychain profile named `openbot-notary`, created from App Store Connect API key env vars in your shell profile:
    - `APP_STORE_CONNECT_API_KEY_P8`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`
    - `echo "$APP_STORE_CONNECT_API_KEY_P8" | sed 's/\\n/\n/g' > /tmp/openbot-notary.p8`
    - `xcrun notarytool store-credentials "openbot-notary" --key /tmp/openbot-notary.p8 --key-id "$APP_STORE_CONNECT_KEY_ID" --issuer "$APP_STORE_CONNECT_ISSUER_ID"`
- `pnpm` deps installed (`pnpm install --config.node-linker=hoisted`).
- Sparkle tools are fetched automatically via SwiftPM at `apps/macos/.build/artifacts/sparkle/Sparkle/bin/` (`sign_update`, `generate_appcast`, etc.).

## Build & package

Notes:

- `APP_BUILD` maps to `CFBundleVersion`/`sparkle:version`; keep it numeric + monotonic (no `-beta`), or Sparkle compares it as equal.
- If `APP_BUILD` is omitted, `scripts/package-mac-app.sh` derives a Sparkle-safe default from `APP_VERSION` (`YYYYMMDDNN`: stable defaults to `90`, prereleases use a suffix-derived lane) and uses the higher of that value and git commit count.
- You can still override `APP_BUILD` explicitly when release engineering needs a specific monotonic value.
- For `BUILD_CONFIG=release`, `scripts/package-mac-app.sh` now defaults to universal (`arm64 x86_64`) automatically. You can still override with `BUILD_ARCHS=arm64` or `BUILD_ARCHS=x86_64`. For local/dev builds (`BUILD_CONFIG=debug`), it defaults to the current architecture (`$(uname -m)`).
- Use `scripts/package-mac-dist.sh` for release artifacts (zip + DMG + notarization). Use `scripts/package-mac-app.sh` for local/dev packaging.

```bash
# From repo root; set release IDs so Sparkle feed is enabled.
# This command builds release artifacts without notarization.
# APP_BUILD must be numeric + monotonic for Sparkle compare.
# Default is auto-derived from APP_VERSION when omitted.
SKIP_NOTARIZE=1 \
BUNDLE_ID=ai.openbot.mac \
APP_VERSION=1.0.0 \
BUILD_CONFIG=release \
SIGN_IDENTITY="Developer ID Application: <Developer Name> (<TEAMID>)" \
scripts/package-mac-dist.sh

# `package-mac-dist.sh` already creates the zip + DMG.
# If you used `package-mac-app.sh` directly instead, create them manually:
# If you want notarization/stapling in this step, use the NOTARIZE command below.
ditto -c -k --sequesterRsrc --keepParent dist/OpenBot.app dist/OpenBot-1.0.0.zip

# Optional: build a styled DMG for humans (drag to /Applications)
scripts/create-dmg.sh dist/OpenBot.app dist/OpenBot-1.0.0.dmg

# Recommended: build + notarize/staple zip + DMG
# First, create a keychain profile once:
#   xcrun notarytool store-credentials "openbot-notary" \
#     --apple-id "<apple-id>" --team-id "<team-id>" --password "<app-specific-password>"
NOTARIZE=1 NOTARYTOOL_PROFILE=openbot-notary \
BUNDLE_ID=ai.openbot.mac \
APP_VERSION=1.0.0 \
BUILD_CONFIG=release \
SIGN_IDENTITY="Developer ID Application: <Developer Name> (<TEAMID>)" \
scripts/package-mac-dist.sh

# Optional: ship dSYM alongside the release
ditto -c -k --keepParent apps/macos/.build/release/OpenBot.app.dSYM dist/OpenBot-1.0.0.dSYM.zip
```

## Appcast entry

Use the release note generator so Sparkle renders formatted HTML notes:

```bash
SPARKLE_PRIVATE_KEY_FILE=/path/to/ed25519-private-key scripts/make_appcast.sh dist/OpenBot-1.0.0.zip https://www.openbot.love/downloads/appcast.xml
```

`scripts/make_appcast.sh` defaults the feed argument to `https://www.openbot.love/downloads/appcast.xml` and the enclosure prefix to `https://www.openbot.love/downloads/` (`SPARKLE_DOWNLOAD_URL_PREFIX`).

Generates HTML release notes from `CHANGELOG.md` (via [`scripts/changelog-to-html.sh`](https://github.com/gmood2008/openbot/blob/main/scripts/changelog-to-html.sh)) and embeds them in the appcast entry.
Commit the updated repo-root `appcast.xml` when the production feed changes. It mirrors production; it is not a separate GitHub raw feed.

Do not publish rc builds on the production appcast without product version sign-off.

## Publish & verify

- Upload `OpenBot-<version>.zip` (and `OpenBot-<version>.dSYM.zip` when you ship symbols) to `https://www.openbot.love/downloads/` so enclosure URLs match the download prefix.
- Upload the signed `appcast.xml` to `https://www.openbot.love/downloads/appcast.xml`. That URL is the baked production feed and the acceptance URL.
- GitHub release assets are optional mirrors. `raw.githubusercontent.com/gmood2008/openbot/...` is not the Sparkle acceptance URL.
- Sanity checks:
  - `curl -fsSL -o /dev/null -w "%{http_code}\n" https://www.openbot.love/downloads/appcast.xml` returns 200.
  - `curl -I https://www.openbot.love/downloads/OpenBot-<version>.zip` returns 200 after the upload.
  - On a previous public build, run "Check for Updates..." from the About tab and verify Sparkle installs the new build cleanly.

Definition of done: signed app + appcast are on `https://www.openbot.love/downloads/`, and the in-app update works from an older installed version.
