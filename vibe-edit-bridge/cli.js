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
 *
 * Optional `--dev -- <command>` flag (documentation/setup-streamline-plan.md)
 * runs the project's dev server as a child process alongside the bridge,
 * so a single command covers both. `--dev` with no `--` command auto-detects
 * from package.json's "dev"/"start" script.
 */

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { startServer } = require("./src/server");

const PORT_RANGE_START = 4017;
const PORT_RANGE_END = 4020; // PRD §7.2 — retry range; extension hardcodes 4017 in v1

function parseArgs(argv) {
  const devIndex = argv.indexOf("--dev");
  if (devIndex === -1) {
    return { devRequested: false, devArgs: null };
  }

  const sepIndex = argv.indexOf("--", devIndex);
  if (sepIndex === -1) {
    return { devRequested: true, devArgs: null }; // auto-detect from package.json
  }

  const devArgs = argv.slice(sepIndex + 1);
  if (devArgs.length === 0) {
    return { devRequested: true, devArgs: null }; // `--dev --` with nothing after
  }

  return { devRequested: true, devArgs };
}

function detectDevCommand(cwd) {
  const pkgPath = path.join(cwd, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch (err) {
    return { error: `Could not read package.json in ${cwd}: ${err.message}` };
  }

  const scripts = pkg.scripts || {};
  const scriptName = scripts.dev ? "dev" : scripts.start ? "start" : null;

  if (!scriptName) {
    const available = Object.keys(scripts);
    return {
      error:
        available.length > 0
          ? `No "dev" or "start" script in package.json. Available scripts: ${available.join(
              ", "
            )}. Use --dev -- <command> to specify one explicitly.`
          : `No scripts found in package.json. Use --dev -- <command> to specify one explicitly.`,
    };
  }

  return { devArgs: ["npm", "run", scriptName] };
}

function spawnDevProcess(devArgs, cwd, onExit) {
  const child = spawn(devArgs[0], devArgs.slice(1), {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (d) => process.stdout.write(`[dev] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[dev] ${d}`));

  child.on("exit", (code, signal) => onExit(code, signal));
  child.on("error", (err) => {
    console.error(`[visidi-bridge] Failed to start dev process: ${err.message}`);
    onExit(null, null);
  });

  return child;
}

async function main() {
  const cwd = process.cwd();
  const { devRequested, devArgs: explicitDevArgs } = parseArgs(
    process.argv.slice(2)
  );

  let devArgs = explicitDevArgs;
  if (devRequested && !devArgs) {
    const detected = detectDevCommand(cwd);
    if (detected.error) {
      console.error(`[visidi-bridge] ${detected.error}`);
      process.exitCode = 1;
      return;
    }
    devArgs = detected.devArgs;
    console.log(`[visidi-bridge] Auto-detected dev command: ${devArgs.join(" ")}`);
  }

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

  let devChild = null;
  let shuttingDown = false;

  function shutdown(exitCode) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n[visidi-bridge] Shutting down...");
    if (devChild) {
      devChild.kill();
    }
    server.close(() => {
      process.exit(exitCode);
    });
  }

  if (devArgs) {
    console.log(`[visidi-bridge] Starting dev process: ${devArgs.join(" ")}`);
    devChild = spawnDevProcess(devArgs, cwd, (code, signal) => {
      if (shuttingDown) return; // expected exit from our own teardown below
      console.error(
        `[visidi-bridge] Dev process exited unexpectedly (code ${code}${
          signal ? `, signal ${signal}` : ""
        }) — shutting down bridge too.`
      );
      shutdown(1);
    });
  }

  // PRD §7.3 — close the WebSocket server cleanly on Ctrl+C; also tears
  // down the dev child if --dev was used (setup-streamline-plan.md).
  process.on("SIGINT", () => shutdown(0));
}

main();
