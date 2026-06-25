#!/usr/bin/env node
/**
 * Smoke test: queue-only WebSocket path (no claude spawn).
 * Run from repo root after npm install in vibe-edit-bridge.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const WebSocket = require(require.resolve("ws", {
  paths: [path.join(__dirname, "../vibe-edit-bridge")],
}));
const { startServer } = require("../vibe-edit-bridge/src/server");

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "visidi-test-"));
const queuePath = path.join(testDir, ".vibe-edits", "queue.md");

const samplePayload = {
  type: "element_selected",
  selector: "button:nth-child(1)",
  tag: "button",
  id: null,
  classes: ["btn"],
  text: "Get Started",
  attributes: {},
  computedStyle: {
    color: "rgb(255,255,255)",
    backgroundColor: "rgb(0,0,0)",
    fontSize: "16px",
    fontWeight: "600",
    padding: "8px",
    margin: "0px",
    width: "100px",
    height: "40px",
    display: "inline-block",
    borderRadius: "4px",
  },
  boundingRect: { x: 0, y: 0, width: 100, height: 40 },
  pageUrl: "http://localhost:3000/",
  timestamp: Date.now(),
  instruction: "make it bigger",
  autoApply: false,
};

async function main() {
  const server = await startServer({
    portRangeStart: 4017,
    portRangeEnd: 4017,
    cwd: testDir,
  });

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.on("open", () => {
      ws.send(JSON.stringify(samplePayload));
      setTimeout(() => {
        ws.close();
        resolve();
      }, 500);
    });
    ws.on("error", reject);
  });

  await new Promise((r) => setTimeout(r, 300));

  if (!fs.existsSync(queuePath)) {
    console.error("FAIL: queue.md not created at", queuePath);
    process.exitCode = 1;
  } else {
    const content = fs.readFileSync(queuePath, "utf8");
    if (!content.includes("make it bigger")) {
      console.error("FAIL: queue.md missing instruction");
      process.exitCode = 1;
    } else {
      console.log("PASS: queue-only path wrote queue.md");
    }
  }

  // Invalid autoApply type should not crash server
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.on("open", () => {
      ws.send(JSON.stringify({ ...samplePayload, autoApply: "yes" }));
      setTimeout(() => {
        ws.close();
        resolve();
      }, 200);
    });
    ws.on("error", reject);
  });

  console.log("PASS: invalid autoApply type ignored without crash");

  server.close(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
