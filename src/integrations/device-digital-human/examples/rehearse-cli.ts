import { runRehearse } from "./rehearse-flow.js";

const baseUrl = process.argv[2];
if (!baseUrl) {
  process.stderr.write("usage: rehearse-cli <baseUrl>\n");
  process.exit(2);
}

await runRehearse(baseUrl);
process.stdout.write("rehearse ok\n");
