"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../background.js"), "utf8");
assert.ok(require("../manifest.json").permissions.includes("notifications"));

async function run({ enabled, count = 3, storageError, notificationError } = {}) {
  let listener;
  const notifications = [];
  const chrome = {
    runtime: {
      onMessage: { addListener: fn => { listener = fn; } },
      getURL: path => `chrome-extension://test/${path}`,
    },
    storage: { sync: { get: (keys, callback) => queueMicrotask(() => {
      chrome.runtime.lastError = storageError && { message: storageError };
      callback({ autoCompletionNotificationEnabled: enabled });
      chrome.runtime.lastError = undefined;
    }) } },
    notifications: { create: (options, callback) => {
      notifications.push(options);
      queueMicrotask(() => {
        chrome.runtime.lastError = notificationError && { message: notificationError };
        callback(notificationError ? undefined : "notification-id");
        chrome.runtime.lastError = undefined;
      });
    } },
    tabs: { query: () => { throw Error("Completion must not depend on the active tab"); } },
  };
  vm.runInNewContext(source, { chrome });
  let keepAlive;
  const response = await new Promise(resolve => {
    keepAlive = listener({ action: "showCompletionNotification", count }, {}, resolve);
  });
  return { response, notifications, keepAlive };
}

(async () => {
  for (const enabled of [undefined, true]) {
    for (const count of [3, 5, 10, 20]) {
      const result = await run({ enabled, count });
      assert.equal(result.keepAlive, true);
      assert.equal(result.response.ok, true);
      assert.equal(result.notifications.length, 1);
      assert.equal(result.notifications[0].message, `${count}회 반복 생성을 완료했습니다.`);
      assert.equal(result.notifications[0].type, "basic");
      assert.ok(fs.existsSync(require("node:path").join(__dirname, "../icons/icon128.png")));
    }
  }
  const disabled = await run({ enabled: false });
  assert.equal(disabled.notifications.length, 0);
  assert.equal(disabled.response.skipped, true);
  for (const count of [0, -1, 1.5, "3", null]) {
    const invalid = await run({ count });
    assert.equal(invalid.response.ok, false);
    assert.equal(invalid.notifications.length, 0);
  }
  const denied = await run({ notificationError: "Permission denied" });
  assert.equal(denied.response.ok, false);
  assert.equal(denied.response.error, "Permission denied");
  const failedRead = await run({ storageError: "Storage unavailable" });
  assert.equal(failedRead.response.ok, false);
  assert.equal(failedRead.notifications.length, 0);
  console.log("Completion notification tests passed (defaults, preferences, all presets, invalid counts, API errors, inactive tab).");
})().catch(error => { console.error(error); process.exitCode = 1; });
