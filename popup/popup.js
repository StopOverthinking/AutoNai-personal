"use strict";
const presets = Array.from(document.querySelectorAll("[data-count]"));
const toggle = document.getElementById("toggle");

const progress = document.getElementById("progress");
const status = document.getElementById("status");
const notificationToggle = document.getElementById("completion-notification");
const notificationStatus = document.getElementById("notification-status");
const NOTIFICATION_KEY = "autoCompletionNotificationEnabled";
function notificationError(error) {
  notificationStatus.textContent = error ? "알림 설정을 저장하거나 불러오지 못했습니다." : "";
  notificationStatus.dataset.error = String(Boolean(error));
}
chrome.storage.sync.get([NOTIFICATION_KEY], (stored = {}) => {
  const error = chrome.runtime.lastError;
  notificationError(error);
  if (!error) {
    notificationToggle.checked = stored[NOTIFICATION_KEY] !== false;
    notificationToggle.disabled = false;
  }
});
notificationToggle.addEventListener("change", () => {
  const enabled = notificationToggle.checked;
  notificationToggle.disabled = true;
  chrome.storage.sync.set({ [NOTIFICATION_KEY]: enabled }, () => {
    const error = chrome.runtime.lastError;
    notificationError(error);
    if (error) notificationToggle.checked = !enabled;
    notificationToggle.disabled = false;
  });
});
const onNotificationSettingChanged = (changes, area) => {
  if (area === "sync" && changes[NOTIFICATION_KEY]) {
    notificationToggle.checked = changes[NOTIFICATION_KEY].newValue !== false;
  }
};
chrome.storage.onChanged.addListener(onNotificationSettingChanged);
let pending = false;
let active = false;
let target = 3;
let revision = 0;
function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (response) =>
    resolve(chrome.runtime.lastError ? { ok: false, error: "페이지 연결에 실패했습니다." } : response)));
}
function showStatus(message, error = false) {
  status.textContent = message || "";
  status.dataset.error = String(error || /못|찾지|벗어나/.test(message || ""));
  toggle.title = (message || "") + "\nCtrl+Enter 시작 · Ctrl+Alt+Enter 중지";
}
async function refresh() {
  if (pending) return;
  const current = revision;
  const response = await send({ action: "getContentStatus" });
  if (pending || current !== revision) return;
  const connected = Boolean(response?.ok);
  active = Boolean(response?.autoActive);
  toggle.disabled = !connected || (!active && !response.hasGenerateButton);
  if (connected) target = response.target;
  for (const button of presets) {
    button.disabled = !connected || active;
    button.setAttribute("aria-pressed", String(Number(button.dataset.count) === target));
  }

  toggle.setAttribute("aria-label", active ? "중지" : "시작");
  toggle.dataset.active = String(active);
  progress.textContent = (response?.completed || 0) + " / " + target;
  showStatus(connected ? response.message : response?.error || "페이지 연결을 확인해 주세요.", !connected);
}
toggle.disabled = true;
toggle.addEventListener("click", async () => {
  pending = true;
  revision++;
  toggle.disabled = true;
  presets.forEach(button => { button.disabled = true; });
  const response = await send({ action: active ? "cancelAutoGenerate" : "startAutoGenerate", count: target });
  pending = false;
  await refresh();
  if (!response?.ok) showStatus(response?.error || "실행에 실패했습니다.", true);
});
for (const button of presets) {
  button.disabled = true;
  button.addEventListener("click", () => {
    if (active || pending) return;
    revision++;
    target = Number(button.dataset.count);
    presets.forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    chrome.storage.sync.set({ gcount: target, intervalTime: 1 }, () => void refresh());
  });
}
void refresh();
const timer = setInterval(refresh, 500);
window.addEventListener("pagehide", () => {
  clearInterval(timer);
  chrome.storage.onChanged.removeListener(onNotificationSettingChanged);
});
