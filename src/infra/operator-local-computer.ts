import type { ExecHost } from "./exec-approvals.js";
import { isDesktopSaveExecCommand, isSafeDesktopFileName } from "./local-exec-permission.js";

/**
 * Bounded local-computer exec while `tools.exec.host` stays sandbox.
 *
 * Operator-seat bots with a computer binding may list or write the user's
 * Desktop on that node. Anything else that asks for `host=node` stays denied.
 * Bounded Desktop probes and writes may raise the local permission card even
 * without a durable binding (本次授权 / 始终授权). Always Allow persists the
 * operator↔computer binding so later Desktop-class ops can skip the card.
 * This is not a general shell on the paired computer.
 */

const DESKTOP_PROBES = new Set([
  'ls -d "$HOME/Desktop"',
  'ls -d "$HOME/Desktop/"',
  "ls -d '$HOME/Desktop'",
  'test -d "$HOME/Desktop"',
  'ls -la "$HOME/Desktop"',
]);

const DESKTOP_DELIM_RE = /^OB_DESKTOP(?:_[0-9a-f]{8})?$/;

export function isDesktopDirectoryProbe(command: string): boolean {
  return DESKTOP_PROBES.has(command.trim());
}

function quotedDesktopTarget(raw: string): boolean {
  const match = raw.match(/^"\$HOME\/Desktop\/([^"]+)"$/);
  return Boolean(match?.[1] && isSafeDesktopFileName(match[1]));
}

/** Quoted heredoc decoded onto one Desktop file. The body is data, not a shell. */
export function isDesktopBase64SaveCommand(command: string): boolean {
  const normalized = command.replace(/\r\n/g, "\n").trim();
  const header = normalized.match(
    /^base64(?:\s+-d|\s+--decode)\s*>\s*("\$HOME\/Desktop\/[^"]+")\s*<<'(OB_DESKTOP(?:_[0-9a-f]{8})?)'\n/,
  );
  if (!header?.[1] || !header[2] || !DESKTOP_DELIM_RE.test(header[2])) {
    return false;
  }
  if (!quotedDesktopTarget(header[1])) {
    return false;
  }
  const bodyStart = header[0].length;
  const closer = `\n${header[2]}`;
  if (!normalized.endsWith(closer) && !normalized.endsWith(`${closer}\n`)) {
    return false;
  }
  const end = normalized.endsWith(`${closer}\n`)
    ? normalized.length - closer.length - 1
    : normalized.length - closer.length;
  if (end < bodyStart) {
    return false;
  }
  const body = normalized.slice(bodyStart, end);
  return !body.split("\n").includes(header[2]);
}

export function isOperatorLocalComputerCommand(command: string): boolean {
  return (
    isDesktopSaveExecCommand(command) ||
    isDesktopBase64SaveCommand(command) ||
    isDesktopDirectoryProbe(command)
  );
}

export type LocalComputerHostDecision =
  | { kind: "passthrough" }
  | { kind: "allow"; pinNodeId?: string }
  | { kind: "deny" };

export function decideLocalComputerHost(params: {
  configuredHost: ExecHost;
  requestedHost: ExecHost | null;
  command: string;
  /** Node bound to the active operator seat. Absent means no computer binding. */
  operatorNodeId?: string | null;
  elevatedRequested: boolean;
}): LocalComputerHostDecision {
  if (
    params.elevatedRequested ||
    !params.requestedHost ||
    params.requestedHost === params.configuredHost
  ) {
    return { kind: "passthrough" };
  }
  if (params.requestedHost !== "node") {
    return { kind: "deny" };
  }
  // Bounded Desktop path may raise the Always/Once card even without a durable
  // binding (Grok-style popup). Pin when the seat already has a computer.
  if (!isOperatorLocalComputerCommand(params.command)) {
    return { kind: "deny" };
  }
  const operatorNodeId = params.operatorNodeId?.trim() ?? "";
  if (operatorNodeId) {
    return { kind: "allow", pinNodeId: operatorNodeId };
  }
  return { kind: "allow" };
}

