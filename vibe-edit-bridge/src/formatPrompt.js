/**
 * Prompt formatting for vibe-edit-bridge.
 *
 * IMPORTANT: this function is intentionally duplicated in
 * vibe-edit-extension/content.js (formatPromptText). The two packages have
 * no shared build step in v1, so keep both copies byte-for-byte identical
 * when editing either one. See PRD §6.6 and documentation/source-mapping-plan.md.
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

  const lines = [
    `## Edit request — ${payload.tag} element`,
    "",
    `**What it is:** ${payload.tag} element with text "${textPreview}"`,
    `**Location on page:** ${payload.selector}`,
    `**Classes:** ${classesStr}`,
  ];

  if (payload.id) {
    lines.push(`**ID:** ${payload.id}`);
  }

  if (payload.attributes && (payload.attributes.href || payload.attributes.src)) {
    const attrBits = [];
    if (payload.attributes.href) attrBits.push(`href="${payload.attributes.href}"`);
    if (payload.attributes.src) attrBits.push(`src="${payload.attributes.src}"`);
    lines.push(`**Attributes:** ${attrBits.join(", ")}`);
  }

  lines.push(
    `**Current style:** color ${payload.computedStyle.color}, background ${payload.computedStyle.backgroundColor}, font-size ${payload.computedStyle.fontSize}, padding ${payload.computedStyle.padding}`
  );

  if (payload.boundingRect) {
    const r = payload.boundingRect;
    lines.push(
      `**Bounding box:** x=${r.x}, y=${r.y}, width=${r.width}, height=${r.height}`
    );
  }

  if (payload.sourceHints && payload.sourceHints.fileName) {
    const { fileName, lineNumber, columnNumber, matchedVia } = payload.sourceHints;
    const loc = lineNumber
      ? `${fileName}:${lineNumber}${columnNumber ? `:${columnNumber}` : ""}`
      : fileName;
    lines.push(`**Likely source location:** ${loc} (via ${matchedVia})`);
  } else if (payload.sourceHints && payload.sourceHints.componentName) {
    lines.push(
      `**Likely component:** <${payload.sourceHints.componentName} /> (via ${payload.sourceHints.matchedVia} — exact file/line not available; search for this component name)`
    );
  }

  lines.push(`**Page:** ${payload.pageUrl}`);
  lines.push("");
  lines.push(
    "Note: this element may be one of several rendered instances of a shared/looped component. If your search matches more than one location in source, use the bounding box, attributes, and surrounding text to pick the correct one — don't guess silently."
  );
  lines.push("");
  lines.push(`**Instruction:** ${instruction}`);

  return lines.join("\n");
}

module.exports = { formatPrompt };
