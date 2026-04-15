(() => {
  const TAG = "__NS_LOADER_TRACKER__";
  const DEBUG = false;

  if (window.__NS_LOADER_BRIDGE_ACTIVE__) return;
  window.__NS_LOADER_BRIDGE_ACTIVE__ = true;

  const state = {
    activeRequests: 0
  };

  const IGNORED_URL_PATTERNS = [
    /favicon\.ico$/i,
    /google-analytics|googletagmanager|doubleclick/i,
    /segment|mixpanel|fullstory|hotjar/i,
    /session-status/i,
    /tooltip/i
  ];

  function log(...args) {
    if (DEBUG) console.log("[NS Loader Bridge]", ...args);
  }

  function shouldIgnore(url) {
    if (!url) return false;
    return IGNORED_URL_PATTERNS.some((re) => re.test(url));
  }

  function emit(kind, payload) {
    try {
      window.postMessage(
        {
          source: TAG,
          kind,
          payload: payload || {},
          ts: Date.now()
        },
        "*"
      );
    } catch (error) {
      log("emit failed", error);
    }
  }

  function normalizeUrl(input) {
    try {
      if (typeof input === "string") return input;
      if (input && typeof input.url === "string") return input.url;
      if (input instanceof Request && typeof input.url === "string") return input.url;
    } catch {
      // ignore
    }
    return "";
  }

  function trackStart(url, transport, extra) {
    if (shouldIgnore(url)) return false;
    state.activeRequests += 1;
    emit("REQUEST_START", {
      url,
      transport,
      activeRequests: state.activeRequests,
      ...extra
    });
    return true;
  }

  function trackEnd(url, transport, extra) {
    if (shouldIgnore(url)) return false;
    state.activeRequests = Math.max(0, state.activeRequests - 1);
    emit("REQUEST_END", {
      url,
      transport,
      activeRequests: state.activeRequests,
      ...extra
    });
    return true;
  }

  function patchFetch() {
    if (typeof window.fetch !== "function" || window.fetch.__nsLoaderPatched) return;

    const originalFetch = window.fetch.bind(window);

    function patchedFetch(...args) {
      const url = normalizeUrl(args[0]);
      const tracked = trackStart(url, "fetch");

      let result;
      try {
        result = originalFetch(...args);
      } catch (error) {
        if (tracked) {
          trackEnd(url, "fetch", {
            ok: false,
            error: String(error && error.message ? error.message : error)
          });
        }
        throw error;
      }

      return Promise.resolve(result).then(
        (response) => {
          if (tracked) {
            trackEnd(url, "fetch", {
              ok: true,
              status: response && typeof response.status === "number" ? response.status : undefined
            });
          }
          return response;
        },
        (error) => {
          if (tracked) {
            trackEnd(url, "fetch", {
              ok: false,
              error: String(error && error.message ? error.message : error)
            });
          }
          throw error;
        }
      );
    }

    patchedFetch.__nsLoaderPatched = true;
    window.fetch = patchedFetch;
  }

  function patchXHR() {
    if (!window.XMLHttpRequest || !window.XMLHttpRequest.prototype) return;

    const proto = window.XMLHttpRequest.prototype;
    if (proto.__nsLoaderPatched) return;

    const originalOpen = proto.open;
    const originalSend = proto.send;

    proto.open = function open(method, url) {
      this.__nsLoaderMethod = method;
      this.__nsLoaderUrl = typeof url === "string" ? url : "";
      this.__nsLoaderTracked = false;
      return originalOpen.apply(this, arguments);
    };

    proto.send = function send() {
      const xhr = this;
      const url = xhr.__nsLoaderUrl || "";

      const start = () => {
        if (xhr.__nsLoaderTracked) return;
        xhr.__nsLoaderTracked = true;
        trackStart(url, "xhr", {
          method: xhr.__nsLoaderMethod || ""
        });
      };

      const end = () => {
        if (!xhr.__nsLoaderTracked) return;
        xhr.__nsLoaderTracked = false;
        trackEnd(url, "xhr", {
          method: xhr.__nsLoaderMethod || "",
          status: typeof xhr.status === "number" ? xhr.status : undefined
        });
      };

      xhr.addEventListener("loadstart", start, { once: true });
      xhr.addEventListener("loadend", end, { once: true });
      xhr.addEventListener("abort", end, { once: true });
      xhr.addEventListener("error", end, { once: true });
      xhr.addEventListener("timeout", end, { once: true });

      return originalSend.apply(this, arguments);
    };

    proto.__nsLoaderPatched = true;
  }

  function patchHistorySignals() {
    try {
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;

      history.pushState = function pushState() {
        const result = originalPushState.apply(this, arguments);
        emit("ROUTE_CHANGE", { method: "pushState", url: location.href });
        return result;
      };

      history.replaceState = function replaceState() {
        const result = originalReplaceState.apply(this, arguments);
        emit("ROUTE_CHANGE", { method: "replaceState", url: location.href });
        return result;
      };

      window.addEventListener("popstate", () => {
        emit("ROUTE_CHANGE", { method: "popstate", url: location.href });
      });
    } catch (error) {
      log("history patch failed", error);
    }
  }

  /**
   * Detect if an element is a pagination control in NetSuite.
   */
  function isPaginationElement(el) {
    if (!el) return false;
    
    let current = el;
    for (let i = 0; i < 5 && current; i++) {
      const className = current.className || "";
      const id = current.id || "";
      
      if (
        /paging|paginator|pagination|pgnum|segment|listnav/i.test(className) ||
        /paging|paginator|pagination|pgnum|segment|listnav/i.test(id)
      ) {
        return true;
      }
      
      const onclick = current.getAttribute?.("onclick") || "";
      if (
        onclick.includes("NLPaging") ||
        onclick.includes("segment") ||
        onclick.includes("setWindowChanged") ||
        onclick.includes("goToPage")
      ) {
        return true;
      }
      
      current = current.parentElement;
    }
    
    return false;
  }

  /**
   * Intercept link clicks to show loader BEFORE navigation starts.
   * This eliminates the visual gap between clicking and the new page loading.
   */
  function interceptNavigationClicks() {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        
        // Check for pagination controls
        if (isPaginationElement(target)) {
          log("pagination click detected");
          emit("NAVIGATION_CLICK", { url: "pagination", source: "pagination" });
          return;
        }
        
        // Find the closest anchor element (handles clicks on nested elements)
        const anchor = target.closest("a");
        if (!anchor) return;

        const href = anchor.getAttribute("href");
        if (!href) return;

        // Skip if modifier keys are pressed (new tab, etc.)
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        // Skip if target is _blank or external
        const anchorTarget = anchor.getAttribute("target");
        if (anchorTarget === "_blank" || anchorTarget === "_new") return;

        // Skip non-navigation hrefs
        if (
          href.startsWith("#") ||
          href.startsWith("mailto:") ||
          href.startsWith("tel:") ||
          // javascript:void(...) is typically used for in-page actions, not navigation
          /^javascript:\s*void\s*\(/i.test(href)
        ) {
          return;
        }

        // This is a navigation click - emit immediately before browser navigates
        log("navigation click detected", href);
        emit("NAVIGATION_CLICK", { url: href, source: "click" });
      },
      true // Use capture phase to catch it before anything else
    );
  }

  /**
   * Intercept form submissions that cause navigation.
   */
  function interceptFormSubmits() {
    document.addEventListener(
      "submit",
      (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;

        // Skip if form has target=_blank
        const target = form.getAttribute("target");
        if (target === "_blank" || target === "_new") return;

        log("form submit detected", form.action || location.href);
        emit("NAVIGATION_CLICK", { url: form.action || location.href, source: "form" });
      },
      true
    );
  }

  /**
   * Catch any navigation we might have missed (window.location, etc.)
   */
  function interceptBeforeUnload() {
    window.addEventListener(
      "beforeunload",
      () => {
        emit("NAVIGATION_CLICK", { url: "unload", source: "beforeunload" });
      },
      true
    );
  }

  patchFetch();
  patchXHR();
  patchHistorySignals();
  interceptNavigationClicks();
  interceptFormSubmits();
  interceptBeforeUnload();

  emit("BRIDGE_READY", { url: location.href });
})();