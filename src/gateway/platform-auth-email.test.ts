import type { IncomingMessage } from "node:http";
import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  deliverPlatformAuthEmailNotification,
  formatPlatformAuthExpiry,
  resolvePlatformAuthEmailGreeting,
  sendPlatformAuthSmtpMail,
} from "./platform-auth-email.js";
import type { PlatformAuthLeadNotification } from "./platform-auth.js";
import { buildEmployeeActivationUrl } from "./platform-auth/routes-employee.js";

let server: Server | null = null;

afterEach(async () => {
  if (!server) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = null;
});

function decodeMimeBodies(raw: string): string {
  const decodedParts: string[] = [];
  const pattern = /Content-Transfer-Encoding: base64\r?\n\r?\n([\s\S]*?)(?=\r?\n--)/g;
  for (const match of raw.matchAll(pattern)) {
    const normalized = match[1].replace(/\r?\n/g, "");
    decodedParts.push(Buffer.from(normalized, "base64").toString("utf8"));
  }
  return decodedParts.length > 0 ? decodedParts.join("\n") : raw;
}

function listen(serverToListen: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    serverToListen.once("error", reject);
    serverToListen.listen(0, "127.0.0.1", () => {
      serverToListen.off("error", reject);
      const address = serverToListen.address();
      if (!address || typeof address === "string") {
        reject(new Error("SMTP test server did not expose a TCP address."));
        return;
      }
      resolve(address.port);
    });
  });
}

function createSmtpTestServer(messages: string[]): Server {
  return createServer((socket: Socket) => {
    let buffer = "";
    let collectingData = false;
    const dataLines: string[] = [];
    socket.write("220 test.smtp.local ESMTP\r\n");

    const handleLine = (line: string) => {
      if (collectingData) {
        if (line === ".") {
          collectingData = false;
          messages.push(dataLines.join("\n"));
          dataLines.length = 0;
          socket.write("250 queued\r\n");
          return;
        }
        dataLines.push(line.startsWith("..") ? line.slice(1) : line);
        return;
      }
      const command = line.toUpperCase();
      if (command.startsWith("EHLO")) {
        socket.write("250-test.smtp.local\r\n250 OK\r\n");
        return;
      }
      if (command.startsWith("MAIL FROM:")) {
        socket.write("250 sender ok\r\n");
        return;
      }
      if (command.startsWith("RCPT TO:")) {
        socket.write("250 recipient ok\r\n");
        return;
      }
      if (command === "DATA") {
        collectingData = true;
        socket.write("354 send message\r\n");
        return;
      }
      if (command === "QUIT") {
        socket.write("221 bye\r\n");
        socket.end();
        return;
      }
      socket.write("250 ok\r\n");
    };

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\n")) {
        const newlineIndex = buffer.indexOf("\n");
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        handleLine(line);
      }
    });
  });
}

