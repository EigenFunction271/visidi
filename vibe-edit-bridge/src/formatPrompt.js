/**
 * Prompt formatting for vibe-edit-bridge.
 *
 * IMPORTANT: this function is intentionally duplicated in
 * vibe-edit-extension/content.js (formatPromptText). The two packages have
 * no shared build step in v1, so keep both copies byte-for-byte identical
 * when editing either one. See PRD §6.6.
 */

function formatPrompt(payload) {
  const classesStr = payload.classes.length
    ? payload.classes.join(" ")
    : "(none)";
  const textPreview = (payload.text || "").slice(0, 80);
  const instruction =
    payload.instruction && payload.instruction.length > 0
      ? payload.instruction
      : '[Edit this line with what you want changed — e.g. "Make the background green and increase the padding."]';

  return [
    `## Edit request — ${payload.tag} element`,
    "",
    `**What it is:** ${payload.tag} element with text "${textPreview}"`,
    `**Location on page:** ${payload.selector}`,
    `**Classes:** ${classesStr}`,
    `**Current style:** color ${payload.computedStyle.color}, background ${payload.computedStyle.backgroundColor}, font-size ${payload.computedStyle.fontSize}, padding ${payload.computedStyle.padding}`,
    `**Page:** ${payload.pageUrl}`,
    "",
    `**Instruction:** ${instruction}`,
  ].join("\n");
}

module.exports = { formatPrompt };
