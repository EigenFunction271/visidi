/**
 * WebSocket server for vibe-edit-bridge.
 *
 * Responsibilities (PRD §7.2):
 *  - Bind to a port in the 4017-4020 range (extension hardcodes 4017, see
 *    cli.js warning if we fall back).
 *  - Validate incoming payloads, reject malformed ones without crashing.
 *  - Hand valid payloads to writeQueue for formatting + appending to disk.
 */

const { WebSocketServer } = require("ws");
const { appendEditToQueue } = require("./writeQueue");

function isValidPayload(payload) {
  return (
    payload &&
    payload.type === "element_selected" &&
    typeof payload.selector === "string" &&
    typeof payload.tag === "string" &&
    Array.isArray(payload.classes) &&
    payload.computedStyle &&
    typeof payload.pageUrl === "string"
  );
}

function tryBindPort(port, cwd) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port });

    wss.on("listening", () => {
      resolve(wss);
    });

    wss.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(err); // caller tries the next port in range
      } else {
        // Unexpected error after binding (e.g. mid-session) — log, don't crash.
        console.error("[vibe-edit-bridge] Server error:", err.message);
      }
    });
  });
}

async function startServer({ portRangeStart, portRangeEnd, cwd }) {
  let wss = null;
  let boundPort = null;
  let lastErr = null;

  for (let port = portRangeStart; port <= portRangeEnd; port += 1) {
    try {
      wss = await tryBindPort(port, cwd);
      boundPort = port;
      break;
    } catch (err) {
      lastErr = err;
      // EADDRINUSE — try next port in range, per PRD §7.2
    }
  }

  if (!wss) {
    throw lastErr || new Error("Unable to bind any port in range.");
  }

  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch (err) {
        const preview = raw.toString().slice(0, 200);
        console.warn(
          `[vibe-edit-bridge] Received malformed JSON, ignoring: ${preview}`
        );
        return;
      }

      if (!isValidPayload(payload)) {
        console.warn(
          "[vibe-edit-bridge] Received payload missing required fields, ignoring."
        );
        return;
      }

      appendEditToQueue(payload, cwd)
        .then(() => {
          const time = new Date().toLocaleTimeString();
          const label = payload.text
            ? `"${payload.text.slice(0, 40)}"`
            : `<${payload.tag}>`;
          console.log(
            `[${time}] Queued edit: ${payload.tag} ${label} — .vibe-edits/queue.md`
          );
        })
        .catch((err) => {
          // PRD §7.3 — directory/permission issues should not crash the server
          console.error(
            "[vibe-edit-bridge] Failed to write to queue file:",
            err.message
          );
        });
    });

    ws.on("error", (err) => {
      console.warn("[vibe-edit-bridge] Client connection error:", err.message);
    });
  });

  return {
    port: boundPort,
    close: (cb) => wss.close(cb),
  };
}

module.exports = { startServer };