describe("platform auth email delivery", () => {
  it("sends seat assignment offer emails through configured SMTP", async () => {
    const messages: string[] = [];
    server = createSmtpTestServer(messages);
    const port = await listen(server);
    const notification: PlatformAuthLeadNotification = {
      id: "notification-1",
      type: "seat-assignment-offer-email",
      email: "alice@example.com",
      enterpriseId: "acme",
      payload: {
        offerId: "offer-1",
        enterpriseName: "Acme",
        seatTitle: "销售助理",
        employeeDisplayName: "Alice",
        offeredByDisplayName: "Admin",
        confirmationUrl: "https://app.example.com/?workbench=settings&seatOffer=offer-1",
      },
      status: "queued",
      createdAt: "2026-05-09T00:00:00.000Z",
    };

    const result = await deliverPlatformAuthEmailNotification(notification, {
      OPENBOT_SMTP_HOST: "127.0.0.1",
      OPENBOT_SMTP_PORT: String(port),
      OPENBOT_SMTP_FROM: "OpenBot <noreply@example.com>",
      OPENBOT_SMTP_SECURE: "0",
      OPENBOT_SMTP_STARTTLS: "0",
    });

    expect(result.status).toBe("sent");
    expect(messages).toHaveLength(1);
    const decoded = decodeMimeBodies(messages[0]);
    expect(messages[0]).toContain("To: alice@example.com");
    expect(decoded).toContain("销售助理");
    expect(decoded).toContain("https://app.example.com/?workbench=settings&amp;seatOffer=offer-1");
  });

  it("sends employee activation emails through configured SMTP", async () => {
    const messages: string[] = [];
    server = createSmtpTestServer(messages);
    const port = await listen(server);
    const notification: PlatformAuthLeadNotification = {
      id: "notification-2",
      type: "employee-activation-email",
      email: "member@example.com",
      enterpriseId: "acme",
      payload: {
        enterpriseName: "Acme",
        employeeName: "Member",
        employeeEmail: "member@example.com",
        seatTitle: "销售负责人",
        code: "EMP-123456",
        expiresAt: "2026-05-20T00:00:00.000Z",
        activationUrl: "https://app.example.com/me?authMode=employee-register&code=EMP-123456#auth",
      },
      status: "queued",
      createdAt: "2026-05-09T00:00:00.000Z",
    };

    const result = await deliverPlatformAuthEmailNotification(notification, {
      OPENBOT_SMTP_HOST: "127.0.0.1",
      OPENBOT_SMTP_PORT: String(port),
      OPENBOT_SMTP_FROM: "OpenBot <noreply@example.com>",
      OPENBOT_SMTP_SECURE: "0",
      OPENBOT_SMTP_STARTTLS: "0",
    });

    expect(result.status).toBe("sent");
    expect(messages).toHaveLength(1);
    const decoded = decodeMimeBodies(messages[0]);
    expect(messages[0]).toContain("To: member@example.com");
    expect(messages[0]).toContain("Content-Transfer-Encoding: base64");
    expect(decoded).toContain("销售负责人");
    expect(decoded).toContain("EMP-123456");
    expect(decoded).toContain("2026年5月20日");
    expect(decoded).toContain("北京时间");
    expect(decoded).toContain(
      "https://app.example.com/me?authMode=employee-register&amp;code=EMP-123456#auth",
    );
  });

  it("uses a friendly greeting when employee name is the email address", async () => {
    const messages: string[] = [];
    server = createSmtpTestServer(messages);
    const port = await listen(server);
    const notification: PlatformAuthLeadNotification = {
      id: "notification-greeting",
      type: "employee-activation-email",
      email: "elledecke204@gmail.com",
      enterpriseId: "upbeyond",
      payload: {
        enterpriseName: "upbeyond",
        employeeName: "elledecke204@gmail.com",
        employeeEmail: "elledecke204@gmail.com",
        seatTitle: "客服专员",
        code: "wmj4SRFs0bWNhMBR2tJ4ylE",
        expiresAt: "2026-06-17T09:10:02.737Z",
        activationUrl:
          "https://www.openbot.love/me?authMode=employee-register&email=elledecke204%40gmail.com&code=wmj4SRFs0bWNhMBR2tJ4ylE#auth",
      },
      status: "queued",
      createdAt: "2026-06-14T09:10:00.000Z",
    };

    const result = await deliverPlatformAuthEmailNotification(notification, {
      OPENBOT_SMTP_HOST: "127.0.0.1",
      OPENBOT_SMTP_PORT: String(port),
      OPENBOT_SMTP_FROM: "OpenBot <csc@mail.openbot.love>",
      OPENBOT_SMTP_SECURE: "0",
      OPENBOT_SMTP_STARTTLS: "0",
    });

    expect(result.status).toBe("sent");
    const decoded = decodeMimeBodies(messages[0]);
    expect(decoded).toContain("你好，");
    expect(decoded).not.toContain("elledecke204@gmail.com，");
    expect(decoded).toContain("2026年6月17日");
    expect(decoded).toContain("17:10");
  });

  it("formats activation expiry timestamps for Beijing time", () => {
    expect(formatPlatformAuthExpiry("2026-06-17T09:10:02.737Z")).toContain("2026年6月17日");
    expect(formatPlatformAuthExpiry("2026-06-17T09:10:02.737Z")).toContain("17:10");
    expect(formatPlatformAuthExpiry("2026-06-17T09:10:02.737Z")).toContain("北京时间");
  });

  it("resolves email-like names to a friendly greeting", () => {
    expect(
      resolvePlatformAuthEmailGreeting({
        preferredName: "elledecke204@gmail.com",
        email: "elledecke204@gmail.com",
      }),
    ).toBe("你好");
    expect(
      resolvePlatformAuthEmailGreeting({
        preferredName: "张三",
        email: "member@example.com",
      }),
    ).toBe("张三");
  });

  it("builds employee activation links with email and name prefill", () => {
    const previousBaseUrl = process.env.OPENBOT_PUBLIC_APP_BASE_URL;
    const previousEmployeeBase = process.env.OPENBOT_PUBLIC_EMPLOYEE_BASE_URL;
    const previousHomeBase = process.env.OPENBOT_PUBLIC_HOME_BASE_URL;
    process.env.OPENBOT_PUBLIC_APP_BASE_URL = "https://admin.openbot.love";
    process.env.OPENBOT_PUBLIC_EMPLOYEE_BASE_URL = "https://www.openbot.love";
    delete process.env.OPENBOT_PUBLIC_HOME_BASE_URL;
    try {
      const url = buildEmployeeActivationUrl({
        req: { headers: { host: "127.0.0.1:18789" } } as IncomingMessage,
        code: "EMP-123456",
        email: "member@example.com",
        employeeName: "张三",
      });
      expect(url.startsWith("https://www.openbot.love/me?")).toBe(true);
      expect(url).not.toContain("admin.openbot.love");
      expect(url).not.toContain("gw.openbot.love");
      expect(url).toContain("authMode=employee-register");
      expect(url).toContain("code=EMP-123456");
      expect(url).toContain("email=member%40example.com");
      expect(url).toContain("name=%E5%BC%A0%E4%B8%89");
      expect(url).toContain("#auth");
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.OPENBOT_PUBLIC_APP_BASE_URL;
      } else {
        process.env.OPENBOT_PUBLIC_APP_BASE_URL = previousBaseUrl;
      }
      if (previousEmployeeBase === undefined) {
        delete process.env.OPENBOT_PUBLIC_EMPLOYEE_BASE_URL;
      } else {
        process.env.OPENBOT_PUBLIC_EMPLOYEE_BASE_URL = previousEmployeeBase;
      }
      if (previousHomeBase === undefined) {
        delete process.env.OPENBOT_PUBLIC_HOME_BASE_URL;
      } else {
        process.env.OPENBOT_PUBLIC_HOME_BASE_URL = previousHomeBase;
      }
    }
  });

  it("refuses activation emails without code or activation url", async () => {
    const notification: PlatformAuthLeadNotification = {
      id: "notification-empty",
      type: "employee-activation-email",
      email: "member@example.com",
      enterpriseId: "acme",
      payload: {
        enterpriseName: "Acme",
        employeeName: "Member",
        employeeEmail: "member@example.com",
        seatTitle: "客服专员",
      },
      status: "queued",
      createdAt: "2026-05-09T00:00:00.000Z",
    };

    const result = await deliverPlatformAuthEmailNotification(notification, {
      OPENBOT_SMTP_HOST: "127.0.0.1",
      OPENBOT_SMTP_PORT: "2525",
      OPENBOT_SMTP_FROM: "OpenBot <noreply@example.com>",
    });

    expect(result).toMatchObject({
      status: "queued",
      reason: "missing_recipient",
    });
  });

  it("sends password reset emails through configured SMTP", async () => {
    const messages: string[] = [];
    server = createSmtpTestServer(messages);
    const port = await listen(server);
    const notification: PlatformAuthLeadNotification = {
      id: "notification-3",
      type: "password-reset-email",
      email: "owner@example.com",
      payload: {
        email: "owner@example.com",
        displayName: "Owner",
        code: "RESET-123456",
        expiresAt: "2026-05-20T00:00:00.000Z",
        resetUrl: "https://app.example.com/auth?mode=password-reset&code=RESET-123456#auth",
      },
      status: "queued",
      createdAt: "2026-05-09T00:00:00.000Z",
    };

    const result = await deliverPlatformAuthEmailNotification(notification, {
      OPENBOT_SMTP_HOST: "127.0.0.1",
      OPENBOT_SMTP_PORT: String(port),
      OPENBOT_SMTP_FROM: "OpenBot <noreply@example.com>",
      OPENBOT_SMTP_SECURE: "0",
      OPENBOT_SMTP_STARTTLS: "0",
    });

    expect(result.status).toBe("sent");
    expect(messages).toHaveLength(1);
    const decoded = decodeMimeBodies(messages[0]);
    expect(messages[0]).toContain("To: owner@example.com");
    expect(decoded).toContain("RESET-123456");
    expect(decoded).toContain(
      "https://app.example.com/auth?mode=password-reset&amp;code=RESET-123456#auth",
    );
  });

  it("sends multipart/mixed mail with a binary attachment", async () => {
    const messages: string[] = [];
    server = createSmtpTestServer(messages);
    const port = await listen(server);
    const content = Buffer.from("PK\x03\x04deck");
    await sendPlatformAuthSmtpMail(
      {
        host: "127.0.0.1",
        port,
        secure: false,
        startTls: false,
        from: "OpenBot <noreply@example.com>",
        timeoutMs: 5000,
      },
      {
        to: "hedon@example.com",
        subject: "OpenBot deck",
        text: "See attached",
        html: "<p>See attached</p>",
        attachments: [
          {
            filename: "OpenBot_投资介绍.pptx",
            contentType:
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            content,
          },
        ],
      },
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("multipart/mixed");
    expect(messages[0]).toContain("Content-Disposition: attachment");
    expect(messages[0]).toContain("filename*=UTF-8''OpenBot_");
    expect(messages[0]).toContain(content.toString("base64"));
  });
});
