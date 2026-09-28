console.log("NetAcad Scraper content script loaded and ready.");

const FLOATING_BTN_ID = "netacad-ai-floating-process-btn";

function injectFloatingButton() {
  if (window.top !== window) return; // top frame only
  if (document.getElementById(FLOATING_BTN_ID)) return;
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", injectFloatingButton, { once: true });
    return;
  }

  const btn = document.createElement("button");
  btn.id = FLOATING_BTN_ID;
  btn.type = "button";
  btn.textContent = "AI";
  btn.title = "Process Questions on this Page (drag to move)";
  Object.assign(btn.style, {
    position: "fixed",
    left: "10px",
    top: "50%",
    zIndex: "2147483647",
    width: "36px",
    height: "36px",
    padding: "0",
    fontSize: "12px",
    fontWeight: "600",
    color: "#fff",
    backgroundColor: "#007bff",
    border: "none",
    borderRadius: "50%",
    boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
    cursor: "grab",
    fontFamily: "Arial, sans-serif",
    transition: "background-color 0.15s, box-shadow 0.15s",
    lineHeight: "36px",
    textAlign: "center",
    userSelect: "none",
    touchAction: "none",
  });
  btn.addEventListener("mouseover", () => (btn.style.backgroundColor = "#0056b3"));
  btn.addEventListener("mouseout", () => (btn.style.backgroundColor = "#007bff"));

  // --- Drag state ---
  const DRAG_THRESHOLD_PX = 4;
  let dragState = null; // { startX, startY, offsetX, offsetY, moved }
  let suppressNextClick = false;

  function clampToViewport(x, y) {
    const w = btn.offsetWidth;
    const h = btn.offsetHeight;
    const maxX = Math.max(0, window.innerWidth - w);
    const maxY = Math.max(0, window.innerHeight - h);
    return [Math.min(Math.max(0, x), maxX), Math.min(Math.max(0, y), maxY)];
  }

  function applyPosition(x, y) {
    const [cx, cy] = clampToViewport(x, y);
    btn.style.left = cx + "px";
    btn.style.top = cy + "px";
    btn.style.right = "auto";
    btn.style.bottom = "auto";
  }

  // Restore saved position
  chrome.storage.sync.get(["floatingBtnPos"], (res) => {
    const p = res.floatingBtnPos;
    if (p && typeof p.x === "number" && typeof p.y === "number") {
      applyPosition(p.x, p.y);
    } else {
      // First load: use computed center-left default
      applyPosition(10, Math.round(window.innerHeight / 2 - 18));
    }
  });

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    btn.setPointerCapture && e.pointerId != null && btn.setPointerCapture(e.pointerId);
    const rect = btn.getBoundingClientRect();
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      moved: false,
    };
    btn.style.cursor = "grabbing";
    btn.style.transition = "background-color 0.15s";
  }

  function onPointerMove(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    dragState.moved = true;
    applyPosition(e.clientX - dragState.offsetX, e.clientY - dragState.offsetY);
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!dragState) return;
    btn.style.cursor = "grab";
    if (dragState.moved) {
      suppressNextClick = true;
      const rect = btn.getBoundingClientRect();
      chrome.storage.sync.set({
        floatingBtnPos: { x: rect.left, y: rect.top },
      });
    }
    dragState = null;
  }

  btn.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  // Re-clamp on resize
  window.addEventListener("resize", () => {
    const rect = btn.getBoundingClientRect();
    applyPosition(rect.left, rect.top);
  });

  btn.addEventListener("click", async (ev) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "...";
    try {
      const stored = await chrome.storage.sync.get(["anthropicApiKey"]);
      const key = stored.anthropicApiKey;
      if (!key) {
        btn.textContent = "!";
        btn.title = "Set API Key in popup";
        setTimeout(() => {
          btn.textContent = original;
          btn.title = "Process Questions on this Page";
        }, 2500);
        return;
      }

      // Top frame may not contain app-root (it's in iframe). Try local first, then broadcast.
      if (typeof window.scrapeData === "function" && document.querySelector("app-root")) {
        await window.scrapeData();
      } else {
        // Forward to all frames via runtime message — content scripts in iframes will handle it
        chrome.runtime.sendMessage({ action: "broadcastProcessPage" }, () => {
          if (chrome.runtime.lastError) {
            console.debug("NetAcad Scraper: broadcast send error", chrome.runtime.lastError.message);
          }
        });
      }
      btn.textContent = "✓";
    } catch (e) {
      console.error("NetAcad Scraper: floating button error", e);
      btn.textContent = "✗";
    } finally {
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 1500);
    }
  });

  document.body.appendChild(btn);
  console.debug("NetAcad Scraper: floating button injected.");
}

let debounceTimeout;
function debouncedScrape() {
  clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => {
    chrome.storage.sync.get(["processOnSwitch"], (result) => {
      if (result.processOnSwitch === false) {
        console.debug(
          "NetAcad Scraper: Page switch detected but 'Process on Page Switch' is disabled.",
        );
        return;
      }

      if (typeof window.scrapeData === "function") {
        console.debug(
          "NetAcad Scraper: Mutation detected, re-initiating scrape...",
        );
        window.scrapeData();
      } else {
        console.error(
          "NetAcad Scraper: window.scrapeData not found for debounced call.",
        );
      }
    });
  }, 1200);
}

