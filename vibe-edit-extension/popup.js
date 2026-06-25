/**
 * Popup script for Visidi.
 *
 * Responsibilities (PRD §6.5):
 *  - Send TOGGLE_PICK_MODE to the active tab's content script.
 *  - Detect the file:// permission gap, which is the single most likely
 *    workshop support issue, and surface it directly in the popup rather
 *    than only documenting it in a README.
 */

document.getElementById("activate-btn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PICK_MODE" });
  window.close(); // close popup so it doesn't block the page click
});

(async function checkFileUrlPermission() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !tab.url.startsWith("file://")) return;

  chrome.extension.isAllowedFileSchemeAccess((isAllowed) => {
    if (!isAllowed) {
      const warning = document.getElementById("file-warning");
      warning.style.display = "block";

      const link = document.getElementById("extensions-link");
      link.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.tabs.create({
          url: `chrome://extensions/?id=${chrome.runtime.id}`,
        });
      });
    }
  });
})();
