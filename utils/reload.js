// Ask the service worker to reload instead of calling chrome.runtime.reload() here:
// this page dies with the extension, leaving a dead tab that Chrome then re-focuses
// on the next `npm run reload` instead of loading this script again — a silent no-op.
chrome.runtime.sendMessage({ type: "utils.reload" }).catch(() => {
  chrome.runtime.reload();
});
