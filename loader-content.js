(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const DEBUG = true;

  const IDLE_HIDE_DELAY_MS = 700;
  const MIN_VISIBLE_MS = 400;
  const CHECK_INTERVAL_MS = 150;
  const TAG = "__NS_LOADER_TRACKER__";

  const state = {
    activeRequests: 0,
    lastActivityAt: Date.now(),
    visibleSince: 0,
    isVisible: false,
    pageLoaded: false,  // Track if page load event has fired
    navigating: false   // Once true, NEVER hide overlay (page is leaving)
  };

  let overlayEl = null;
  let overlayTextEl = null;
  let bridgeInjected = false;

  function log(...args) {
    if (DEBUG) console.log("[NS Loader CS]", ...args);
  }

  function now() {
    return Date.now();
  }

  function getMountNode() {
    return document.documentElement || document.head || document.body;
  }

  function appendWhenReady(node) {
    const mount = getMountNode();
    if (mount) {
      mount.appendChild(node);
      return;
    }

    const observer = new MutationObserver(() => {
      const readyMount = getMountNode();
      if (readyMount) {
        readyMount.appendChild(node);
        observer.disconnect();
      }
    });

    observer.observe(document, { childList: true, subtree: true });
  }

  function safeAppendStyle() {
    if (document.getElementById("ns-loader-style")) return;

    const style = document.createElement("style");
    style.id = "ns-loader-style";
    style.textContent = `
      #ns-loader-overlay {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(12, 18, 28, 0.58);
        z-index: 999999;
        pointer-events: all;
        -webkit-backdrop-filter: blur(1px);
        backdrop-filter: blur(1px);
      }

      #ns-loader-overlay .ns-loader-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        padding: 24px 28px;
        border-radius: 16px;
        background: rgba(17, 24, 39, 0.92);
        color: #fff;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
        font: 600 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0.2px;
        min-width: 220px;
        text-align: center;
      }

      #ns-loader-overlay .ns-loader-spinner {
        width: 42px;
        height: 42px;
        border-radius: 50%;
        border: 4px solid rgba(255, 255, 255, 0.18);
        border-top-color: #ffffff;
        animation: ns-loader-spin 0.9s linear infinite;
        box-sizing: border-box;
      }

      #ns-loader-overlay .ns-loader-label {
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
      }

      @keyframes ns-loader-spin {
        to { transform: rotate(360deg); }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureOverlay() {
    if (overlayEl && overlayEl.isConnected) return overlayEl;

    safeAppendStyle();

    overlayEl = document.getElementById("ns-loader-overlay");
    if (overlayEl) {
      overlayTextEl = overlayEl.querySelector(".ns-loader-label");
      return overlayEl;
    }

    overlayEl = document.createElement("div");
    overlayEl.id = "ns-loader-overlay";
    overlayEl.setAttribute("aria-live", "polite");
    overlayEl.setAttribute("aria-busy", "true");
    overlayEl.setAttribute("aria-hidden", "false");
    overlayEl.innerHTML = `
      <div class="ns-loader-card" role="status" aria-label="Loading NetSuite">
        <div class="ns-loader-spinner" aria-hidden="true"></div>
        <div class="ns-loader-label">NetSuite is Loading</div>
      </div>
    `;
    overlayTextEl = overlayEl.querySelector(".ns-loader-label");

    appendWhenReady(overlayEl);
    return overlayEl;
  }

  function showOverlay(reason) {
    const overlay = ensureOverlay();
    if (!overlay) return;

    if (!state.isVisible) {
      state.isVisible = true;
      state.visibleSince = now();
    }

    overlay.style.display = "flex";
    overlay.setAttribute("aria-hidden", "false");

    // Always show reason for debugging - remove condition after testing
    if (overlayTextEl && reason) {
      overlayTextEl.textContent = `Loading... (${reason})`;
    }
  }

  function hideOverlay() {
    if (!overlayEl || !state.isVisible) return;
    overlayEl.style.display = "none";
    overlayEl.setAttribute("aria-hidden", "true");
    state.isVisible = false;
    state.visibleSince = 0;
  }

  function markActivity(source) {
    state.lastActivityAt = now();
    if (DEBUG) log("activity", source, "activeRequests=", state.activeRequests);
  }

  function onRequestStart(source) {
    state.activeRequests += 1;
    markActivity(source);
    showOverlay(source);
  }

  function onRequestEnd(source) {
    state.activeRequests = Math.max(0, state.activeRequests - 1);
    markActivity(source);
  }

  function maybeHide() {
    if (!state.isVisible) return;
    if (state.activeRequests > 0) return;

    // NEVER hide if navigation has started - keep overlay until page unloads
    if (state.navigating) return;

    // Don't hide until the page is fully loaded (SSR pages have no fetch/XHR)
    if (!state.pageLoaded) return;

    const idleFor = now() - state.lastActivityAt;
    if (idleFor < IDLE_HIDE_DELAY_MS) return;

    const visibleFor = now() - state.visibleSince;
    if (visibleFor < MIN_VISIBLE_MS) return;

    hideOverlay();
  }

  /**
   * Track page load completion for SSR pages that don't use fetch/XHR.
   */
  function trackPageLoad() {
    // If already complete, mark it
    if (document.readyState === "complete") {
      state.pageLoaded = true;
      markActivity("page-complete");
      return;
    }

    // Listen for the load event
    window.addEventListener(
      "load",
      () => {
        log("page load event fired");
        state.pageLoaded = true;
        markActivity("page-load");
      },
      { once: true }
    );

    // Also listen for readyState changes
    document.addEventListener(
      "readystatechange",
      () => {
        if (document.readyState === "complete") {
          log("readyState complete");
          state.pageLoaded = true;
          markActivity("readystate-complete");
        }
      }
    );
  }

  function injectPageBridge() {
    if (bridgeInjected) return;
    bridgeInjected = true;

    const existing = document.getElementById("ns-loader-page-bridge");
    if (existing) return;

    const script = document.createElement("script");
    script.id = "ns-loader-page-bridge";
    script.src = api.runtime.getURL("page-bridge.js");
    script.async = false;
    script.onload = () => {
      script.remove();
    };
    script.onerror = () => {
      log("page bridge failed to load");
      script.remove();
    };

    appendWhenReady(script);
  }

  function handleBridgeMessage(event) {
    if (!event || event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== TAG) return;

    switch (data.kind) {
      case "BRIDGE_READY":
        markActivity("bridge-ready");
        showOverlay("bridge-ready");
        break;

      case "REQUEST_START":
        onRequestStart(data.payload?.transport || "request");
        break;

      case "REQUEST_END":
        onRequestEnd(data.payload?.transport || "request");
        break;

      case "ROUTE_CHANGE":
        markActivity("route-change");
        showOverlay("route-change");
        break;

      case "NAVIGATION_CLICK":
        // User clicked a link or submitted a form - show overlay IMMEDIATELY
        // This runs BEFORE the browser starts navigating away
        markActivity("navigation-click");
        showOverlay("navigation-click");
        break;

      default:
        break;
    }
  }

  function handleRuntimeMessage(message) {
    if (!message || !message.action) return;

    if (message.action === "SHOW_LOADER") {
      markActivity(message.reason || "show-loader");
      showOverlay(message.reason || "show-loader");
      return;
    }

    if (message.action === "HIDE_LOADER") {
      hideOverlay();
    }
  }

  // Fallback: If a known NetSuite list/filter control is clicked and no network event fires, show overlay on DOM mutation
  function startMutationFallback() {
    if (!window.MutationObserver || !document.documentElement) return;

    let lastListNavClick = 0;
    let overlayPending = false;
    const LIST_NAV_TIMEOUT = 350; // ms

    // Heuristic: known NetSuite list/filter controls
    function isNetSuiteListControl(el) {
      if (!el) return false;
      let current = el;
      for (let i = 0; i < 5 && current; i++) {
        const className = current.className || "";
        const id = current.id || "";
        if (/listnav|pgnum|daterange|datefilter|segfilter|custfilter|nllist/i.test(className + " " + id)) {
          return true;
        }
        const onclick = current.getAttribute?.("onclick") || "";
        if (onclick.includes("NLPaging") || onclick.includes("setWindowChanged") || onclick.includes("goToPage") || onclick.includes("NLFilter")) {
          return true;
        }
        current = current.parentElement;
      }
      return false;
    }

    document.addEventListener(
      "click",
      (event) => {
        if (isNetSuiteListControl(event.target)) {
          lastListNavClick = now();
          overlayPending = true;
          if (DEBUG) log("NetSuite list/filter control click detected (mutation fallback)");
        }
      },
      true
    );

    const observer = new MutationObserver(() => {
      // If a list/filter control was clicked recently and overlay is not visible, show overlay
      if (
        overlayPending &&
        !state.isVisible &&
        now() - lastListNavClick < LIST_NAV_TIMEOUT
      ) {
        if (DEBUG) log("DOM mutation after list/filter control click, showing overlay (fallback)");
        markActivity("mutation-listnav");
        showOverlay("mutation-listnav");
        overlayPending = false;
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Intercept clicks directly in content script as a fast fallback.
   * This runs even before page-bridge is loaded.
   */
  function interceptClicksEarly() {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        
        // Check for pagination controls (NetSuite uses these for list navigation)
        const isPaginationClick = isPaginationElement(target);
        
        // Check for submit buttons (form submissions)
        const isSubmitButton = isSubmitElement(target);
        
        const anchor = target.closest?.("a");
        
        if (isPaginationClick) {
          // Pagination click - show overlay (even for javascript: hrefs)
          log("pagination click detected");
          markActivity("pagination-click");
          showOverlay("pagination-click");
          return;
        }
        
        if (isSubmitButton) {
          // Submit button click - show overlay
          log("submit button click detected");
          markActivity("submit-click");
          showOverlay("submit-click");
          return;
        }
        
        if (!anchor) return;

        const href = anchor.getAttribute("href");
        if (!href) return;

        // Skip modifier keys, _blank targets
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
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

        // Show overlay immediately on any navigation click
        markActivity("click-early");
        showOverlay("click-early");
      },
      true
    );
  }

  /**
   * Detect if an element is a pagination control in NetSuite.
   */
  function isPaginationElement(el) {
    if (!el) return false;
    
    // Walk up to find pagination indicators
    let current = el;
    for (let i = 0; i < 5 && current; i++) {
      // Check class names for pagination patterns
      const className = current.className || "";
      const id = current.id || "";
      
      if (
        /paging|paginator|pagination|pgnum|segment|listnav/i.test(className) ||
        /paging|paginator|pagination|pgnum|segment|listnav/i.test(id)
      ) {
        return true;
      }
      
      // Check for NetSuite-specific pagination elements
      // These often have onclick with setWindowChanged or NLPaging
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
   * Detect if an element is a submit button or triggers form submission.
   */
  function isSubmitElement(el) {
    if (!el) return false;
    
    // Check the element and its parents
    let current = el;
    for (let i = 0; i < 3 && current; i++) {
      const tagName = current.tagName?.toLowerCase();
      
      // Check for submit buttons
      if (tagName === "button") {
        const type = current.getAttribute("type");
        // Buttons default to type="submit" if inside a form
        if (!type || type === "submit") {
          return true;
        }
      }
      
      if (tagName === "input") {
        const type = current.getAttribute("type");
        if (type === "submit" || type === "image") {
          return true;
        }
      }
      
      // Check for NetSuite specific submit patterns
      const onclick = current.getAttribute?.("onclick") || "";
      if (
        onclick.includes("submit") ||
        onclick.includes("NLDoSearch") ||
        onclick.includes("setWindowChanged") && onclick.includes("true")
      ) {
        return true;
      }
      
      current = current.parentElement;
    }
    
    return false;
  }

  /**
   * Catch beforeunload to ensure overlay shows during navigation.
   */
  function interceptPageUnload() {
    window.addEventListener(
      "beforeunload",
      () => {
        // Lock overlay visible - page is definitely leaving
        state.navigating = true;
        markActivity("beforeunload");
        showOverlay("beforeunload");
      },
      true
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
        markActivity("form-submit");
        showOverlay("form-submit");
      },
      true
    );
  }

  function bootstrap() {
    // We just need to create the overlay and set up event handlers

    ensureOverlay();
    showOverlay("bootstrap");

    // Track page load state for SSR pages
    trackPageLoad();

    // Set up early click interception BEFORE page-bridge loads
    interceptClicksEarly();
    interceptFormSubmits();
    interceptPageUnload();

    injectPageBridge();

    window.addEventListener("message", handleBridgeMessage, false);

    try {
      api.runtime.onMessage.addListener(handleRuntimeMessage);
    } catch (error) {
      log("runtime message listener failed", error);
    }

    try {
      api.runtime.sendMessage({ action: "INIT_BRIDGE" });
    } catch {
      // Optional; background message is not required for hard navigations.
    }

    window.setInterval(maybeHide, CHECK_INTERVAL_MS);
    startMutationFallback();
  }

  bootstrap();
})();