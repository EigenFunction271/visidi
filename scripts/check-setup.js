#!/usr/bin/env node
/**
 * Verify Visidi local setup.
 *
 * The mock HTTP site and visidi-bridge use DIFFERENT ports by design:
 *   - HTTP page: any localhost port (3000, 59696, etc.) — serves your site
 *   - Bridge:    ws://localhost:4017 only — receives element captures
 *
 * Usage:
 *   node scripts/check-setup.js
 *   node scripts/check-setup.js http://localhost:59696
 */

const http = require("http");
const https = require("https");
const path = require("path");

const bridgeDir = path.join(__dirname, "../vibe-edit-bridge");
let WebSocket;
try {
  ({ WebSocket } = require(require.resolve("ws", { paths: [bridgeDir] })));
} catch {
  console.error("Missing dependency: run npm install in vibe-edit-bridge/");
  process.exit(1);
}

const BRIDGE_URL = "ws://localhost:4017";
const PAGE_URL = process.argv[2] || "http://localhost:3000";
const TIMEOUT_MS = 2000;

function checkHttp(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout: TIMEOUT_MS }, (res) => {
      res.resume();
      resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: "timeout" });
    });
    req.on("error", (err) => resolve({ ok: false, status: err.code || err.message }));
  });
}

function checkBridge() {
  return new Promise((resolve) => {
    const ws = new WebSocket(BRIDGE_URL);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch (_) {
        /* noop */
      }
      resolve({ ok: false, error: "timeout" });
    }, TIMEOUT_MS);

    ws.on("open", () => {
      clearTimeout(timer);
      ws.close();
      resolve({ ok: true });
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
}

async function main() {
  console.log("Visidi local setup check\n");
  console.log("Note: HTTP page port and bridge port do NOT need to match.");
  console.log(`  Page (HTTP):  ${PAGE_URL}`);
  console.log(`  Bridge (WS):  ${BRIDGE_URL}\n`);

  const [page, bridge] = await Promise.all([checkHttp(PAGE_URL), checkBridge()]);

  if (page.ok) {
    console.log(`✓ HTTP page reachable (${PAGE_URL}) — status ${page.status}`);
  } else {
    console.log(`✗ HTTP page not reachable (${PAGE_URL}) — ${page.status}`);
    console.log("  Start mock site: cd examples/mock-landing && npx serve --listen 3000 .");
  }

  if (bridge.ok) {
    console.log(`✓ Bridge reachable (${BRIDGE_URL})`);
  } else {
    console.log(`✗ Bridge not reachable (${BRIDGE_URL}) — ${bridge.error}`);
    console.log("  Start bridge: cd /path/to/project && npx visidi-bridge");
  }

  console.log("");
  if (page.ok && bridge.ok) {
    console.log("Ready to test in Chrome — reload the Visidi extension, then pick an element.");
    process.exit(0);
  }
  console.log("Fix the items above, then re-run: node scripts/check-setup.js", PAGE_URL);
  process.exit(1);
}

main();
