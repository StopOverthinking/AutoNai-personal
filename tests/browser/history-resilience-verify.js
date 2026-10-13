async (page) => {
  const root = "__PROJECT_ROOT__/";
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const passed = [];
  await page.route("https://novelai.net/**", route => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: `<html><body style="background:#101722;color:#eafffb;font:16px system-ui;padding:24px">
      <h1>히스토리 강조 복원 검증</h1><p>로컬 시뮬레이션 · 실제 생성 요청 없음</p>
      <button id="generate" class="image-gen-generate-button">Generate 4 Images</button>
      <div id="historyContainer" class="image-gen-history" style="display:flex;gap:16px;margin-top:32px"></div>
    </body></html>`
  }));
  await page.clock.install();
  async function setup(options = {}) {
    await page.goto("https://novelai.net/image");
    await page.evaluate(options => {
      window.clicks = 0; window.notifications = []; window.fixtureOptions = options;
      let listener;
      window.chrome = {
        storage: {
          local: { get: (keys, cb) => cb({}), set: () => {} },
          sync: { get: (keys, cb) => cb({ gcount: 3 }), set: () => {} },
          onChanged: { addListener: () => {}, removeListener: () => {} }
        },
        runtime: {
          onMessage: { addListener: fn => { listener = fn; }, removeListener: () => {} },
          sendMessage: (message, cb) => { notifications.push(message); cb?.({ ok: true }); }
        }
      };
      window.ask = request => { let result; listener(request, {}, value => { result = value; }); return result; };
      window.historyList = document.querySelector("#historyContainer");
      if (options.renamedContainer) { historyList.id = "new-history"; historyList.className = "new-layout"; }
      let serial = 0;
      window.finishGroup = item => {
        const thumbnail = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="150"><rect width="120" height="150" fill="#245e69"/><text x="60" y="80" text-anchor="middle" fill="white">${item.dataset.groupId}</text></svg>`);
        if (options.nestedThumbnail || options.cssThumbnail) {
          const preview = document.createElement("figure");
          preview.style.cssText = "position:absolute;inset:0;background-size:cover";
          if (options.cssThumbnail) {
            preview.className = "thumbnail-" + item.dataset.groupId;
            const style = document.createElement("style");
            style.textContent = `.${preview.className} { background-image: url("${thumbnail}"); }`;
            document.head.append(style);
          } else preview.style.backgroundImage = `url("${thumbnail}")`;
          preview.style.pointerEvents = "none";
          item.prepend(preview);
        } else item.style.backgroundImage = `url("${thumbnail}")`;
        item.querySelector("button").disabled = false;
      };
      window.addGroup = (ready = true, old = false, id) => {
        const item = document.createElement(options.changedTag ? "article" : "div");
        if (!options.noRole) item.setAttribute("role", "button");
        item.setAttribute("aria-label", "choose image"); item.draggable = true;
        item.dataset.groupId = id || "group-" + ++serial; item.dataset.old = String(old);
        item.style.cssText = "width:120px;height:150px;position:relative;border-radius:8px;background-size:cover";
        item.innerHTML = '<button aria-label="delete image(s)" disabled>×</button>'
          + `<span style="position:absolute;bottom:2px;right:2px">${options.timesBadge ? "×" : "x"}4</span>`;
        if (options.wrappedItems) {
          const wrapper = document.createElement("section"); wrapper.append(item); historyList.prepend(wrapper);
        } else historyList.prepend(item);
        if (ready) finishGroup(item);
        return item;
      };
      addGroup(true, true, "old-1"); addGroup(true, true, "old-2");
      const generate = document.querySelector("#generate");
      generate.onclick = () => {
        clicks++;
        if (options.noAck) return;
        const item = options.placeholder ? addGroup(false) : null;
        if (!options.historyOnly) generate.disabled = true;
        setTimeout(() => {
          generate.disabled = false;
          if (item) finishGroup(item); else addGroup();
        }, options.duration || 350);
      };
    }, options);
    await page.addStyleTag({ path: root + "content.css" });
    await page.addScriptTag({ path: root + "content.js" });
  }
  const status = () => page.evaluate(() => ask({ action: "getContentStatus" }));
  const start = () => page.evaluate(() => ask({ action: "startAutoGenerate", count: 3 }));
  const cancel = () => page.evaluate(() => ask({ action: "cancelAutoGenerate" }));
  async function marked(count, message) {
    check(await page.locator(".nai-repeat-history-highlight").count() === count, message);
    check(await page.locator('[data-old="true"].nai-repeat-history-highlight').count() === 0, "old history stays unmarked");
  }
  async function complete(options = {}) {
    await setup(options); check((await start()).ok, "start succeeds"); await page.clock.runFor(6500);
    const result = await status();
    check(!result.autoActive && result.completed === 3, "exactly three completed requests");
    check(await page.evaluate(() => clicks === 3 && notifications.length === 1), "no duplicate requests or notifications");
    await marked(3, "three generated groups highlighted");
    await page.getByRole("dialog", { name: "자동 생성 완료" }).getByRole("button", { name: "확인" }).click();
  }

  await complete();
  await page.evaluate(() => {
    const replacement = historyList.cloneNode(true);
    replacement.querySelectorAll(".nai-repeat-history-highlight").forEach(item => item.classList.remove("nai-repeat-history-highlight"));
    historyList.replaceWith(replacement); historyList = replacement;
  });
  await page.clock.runFor(400);
  await marked(3, "completed highlights return after React replaces the history DOM");
  passed.push("regression: restore completed group highlights after DOM replacement");

  await page.clock.runFor(30000);
  await page.evaluate(() => {
    window.detachedHistory = historyList;
    historyList.remove();
    detachedHistory.querySelectorAll(".nai-repeat-history-highlight").forEach(item => item.classList.remove("nai-repeat-history-highlight"));
  });
  await page.clock.runFor(20000);
  await page.evaluate(() => {
    const replacement = detachedHistory.cloneNode(true);
    replacement.id = "renamed-history"; replacement.className = "layout-after-update";
    replacement.querySelectorAll("[data-group-id]").forEach(item => {
      item.removeAttribute("role"); item.removeAttribute("draggable"); item.removeAttribute("aria-label");
      item.style.backgroundImage = item.style.backgroundImage.replace("data:image/svg+xml,", "data:image/svg+xml;charset=utf-8,");
    });
    document.body.append(replacement); historyList = replacement;
  });
  await page.clock.runFor(400);
  await marked(3, "stable group identity survives a late reopen, container rename, role removal, and changed thumbnail URLs");
  await page.evaluate(() => {
    // Framework updates can reset className without replacing the item.
    historyList.querySelectorAll("[data-group-id]").forEach(item => item.className = "site-selected-item");
    historyList.append(historyList.firstElementChild);
    addGroup(true, true, "unrelated-after-completion");
  });
  await page.clock.runFor(400);
  await marked(3, "restore only recorded results after class replacement/reordering; exclude later groups");
  await page.evaluate(() => {
    const item = historyList.querySelector('[data-old="false"]');
    item.style.position = "static";
    item.dataset.repositioned = "true";
  });
  await page.clock.runFor(400);
  check(await page.locator('[data-repositioned="true"]').evaluate(item => getComputedStyle(item).position) === "relative",
    "restore corner anchoring if the site resets positioning");
  await page.evaluate(() => {
    const item = historyList.querySelector('[data-old="false"]:not([data-repositioned])');
    item.dataset.groupId = "recycled-for-unrelated-result";
    item.dataset.old = "true";
  });
  await page.clock.runFor(400); await marked(2, "recycled DOM nodes must lose the previous result's highlight");
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.screenshot({ path: root + "output/playwright/history-resilience-v__VERSION__.png" });
  passed.push("late reopen, stable IDs, changed containers/roles/URLs, class/position resets, reordering, recycled nodes, and no new admission after completion");

  for (const options of [
    { historyOnly: true, renamedContainer: true, noRole: true, changedTag: true },
    { historyOnly: true, nestedThumbnail: true, renamedContainer: true, noRole: true, timesBadge: true },
    { historyOnly: true, cssThumbnail: true, wrappedItems: true, renamedContainer: true, noRole: true }
  ]) await complete(options);
  passed.push("generation and batch counts survive container/tag/role changes, per-item wrappers, nested/CSS thumbnails, and ×4 badges");

  await setup({ noAck: true, renamedContainer: true, noRole: true }); await start();
  await page.evaluate(() => {
    historyList.append(addGroup(true, true, "older-loaded-by-scroll"));
    const item = addGroup(false);
    item.style.backgroundImage = 'url("data:image/png;base64,pending")';
  });
  await page.clock.runFor(1000);
  check((await status()).completed === 0 && await page.evaluate(() => clicks === 1), "old and unfinished results cannot acknowledge a request");
  await cancel();
  passed.push("old history and unfinished previews remain excluded with renamed UI");

  await setup({ placeholder: true, duration: 12000 }); await start(); await page.clock.runFor(1000); await cancel();
  await page.clock.runFor(13000); await marked(1, "cancel retains a late pending result");
  await page.evaluate(() => {
    historyList.innerHTML = historyList.innerHTML;
    historyList.querySelectorAll("[data-group-id]").forEach(item => item.className = "recreated");
  });
  await page.clock.runFor(400); await marked(1, "cancelled results also restore after remounting");
  await page.locator("#generate").click(); await marked(0, "manual generation clears retained identity and feedback");
  await page.clock.runFor(14000); await marked(0, "manual results cannot revive previous automatic highlights");
  passed.push("cancelled pending results, remount restoration, and manual generation reset");

  await setup({ placeholder: true, duration: 25000, historyOnly: true });
  await start(); await page.clock.runFor(1000); await cancel();
  await page.clock.runFor(30000);
  await marked(1, "a recorded placeholder can finish after the ten-second collection window");
  check(await page.evaluate(() => clicks === 1 && notifications.length === 0), "late cancelled result never restarts generation");
  passed.push("recorded pending identities survive thumbnail delays beyond the collection window");

  await complete();
  await start(); await marked(0, "next automatic run clears previous feedback");
  await page.clock.runFor(6500); await marked(3, "only latest automatic run is highlighted");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await page.clock.runFor(1000); await marked(0, "pagehide stops retained feedback");
  passed.push("next run and pagehide clear persistent highlighting");
  return { passed };
}
