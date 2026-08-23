import { buildCheckinView } from "./hoyolab-popup.js";

const initPopup = () => {
  const elements = {
    version: document.querySelector("#version"),
    overallStatus: document.querySelector("#overallStatus"),
    statusChip: document.querySelector("#statusChip"),
    checkin: document.querySelector(".checkin"),
    summary: document.querySelector("#checkinSummary"),
    status: document.querySelector("#checkinStatus"),
    detail: document.querySelector("#checkinDetail"),
    last: document.querySelector("#lastCheckin"),
    next: document.querySelector("#nextCheckin"),
    toggle: document.querySelector("#autoCheckin"),
    checkinButton: document.querySelector("#checkinButton"),
    reloadButton: document.querySelector("#reloadButton"),
  };
  let currentState = {
    enabled: true,
    status: "idle",
    lastRunAt: null,
    nextRunAt: null,
    results: [],
  };

  const render = (state) => {
    currentState = state;
    const view = buildCheckinView(state);
    elements.overallStatus.dataset.tone = view.tone;
    elements.overallStatus.setAttribute("aria-label", `${view.chip}：${view.title}。${view.detail}`);
    elements.statusChip.textContent = view.chip;
    elements.checkin.dataset.tone = view.tone;
    elements.summary.setAttribute("aria-busy", String(view.busy));
    elements.status.textContent = view.title;
    elements.detail.textContent = view.detail;
    elements.last.textContent = view.last;
    elements.next.textContent = view.next;
    elements.toggle.checked = Boolean(state.enabled);
    elements.toggle.disabled = view.busy;
    elements.checkinButton.disabled = view.busy;
    elements.checkinButton.textContent = view.action;
  };

  const readState = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "utils.hoyolab.getState" });
      if (!response?.ok) {
        throw new Error("state-unavailable");
      }
      render(response.state);
      elements.toggle.disabled = false;
    } catch {
      render({
        ...currentState,
        status: "failed",
        lastRunAt: Date.now(),
        results: [{ status: "failed" }],
      });
      elements.toggle.disabled = false;
    }
  };

  elements.version.textContent = chrome.runtime.getManifest().version;

  elements.toggle.addEventListener("change", async () => {
    const enabled = elements.toggle.checked;
    elements.toggle.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: "utils.hoyolab.setEnabled", enabled });
      if (!response?.ok) {
        throw new Error("setting-failed");
      }
      render(response.state);
    } catch {
      elements.toggle.checked = currentState.enabled;
    } finally {
      elements.toggle.disabled = currentState.status === "running";
    }
  });

  elements.checkinButton.addEventListener("click", async () => {
    render({ ...currentState, status: "running" });
    try {
      const response = await chrome.runtime.sendMessage({ type: "utils.hoyolab.run" });
      if (!response?.ok) {
        throw new Error("run-failed");
      }
      render(response.state);
    } catch {
      render({
        ...currentState,
        status: "failed",
        lastRunAt: Date.now(),
        results: [{ status: "failed" }],
      });
    }
  });

  elements.reloadButton.addEventListener("click", () => {
    elements.reloadButton.disabled = true;
    elements.reloadButton.textContent = "重新加载中…";
    chrome.runtime.reload();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.hoyolabCheckin?.newValue) {
      render({ ...currentState, ...changes.hoyolabCheckin.newValue });
    }
  });

  void readState();
};

if (typeof document !== "undefined" && globalThis.chrome?.runtime) {
  initPopup();
}
