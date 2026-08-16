// The popup is re-read from disk every time it opens, so it can reload the
// extension even when a stale reload tab has made `npm run reload` a no-op.
const version = document.querySelector("#version");
const reloadButton = document.querySelector("#reloadButton");

version.textContent = chrome.runtime.getManifest().version;

reloadButton.addEventListener("click", () => {
  reloadButton.disabled = true;
  reloadButton.textContent = "重新加载中…";
  chrome.runtime.reload();
});
