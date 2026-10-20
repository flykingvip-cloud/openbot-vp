#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cliEntry = new URL("../dist/cli.js", import.meta.url);

if (!existsSync(fileURLToPath(cliEntry))) {
  process.stderr.write(
    "CogniWeave SDK CLI build output is missing. Run `npm run build` in packages/cogniweave-sdk before invoking the bin from a workspace checkout.\n",
  );
  process.exit(1);
}

const { runCogniWeaveCli } = await import(cliEntry);

const exitCode = await runCogniWeaveCli();
if (exitCode !== 0) {
  process.exitCode = exitCode;
}
