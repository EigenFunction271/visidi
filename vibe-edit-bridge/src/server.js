/**
 * WebSocket server for vibe-edit-bridge.
 *
 * Responsibilities (PRD §7.2 + auto-apply-plan.md):
 *  - Bind to a port in the 4017-4020 range (extension hardcodes 4017).
 *  - Validate incoming payloads, reject malformed ones without crashing.
 *  - Append to queue.md; optionally spawn claude CLI when autoApply is true.
 */

const { WebSocketServer } = require("ws");
const { appendEditToQueue } = require("./writeQueue");
const { applyEditViaClaude } = require("./applyEdit");

let applyInFlight = false;

function isValidPayload(payload) {
  if (
    !payload ||
    payload.type !== "element_selected" ||
    typeof payload.selector !== "string" ||
    typeof payload.tag !== "string" ||
    !Array.isArray(payload.classes) ||
    !payload.computedStyle ||
    typeof payload.pageUrl !== "string"
  ) {
    return false;
  }
  if (
    payload.autoApply !== undefined &&
    typeof payload.autoApply !== "boolean"
  ) {
    return false;
  }
  if (
    payload.sourceConfidence !== undefined &&
    typeof payload.sourceConfidence !== "string"
  ) {
    return false;
  }
  if (
    payload.sourceHints !== undefined &&
    payload.sourceHints !== null &&
    typeof payload.sourceHints !== "object"
  ) {
    return false;
  }
  return true;
}

function sendApplyResult(ws, ok, message, extra = {}) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: "apply_result", ok, message, ...extra }));
  }
}

function logQueuedEdit(payload, result) {
  const time = new Date().toLocaleTimeString();
  const label = payload.text
    ? `"${payload.text.slice(0, 40)}"`
    : `<${payload.tag}>`;
  console.log(`[${time}] Queued edit: ${payload.tag} ${label}`);
  console.log(
    `[visidi-bridge]   wrote ${result.bytesWritten} bytes (${result.entryCount})`
  );
  console.log(`[visidi-bridge]   file: ${result.absolutePath}`);
}

function tryBindPort(port) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port });

    wss.on("listening", () => {
      resolve(wss);
    });

    wss.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(err);
      } else {
        console.error("[visidi-bridge] Server error:", err.message);
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
      wss = await tryBindPort(port);
      boundPort = port;
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!wss) {
    throw lastErr || new Error("Unable to bind any port in range.");
  }

  wss.on("connection", (ws, req) => {
    const client = req?.socket?.remoteAddress || "unknown";
    console.log(`[visidi-bridge] Client connected (${client})`);

    ws.on("message", (raw) => {
      console.log(`[visidi-bridge] Received message (${raw.length} bytes)`);

      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch (err) {
        const preview = raw.toString().slice(0, 200);
        console.warn(
          `[visidi-bridge] Received malformed JSON, ignoring: ${preview}`
        );
        return;
      }

      if (!isValidPayload(payload)) {
        console.warn(
          "[visidi-bridge] Received payload missing required fields, ignoring.",
          "Got keys:",
          Object.keys(payload || {}).join(", ") || "(none)"
        );
        return;
      }

      const autoApply = payload.autoApply === true;
      const instructionPreview =
        payload.instruction && payload.instruction.length > 0
          ? payload.instruction
          : "(no instruction — placeholder will be used)";

      console.log(
        `[visidi-bridge] Valid capture: <${payload.tag}> on ${payload.pageUrl}`
      );
      console.log(`[visidi-bridge]   selector: ${payload.selector}`);
      console.log(`[visidi-bridge]   instruction: ${instructionPreview}`);
      if (autoApply) {
        console.log("[visidi-bridge]   auto-apply: requested");
      }

      if (autoApply && applyInFlight) {
        console.warn(
          "[visidi-bridge] Auto-apply rejected — another apply is in flight"
        );
        sendApplyResult(ws, false, "busy");
        return;
      }

      appendEditToQueue(payload, cwd)
        .then(async (result) => {
          logQueuedEdit(payload, result);

          if (!autoApply) {
            console.log(
              "[visidi-bridge]   next step: tell your coding agent to read this file and apply the edit in source code"
            );
            return;
          }

          const confidence = payload.sourceConfidence || "none";
          if (confidence === "none") {
            console.warn(
              "[visidi-bridge]   auto-apply skipped — no reliable source location found (confidence: none); edit queued for manual review"
            );
            sendApplyResult(
              ws,
              false,
              "Auto-apply skipped — no reliable source location found for this element; edit queued in .vibe-edits/queue.md for manual review.",
              { skipped: true }
            );
            return;
          }

          applyInFlight = true;
          console.log("[visidi-bridge] Starting auto-apply via claude CLI…");

          try {
            const applyResult = await applyEditViaClaude(payload, cwd);
            if (applyResult.ok) {
              console.log("[visidi-bridge] Auto-apply finished successfully");
              sendApplyResult(ws, true, "Applied successfully");
            } else {
              const msg = applyResult.error || "claude exited with error";
              console.error(`[visidi-bridge] Auto-apply failed: ${msg}`);
              sendApplyResult(ws, false, msg);
            }
          } finally {
            applyInFlight = false;
          }
        })
        .catch((err) => {
          console.error(
            "[visidi-bridge] Failed to write to queue file:",
            err.message
          );
          if (autoApply) {
            sendApplyResult(ws, false, err.message);
          }
        });
    });

    ws.on("close", () => {
      console.log("[visidi-bridge] Client disconnected");
    });

    ws.on("error", (err) => {
      console.warn("[visidi-bridge] Client connection error:", err.message);
    });
  });

  return {
    port: boundPort,
    close: (cb) => wss.close(cb),
  };
}

module.exports = { startServer };
