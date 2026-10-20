# License notes — Media Monitor / MediaCrawler

## MediaCrawler

[NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) is licensed under
**NON-COMMERCIAL LEARNING LICENSE 1.1**.

Constraints relevant to OpenBot:

- Learning / research use only unless written commercial consent is obtained.
- No large-scale crawling or disruption of platform operations.
- Commercial use and improper third-party influence are prohibited without copyright-owner consent.

## OpenBot policy for this plugin

1. This repository **does not** copy MediaCrawler source code.
2. This plugin is a **sidecar connector**: it spawns an operator-supplied external adapter process that speaks the versioned JSON contract in `src/contract.ts`.
3. MediaCrawler (or any replacement crawler) remains outside OpenBot core and is **not** a production built-in dependency.
4. Before offering this capability commercially or as a hosted OpenBot feature, obtain written commercial authorization for the crawler, or replace it with a commercially licensed implementation.
5. Auto-comment / auto-like / auto-follow / auto-DM / auto-posting are **out of scope** and forbidden in MVP.

## Recommended production adapter (clean-room)

Prefer the sibling Apache-2.0 project **`openbot-media-adapter`** (clean-room; no MediaCrawler code):

- Path (local): `../openbot-media-adapter` relative to this monorepo
- Policy: that repo's `CLEAN_ROOM.md`
- Contract: that repo's `docs/CONTRACT.md` (same `schema_version: 1` as this plugin)

Do **not** modify MediaCrawler to "escape" its license — that does not remove NCLL obligations.
