import { createConnection, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";

export type PlatformAuthImapConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  timeoutMs: number;
};

export type PlatformAuthImapProbeResult = { ok: true } | { ok: false; error: string };

export type PlatformAuthImapCommandResult = {
  status: "OK" | "NO" | "BAD" | "BYE" | "PREAUTH";
  text: string;
  raw: string;
};

type PendingCommand = {
  tag: string;
  resolve: (result: PlatformAuthImapCommandResult) => void;
  reject: (error: Error) => void;
  rawParts: string[];
};

function quoteImapString(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function skipLiteralSegments(buffer: string, start: number): number {
  let index = start;
  while (index < buffer.length) {
    const match = buffer.slice(index).match(/^\{(\d+)\}\r\n/);
    if (!match) {
      return index;
    }
    index += match[0].length + Number(match[1]);
  }
  return index;
}

function tryParseCompletedCommand(
  buffer: string,
  pending: PendingCommand,
): { consumed: number; result: PlatformAuthImapCommandResult } | null {
  let index = 0;
  while (index < buffer.length) {
    index = skipLiteralSegments(buffer, index);
    if (index >= buffer.length) {
      return null;
    }
    const lineEnd = buffer.indexOf("\r\n", index);
    if (lineEnd === -1) {
      return null;
    }
    const line = buffer.slice(index, lineEnd);
    if (line.startsWith(`${pending.tag} `)) {
      const match = line.match(/^(\w+) (OK|NO|BAD|BYE|PREAUTH) (.*)$/);
      if (!match) {
        return null;
      }
      const consumed = lineEnd + 2;
      return {
        consumed,
        result: {
          status: match[2] as PlatformAuthImapCommandResult["status"],
          text: match[3] ?? "",
          raw: buffer.slice(0, consumed),
        },
      };
    }
    pending.rawParts.push(line);
    index = lineEnd + 2;
  }
  return null;
}

export class PlatformAuthImapSession {
  private buffer = "";
  private tagCounter = 0;
  private pending: PendingCommand | null = null;

  constructor(
    private readonly socket: Socket | TLSSocket,
    private readonly timeoutMs: number,
  ) {
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => this.onData(chunk.toString("utf8")));
    this.socket.on("error", (error) => {
      if (this.pending) {
        this.pending.reject(error instanceof Error ? error : new Error(String(error)));
        this.pending = null;
      }
    });
    this.socket.on("close", () => {
      if (this.pending) {
        this.pending.reject(new Error("IMAP connection closed."));
        this.pending = null;
      }
    });
  }

  static async open(config: PlatformAuthImapConfig): Promise<PlatformAuthImapSession> {
    return await new Promise<PlatformAuthImapSession>((resolve, reject) => {
      const socket: Socket | TLSSocket = config.secure
        ? connectTls(config.port, config.host, { servername: config.host })
        : createConnection(config.port, config.host);
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("IMAP connection timed out."));
      }, config.timeoutMs);

      const finish = (error: Error | null, session?: PlatformAuthImapSession) => {
        clearTimeout(timeout);
        if (error) {
          socket.destroy();
          reject(error);
          return;
        }
        if (!session) {
          socket.destroy();
          reject(new Error("IMAP session failed to initialize."));
          return;
        }
        resolve(session);
      };

      socket.once("error", (error) =>
        finish(error instanceof Error ? error : new Error(String(error))),
      );
      const session = new PlatformAuthImapSession(socket, config.timeoutMs);
      const onReady = () => {
        void session
          .waitForGreeting()
          .then(() => finish(null, session))
          .catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
      };
      if (config.secure) {
        socket.once("secureConnect", onReady);
      } else {
        socket.once("connect", onReady);
      }
    });
  }

  close(): void {
    this.socket.destroy();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (!this.pending) {
      return;
    }
    const parsed = tryParseCompletedCommand(this.buffer, this.pending);
    if (!parsed) {
      return;
    }
    this.buffer = this.buffer.slice(parsed.consumed);
    const pending = this.pending;
    this.pending = null;
    pending.resolve(parsed.result);
  }

  private async waitForGreeting(): Promise<void> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      if (/^\* OK /m.test(this.buffer)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("IMAP greeting not received.");
  }

  private nextTag(): string {
    this.tagCounter += 1;
    return `a${this.tagCounter}`;
  }

  async command(command: string): Promise<PlatformAuthImapCommandResult> {
    if (this.pending) {
      throw new Error("IMAP command already in flight.");
    }
    const tag = this.nextTag();
    return await new Promise<PlatformAuthImapCommandResult>((resolve, reject) => {
      this.pending = {
        tag,
        resolve,
        reject,
        rawParts: [],
      };
      this.socket.write(`${tag} ${command}\r\n`);
    });
  }

  async login(): Promise<void> {
    const login = await this.command(
      `LOGIN ${quoteImapString(this.requireAuthUser())} ${quoteImapString(this.requireAuthPass())}`,
    );
    if (login.status !== "OK") {
      throw new Error(login.text || "IMAP LOGIN 失败。");
    }
  }

  async selectMailbox(mailbox: string): Promise<void> {
    const selected = await this.command(`SELECT ${quoteImapMailbox(mailbox)}`);
    if (selected.status !== "OK") {
      throw new Error(selected.text || "IMAP SELECT 失败。");
    }
  }

  async logout(): Promise<void> {
    await this.command("LOGOUT");
  }

  private authUser = "";
  private authPass = "";

  bindCredentials(user: string, pass: string): void {
    this.authUser = user;
    this.authPass = pass;
  }

  private requireAuthUser(): string {
    if (!this.authUser.trim()) {
      throw new Error("IMAP user is missing.");
    }
    return this.authUser;
  }

  private requireAuthPass(): string {
    if (!this.authPass.trim()) {
      throw new Error("IMAP password is missing.");
    }
    return this.authPass;
  }
}

function quoteImapMailbox(value: string): string {
  const trimmed = value.trim() || "INBOX";
  if (/^[\w.-]+$/i.test(trimmed)) {
    return trimmed;
  }
  return quoteImapString(trimmed);
}

export async function runPlatformAuthImapSession<T>(
  config: PlatformAuthImapConfig,
  run: (session: PlatformAuthImapSession) => Promise<T>,
): Promise<T> {
  const session = await PlatformAuthImapSession.open(config);
  session.bindCredentials(config.user, config.pass);
  try {
    return await run(session);
  } finally {
    session.close();
  }
}

export async function probePlatformAuthImapConnection(
  config: PlatformAuthImapConfig,
): Promise<PlatformAuthImapProbeResult> {
  if (!config.host.trim() || !config.user.trim() || !config.pass.trim()) {
    return { ok: false, error: "IMAP 配置不完整。" };
  }
  try {
    await runPlatformAuthImapSession(config, async (session) => {
      await session.login();
      const list = await session.command('LIST "" "*"');
      if (list.status !== "OK") {
        throw new Error(list.text || "IMAP LIST 失败。");
      }
      await session.logout();
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "IMAP 探测失败。",
    };
  }
}
