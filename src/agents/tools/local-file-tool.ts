/**
 * Model-facing tools for reading files on the user's own machine.
 *
 * Why these exist instead of letting the model use `nodes` with `action="invoke"`:
 * that entry point accepts an arbitrary `invokeCommand`
 * (`src/agents/tools/nodes-tool.ts`), which is far too wide a surface for a
 * capability that reads a person's disk. These tools are the only sanctioned path,
 * and the generic invoke route refuses the same commands
 * (see `assertNotLocalFilesCommand`), so there are not two doors with different
 * locks (design 4.6).
 *
 * Everything that decides whether a read may happen lives gateway-side in
 * `LocalFilesService`. These tools carry no authorization argument at all: there is
 * deliberately no `userDirected` flag, no capability parameter and no node id, so a
 * model cannot assert its own permission (design 4.5, 5).
 */

import { Type } from "@sinclair/typebox";
import type { LocalFilesService } from "../../gateway/local-files/service.js";
import {
  LOCAL_FILES_OPAQUE_DENIAL,
  type CapabilityBinding,
  type LocalFilesOperation,
} from "../../local-files/types.js";
import { asToolParams, jsonResult, readStringParam, type AnyAgentTool } from "./common.js";

/**
 * Commands that must never be reachable through the generic node invoke tool.
 * Kept as a prefix check so a future `fs.something` is refused by default.
 */
export function isLocalFilesCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return normalized.startsWith("fs.") || normalized.startsWith("archive.");
}

/**
 * Guard for the generic `nodes` invoke path.
 *
 * Throws rather than returning a flag so a caller cannot accidentally ignore it.
 */
export function assertNotLocalFilesCommand(command: string): void {
  if (isLocalFilesCommand(command)) {
    throw new Error(
      `invokeCommand "${command}" is not available through generic node invoke; ` +
        `use the local_file.* or local_archive.* tools, which carry the required authorization`,
    );
  }
}

/** Turn identity the gateway supplies. Never sourced from tool arguments. */
export type LocalFileToolIdentity = {
  tenantId: string;
  userId: string;
  agentId: string;
  sessionKey: string;
  turnId: string;
  inboundMessageId?: string;
};

export type LocalFileToolOptions = {
  service: LocalFilesService;
  /**
   * Trusted turn identity, resolved by the gateway from the authenticated
   * session. A model-supplied value would defeat the whole binding.
   */
  identity: LocalFileToolIdentity;
  /**
   * Resolve which of the user's bound devices to use. Returns null when the user
   * has no active binding, or several and has not chosen one — requests are never
   * broadcast (design 4.3).
   */
  resolveNodeId(identity: LocalFileToolIdentity): Promise<{
    nodeId: string;
    devicePublicKey: string;
  } | null>;
};

const PATH_DESCRIPTION =
  "Absolute path or ~-prefixed path on the user's own computer, exactly as the user wrote it.";

function buildTool(params: {
  label: string;
  name: string;
  description: string;
  schema: ReturnType<typeof Type.Object>;
  operation: LocalFilesOperation;
  options: LocalFileToolOptions;
  readEntry?: boolean;
}): AnyAgentTool {
  return {
    label: params.label,
    name: params.name,
    description: params.description,
    parameters: params.schema,
    execute: async (_toolCallId: string, rawParams: unknown) => {
      const toolParams = asToolParams(rawParams);
      const path = readStringParam(toolParams, "path", { required: true, label: "path" });
      const entryPath = params.readEntry
        ? readStringParam(toolParams, "entryPath", { required: true, label: "entryPath" })
        : undefined;

      const device = await params.options.resolveNodeId(params.options.identity);
      if (!device) {
        // No paired computer, or more than one. A single unpaired Mac is not
        // this branch: the resolver returns it and the service raises a card.
        return jsonResult({ ok: false, message: LOCAL_FILES_OPAQUE_DENIAL });
      }

      const binding: CapabilityBinding = {
        tenantId: params.options.identity.tenantId,
        userId: params.options.identity.userId,
        agentId: params.options.identity.agentId,
        sessionKey: params.options.identity.sessionKey,
        turnId: params.options.identity.turnId,
        nodeId: device.nodeId,
        devicePublicKey: device.devicePublicKey,
      };

      const result = await params.options.service.requestAccess({
        binding,
        rawPath: path,
        operation: params.operation,
        archiveEntryPath: entryPath,
        inboundMessageId: params.options.identity.inboundMessageId,
      });

      if (!result.ok) {
        // Uniform refusal. The model learns nothing about the path (design 9.1).
        return jsonResult({ ok: false, message: result.message });
      }
      return jsonResult({ ok: true, ...(result.payload as Record<string, unknown>) });
    },
  };
}

/**
 * The five model-visible tools.
 *
 * Names are namespaced so the model sees a file capability rather than a node RPC,
 * and there is no tool for writing, deleting, moving or executing (design 2).
 */
export function createLocalFileTools(options: LocalFileToolOptions): AnyAgentTool[] {
  const pathOnly = Type.Object({
    path: Type.String({ description: PATH_DESCRIPTION }),
  });

  return [
    buildTool({
      label: "Local File Stat",
      name: "local_file.stat",
      description:
        "Report metadata for one file or directory on the user's own computer. " +
        "Does not return file contents.",
      schema: pathOnly,
      operation: "fs.stat",
      options,
    }),
    buildTool({
      label: "Local File List",
      name: "local_file.list",
      description:
        "List the direct children of one directory on the user's own computer. " +
        "Not recursive. Listing a child does not permit reading it: request that file separately.",
      schema: pathOnly,
      operation: "fs.list",
      options,
    }),
    buildTool({
      label: "Local File Read",
      name: "local_file.read",
      description:
        "Read one text file on the user's own computer. Returns metadata plus text, " +
        "truncated when large. Binary files return metadata only.",
      schema: pathOnly,
      operation: "fs.read",
      options,
    }),
    buildTool({
      label: "Local Archive List",
      name: "local_archive.list",
      description:
        "List the entries inside one ZIP archive on the user's own computer. " +
        "The archive is never extracted to disk.",
      schema: pathOnly,
      operation: "archive.list",
      options,
    }),
    buildTool({
      label: "Local Archive Read Entry",
      name: "local_archive.read_entry",
      description:
        "Read one entry inside a ZIP archive on the user's own computer, without extracting it.",
      schema: Type.Object({
        path: Type.String({ description: PATH_DESCRIPTION }),
        entryPath: Type.String({
          description: "Entry path inside the archive, as reported by local_archive.list.",
        }),
      }),
      operation: "archive.readEntry",
      options,
      readEntry: true,
    }),
  ];
}
