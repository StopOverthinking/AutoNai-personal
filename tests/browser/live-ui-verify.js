async (page) => {
  const root = "__PROJECT_ROOT__/";
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const live = await page.context().newPage();
  const generationRequests = [];
  await live.route("**/*", route => {
    const request = route.request();
    return request.method() === "POST" && /generate/i.test(request.url())
      ? route.abort() : route.continue();
  });
  live.on("request", request => {
    if (request.method() === "POST" && /generate-image/.test(request.url())) generationRequests.push(request.url());
  });
  try {
    await live.setViewportSize({ width: 1440, height: 1000 });
    await live.goto("https://novelai.net/image");
    await live.locator("button.image-gen-generate-button").first().waitFor({ state: "attached" });
    const consent = live.getByRole("button", { name: "Close this consent banner" });
    if (await consent.isVisible()) await consent.click();
    const welcome = live.getByRole("dialog").filter({ hasText: "Welcome to NovelAI!" });
    try {
      await welcome.waitFor({ state: "visible", timeout: 5000 });
      await welcome.getByRole("button").first().click();
      await welcome.waitFor({ state: "hidden", timeout: 5000 });
    } catch (error) {
      if (error.name !== "TimeoutError") throw error;
    }
    await live.evaluate(() => {
      let listener;
      window.chrome = {
        storage: {
          local: { get: (keys, cb) => cb({}), set: () => {} },
          sync: { get: (keys, cb) => cb({ gcount: 3 }), set: () => {} },
          onChanged: { addListener: () => {}, removeListener: () => {} }
        },
        runtime: { onMessage: { addListener: fn => { listener = fn; }, removeListener: () => {} } }
      };
      window.askExtension = () => {
        let result;
        listener({ action: "getContentStatus" }, {}, value => { result = value; });
        return result;
      };
    });
    await live.addStyleTag({ path: root + "content.css" });
    await live.addScriptTag({ path: root + "content.js" });
    const desktop = await live.evaluate(() => askExtension());
    check(desktop.hasGenerateButton && !desktop.autoActive, "desktop current generation button detected without generating");
    const markup = await live.locator("button.image-gen-generate-button").allTextContents();
    await live.screenshot({ path: root + "output/playwright/live-ui-desktop-v__VERSION__.png" });
    await live.setViewportSize({ width: 390, height: 844 });
    const mobile = await live.evaluate(() => askExtension());
    check(mobile.hasGenerateButton && !mobile.autoActive, "mobile current generation button detected without generating");
    await live.screenshot({ path: root + "output/playwright/live-ui-mobile-v__VERSION__.png" });
    check(generationRequests.length === 0, "no real generation request");
    return { desktop, mobile, markup, generationRequests: generationRequests.length };
  } finally {
    await live.close();
  }
}