export function formatOperatorComputerTurnPrompt(
  nodeId: string | null | undefined,
  opts?: { alwaysAllowDesktop?: boolean },
): string {
  const id = nodeId?.trim();
  if (id) {
    const always = opts?.alwaysAllowDesktop
      ? "This seat already has Always Allow (始终授权) for the bounded Desktop path on that node, so do not wait for another card."
      : "If a permission card appears, the user may choose 本次授权 (Allow Once) or 始终授权 (Always Allow). While waiting, say 等待授权.";
    return [
      "Operator computer:",
      `This seat is bound to node ${id}. Every bot on this seat may use that computer for the Desktop path below.`,
      always,
      'Save with exec host "node" and a command that writes only "$HOME/Desktop/<file>" (cat heredoc, or `base64 -d` heredoc for a binary file).',
      'Listing that folder is only `ls -d "$HOME/Desktop"`.',
      "Other host=node commands stay denied. The sandbox home directory is not this Desktop.",
    ].join("\n");
  }
  return [
    "Operator computer:",
    "This seat has no durable Always Allow (始终授权) binding yet.",
    "For bounded Desktop host=node requests, the chat shows a permission card: 本次授权 (Allow Once) or 始终授权 (Always Allow).",
    "While waiting, say 等待授权. Do not say the computer is missing, unbound, or tell the user to open settings.",
    "Do not treat the sandbox home as the Mac Desktop.",
  ].join("\n");
}

/** After Always Allow, skip the card for the same bounded Desktop command class. */
export function shouldSkipOperatorComputerApproval(params: {
  command: string;
  alwaysAllowDesktop?: boolean;
}): boolean {
  return Boolean(params.alwaysAllowDesktop) && isOperatorLocalComputerCommand(params.command);
}

function operatorUserMatches(
  requestUserId: string | undefined,
  operatorUserId: string,
  aliases: readonly string[],
): boolean {
  const owner = requestUserId?.trim() ?? "";
  if (!owner) {
    return true;
  }
  const ids = new Set(
    [operatorUserId, ...aliases].map((value) => value.trim().toLowerCase()).filter(Boolean),
  );
  return ids.has(owner.toLowerCase());
}

export type OperatorComputerBindingRecord = {
  seatId: string;
  nodeId: string;
};

export type OperatorComputerRequestRecord = {
  seatId: string;
  nodeId: string;
  userId?: string;
};

export type OperatorComputerBindingDecision =
  | { permitted: false; reason: "agent-not-on-seat" | "no-binding" | "ambiguous-node" }
  | { permitted: true; nodeId: string; alignFromSeatId?: string };

