import { describe, expect, it } from "vitest";
import { parsePersonalEmailImapPayload } from "./user-operational-identity-imap-actions.js";

describe("personal email imap payload", () => {
  it("parses uid and query fields", () => {
    expect(
      parsePersonalEmailImapPayload({
        uid: 42,
        mailbox: "INBOX",
        query: "from:boss",
        limit: 5,
        includeBody: true,
      }),
    ).toEqual({
      mailbox: "INBOX",
      uid: 42,
      limit: 5,
      query: "from:boss",
      unseen: undefined,
      includeBody: true,
      to: undefined,
      subject: undefined,
      message: undefined,
      body: undefined,
      html: undefined,
    });
  });
});
