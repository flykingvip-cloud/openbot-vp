#!/usr/bin/env node
/**
 * Fake MediaCrawler-compatible adapter for tests.
 * Speaks schema_version=1 JSON on stdout. Logs go to stderr only.
 *
 * Env:
 *   FAKE_ADAPTER_SCENARIO = baseline | new_content | new_comment | rate_limit |
 *                           reauth | captcha | timeout | fail_exit | invalid_json |
 *                           paginated_dupes | empty
 *   FAKE_ADAPTER_SLEEP_MS  = optional delay before output
 */
import { parseArgs } from "node:util";

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function logDiag(msg) {
  process.stderr.write(`${msg}\n`);
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    platform: { type: "string" },
    "account-id": { type: "string" },
    "account-url": { type: "string" },
    mode: { type: "string" },
    "content-id": { type: "string" },
    output: { type: "string" },
    scenario: { type: "string" },
  },
  allowPositionals: true,
  strict: false,
});

const scenario = values.scenario || process.env.FAKE_ADAPTER_SCENARIO || "new_content";
const sleepMs = Number(process.env.FAKE_ADAPTER_SLEEP_MS || "0");
const platform = values.platform || "xhs";
const accountId = values["account-id"] || "acct";
const mode = values.mode || "creator";
const contentId = values["content-id"] || "content-1";
const now = new Date().toISOString();

if (process.env.OPENBOT_MEDIA_COOKIE) {
  logDiag("cookie present (value redacted)");
}

async function main() {
  if (sleepMs > 0) {
    await new Promise((r) => setTimeout(r, sleepMs));
  }

  if (scenario === "timeout") {
    // Keep the event loop alive; a bare unresolved Promise is not enough in Node.
    await new Promise(() => {
      setInterval(() => {}, 60_000);
    });
    return;
  }

  if (scenario === "fail_exit") {
    logDiag("simulated crash");
    process.exit(2);
  }

  if (scenario === "invalid_json") {
    process.stdout.write("not-json-at-all\n");
    process.exit(0);
  }

  if (scenario === "rate_limit") {
    emit({
      schema_version: 1,
      error: {
        category: "rate_limit",
        retryable: true,
        provider_code: "429",
        message: "redacted message",
      },
    });
    process.exit(0);
  }

  if (scenario === "reauth") {
    emit({
      schema_version: 1,
      error: {
        category: "reauth_required",
        retryable: false,
        provider_code: "auth",
        message: "cookie expired",
      },
    });
    process.exit(0);
  }

  if (scenario === "captcha") {
    emit({
      schema_version: 1,
      error: {
        category: "captcha",
        retryable: true,
        provider_code: "captcha",
        message: "captcha required",
      },
    });
    process.exit(0);
  }

  const items = [];
  if (mode === "creator") {
    if (scenario === "baseline") {
      items.push(
        {
          type: "content",
          platform_id: "note-old-1",
          url: "https://example.invalid/note-old-1",
          title: "old note",
          text: "history",
          published_at: "2026-08-01T00:00:00Z",
        },
        {
          type: "content",
          platform_id: "note-old-2",
          url: "https://example.invalid/note-old-2",
          title: "old note 2",
          text: "history 2",
          published_at: "2026-08-02T00:00:00Z",
        },
      );
    } else if (scenario === "paginated_dupes") {
      items.push(
        {
          type: "content",
          platform_id: "note-a",
          url: "https://example.invalid/note-a",
          title: "A",
          text: "page1",
          published_at: "2026-08-08T00:00:00Z",
        },
        {
          type: "content",
          platform_id: "note-a",
          url: "https://example.invalid/note-a",
          title: "A dup",
          text: "page2 duplicate",
          published_at: "2026-08-08T00:00:00Z",
        },
        {
          type: "content",
          platform_id: "note-b",
          url: "https://example.invalid/note-b",
          title: "B",
          text: "page2",
          published_at: "2026-08-08T01:00:00Z",
        },
      );
    } else if (scenario === "empty") {
      // no items
    } else {
      items.push({
        type: "content",
        platform_id: "note-new-1",
        url: "https://example.invalid/note-new-1",
        title: "fresh note",
        text: "hello world",
        published_at: "2026-08-09T00:00:00Z",
      });
    }
  } else if (mode === "comments") {
    if (scenario === "baseline" || scenario === "new_comment" || scenario === "new_content") {
      const commentId = scenario === "baseline" ? "cmt-old-1" : "cmt-new-1";
      items.push({
        type: "comment",
        platform_id: commentId,
        parent_platform_id: contentId,
        url: `https://example.invalid/${contentId}#${commentId}`,
        text: scenario === "baseline" ? "old comment" : "brand new comment",
        published_at: now,
        author_name: "user",
      });
    }
  }

  emit({
    schema_version: 1,
    platform,
    target: {
      account_id: accountId,
      url: values["account-url"] || "https://example.invalid/profile",
    },
    run: {
      id: `run-${scenario}-${mode}`,
      started_at: now,
      finished_at: now,
      mode,
    },
    items,
    health: { state: "ok" },
  });
}

main().catch((err) => {
  logDiag(String(err));
  process.exit(1);
});
