#!/usr/bin/env node

/**
 * Vibe Edit Bridge — CLI entry point.
 *
 * Usage: npx vibe-edit-bridge   (run from the project root you want
 *        edits queued into — see PRD §7.1)
 *
 * Starts a local WebSocket server that the Vibe Edit Picker browser
 * extension connects to, and appends formatted edit prompts to
 * .vibe-edits/queue.md in the current working directory.
 */

const path = require("path");
const { startServer } = require("./src/server");

const PORT_RANGE_START = 4017;
const PORT_RANGE_END = 4020; // PRD §7.2 — retry range; extension hardcodes 4017 in v1

async function main() {
  const cwd = process.cwd();
  let server;

  try {
    server = await startServer({
      portRangeStart: PORT_RANGE_START,
      portRangeEnd: PORT_RANGE_END,
      cwd,
    });
  } catch (err) {
    console.error(
      `[visidi-bridge] Could not bind any port in range ${PORT_RANGE_START}-${PORT_RANGE_END}.`
    );
    console.error(
      "[visidi-bridge] Free up port 4017 and try again — the extension only looks for the bridge on 4017 in v1."
    );
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  console.log(
    `[visidi-bridge] Running on ws://localhost:${server.port}`
  );
  console.log(
    `[visidi-bridge] Queue file: ${path.resolve(cwd, ".vibe-edits/queue.md")}`
  );
  console.log(
    "[visidi-bridge] Queue-only: capture in the extension without 'Apply automatically'."
  );
  console.log(
    "[visidi-bridge] Auto-apply: check 'Apply automatically' in the extension — requires `claude` on PATH."
  );
  console.log(
    "[visidi-bridge] Both modes write to the queue file; auto-apply also runs claude in this directory:"
  );
  console.log(`[visidi-bridge]   ${cwd}`);

  if (server.port !== PORT_RANGE_START) {
    console.warn(
      `[visidi-bridge] WARNING: bound to port ${server.port} instead of ${PORT_RANGE_START} (likely in use). The extension only connects on ${PORT_RANGE_START} in v1, so it will not find this bridge. Free port ${PORT_RANGE_START} and restart.`
    );
  }

  // PRD §7.3 — close the WebSocket server cleanly on Ctrl+C
  process.on("SIGINT", () => {
    console.log("\n[visidi-bridge] Shutting down...");
    server.close(() => {
      process.exit(0);
    });
  });
}

main();
