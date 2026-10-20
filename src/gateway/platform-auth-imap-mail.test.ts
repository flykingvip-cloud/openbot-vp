import { describe, expect, it } from "vitest";
import {
  buildReplyEmailSubject,
  extractEmailAddressFromHeader,
  normalizeMessageIdHeader,
  parsePlatformAuthImapFetchSummaries,
  parsePlatformAuthImapSearchUids,
} from "./platform-auth-imap-mail.js";

describe("platform auth imap mail parsing", () => {
  it("parses SEARCH uids from untagged response", () => {
    expect(
      parsePlatformAuthImapSearchUids("* SEARCH 12 15 99\r\na2 OK SEARCH completed\r\n"),
    ).toEqual([12, 15, 99]);
  });

  it("parses FETCH summaries with header and snippet literals", () => {
    // Literal sizes must match exact byte lengths of following octets (CRLF included).
    const raw = [
      "* 1 FETCH (UID 42 BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] {128}\r\n",
      "From: Alice <alice@example.com>\r\n",
      "Subject: Weekly update\r\n",
      "Date: Mon, 1 Jan 2024 00:00:00 +0000\r\n",
      "Message-ID: <abc@example.com>\r\n",
      "\r\n",
      " BODY[TEXT]<0.512> {19}\r\n",
      "Hello team update\r\n",
      ")\r\n",
      "a3 OK Fetch completed.\r\n",
    ].join("");
    const summaries = parsePlatformAuthImapFetchSummaries(raw);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.uid).toBe(42);
    expect(summaries[0]?.from).toContain("alice@example.com");
    expect(summaries[0]?.subject).toBe("Weekly update");
    expect(summaries[0]?.messageId).toBe("<abc@example.com>");
    expect(summaries[0]?.snippet).toContain("Hello team");
  });

  it("extracts reply address and subject helpers", () => {
    expect(extractEmailAddressFromHeader("Bob <bob@example.com>")).toBe("bob@example.com");
    expect(buildReplyEmailSubject("Hello")).toBe("Re: Hello");
    expect(buildReplyEmailSubject("Re: Hello")).toBe("Re: Hello");
    expect(normalizeMessageIdHeader("abc@example.com")).toBe("<abc@example.com>");
  });
});
