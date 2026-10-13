"use strict";
const ACTIONS = new Set(["ping", "getContentStatus", "startAutoGenerate", "cancelAutoGenerate"]);
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (request?.action === "showCompletionNotification") {
    if (!Number.isInteger(request.count) || request.count <= 0) {
      respond({ ok: false, error: "완료 횟수가 올바르지 않습니다." });
      return false;
    }
    chrome.storage.sync.get(["autoCompletionNotificationEnabled"], (stored = {}) => {
      if (chrome.runtime.lastError) {
        respond({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      if (stored.autoCompletionNotificationEnabled === false) {
        respond({ ok: true, skipped: true });
        return;
      }
      chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: "AutoNai personal · 자동 생성 완료",
        message: `${request.count}회 반복 생성을 완료했습니다.`,
        priority: 0,
        requireInteraction: false,
      }, () => {
        const error = chrome.runtime.lastError;
        respond(error ? { ok: false, error: error.message } : { ok: true });
      });
    });
    return true;
  }
  if (!ACTIONS.has(request?.action)) return false;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    if (chrome.runtime.lastError || !tab?.id || !tab.url?.startsWith("https://novelai.net/image")) {
      respond({ ok: false, error: "NovelAI 이미지 페이지를 열어 주세요." });
      return;
    }
    chrome.tabs.sendMessage(tab.id, request, (response) => {
      if (chrome.runtime.lastError) {
        respond({ ok: false, error: "NovelAI 페이지를 새로고침해 주세요." });
        return;
      }
      respond(response || { ok: false, error: "페이지 응답을 받지 못했습니다." });
    });
  });
  return true;
});