function initMutationObserver() {
  console.debug("NetAcad Scraper: Attempting to initialize MutationObserver.");
  const appRoot = document.querySelector("app-root");
  if (appRoot && appRoot.shadowRoot) {
    const pageView = appRoot.shadowRoot.querySelector("page-view");
    if (pageView && pageView.shadowRoot) {
      const targetNode = pageView.shadowRoot;
      const observerConfig = { childList: true, subtree: true };

      const observer = new MutationObserver((mutationsList, observer) => {
        console.debug(
          "NetAcad Scraper: MutationObserver detected DOM change in page-view's shadowRoot.",
        );
        debouncedScrape();
      });

      observer.observe(targetNode, observerConfig);
      console.debug(
        "NetAcad Scraper: MutationObserver initialized and observing page-view's shadowRoot.",
      );
    } else {
      console.warn(
        "NetAcad Scraper: MutationObserver setup failed - page-view or its shadowRoot not found. Observer will not be active.",
      );
    }
  } else {
    console.warn(
      "NetAcad Scraper: MutationObserver setup failed - app-root or its shadowRoot not found. Observer will not be active.",
    );
  }
}

if (typeof window.scrapeData !== "function") {
  if (typeof scrapeData === "function") {
    window.scrapeData = scrapeData;
  } else {
    console.error(
      "scrapeData function not found in global scope. scraper.js might not have loaded correctly or before this script.",
    );
  }
}

const autoRunScraper = async () => {
  if (!document.querySelector("app-root")) {
    const frameContext = window.top === window ? "main page" : "an iframe";
    console.debug(
      `NetAcad Scraper: autoRunScraper - app-root not found in this frame context (${frameContext}). Auto-run aborted.`,
    );
    return;
  }

  if (document.readyState !== "complete") {
    await new Promise((resolve) =>
      window.addEventListener("load", resolve, { once: true }),
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 500));

  const storedData = await chrome.storage.sync.get([
    "anthropicApiKey",
    "showAnswers",
  ]);
  if (
    storedData.anthropicApiKey &&
    (typeof storedData.showAnswers === "undefined" ||
      storedData.showAnswers === true)
  ) {
    console.debug(
      "NetAcad Scraper: API key found and showAnswers enabled. Attempting initial scrape and setting up observer.",
    );
    if (typeof window.scrapeData === "function") {
      await window.scrapeData(); // Perform initial scrape
      initMutationObserver(); // Setup observer after initial scrape attempt
    } else {
      console.error(
        "NetAcad Scraper: Critical - window.scrapeData not defined for auto-run and observer setup.",
      );
    }
  } else if (storedData.anthropicApiKey && storedData.showAnswers === false) {
    console.debug(
      "NetAcad Scraper: showAnswers is disabled. Skipping initial scrape and observer.",
    );
  } else {
    console.debug(
      "NetAcad Scraper: Page loaded. No API key. Observer not set. Use popup to set key and process.",
    );
  }
};

autoRunScraper();
injectFloatingButton();

// Listener for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "processPage") {
    console.debug(
      "NetAcad Scraper (content.js): Received processPage message from popup.",
    );
    // Check if this frame contains the app-root element
    if (document.querySelector("app-root")) {
      if (
        request.hasOwnProperty("showAnswers") &&
        request.showAnswers === false
      ) {
        console.debug(
          "NetAcad Scraper (content.js): showAnswers is false, not scraping.",
        );
        sendResponse({
          success: true,
          result: false,
          message: "AI answers are hidden by user setting.",
        });
        return false;
      }
      console.debug(
        "NetAcad Scraper (content.js): app-root found in this frame. Calling window.scrapeData().",
      );
      if (typeof window.scrapeData === "function") {
        window
          .scrapeData()
          .then((result) => {
            console.debug(
              `NetAcad Scraper (content.js): scrapeData completed in this frame with result: ${result}`,
            );
            sendResponse({ success: true, result: result });
          })
          .catch((error) => {
            console.error(
              "NetAcad Scraper (content.js): Error calling scrapeData from message listener:",
              error,
            );
            sendResponse({ success: false, error: error.toString() });
          });
        return true; // Indicates that sendResponse will be called asynchronously
      } else {
        console.error(
          "NetAcad Scraper (content.js): window.scrapeData not found in this frame for processPage message.",
        );
        sendResponse({
          success: false,
          error: "scrapeData_not_found_in_frame",
        });
      }
    } else {
      console.debug(
        "NetAcad Scraper (content.js): app-root NOT found in this frame. Ignoring processPage message.",
      );
      return false;
    }
  }
  return false;
});

// Periodic check to see if the content script is still active. Can be removed.
setInterval(() => {
  console.debug(
    "NetAcad Scraper content script is active - periodic check @ " +
      new Date().toLocaleTimeString(),
  );
}, 30000);
