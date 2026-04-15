(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const DEBUG = false;

  function log(...args) {
    if (DEBUG) console.log("[NS Loader BG]", ...args);
  }

  function sendToTab(tabId, message) {
    try {
      const result = api.tabs.sendMessage(tabId, message);
      if (result && typeof result.catch === "function") {
        result.catch(() => {});
      }
    } catch {
      // No content script yet, tab is changing, or tab closed.
    }
  }

  function showLoader(details, reason) {
    if (!details || details.frameId !== 0) return;
    if (typeof details.tabId !== "number") return;

    log("show loader", reason, details.tabId, details.url || "");
    sendToTab(details.tabId, { action: "SHOW_LOADER", reason });
  }

  api.webNavigation.onBeforeNavigate.addListener((details) => {
    showLoader(details, "beforeNavigate");
  });

  api.webNavigation.onCommitted.addListener((details) => {
    showLoader(details, "committed");
  });

  if (api.webNavigation.onHistoryStateUpdated) {
    api.webNavigation.onHistoryStateUpdated.addListener((details) => {
      showLoader(details, "historyStateUpdated");
    });
  }
})();