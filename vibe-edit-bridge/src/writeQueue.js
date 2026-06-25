/**
 * Queue file writer for vibe-edit-bridge.
 *
 * Appends formatted edit blocks to <cwd>/.vibe-edits/queue.md, creating
 * the directory/file if absent. Most recent entry goes at the bottom
 * (chronological order) — see PRD §7.2.
 */

const fs = require("fs");
const path = require("path");
const { formatPrompt } = require("./formatPrompt");

async function appendEditToQueue(payload, cwd) {
  const dir = path.join(cwd, ".vibe-edits");
  const filePath = path.join(dir, "queue.md");

  await fs.promises.mkdir(dir, { recursive: true });

  const block = formatPrompt(payload);
  const exists = fs.existsSync(filePath);
  const separator = exists ? "\n\n---\n\n" : "";
  const content = separator + block + "\n";

  await fs.promises.appendFile(filePath, content, "utf8");

  return {
    filePath,
    absolutePath: path.resolve(filePath),
    bytesWritten: Buffer.byteLength(content, "utf8"),
    entryCount: exists ? "appended" : "created",
  };
}

module.exports = { appendEditToQueue };
