import type { ControlUiEmailDeliveryResult } from "../../../../src/gateway/control-ui-contract.js";

export type AdminActivationEmailReceipt = {
  level: "ok" | "error";
  text: string;
};

function queuedReasonLabel(reason: ControlUiEmailDeliveryResult["reason"] | undefined): string {
  switch (reason) {
    case "smtp_not_configured":
      return "SMTP 未配置";
    case "missing_recipient":
      return "缺少收件人";
    case "unsupported_notification":
      return "不支持该通知类型";
    default:
      return "等待投递";
  }
}

/** Operator-facing receipt for an enterprise-admin activation email. */
export function formatAdminActivationEmailReceipt(
  delivery: ControlUiEmailDeliveryResult | undefined,
  recipientEmail: string,
  sentAt = new Date(),
): AdminActivationEmailReceipt {
  const recipient = recipientEmail.trim() || "管理员";
  if (!delivery) {
    return {
      level: "error",
      text: `没有收到邮件回执，无法确认是否已发给 ${recipient}。`,
    };
  }
  if (delivery.status === "sent") {
    const stamp = sentAt.toLocaleString();
    const messageId = delivery.messageId?.trim();
    return {
      level: "ok",
      text: messageId
        ? `已于 ${stamp} 发送至 ${recipient}。邮件回执 ${messageId}。`
        : `已于 ${stamp} 发送至 ${recipient}。`,
    };
  }
  if (delivery.status === "queued") {
    return {
      level: "error",
      text: `邮件尚未发出，当前为排队（${queuedReasonLabel(delivery.reason)}）。收件人 ${recipient}。`,
    };
  }
  const detail = delivery.error?.trim() || "邮件服务返回失败";
  return {
    level: "error",
    text: `发送失败：${detail}。收件人 ${recipient}。`,
  };
}
