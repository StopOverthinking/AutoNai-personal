async (page) => {
  const root = "__PROJECT_ROOT__/";
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const passed = [];
  await page.route("https://novelai.net/**", route => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: '<html><body><button id="generate">Generate 1 Image</button><div id="historyContainer"></div></body></html>'
  }));
  await page.clock.install();
  async function setup(options = {}) {
    await page.goto("https://novelai.net/image");
    await page.evaluate(options => {
      window.clicks = []; window.ends = []; window.notifications = [];
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
      window.ask = request => { let response; listener(request, {}, value => { response = value; }); return response; };
      let serial = 0;
      window.addHistory = count => {
        for (let i = 0; i < count; i++) {
          const item = document.createElement("div");
          item.setAttribute("role", "button"); item.draggable = true;
          const img = document.createElement("img");
          img.src = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg"><text>${++serial}</text></svg>`);
          item.append(img); document.querySelector("#historyContainer").prepend(item);
        }
        if (options.cap) {
          const history = document.querySelector("#historyContainer");
          while (history.children.length > options.cap) history.lastElementChild.remove();
        }
      };
      addHistory(3);
      const label = options.label || `Generate ${options.batch || 1} Images`;
      window.bind = button => {
        button.textContent = label;
        if (options.ariaLabel) { button.textContent = ""; button.setAttribute("aria-label", label); }
        button.onclick = () => {
          clicks.push(Date.now());
          const round = clicks.length;
          if (options.noAck || (options.noAckAfter && round > options.noAckAfter)) return;
          if (options.syncBusy) {
            button.disabled = true; button.disabled = false;
            ends.push(Date.now()); return;
          }
          const generate = () => {
            let active = button;
            if (options.replaceBusy) {
              active = button.cloneNode(false); button.replaceWith(active);
            }
            if (!options.historyOnly) {
              if (options.busyLabel || options.replaceBusy) active.textContent = "Generating…";
              else if (options.busyAttribute) active.setAttribute(options.busyAttribute, "true");
              else active.disabled = true;
            }
            if (options.stuck) return;
            if (options.readyGlitch) {
              setTimeout(() => { active.disabled = false; }, 100);
              setTimeout(() => { active.disabled = true; }, 150);
            }
            setTimeout(() => {
              if (options.busyAttribute) active.removeAttribute(options.busyAttribute);
              active.disabled = false; bind(active); ends.push(Date.now());
              if (!options.noHistory) setTimeout(() => addHistory(options.batch || 1), options.historyDelay || 0);
              if (options.missingBetween && round === 1) {
                active.remove(); setTimeout(() => document.body.prepend(active), 5000);
              }
            }, options.duration || 350);
          };
          if (options.ackDelay) setTimeout(generate, options.ackDelay);
          else generate();
        };
      };
      bind(document.querySelector("#generate"));
    }, options);
    await page.addScriptTag({ path: root + "content.js" });
  }
  const status = () => page.evaluate(() => ask({ action: "getContentStatus" }));
  const start = count => page.evaluate(count => ask({ action: "startAutoGenerate", count }), count || 3);
  const cancel = () => page.evaluate(() => ask({ action: "cancelAutoGenerate" }));
  async function completed(count = 3) {
    const result = await status();
    check(!result.autoActive && result.completed === count, `expected ${count} completions: ${JSON.stringify(result)}`);
    check(await page.evaluate(() => clicks.length) === count, "one click per round");
    check(await page.evaluate(() => notifications.length) === 1, "one completion notification");
    const times = await page.evaluate(() => ({ clicks, ends }));
    for (let i = 1; i < count; i++) check(times.clicks[i] - times.ends[i - 1] >= 1000, "delay after actual completion");
  }

  // Reproduces the old 30-second false timeout: successful history, no disabled signal.
  await setup({ historyOnly: true }); check((await start()).ok, "start history-only generation");
  await page.clock.runFor(6500); await completed(); passed.push("history confirms completion when no busy signal is exposed");

  for (const options of [{ syncBusy: true }, { duration: 10, noHistory: true }, { busyLabel: true },
    { replaceBusy: true }, { busyAttribute: "aria-busy" }, { busyAttribute: "aria-disabled" }]) {
    await setup(options); await start(); await page.clock.runFor(6500); await completed();
  }
  passed.push("synchronous/brief busy transitions, generating labels, replaced buttons");

  for (const options of [{ label: "Generate Image" }, { label: "Generate1Image" }, { ariaLabel: true }]) {
    await setup(options); check((await start()).ok, "supported accessible generation label");
    await page.clock.runFor(6500); await completed();
  }
  passed.push("spacing, optional image count and accessible labels");

  await setup({ readyGlitch: true, duration: 5000 }); await start(); await page.clock.runFor(3000);
  check((await status()).completed === 0 && await page.evaluate(() => clicks.length) === 1, "brief ready state cannot trigger another request");
  await page.clock.runFor(19000); await completed(); passed.push("transient ready states cannot cause overlapping requests");

  await setup({ noAck: true });
  await page.evaluate(() => document.querySelector("#historyContainer img").removeAttribute("src"));
  await start();
  await page.evaluate(() => { document.querySelector("#historyContainer img").src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"; });
  await page.clock.runFor(1000);
  check((await status()).completed === 0 && await page.evaluate(() => clicks.length) === 1, "loading old thumbnail does not confirm generation");
  await cancel(); passed.push("previously unloaded history thumbnails cannot confirm a new click");

  await setup({ ackDelay: 45000 }); await start(); await page.clock.runFor(31000);
  check((await status()).autoActive, "still awaiting delayed acknowledgement after 30 seconds");
  check(await page.evaluate(() => clicks.length) === 1, "delayed acknowledgement is never retried");
  await page.clock.runFor(120000); await completed(); passed.push("acknowledgement later than 30 seconds recovers without retry");

  await setup({ missingBetween: true }); await start(); await page.clock.runFor(14000); await completed();
  passed.push("temporarily missing button recovers between rounds");

  await setup({ historyOnly: true, batch: 4, cap: 4 }); await start(); await page.clock.runFor(6500); await completed();
  passed.push("multi-image results and bounded history");

  await setup({ batch: 4, historyOnly: true, noHistory: true }); await start(); await page.clock.runFor(1000);
  await page.evaluate(() => addHistory(3)); await page.clock.runFor(2000);
  check((await status()).completed === 0 && await page.evaluate(() => clicks.length) === 1, "partial batch cannot complete a round");
  await page.evaluate(() => addHistory(1)); await page.clock.runFor(500);
  check((await status()).completed === 1, "full batch confirms a round"); await cancel();
  passed.push("partial batches are not mistaken for completion");

  await setup({ historyDelay: 3000, noAckAfter: 1 }); await start(); await page.clock.runFor(6000);
  check((await status()).autoActive && (await status()).completed === 1, "late earlier history does not acknowledge the next click");
  check(await page.evaluate(() => clicks.length) === 2, "unacknowledged second click is not retried"); await cancel();
  passed.push("late results from an earlier round never confirm an unacknowledged next round");

  await setup({ noAck: true }); await start(); await page.clock.runFor(31000);
  check((await status()).autoActive && (await status()).completed === 0, "unknown status keeps waiting");
  await page.clock.fastForward(571000);
  check(!(await status()).autoActive && (await status()).completed === 0, "unknown status eventually stops");
  check(await page.evaluate(() => clicks.length === 1 && notifications.length === 0), "no retries or false success on timeout");
  passed.push("bounded waiting, no blind retries, no false completion notification");

  await setup({ stuck: true }); await start(); await page.clock.fastForward(601000);
  check(!(await status()).autoActive && (await status()).completed === 0, "stuck generation stops");
  check(await page.evaluate(() => notifications.length) === 0, "stuck generation does not notify");
  passed.push("stuck generation remains bounded");

  await setup({ stuck: true }); await start();
  // Move wall-clock past the deadline without running timers, as in a suspended tab.
  await page.clock.setSystemTime(new Date(await page.evaluate(() => Date.now() + 20 * 60 * 1000)));
  await page.evaluate(() => { const b = document.querySelector("#generate"); b.disabled = false; addHistory(1); });
  await page.clock.runFor(500);
  check((await status()).autoActive && (await status()).completed === 1, "valid completion beats expired wall-clock deadline");
  await cancel(); passed.push("suspended tab inspects completion before applying timeout");

  await setup({ ackDelay: 45000 }); await start(); await page.clock.runFor(31000); await cancel();
  await page.clock.runFor(100000);
  check(!(await status()).autoActive && await page.evaluate(() => clicks.length === 1 && notifications.length === 0), "cancel while recovering stops future clicks and notifications");
  passed.push("cancellation during delayed acknowledgement");
  return { passed };
}