function uniqueNodes(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Map a live node.list payload to preferredNodeIds for seat-turn resolution.
 * Only currently connected openbot-node ids are kept so stale offline
 * approved-request nodeIds are filtered out at runtime.
 */
export function collectConnectedPreferredNodeIds(
  nodes: ReadonlyArray<{ nodeId?: string; connected?: boolean }>,
): string[] {
  return uniqueNodes(
    nodes
      .filter((node) => node.connected === true)
      .map((node) => (typeof node.nodeId === "string" ? node.nodeId : "")),
  );
}

/**
 * Which node the active operator seat may use.
 * A bot is eligible only when it is granted on that seat — the agent id is not special-cased.
 * A binding stored on another seat is copied onto the active seat only when it belongs to
 * this operator, or when it sits on a seat nobody occupies.
 */
export function decideOperatorComputerBinding(input: {
  activeSeatId: string;
  operatorUserId: string;
  /**
   * Extra ids that identify the same operator (e.g. login email when runtime
   * compares an employee UUID). Historical approved-request userId may be either.
   */
  operatorUserIdAliases?: readonly string[];
  /**
   * Currently connected openbot-node ids. Stale approved-request nodeIds that are
   * not among these are ignored so Always Allow can target the live computer.
   */
  preferredNodeIds?: readonly string[];
  agentId: string;
  operatorAgentIds: readonly string[];
  /** Seats that currently have an employee. Bindings on other seats are not stolen. */
  occupiedSeatIds: readonly string[];
  bindings: readonly OperatorComputerBindingRecord[];
  approvedRequests: readonly OperatorComputerRequestRecord[];
}): OperatorComputerBindingDecision {
  const agentId = input.agentId.trim();
  const activeSeatId = input.activeSeatId.trim();
  const operatorUserId = input.operatorUserId.trim();
  if (!agentId || !activeSeatId || !operatorUserId) {
    return { permitted: false, reason: "no-binding" };
  }
  if (!input.operatorAgentIds.some((id) => id.trim() === agentId)) {
    return { permitted: false, reason: "agent-not-on-seat" };
  }
  const onActive = input.bindings.find(
    (binding) => binding.seatId.trim() === activeSeatId && binding.nodeId.trim(),
  );
  if (onActive) {
    return { permitted: true, nodeId: onActive.nodeId.trim() };
  }

  const aliases = input.operatorUserIdAliases ?? [];
  const preferred = uniqueNodes(input.preferredNodeIds ?? []);
  const preferredSet = new Set(preferred);
  let mine = input.approvedRequests.filter(
    (request) =>
      operatorUserMatches(request.userId, operatorUserId, aliases) && request.nodeId.trim(),
  );
  if (preferredSet.size > 0) {
    const onlineMine = mine.filter((request) => preferredSet.has(request.nodeId.trim()));
    // Prefer the computer that is actually online; ignore stale approved nodeIds.
    mine = onlineMine;
  }
  const myNodes = uniqueNodes(mine.map((request) => request.nodeId));
  if (myNodes.length > 1) {
    return { permitted: false, reason: "ambiguous-node" };
  }
  if (myNodes.length === 1) {
    const nodeId = myNodes[0] ?? "";
    const from = mine.find((request) => request.nodeId.trim() === nodeId);
    const fromSeat = from?.seatId.trim() ?? "";
    return {
      permitted: true,
      nodeId,
      ...(fromSeat && fromSeat !== activeSeatId ? { alignFromSeatId: fromSeat } : {}),
    };
  }
  // No approved-request match on a live node: if exactly one preferred node is
  // online and no binding yet, do not invent a binding here — the popup must ask.
  // (Allow Once / Always Allow on that node will persist.)

  const bindings = input.bindings.filter(
    (binding) => binding.seatId.trim() && binding.nodeId.trim(),
  );
  if (bindings.length !== 1) {
    return { permitted: false, reason: bindings.length > 1 ? "ambiguous-node" : "no-binding" };
  }
  const only = bindings[0];
  if (!only) {
    return { permitted: false, reason: "no-binding" };
  }
  const occupied = new Set(input.occupiedSeatIds.map((seatId) => seatId.trim()).filter(Boolean));
  if (occupied.has(only.seatId.trim())) {
    return { permitted: false, reason: "no-binding" };
  }
  const requests = input.approvedRequests.filter((request) => request.nodeId.trim());
  if (requests.length > 1) {
    return { permitted: false, reason: "ambiguous-node" };
  }
  if (requests.length === 1) {
    const request = requests[0];
    const owner = request?.userId?.trim() ?? "";
    if (!request || (owner && !operatorUserMatches(owner, operatorUserId, aliases))) {
      return { permitted: false, reason: "no-binding" };
    }
    if (request.nodeId.trim() !== only.nodeId.trim()) {
      return { permitted: false, reason: "no-binding" };
    }
  }
  return {
    permitted: true,
    nodeId: only.nodeId.trim(),
    alignFromSeatId: only.seatId.trim(),
  };
}
