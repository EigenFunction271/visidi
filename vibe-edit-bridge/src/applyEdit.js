/**
 * Auto-apply via Claude CLI — documentation/auto-apply-plan.md
 *
 * Verified against local `claude --help` (2026-06):
 *   claude -p "<prompt>" --permission-mode acceptEdits
 *
 * - `-p` / `--print`: non-interactive; prints response and exits
 * - `--permission-mode acceptEdits`: file edits only; no bash/network tools
 *   without explicit approval (safer than bypassPermissions for local auto-apply)
 */

const { spawn, exec } = require("child_process");
const { formatPrompt } = require("./formatPrompt");

const DEFAULT_TIMEOUT_MS = 60_000;

function printGitDiffStat(cwd) {
  return new Promise((resolve) => {
    exec("git diff --stat", { cwd }, (err, stdout) => {
      if (!err && stdout && stdout.trim()) {
        process.stdout.write("[visidi-bridge] git diff --stat:\n");
        process.stdout.write(stdout);
        if (!stdout.endsWith("\n")) process.stdout.write("\n");
      }
      resolve();
    });
  });
}

function applyEditViaClaude(payload, cwd, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const prompt = formatPrompt(payload);

  return new Promise((resolve) => {
    const child = spawn(
      "claude",
      ["-p", prompt, "--permission-mode", "acceptEdits"],
      { cwd, stdio: ["ignore", "pipe", "pipe"] }
    );

    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);

    child.stdout.on("data", (d) => process.stdout.write(`[claude] ${d}`));
    child.stderr.on("data", (d) => process.stderr.write(`[claude] ${d}`));

    child.on("exit", (code) => {
      clearTimeout(timer);
      printGitDiffStat(cwd).finally(() => {
        resolve({ ok: code === 0, error: code === 0 ? undefined : `exit code ${code}` });
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
}

module.exports = { applyEditViaClaude };
