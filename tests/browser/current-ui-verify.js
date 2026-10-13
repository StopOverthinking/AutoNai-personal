async (page) => {
  const root = "__PROJECT_ROOT__/";
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const passed = [];
  await page.route("https://novelai.net/**", route => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: `<html><body style="background:#101722;color:#eafffb;font:16px system-ui;padding:24px">
      <h1>NovelAI grouped history compatibility</h1><p>Local simulation — no image generation requests</p>
      <button id="decoy">Generate 1 Image</button>
      <div hidden><button class="image-gen-generate-button">Generate 4 Images</button></div>
      <div style="opacity:0"><button class="image-gen-generate-button">Generate 4 Images</button></div>
      <button id="generate" class="image-gen-generate-button"><span>Generate 4 Images</span><div>26 Anlas</div></button>
      <div id="historyContainer" class="image-gen-history" style="display:flex;flex-wrap:wrap;gap:16px;margin-top:32px"></div>
    </body></html>`
  }));
  await page.clock.install();
  async function setup(options = {}) {
    await page.goto("https://novelai.net/image");
    await page.evaluate(options => {
      window.clicks = []; window.ends = []; window.notifications = []; window.decoyClicks = 0;
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
      document.querySelector("#decoy").onclick = () => { decoyClicks++; };
      document.querySelectorAll(".image-gen-generate-button:not(#generate)").forEach(button => {
        button.onclick = () => { decoyClicks++; };
      });
      let serial = 0;
      const history = document.querySelector(".image-gen-history");
      if (options.classOnlyHistory) history.removeAttribute("id");
      window.finishGroup = item => {
        const thumbnail = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="150"><rect width="120" height="150" fill="#245e69"/><text x="60" y="80" text-anchor="middle" fill="white">${item.dataset.groupId}</text></svg>`);
        item.style.backgroundImage = `url("${thumbnail}")`;
        item.querySelector("button").disabled = false;
      };
      window.addGroup = (count = 4, ready = true, old = false, id) => {
        const item = document.createElement("div");
        item.setAttribute("role", "button"); item.setAttribute("aria-label", "choose image"); item.draggable = true;
        item.dataset.groupId = id || "group-" + ++serial;
        item.dataset.old = String(old);
        item.style.cssText = "width:120px;height:150px;position:relative;border-radius:8px;background-size:cover";
        item.innerHTML = '<button aria-label="delete image(s)" disabled>×</button>'
          + (count > 1 ? `<div style="position:absolute;bottom:2px;right:2px">x${count}</div>` : "");
        history.prepend(item);
        if (ready) finishGroup(item);
        if (options.cap) while (history.children.length > options.cap) history.lastElementChild.remove();
        return item;
      };
      addGroup(4, true, true);
      addGroup(4, true, true);
      const label = options.label || `Generate ${options.batch || 4} Images`;
      window.bind = button => {
        button.innerHTML = `<span>${label}</span><div>26 Anlas</div>`;
        button.onclick = () => {
          clicks.push(Date.now());
          if (options.noAck || (options.noAckAfter && clicks.length > options.noAckAfter)) return;
          const item = options.placeholder ? addGroup(options.batch || 4, false) : null;
          if (!options.historyOnly) button.disabled = true;
          setTimeout(() => {
            let active = button;
            if (options.replaceButton) { active = button.cloneNode(false); button.replaceWith(active); }
            active.disabled = false; bind(active); ends.push(Date.now());
            if (!options.noHistory) setTimeout(() => {
              if (item) finishGroup(item);
              else addGroup(options.batch || 4);
              if (options.duplicateHistory) history.append(history.firstElementChild.cloneNode(true));
            }, options.historyDelay || 0);
          }, options.duration || 350);
        };
      };
      bind(document.querySelector("#generate"));
    }, options);
    await page.addStyleTag({ path: root + "content.css" });
    await page.addScriptTag({ path: root + "content.js" });
  }
  const status = () => page.evaluate(() => ask({ action: "getContentStatus" }));
  const start = count => page.evaluate(count => ask({ action: "startAutoGenerate", count }), count || 3);
  const cancel = () => page.evaluate(() => ask({ action: "cancelAutoGenerate" }));
  async function completed(count = 3) {
    const result = await status();
    check(!result.autoActive && result.completed === count, `expected ${count} completions: ${JSON.stringify(result)}`);
    const run = await page.evaluate(() => ({ clicks, ends, notifications, decoyClicks }));
    check(run.clicks.length === count && run.decoyClicks === 0, "exact requests on the visible current generation button");
    check(run.notifications.length === 1, "one completion notification");
    for (let i = 1; i < count; i++) check(run.clicks[i] - run.ends[i - 1] >= 1000, "one second after completion");
    check(await page.locator('[data-old="true"].nai-repeat-history-highlight').count() === 0, "previous groups stay unmarked");
    check(await page.getByRole("dialog", { name: "자동 생성 완료" }).isVisible(), "completion overlay");
  }

  for (const count of [3, 5, 10, 20]) {
    await setup({ historyOnly: true }); check((await start(count)).ok, "start current UI generation");
    await page.clock.runFor(count * 1800); await completed(count);
    check(await page.locator(".nai-repeat-history-highlight").count() === count, "one highlighted history group per four-image batch");
  }
  passed.push("all repeat presets with four-image groups and history-only completion");

  for (const options of [
    { historyOnly: true, label: "画像を4枚生成" },
    { historyOnly: true, label: "이미지 4장 생성" },
    { historyOnly: true, batch: 1 },
    { historyOnly: true, batch: 2 },
    { historyOnly: true, batch: 3 },
    { historyOnly: true, cap: 1 },
    { historyOnly: true, duplicateHistory: true },
    { historyOnly: true, classOnlyHistory: true },
    { replaceButton: true, label: "画像を4枚生成" },
    { historyOnly: true, placeholder: true, historyDelay: 800 }
  ]) {
    await setup(options); await start(); await page.clock.runFor(10000); await completed();
  }
  passed.push("localized labels, batches of 1–4, bounded/duplicated history, class selector, button replacement, delayed placeholders");

  await setup({ noAck: true }); await start();
  await page.evaluate(() => {
    const item = addGroup(4, false);
    item.style.backgroundImage = "none";
    item.querySelector("button").disabled = false;
  });
  await page.clock.runFor(1000);
  check((await status()).completed === 0, "empty group must not confirm completion");
  await page.evaluate(() => {
    const item = document.querySelector(".image-gen-history").firstElementChild;
    finishGroup(item); item.querySelector("button").disabled = true;
  });
  await page.clock.runFor(1000);
  check((await status()).completed === 0, "unfinished group with thumbnail must not confirm completion");
  await page.evaluate(() => document.querySelector(".image-gen-history button").disabled = false);
  await page.clock.runFor(500);
  check((await status()).completed === 1, "completed group confirms a full batch"); await cancel();
  passed.push("unfinished/empty history groups cannot acknowledge a request");

  await setup({ noAck: true });
  await page.evaluate(() => addGroup(4, false, true, "old-pending")); await start();
  await page.evaluate(() => {
    const history = document.querySelector(".image-gen-history");
    history.innerHTML = history.innerHTML;
    finishGroup(history.querySelector('[data-group-id="old-pending"]'));
    const newThumbnail = addGroup(4).style.backgroundImage;
    history.firstElementChild.remove();
    history.lastElementChild.style.backgroundImage = newThumbnail;
  });
  await page.clock.runFor(1500);
  check((await status()).completed === 0 && await page.evaluate(() => clicks.length) === 1,
    "remounts, loaded old thumbnails, and changed URLs of old group IDs cannot confirm a new request");
  await cancel(); await page.clock.runFor(1000);
  check(await page.locator(".nai-repeat-history-highlight").count() === 0, "old pending groups stay unmarked after cancellation");
  passed.push("stable group IDs exclude old results after remounts and thumbnail URL changes");

  await setup({ noAck: true }); await start();
  await page.evaluate(() => {
    const history = document.querySelector(".image-gen-history");
    history.append(addGroup(4, true, true, "older-loaded-by-scroll"));
  });
  await page.clock.runFor(1500);
  check((await status()).completed === 0 && await page.evaluate(() => clicks.length) === 1,
    "scrolling older groups into the DOM cannot confirm a request");
  await cancel(); await page.clock.runFor(1000);
  check(await page.locator(".nai-repeat-history-highlight").count() === 0, "older groups loaded by scrolling stay unmarked");
  passed.push("older groups appended during history scrolling are excluded");

  await setup({ noAck: true, duplicateHistory: true }); await start();
  await page.evaluate(() => {
    const item = addGroup(2);
    item.parentElement.append(item.cloneNode(true));
  });
  await page.clock.runFor(1000);
  check((await status()).completed === 0, "duplicate group renders cannot double the result count");
  await page.evaluate(() => addGroup(2)); await page.clock.runFor(500);
  check((await status()).completed === 1, "two distinct two-image groups can confirm four results"); await cancel();
  passed.push("deduplicate results by group identity");

  await setup({ historyDelay: 3000, noAckAfter: 1 }); await start(); await page.clock.runFor(6000);
  check((await status()).autoActive && (await status()).completed === 1, "late first group cannot acknowledge a second click");
  check(await page.evaluate(() => clicks.length) === 2, "unacknowledged second click never retried"); await cancel();
  passed.push("delayed earlier batches cannot complete later unacknowledged requests");

  await setup({ placeholder: true, duration: 12000 }); await start(); await page.clock.runFor(1000); await cancel();
  await page.clock.runFor(12500);
  check(await page.locator(".nai-repeat-history-highlight").count() === 1, "cancelled run highlights its finished pending group");
  check(await page.evaluate(() => clicks.length === 1 && notifications.length === 0), "cancel stops subsequent clicks and completion notification");
  await page.evaluate(() => document.querySelector("#generate span").textContent = "画像を4枚生成");
  await page.locator("#generate").click();
  check(await page.locator(".nai-repeat-history-highlight").count() === 0, "localized manual generation resets feedback");
  passed.push("cancellation retains pending group feedback; localized manual generation clears it");

  await setup({ historyOnly: true }); await start(); await page.clock.runFor(6500); await completed();
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.screenshot({ path: root + "output/playwright/current-ui-completion-v__VERSION__.png" });
  await page.getByRole("dialog", { name: "자동 생성 완료" }).getByRole("button", { name: "확인" }).click();
  await page.screenshot({ path: root + "output/playwright/current-ui-history-v__VERSION__.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { clicks.length = 0; ends.length = 0; notifications.length = 0; });
  await start(); await page.clock.runFor(6500); await completed();
  const dialog = await page.getByRole("dialog", { name: "자동 생성 완료" }).boundingBox();
  check(dialog.x >= 0 && dialog.x + dialog.width <= 390, "mobile completion overlay fits viewport");
  await page.screenshot({ path: root + "output/playwright/current-ui-mobile-v__VERSION__.png" });
  passed.push("desktop/mobile completion overlay and grouped-history screenshots");
  return { passed };
}
