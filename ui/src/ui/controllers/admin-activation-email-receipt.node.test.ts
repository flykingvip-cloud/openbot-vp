import { describe, expect, it } from "vitest";
import { formatAdminActivationEmailReceipt } from "./admin-activation-email-receipt.ts";

const sentAt = new Date("2026-09-22T02:53:00.000Z");

describe("formatAdminActivationEmailReceipt", () => {
  it("includes the recipient and message id when the mail is sent", () => {
    const receipt = formatAdminActivationEmailReceipt(
      { status: "sent", messageId: "<abc@mail>" },
      "2894357278@qq.com",
      sentAt,
    );
    expect(receipt.level).toBe("ok");
    expect(receipt.text).toContain("2894357278@qq.com");
    expect(receipt.text).toContain("<abc@mail>");
    expect(receipt.text).toContain("发送至");
  });

  it("says the mail was not sent when delivery is queued or failed", () => {
    expect(
      formatAdminActivationEmailReceipt(
        { status: "queued", reason: "smtp_not_configured" },
        "admin@example.com",
        sentAt,
      ).text,
    ).toContain("尚未发出");
    expect(
      formatAdminActivationEmailReceipt(
        { status: "failed", error: "550 mailbox unavailable" },
        "admin@example.com",
        sentAt,
      ).text,
    ).toContain("550 mailbox unavailable");
  });

  it("does not claim success when the response has no delivery receipt", () => {
    const receipt = formatAdminActivationEmailReceipt(undefined, "admin@example.com", sentAt);
    expect(receipt.level).toBe("error");
    expect(receipt.text).toContain("没有收到邮件回执");
  });
});
