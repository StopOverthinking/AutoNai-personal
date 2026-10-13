async (page) => {
  const root = "__PROJECT_ROOT__/";
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const popup = await page.context().newPage();
  const saved = {};
  await popup.route("https://repeat.test/**", route => route.fulfill({
    path: root + "popup/" + (route.request().url().split("/").pop() || "popup.html")
  }));
  await popup.exposeFunction("readSettings", () => saved);
  await popup.exposeFunction("writeSettings", values => Object.assign(saved, values));
  await popup.addInitScript(() => {
    const listeners = [];
    window.failSave = false;
    window.disconnected = false;
    window.autoActive = false;
    window.targetCount = 3;
    window.chrome = {
      runtime: { sendMessage: (request, callback) => {
        if (window.disconnected) { callback({ ok: false, error: "페이지 연결을 확인해 주세요." }); return; }
        if (request.action === "startAutoGenerate") { autoActive = true; targetCount = request.count; }
        if (request.action === "cancelAutoGenerate") autoActive = false;
        callback({ ok: true, autoActive, target: targetCount, completed: 0, hasGenerateButton: true });
      } },
      storage: {
        sync: {
          get: (keys, callback) => readSettings().then(callback),
          set: (values, callback) => {
            if (window.failSave) {
              chrome.runtime.lastError = { message: "Storage unavailable" };
              callback?.(); chrome.runtime.lastError = undefined; return;
            }
            writeSettings(values).then(() => {
              if (values.gcount) targetCount = values.gcount;
              const delta = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }]));
              listeners.forEach(listener => listener(delta, "sync")); callback?.();
            });
          },
        },
        onChanged: { addListener: fn => listeners.push(fn), removeListener: () => {} },
      },
    };
  });
  const errors = [];
  popup.on("pageerror", error => errors.push(error.message));
  await popup.goto("https://repeat.test/popup.html");
  check(await popup.title() === "AutoNai personal", "renamed popup title");
  check(await popup.getByRole("region", { name: "AutoNai personal 반복 생성" }).count() === 1, "renamed popup region");
  const toggle = popup.getByRole("checkbox", { name: "완료 알림" });
  await popup.waitForFunction(() => !document.getElementById("completion-notification").disabled);
  check(await toggle.isChecked(), "notification default on");
  await toggle.uncheck();
  await popup.waitForFunction(() => !document.getElementById("completion-notification").disabled);
  check(saved.autoCompletionNotificationEnabled === false, "disabled preference saved");
  await popup.reload();
  await popup.waitForFunction(() => !document.getElementById("completion-notification").disabled);
  check(!await toggle.isChecked(), "disabled preference survives reopening");
  await toggle.check();
  await popup.waitForFunction(() => !document.getElementById("completion-notification").disabled);
  check(saved.autoCompletionNotificationEnabled === true, "reenabled preference saved");
  await popup.evaluate(() => { window.failSave = true; });
  await toggle.click();
  check(await toggle.isChecked(), "failed save rolls checkbox back");
  check(await popup.locator("#notification-status").isVisible(), "save failure visible");
  await popup.evaluate(() => { window.failSave = false; });
  await popup.getByRole("button", { name: "5", exact: true }).click();
  await popup.waitForFunction(() => targetCount === 5);
  await popup.getByRole("button", { name: "시작", exact: true }).click();
  check(await popup.evaluate(() => autoActive), "popup starts generation");
  await toggle.uncheck();
  await popup.waitForFunction(() => !document.getElementById("completion-notification").disabled);
  check(saved.autoCompletionNotificationEnabled === false, "preference editable during generation");
  await popup.getByRole("button", { name: "중지", exact: true }).click();
  check(!await popup.evaluate(() => autoActive), "popup stops generation");
  await toggle.check();
  await popup.waitForFunction(() => !document.getElementById("completion-notification").disabled);
  await popup.setViewportSize({ width: 320, height: 180 });
  await popup.screenshot({ path: root + "output/playwright/notification-popup-v__VERSION__.png" });
  await popup.evaluate(() => { window.disconnected = true; });
  await popup.waitForFunction(() => document.getElementById("toggle").disabled);
  check(await toggle.isEnabled(), "notification preference usable without NovelAI tab");
  check(errors.length === 0, `popup errors: ${errors.join(", ")}`);
  return "Popup checks passed: default, persistence, old setting, save failure, start/stop, in-run toggle, disconnected tab.";
}
