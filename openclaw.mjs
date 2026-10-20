#!/usr/bin/env node

process.emitWarning("openclaw.mjs is deprecated; use openbot.mjs instead.", "DeprecationWarning");

await import("./openbot.mjs");
