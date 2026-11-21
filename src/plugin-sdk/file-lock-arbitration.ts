import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isPidAlive } from "../shared/pid-alive.js";

type Ticket = { pid: number; number: number };

/**
 * Local-filesystem bakery arbitration. Every public-lock mutation participates.
 * A choosing ticket (number=0) is published before selecting a number. Ties are
 * ordered by unique filename. Only dead owners' unique names may be reclaimed;
 * a live, paused participant is never revoked by elapsed time.
 * All participants must use this protocol; mixed old/new workers are unsupported.
 */
export function tryWithFileLockArbitration<T>(
  lockPath: string,
  action: () => T,
): { acquired: true; value: T } | { acquired: false } {
  const dir = `${lockPath}.arbitration`;
  fs.mkdirSync(dir, { recursive: true });
  const id = `${process.pid}-${randomUUID()}.json`;
  const own = path.join(dir, id);
  const staging = `${own}.pending`;
  function publish(number: number): void {
    fs.writeFileSync(staging, JSON.stringify({ pid: process.pid, number }), { flag: "wx" });
    fs.renameSync(staging, own);
  }
  function peers(): Array<{ id: string; ticket: Ticket }> {
    const entries: Array<{ id: string; ticket: Ticket }> = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json") || name === id) {
        continue;
      }
      const file = path.join(dir, name);
      let ticket: Ticket;
      try {
        ticket = JSON.parse(fs.readFileSync(file, "utf8")) as Ticket;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw error; // Unknown/corrupt arbitration state fails closed.
      }
      if (
        !Number.isInteger(ticket.pid) ||
        ticket.pid <= 0 ||
        !Number.isSafeInteger(ticket.number) ||
        ticket.number < 0
      ) {
        throw new Error(`Invalid file lock arbitration ticket: ${file}`);
      }
      // Permission failures are not evidence of death (e.g. another local user).
      let alive = true;
      try {
        process.kill(ticket.pid, 0);
        alive = isPidAlive(ticket.pid);
      } catch (error) {
        alive = (error as NodeJS.ErrnoException).code !== "ESRCH";
      }
      if (!alive) {
        fs.rmSync(file, { force: true });
        continue;
      }
      entries.push({ id: name, ticket });
    }
    return entries;
  }
  try {
    publish(0);
    const number = Math.max(0, ...peers().map((peer) => peer.ticket.number)) + 1;
    if (!Number.isSafeInteger(number)) {
      throw new Error("File lock arbitration ticket overflow");
    }
    publish(number);
    for (const peer of peers()) {
      if (
        peer.ticket.number === 0 ||
        peer.ticket.number < number ||
        (peer.ticket.number === number && peer.id < id)
      ) {
        return { acquired: false };
      }
    }
    // No await here: synchronous and asynchronous callers share this short section.
    return { acquired: true, value: action() };
  } finally {
    fs.rmSync(staging, { force: true });
    fs.rmSync(own, { force: true });
    // Keep the directory: removing a shared directory would introduce another race.
  }
}
