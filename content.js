(function loadRepeatGenerator() {
  "use strict";
  if (window.__naiRepeatGeneratorLoaded) return;
  window.__naiRepeatGeneratorLoaded = true;

  const COUNTS = [3, 5, 10, 20];
  const INTERVAL_MS = 1000;
  const TIMEOUT_MS = 10 * 60 * 1000;
  const CONFIRMATION_NOTICE_MS = 30000;
  const READY_STABLE_MS = 300;
  const GENERATE_SELECTOR = "button.image-gen-generate-button";
  const GENERATE_LABEL = /\bGenerate\s*(\d*)\s*Images?\b/i;
  const BUSY_LABEL = /\bGenerating\b|\bQueued\b|\bWaiting\s+(?:in\s+)?(?:the\s+)?queue\b|\b(?:Cancel|Stop)\s+Generation\b/i;
  const state = { active: false, target: 3, completed: 0, phase: "idle", deadline: 0, nextAt: 0,
    noticeAt: 0, readySince: null };
  let lastGenerateButton = null;
  let pendingButton = null;
  let timer = null;
  let disposed = false;
  const host = document.createElement("div");
  host.id = "nai-repeat-generator";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = "<style>:host{position:fixed;right:8px;top:64px;z-index:2147483647;color-scheme:dark}* { box-sizing: border-box; }\n.card { width: 116px; max-width: calc(100vw - 16px); display: grid; gap: 5px; padding: 6px; border: 1px solid rgba(39,214,196,.48); border-radius: 7px; background: #111820; color: #eafffb; box-shadow: 0 10px 28px rgba(0,0,0,.38); font: 10px system-ui; }\n.handle { display: grid; place-items: center; height: 8px; padding: 0; border: 0; background: transparent; color: #718f91; cursor: grab; touch-action: none; user-select: none; } .handle::before { content: \"\"; width: 24px; height: 3px; border-radius: 2px; background: currentColor; } .handle:hover { color: #27d6c4; } .handle:active { cursor: grabbing; }\n.presets { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 3px; }\nbutton { font-family: inherit; cursor: pointer; }\n.presets button { min-width: 0; height: 24px; border: 1px solid rgba(151,170,174,.28); border-radius: 4px; background: #202a34; color: #dce8ea; padding: 1px 2px; font-size: 10px; font-weight: 800; }\n.presets button:hover { border-color: rgba(39,214,196,.56); color: #f2fffd; }\n.presets button[aria-pressed=\"true\"] { border-color: #27d6c4; background: #243f3f; color: #f2fffd; }\n.toggle { min-width: 0; min-height: 28px; display: grid; grid-template-columns: 14px minmax(0,1fr); grid-template-rows: auto; align-items: center; column-gap: 5px; row-gap: 2px; border: 1px solid rgba(39,214,196,.48); border-radius: 5px; background: #243f3f; color: #f2fffd; padding: 5px 6px; text-align: left; font-size: 11px; font-weight: 800; line-height: 1; }\n.icon {  width: 0; height: 0; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 8px solid currentColor; margin-left: 2px; }\n.progress { color: #aab8ba; font-size: 9px; font-weight: 400; }\n.toggle[data-active=\"true\"] { border-color: rgba(255,149,118,.58); background: #3d2528; }\n.toggle[data-active=\"true\"] .icon { width: 8px; height: 8px; border: 0; background: currentColor; }\nbutton:disabled { opacity: .5; cursor: default; }\nbutton:focus-visible { outline: 2px solid #27d6c4; outline-offset: 1px; }\n.status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); margin: 0; }\n.status[data-error=\"true\"] { position: static; width: auto; height: auto; clip-path: none; color: #ffbba7; font-size: 10px; line-height: 1.4; overflow-wrap: anywhere; }</style><section class=\"card\" aria-label=\"반복 생성\">\n  <button class=\"handle\" type=\"button\" aria-label=\"패널 이동\" title=\"드래그로 이동 · 방향키로 이동\"></button>\n  <div class=\"presets\" role=\"group\" aria-label=\"생성 횟수\">\n    <button type=\"button\" data-count=\"3\" aria-pressed=\"true\">3</button>\n    <button type=\"button\" data-count=\"5\" aria-pressed=\"false\">5</button>\n    <button type=\"button\" data-count=\"10\" aria-pressed=\"false\">10</button>\n    <button type=\"button\" data-count=\"20\" aria-pressed=\"false\">20</button>\n  </div>\n  <button id=\"toggle\" class=\"toggle\" type=\"button\" aria-label=\"시작\" title=\"Ctrl+Enter 시작 · Ctrl+Alt+Enter 중지\">\n    <span class=\"icon\" aria-hidden=\"true\"></span><span id=\"progress\" class=\"progress\">0 / 3</span>\n  </button>\n  <p id=\"status\" class=\"status\" role=\"status\">준비 중…</p>\n</section>";
  (document.body || document.documentElement).append(host);
  const presets = Array.from(shadow.querySelectorAll("[data-count]"));
  const toggle = shadow.querySelector("#toggle");

  const progress = shadow.querySelector("#progress");
  const status = shadow.querySelector("#status");
  const handle = shadow.querySelector(".handle");
  const feedbackStyle = document.createElement("style");
  feedbackStyle.textContent = `
    .completion { position: fixed; inset: 0; width: 360px; max-width: calc(100vw - 32px);
      margin: auto; padding: 24px; border: 1px solid #27d6c4; border-radius: 12px;
      background: #111820; color: #eafffb; text-align: center; font: 14px/1.6 system-ui;
      box-shadow: 0 18px 60px #0008; }
    .completion::backdrop { background: rgba(7,10,14,.72); }
    .completion h2 { margin: 0 0 8px; font-size: 22px; }
    .completion p { margin: 0 0 20px; color: #b9cdce; }
    .completion button { padding: 8px 24px; border: 1px solid #27d6c4; border-radius: 6px;
      background: #243f3f; color: #f2fffd; font-size: 14px; font-weight: 700; }
  `;
  const completion = document.createElement("dialog");
  completion.className = "completion";
  completion.setAttribute("aria-labelledby", "completion-title");
  completion.setAttribute("aria-describedby", "completion-message");
  completion.innerHTML = '<h2 id="completion-title">자동 생성 완료</h2><p id="completion-message"></p><form method="dialog"><button autofocus>확인</button></form>';
  shadow.append(feedbackStyle, completion);
  completion.addEventListener("click", (event) => {
    const rect = completion.getBoundingClientRect();
    if (event.target === completion && (event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom)) completion.close();
  });

  // Group identity is independent of the site's container names, tags, and roles.
  // Keep the scoped fallback for older individual-image histories.
  const HISTORY_CONTAINER_SELECTOR = "#historyContainer, .image-gen-history";
  const HISTORY_SELECTOR = '[data-group-id], :is(#historyContainer, .image-gen-history) [role="button"][draggable="true"]';
  let historyBaseline = null;
  let originalHistoryKeys = new Set();
  const generatedHistoryImages = new Map();
  let expectedImages = 0;
  let historyTimer = null;
  let feedbackUpdate = null;
  const highlighted = new Map();
  function historyItems() {
    return Array.from(document.querySelectorAll(HISTORY_SELECTOR))
      .filter(item => !item.parentElement?.closest("[data-group-id]"));
  }
  function historyKey(item) {
    const groupId = item.getAttribute("data-group-id");
    if (groupId) return "group:" + groupId;
    return historyThumbnail(item);
  }
  function historyThumbnail(item) {
    const images = Array.from(item.querySelectorAll("img")).map(img => img.currentSrc || img.src).filter(Boolean).join("|");
    if (images) return images;
    // Thumbnails may move into a child or from inline styles to a CSS rule.
    for (const node of [item, ...item.querySelectorAll("*")]) {
      const background = node.style.backgroundImage || getComputedStyle(node).backgroundImage;
      if (background.includes("url(")) return background;
    }
    return "";
  }
  function historyImageCount(item) {
    if (!item.hasAttribute("data-group-id")) return 1;
    // Current history renders one thumbnail per batch, with an x2/x3/x4 badge.
    const badge = Array.from(item.querySelectorAll("*")).find(node => /^[x×]\s*\d+$/i.test(node.textContent.trim()));
    return Number(badge?.textContent.trim().match(/\d+/)?.[0]) || 1;
  }
  function historyReady(item) {
    if (!historyThumbnail(item)) return false;
    if (item.getAttribute("aria-busy") === "true" || item.querySelector('[aria-busy="true"]')) return false;
    const remove = item.querySelector('button[aria-label="delete image(s)"]');
    return !remove?.disabled;
  }
  function historyContainer(item) {
    const known = item.closest(HISTORY_CONTAINER_SELECTOR);
    if (known) return known;
    // A renamed list can also wrap each item in another element.
    let parent = item.parentElement;
    while (parent?.parentElement && parent.querySelectorAll("[data-group-id]").length < 2) parent = parent.parentElement;
    return parent;
  }
  function newHistoryItems(baseline, originalKeys, readyOnly = true) {
    const pastOriginalGroups = new Set();
    return historyItems().filter(item => {
      const key = historyKey(item);
      const group = item.hasAttribute("data-group-id");
      const container = historyContainer(item);
      // New groups are prepended; scrolling can append previously unmounted old groups.
      if (group && originalKeys.has(key)) pastOriginalGroups.add(container);
      return key && (!readyOnly || historyReady(item)) && !originalKeys.has(key)
        && (generatedHistoryImages.has(key) || !group || !pastOriginalGroups.has(container))
        && (!baseline.has(item) || (baseline.get(item) && baseline.get(item) !== key));
    });
  }
  function unmarkHistoryItem(item, position) {
    item.classList.remove("nai-repeat-history-highlight");
    // Do not overwrite position changes made by the site after we marked it.
    if (position !== null && item.style.position === "relative") item.style.position = position;
    highlighted.delete(item);
  }
  function reconcileHistoryFeedback() {
    if (!historyBaseline) return;
    const items = historyItems();
    const current = new Set(items);
    for (const [item, entry] of highlighted) {
      if (!current.has(item) || historyKey(item) !== entry.key || !historyReady(item)) unmarkHistoryItem(item, entry.position);
    }
    for (const item of items) {
      const key = historyKey(item);
      if (!generatedHistoryImages.has(key) || !historyReady(item)) {
        if (item.classList.contains("nai-repeat-history-highlight")) item.classList.remove("nai-repeat-history-highlight");
        continue;
      }
      if (!highlighted.has(item)) {
        const position = getComputedStyle(item).position === "static" ? item.style.position : null;
        highlighted.set(item, { key, position });
      }
      const entry = highlighted.get(item);
      if (getComputedStyle(item).position === "static") {
        entry.position = item.style.position;
        item.style.position = "relative";
      }
      if (!item.classList.contains("nai-repeat-history-highlight")) item.classList.add("nai-repeat-history-highlight");
    }
  }
  // Keep restoring recorded identities until the next generation or navigation.
  // Finishing collection must not stop observing remounts and className resets.
  const historyFeedbackObserver = new MutationObserver(() => {
    if (feedbackUpdate !== null) return;
    feedbackUpdate = setTimeout(() => {
      feedbackUpdate = null;
      reconcileHistoryFeedback();
    }, 0);
  });
  function clearHistoryFeedback() {
    clearInterval(historyTimer);
    historyTimer = null;
    historyFeedbackObserver.disconnect();
    clearTimeout(feedbackUpdate);
    feedbackUpdate = null;
    for (const [item, entry] of highlighted) unmarkHistoryItem(item, entry.position);
    // A replacement may inherit our class before the observer reconciles it.
    for (const item of document.querySelectorAll(".nai-repeat-history-highlight")) {
      item.classList.remove("nai-repeat-history-highlight");
    }
    highlighted.clear();
  }
  function resetFeedback() {
    clearHistoryFeedback();
    completion.close();
    historyBaseline = null;
    originalHistoryKeys.clear();
    generatedHistoryImages.clear();
    expectedImages = 0;
  }
  function collectGeneratedHistory() {
    if (!historyBaseline) return;
    for (const item of newHistoryItems(historyBaseline, originalHistoryKeys, false)) {
      const key = historyKey(item);
      // Remember pending identities too, so an already observed placeholder can
      // become visible after the late-result collection window has ended.
      const count = historyReady(item) ? historyImageCount(item) : 0;
      generatedHistoryImages.set(key, Math.max(generatedHistoryImages.get(key) || 0, count));
    }
  }
  function highlightGeneratedHistory(waitForPending = false) {
    if (!historyBaseline || !expectedImages) return;
    clearInterval(historyTimer);
    const expected = expectedImages;
    const pendingDeadline = Date.now() + TIMEOUT_MS;
    let settleDeadline = waitForPending ? null : Date.now() + 10000;
    const check = () => {
      // History thumbnails can arrive after the Generate button becomes ready.
      collectGeneratedHistory();
      reconcileHistoryFeedback();
      if (settleDeadline === null) {
        const button = findGenerateButton();
        if ((button && !isBusy(button)) || Date.now() >= pendingDeadline) settleDeadline = Date.now() + 10000;
      }
      const imageCount = Array.from(generatedHistoryImages.values()).reduce((total, count) => total + count, 0);
      if (imageCount >= expected || (settleDeadline !== null && Date.now() >= settleDeadline)) {
        clearInterval(historyTimer);
        historyTimer = null;
      }
    };
    historyFeedbackObserver.observe(document.documentElement, { subtree: true, childList: true,
      characterData: true, attributes: true,
      attributeFilter: ["class", "style", "src", "srcset", "data-group-id", "disabled", "aria-busy"] });
    historyTimer = setInterval(check, 200);
    check();
  }
  function showCompletionFeedback() {
    // Notification delivery must not interfere with the in-page completion feedback.
    try {
      chrome.runtime.sendMessage({ action: "showCompletionNotification", count: state.completed }, () => {
        void chrome.runtime.lastError;
      });
    } catch (_) {
      // The extension may have been reloaded while this page was generating.
    }
    highlightGeneratedHistory();
    shadow.querySelector("#completion-message").textContent = `${state.completed} / ${state.target}회 반복 생성을 완료했습니다.`;
    completion.showModal();
  }
  const POSITION_KEY = "naiRepeatGenerator.position";
  let drag = null;
  let positionTouched = false;
  function place(left, top) {
    const rect = host.getBoundingClientRect();
    const x = Math.max(8, Math.min(left, Math.max(8, window.innerWidth - rect.width - 8)));
    const y = Math.max(8, Math.min(top, Math.max(8, window.innerHeight - rect.height - 8)));
    host.style.right = "auto";
    host.style.left = x + "px";
    host.style.top = y + "px";
    return { left: x, top: y };
  }
  function savePosition() {
    const rect = host.getBoundingClientRect();
    chrome.storage.local.set({ [POSITION_KEY]: { left: rect.left, top: rect.top } });
  }
  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const pointerId = drag.id;
    drag = null;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    savePosition();
  }
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    positionTouched = true;
    const rect = host.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    place(event.clientX - drag.x, event.clientY - drag.y);
  });
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("lostpointercapture", endDrag);
  handle.addEventListener("keydown", (event) => {
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault();
    positionTouched = true;
    const rect = host.getBoundingClientRect();
    const step = event.shiftKey ? 20 : 5;
    place(rect.left + direction[0] * step, rect.top + direction[1] * step);
    savePosition();
  });
  function keepOnScreen() {
    const rect = host.getBoundingClientRect();
    place(rect.left, rect.top);
  }
  window.addEventListener("resize", keepOnScreen);
  chrome.storage.local.get([POSITION_KEY], (stored = {}) => {
    if (disposed || positionTouched) return;
    const position = stored[POSITION_KEY];
    if (Number.isFinite(position?.left) && Number.isFinite(position?.top)) place(position.left, position.top);
    else keepOnScreen();
  });
  function normalizeCount(value) {
    return COUNTS.includes(Number(value)) ? Number(value) : 3;
  }
  function findGenerateButton() {
    const visible = button => button?.isConnected && button.getClientRects().length > 0
      && getComputedStyle(button).visibility !== "hidden"
      && (!button.checkVisibility || button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
    if (visible(lastGenerateButton)
      && (lastGenerateButton.matches(GENERATE_SELECTOR)
        || GENERATE_LABEL.test(buttonLabel(lastGenerateButton)) || isBusy(lastGenerateButton))) return lastGenerateButton;
    lastGenerateButton = Array.from(document.querySelectorAll(GENERATE_SELECTOR)).find(visible)
      || Array.from(document.querySelectorAll("button")).find(button => visible(button)
      && (GENERATE_LABEL.test(buttonLabel(button)) || BUSY_LABEL.test(buttonLabel(button)))) || null;
    return lastGenerateButton;
  }
  function buttonLabel(button) {
    return [button.textContent, button.getAttribute("aria-label"), button.getAttribute("title")].filter(Boolean).join(" ");
  }
  function generationImageCount(button) {
    const count = buttonLabel(button).match(GENERATE_LABEL)?.[1]
      || (button.matches(GENERATE_SELECTOR) && button.querySelector("span")?.textContent.match(/\d+/)?.[0]);
    return Number(count) || 1;
  }
  function isBusy(button) {
    return button.disabled || button.matches(":disabled") || button.getAttribute("aria-disabled") === "true"
      || button.getAttribute("aria-busy") === "true" || BUSY_LABEL.test(button.textContent || "")
      || BUSY_LABEL.test(button.getAttribute("aria-label") || "");
  }
  function render(message) {
    for (const button of presets) {
      button.disabled = state.active;
      button.setAttribute("aria-pressed", String(Number(button.dataset.count) === state.target));
    }

    toggle.setAttribute("aria-label", state.active ? "중지" : "시작");
    toggle.dataset.active = String(state.active);
    progress.textContent = state.completed + " / " + state.target;
    if (message) {
      status.textContent = message;
      status.dataset.error = String(/못|찾지|벗어나|완료되지/.test(message));
      toggle.title = message + "\nCtrl+Enter 시작 · Ctrl+Alt+Enter 중지";
    }
  }
  function finish(message) {
    clearInterval(timer);
    timer = null;
    generationObserver.disconnect();
    state.active = false;
    state.phase = "idle";
    state.readySince = null;
    pendingButton = null;
    render(message);
  }
  function acknowledgeGeneration() {
    if (state.phase !== "starting") return;
    state.phase = "generating";
    state.deadline = Date.now() + TIMEOUT_MS;
    state.readySince = null;
    render("반복 생성 중: " + state.completed + " / " + state.target + "회 완료");
  }
  // DOM mutations retain short busy transitions that a polling timer can miss.
  const generationObserver = new MutationObserver(records => {
    if (!state.active) return;
    const button = findGenerateButton();
    if (state.phase === "starting" && records.some(record => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const owner = target?.closest("button");
      if (!owner || (owner !== pendingButton && owner !== button)) return false;
      if (record.type === "attributes") {
        if (record.attributeName === "disabled") return record.oldValue !== null || owner.disabled;
        if (["aria-disabled", "aria-busy"].includes(record.attributeName)) {
          return record.oldValue === "true" || owner.getAttribute(record.attributeName) === "true";
        }
      }
      return BUSY_LABEL.test(record.oldValue || "")
        || Array.from(record.removedNodes || []).some(node => BUSY_LABEL.test(node.textContent || ""));
    })) acknowledgeGeneration();
    tick();
  });
  function clickNext() {
    const button = findGenerateButton();
    if (!button) {
      state.phase = "waiting";
      state.deadline = Date.now() + TIMEOUT_MS;
      state.readySince = null;
      render("생성 버튼이 다시 표시되기를 기다립니다.");
      return;
    }
    if (isBusy(button)) {
      state.phase = "existing";
      state.deadline = Date.now() + TIMEOUT_MS;
      state.readySince = null;
      render("현재 생성이 끝나기를 기다립니다.");
      return;
    }
    // Capture evidence before clicking; never retry an unacknowledged request.
    if (!historyBaseline) {
      historyBaseline = new Map(historyItems().map(item => [item, historyKey(item)]));
      originalHistoryKeys = new Set(Array.from(historyBaseline.values()).filter(Boolean));
    }
    collectGeneratedHistory();
    expectedImages += generationImageCount(button);
    pendingButton = button;
    state.phase = "starting";
    state.deadline = Date.now() + TIMEOUT_MS;
    state.noticeAt = Date.now() + CONFIRMATION_NOTICE_MS;
    state.readySince = null;
    button.click();
    if (!state.active) return;
    if (isBusy(button)) acknowledgeGeneration();
    render("반복 생성 중: " + state.completed + " / " + state.target + "회 완료");
  }
  function tick() {
    if (!state.active) return;
    if (!location.href.startsWith("https://novelai.net/image")) {
      finish("이미지 페이지를 벗어나 중지했습니다.");
      return;
    }
    if (state.phase === "delay") {
      if (Date.now() >= state.nextAt) clickNext();
      return;
    }
    const button = findGenerateButton();
    collectGeneratedHistory();
    if (button && isBusy(button)) acknowledgeGeneration();
    // Count cumulative results so late thumbnails from an earlier round cannot
    // acknowledge a later click. Keep observed keys even when history is capped.
    const imageCount = Array.from(generatedHistoryImages.values()).reduce((total, count) => total + count, 0);
    const hasResult = expectedImages > 0 && imageCount >= expectedImages;
    const canFinish = state.phase === "generating" || (state.phase === "starting" && hasResult)
      || state.phase === "existing" || state.phase === "waiting";
    if (button && !isBusy(button) && canFinish) {
      const now = Date.now();
      if (state.readySince === null) state.readySince = now;
      // Reconcile completion before the timeout, including after tab suspension.
      if (now - state.readySince < READY_STABLE_MS) return;
      if (state.phase === "generating" || state.phase === "starting") {
        state.completed += 1;
        if (state.completed >= state.target) {
          finish("반복 생성 완료: " + state.completed + " / " + state.target + "회");
          showCompletionFeedback();
          return;
        }
      }
      pendingButton = null;
      state.phase = "delay";
      state.nextAt = now + INTERVAL_MS;
      render(state.completed + " / " + state.target + "회 완료 · 1초 대기");
      return;
    }
    state.readySince = null;
    if (Date.now() >= state.deadline) {
      if (state.phase === "starting") {
        finish("10분 동안 생성 시작이나 결과를 확인하지 못해 중지했습니다.");
      } else if (state.phase === "generating" || state.phase === "existing") {
        finish("생성이 10분 넘게 완료되지 않아 반복 생성을 중지했습니다.");
      } else {
        finish("생성 버튼을 10분 동안 찾지 못해 중지했습니다.");
      }
    } else if (state.phase === "starting" && Date.now() >= state.noticeAt) {
      if (!status.textContent.startsWith("생성 응답을 기다립니다.")) {
        render("생성 응답을 기다립니다. 추가 클릭 없이 상태를 다시 확인합니다.");
      }
    }
  }
  function begin(value = state.target) {
    if (disposed) return { ok: false, error: "페이지를 새로고침해 주세요." };
    if (state.active) return { ok: false, error: "이미 반복 생성 중입니다." };
    if (!location.href.startsWith("https://novelai.net/image") || !findGenerateButton()) {
      render("NovelAI 이미지 페이지의 생성 버튼을 기다립니다.");
      return { ok: false, error: status.textContent };
    }
    resetFeedback();
    state.target = normalizeCount(value);
    state.completed = 0;
    state.active = true;
    state.readySince = null;
    generationObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true,
      characterDataOldValue: true, attributes: true, attributeOldValue: true,
      attributeFilter: ["disabled", "aria-disabled", "aria-busy", "aria-label", "title", "src", "srcset", "style", "hidden", "class", "data-group-id"] });
    chrome.storage.sync.set({ gcount: state.target, intervalTime: 1 });
    clickNext();
    if (state.active) timer = setInterval(tick, 100);
    return { ok: state.active };
  }
  function cancel() {
    if (state.active) highlightGeneratedHistory(state.phase === "starting" || state.phase === "generating");
    finish("반복 생성을 중지했습니다. 진행 중인 생성은 완료됩니다.");
    return { ok: true };
  }
  for (const button of presets) {
    button.addEventListener("click", () => {
      if (state.active) return;
      state.target = normalizeCount(button.dataset.count);
      state.completed = 0;
      render();
      chrome.storage.sync.set({ gcount: state.target, intervalTime: 1 });
    });
  }
  toggle.addEventListener("click", () => state.active ? cancel() : begin());
  const onStorage = (changes, area) => {
    if (area === "sync" && changes.gcount && !state.active) {
      state.target = normalizeCount(changes.gcount.newValue);
      render();
    }
  };
  chrome.storage.onChanged.addListener(onStorage);
  const onMessage = (request, sender, respond) => {
    if (request?.action === "ping" || request?.action === "getContentStatus") {
      respond({ ok: true, autoActive: state.active, target: state.target, completed: state.completed,
        hasGenerateButton: Boolean(findGenerateButton()), message: status.textContent });
    } else if (request?.action === "startAutoGenerate") {
      respond(begin(request.count ?? state.target));
    } else if (request?.action === "cancelAutoGenerate") {
      respond(cancel());
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(onMessage);
  function onKeydown(event) {
    if (!event.ctrlKey || event.shiftKey || event.metaKey || event.key !== "Enter") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) {
      if (event.altKey) cancel();
      else begin();
    }
  }
  window.addEventListener("keydown", onKeydown, true);
  function onGenerateClick(event) {
    const button = event.target?.closest?.("button");
    if (!state.active && button
      && (button.matches(GENERATE_SELECTOR) || GENERATE_LABEL.test(buttonLabel(button)))) resetFeedback();
  }
  document.addEventListener("click", onGenerateClick, true);
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("pagehide", (event) => {
    cancel();
    resetFeedback();
    endDrag();
    if (event.persisted) return;
    disposed = true;
    window.removeEventListener("resize", keepOnScreen);
    window.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("click", onGenerateClick, true);
    document.removeEventListener("visibilitychange", tick);
    chrome.storage.onChanged.removeListener(onStorage);
    chrome.runtime.onMessage.removeListener(onMessage);
  });
  chrome.storage.sync.get(["gcount"], (stored = {}) => {
    if (disposed || state.active) return;
    state.target = normalizeCount(stored.gcount);
    chrome.storage.sync.set({ gcount: state.target, intervalTime: 1 });
    render("생성 완료 후 1초 대기 · Ctrl+Enter 시작 · Ctrl+Alt+Enter 중지");
  });
})();
