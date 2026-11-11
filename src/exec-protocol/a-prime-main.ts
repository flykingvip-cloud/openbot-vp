import { main } from "./process-main.js";

await main({ ...process.env, OPENBOT_EXEC_PROTOCOL_ROLE: "a" });
