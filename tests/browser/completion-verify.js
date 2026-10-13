async (page) => {
  const root = "__PROJECT_ROOT__/";
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const results = [];
  await page.route("https://novelai.net/**", route => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: `<html><body style="margin:32px;background:#101722;color:#eafffb;font:16px system-ui">
      <h1>반복 생성 · 히스토리 강조 검증</h1><p>로컬 시뮬레이션 · 실제 생성 요청 없음</p>
      <button id="generate">Generate 1 Image</button>
      <div id="historyContainer" style="display:flex;flex-wrap:wrap;gap:16px;margin-top:32px"></div>
    </body></html>`
  }));
  await page.clock.install();
  async function setup(options = {}) {
    await page.goto("https://novelai.net/image");
    await page.evaluate(options => {
      window.notifications = []; window.clicks = []; window.ends = []; window.unexpectedDialogs = 0;
      window.alert = window.confirm = () => { unexpectedDialogs++; throw Error("Unexpected native alert"); };
      const changes = [], messages = [], saved = { gcount: 3 };
      window.chrome = {
        storage: {
          local: { get: (keys, cb) => cb({}), set: () => {} },
          sync: {
            get: (keys, cb) => cb({ ...saved }),
            set: (values, cb) => {
              const delta = {};
              for (const [key, value] of Object.entries(values)) { delta[key] = { newValue: value }; saved[key] = value; }
              changes.forEach(fn => fn(delta, "sync")); cb?.();
            }
          },
          onChanged: { addListener: fn => changes.push(fn), removeListener: () => {} }
        },
        runtime: { sendMessage: (message, callback) => { if (options.notificationThrows) throw Error("Extension context invalidated"); notifications.push(message); callback?.({ ok: !options.notificationFailure }); }, onMessage: { addListener: fn => messages.push(fn), removeListener: () => {} } }
      };
      window.ask = request => { let response; messages[0](request, {}, value => { response = value; }); return response; };
      let serial = 0;
      window.addHistory = (count, old = false) => {
        const container = document.querySelector("#historyContainer");
        for (let i = 0; i < count; i++) {
          const item = document.createElement("div");
          item.setAttribute("role", "button"); item.draggable = true;
          item.style.cssText = "width:120px;height:150px;border-radius:8px;overflow:hidden";
          item.dataset.old = String(old);
          item.dataset.serial = String(++serial);
          const img = document.createElement("img"); img.style.cssText = "width:100%;height:100%";
          img.src = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="150"><rect width="120" height="150" fill="${old ? '#35404e' : '#245e69'}"/><circle cx="60" cy="56" r="27" fill="${old ? '#697689' : '#62c8c0'}"/><text x="60" y="118" text-anchor="middle" fill="white" font-family="sans-serif" font-size="15">${old ? '이전' : '생성'} ${serial}</text></svg>`);
          item.append(img); container.prepend(item);
        }
        if (options.cap) while (container.children.length > options.cap) container.lastElementChild.remove();
      };
      addHistory(4, true);
      const generate = document.querySelector("#generate");
      generate.textContent = `Generate ${options.batch || 1} Images`;
      generate.onclick = () => {
        clicks.push(Date.now());
        if (options.noAck) return;
        generate.disabled = true;
        if (options.stuck) return;
        setTimeout(() => {
          generate.disabled = false; ends.push(Date.now());
          setTimeout(() => addHistory(options.batch || 1), options.historyDelay || 0);
        }, options.duration || 350);
      };
    }, options);
    await page.addStyleTag({ path: root + "content.css" });
    await page.addScriptTag({ path: root + "content.js" });
  }
  const card = page.getByRole("region", { name: "반복 생성" });
  const dialog = page.getByRole("dialog", { name: "자동 생성 완료" });
  async function start(count = 3) {
    await card.getByRole("button", { name: String(count), exact: true }).click();
    await card.getByRole("button", { name: "시작", exact: true }).click();
  }
  async function marked(count) {
    check(await page.locator(".nai-repeat-history-highlight").count() === count, `highlight count ${count}`);
    check(await page.locator('[data-old="true"].nai-repeat-history-highlight').count() === 0, "old history stays unmarked");
  }
  for (const count of [3, 5, 10, 20]) {
    await setup(); await start(count); await page.clock.runFor(count * 1800);
    check(await dialog.isVisible(), `completion overlay ${count}`);
    await marked(count);
    const run = await page.evaluate(() => ({ clicks, ends, status: ask({ action: "ping" }), unexpectedDialogs }));
    check(run.clicks.length === count && run.status.completed === count && !run.status.autoActive, "exact completion count");
    check(run.unexpectedDialogs === 0, "no native alerts"); const delivered = await page.evaluate(() => notifications); check(delivered.length === 1 && delivered[0].action === "showCompletionNotification" && delivered[0].count === count, "exactly one completion notification with repeat count"); await page.clock.runFor(1000); check(await page.evaluate(() => notifications.length) === 1, "no duplicate notification after completion");
    for (let i = 1; i < count; i++) check(run.clicks[i] - run.ends[i - 1] >= 1000, "one second delay");
    await dialog.getByRole("button", { name: "확인" }).click();
    check(!await dialog.isVisible(), "confirm closes overlay");
    await marked(count);
  }
  results.push("all presets, exact counts, fixed delay, confirm dismissal, persistent highlights");

  await setup({ batch: 4, historyDelay: 1500 });
  await start(); await page.clock.runFor(6000);
  await marked(12);
  check(await dialog.isVisible(), "batch completion overlay");
  await page.keyboard.press("Escape");
  check(!await dialog.isVisible(), "Escape closes overlay");
  results.push("multi-image batches and delayed history");

  await setup({ cap: 4 }); await start(); await page.clock.runFor(4500); await marked(3);
  await page.mouse.click(10, 10);
  check(!await dialog.isVisible(), "backdrop closes overlay");
  await card.getByRole("button", { name: "시작", exact: true }).click();
  await marked(0);
  await page.clock.runFor(4500); await marked(3);
  await page.evaluate(() => ask({ action: "startAutoGenerate", count: 5 }));
  check(!await dialog.isVisible(), "restart via popup message dismisses old overlay");
  await marked(0);
  await page.evaluate(() => ask({ action: "cancelAutoGenerate" }));
  results.push("bounded history, backdrop dismissal, restart invalidates old feedback");

  await setup({ duration: 12000 }); await start(); await page.clock.runFor(1000);
  await card.getByRole("button", { name: "중지", exact: true }).click();
  await page.clock.runFor(12500); await marked(1);
  check(!await dialog.isVisible(), "cancel never shows completion overlay"); check(await page.evaluate(() => notifications.length) === 0, "no notification on cancellation");
  check(await page.evaluate(() => clicks.length) === 1, "cancel stops further generation");
  await page.locator("#generate").click(); await marked(0);
  await page.clock.runFor(12500); await marked(0);
  results.push("cancel during slow generation highlights pending result; manual generation clears feedback");

  await setup(); await start(); await page.clock.runFor(800);
  await card.getByRole("button", { name: "중지", exact: true }).click();
  await marked(1); check(!await dialog.isVisible(), "cancel during delay has no overlay");
  results.push("cancel during delay highlights completed results");

  await setup();
  await page.evaluate(() => {
    document.querySelector("#generate").disabled = true;
    setTimeout(() => { addHistory(1, true); document.querySelector("#generate").disabled = false; }, 1000);
  });
  await start(); await page.clock.runFor(7000); await marked(3);
  results.push("already running generation excluded from this run's highlights");

  await setup({ noAck: true }); await start(); await page.clock.runFor(31000);
  check(await page.evaluate(() => notifications.length) === 0, "no notification on unacknowledged click"); check(!await dialog.isVisible(), "unacknowledged click has no completion overlay"); await marked(0);
  check(await page.evaluate(() => ask({ action: "ping" }).autoActive), "delayed acknowledgement keeps waiting after 30 seconds");
  await page.clock.fastForward(571000);
  check(!await page.evaluate(() => ask({ action: "ping" }).autoActive), "10-minute timeout stops run");
  await setup({ stuck: true }); await start(); await page.clock.fastForward(601000);
  check(!await dialog.isVisible(), "generation timeout has no completion overlay"); await marked(0);
  check(await page.evaluate(() => notifications.length) === 0, "no notification on generation timeout"); results.push("unacknowledged click and generation timeout never report success");

  await setup({ historyDelay: 9000 }); await start(); await page.clock.runFor(4000);
  await page.evaluate(() => { history.pushState({}, "", "/"); window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })); });
  await page.clock.runFor(14000); await marked(0);
  check(!await dialog.isVisible(), "pagehide cancels stale overlay and delayed highlighting");
  results.push("pagehide cleans up delayed feedback");

  await setup();
  const initial = await card.boundingBox();
  check(initial.width === 116, "compact panel width unchanged");
  await card.getByRole("button", { name: "패널 이동" }).focus(); await page.keyboard.press("ArrowLeft");
  check((await card.boundingBox()).x === initial.x - 5, "keyboard panel movement preserved");
  await start(); await page.clock.runFor(4500);
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.screenshot({ path: root + "output/playwright/completion-overlay-v__VERSION__.png" });
  await dialog.getByRole("button", { name: "확인" }).click();
  check(await page.locator(".nai-repeat-history-highlight").first().evaluate(el => getComputedStyle(el).outlineColor) === "rgb(39, 214, 196)", "highlight CSS loaded");
  await page.screenshot({ path: root + "output/playwright/history-highlight-v__VERSION__.png" });
  await page.setViewportSize({ width: 320, height: 568 });
  await start(); await page.clock.runFor(4500);
  const box = await dialog.boundingBox();
  check(box.x >= 0 && box.x + box.width <= 320 && box.y >= 0 && box.y + box.height <= 568, "mobile overlay in viewport");
  await page.screenshot({ path: root + "output/playwright/completion-mobile-v__VERSION__.png" });
  results.push("compact panel movement, document CSS, desktop/mobile screenshots");
  for (const options of [{ notificationThrows: true }, { notificationFailure: true }]) { await setup(options); await start(); await page.clock.runFor(4500); check(await dialog.isVisible(), "notification failures preserve completion overlay"); await marked(3); } results.push("completion message exactly once per run; notification failure preserves overlay and highlights"); return { passed: results };
}
