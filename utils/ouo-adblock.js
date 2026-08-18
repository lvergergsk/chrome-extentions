(() => {
  const AD_SELECTORS = [
    'iframe[title="offer"]',
    'iframe[src*="onclck"]',
    'iframe[src*="pubadx"]',
    'iframe[src*="popcash"]',
    'iframe[src*="adspector"]',
    'iframe[src*="cuplikenominee"]',
    'iframe[src*="excavatenearbywand"]',
    "[data-banner-id]",
    ".gfpl-wrapper",
    '[class*="bg-ssp-"]',
    '[class*="bg-container-"]',
    '[id*="bg-ssp-"]',
    ".__bai-container",
    ".__inst-container",
    ".IOarzRhPlPOverlay",
  ];

  const MARKETING_PATH = /^\/(?:rates|auth|login|register|signup|faq|payout|about)(?:\/|$)/i;
  const GATE_PATH = /^\/(?:go\/|xreallcygo\/|fbc\/)?[A-Za-z0-9]+$/;

  const pagePath = () => {
    try {
      return String((window.location || location).pathname || "/");
    } catch {
      return "/";
    }
  };

  const isGatePage = (pathname) => {
    const normalized = String(pathname || "").replace(/\/+$/, "") || "/";
    if (normalized === "/" || MARKETING_PATH.test(normalized)) {
      return false;
    }
    return GATE_PATH.test(normalized);
  };

  const removeAdElements = (root = document) => {
    if (!root || !root.querySelectorAll) {
      return;
    }

    for (const selector of AD_SELECTORS) {
      try {
        if (typeof root.matches === "function" && root.matches(selector)) {
          root.remove();
          return;
        }
      } catch {
        // Invalid selector against this node
      }
      const elements = root.querySelectorAll(selector);
      for (const el of elements) {
        const parent = el.parentElement;
        if (
          el.tagName === "IFRAME" &&
          parent &&
          parent !== document.body &&
          parent !== document.documentElement &&
          typeof parent.querySelector === "function" &&
          !parent.querySelector("#form-captcha, #btn-main, .skip-container")
        ) {
          parent.remove();
          continue;
        }
        el.remove();
      }
    }
  };

  const clickWhenReady = () => {
    if (!isGatePage(pagePath())) {
      return;
    }
    const btn = document.getElementById("btn-main");
    if (!btn || btn.dataset.utilsOuoClicked) {
      return;
    }
    const token = document.querySelector("[name=cf-turnstile-response]");
    if (!token || !token.value) {
      return;
    }
    btn.dataset.utilsOuoClicked = "1";
    btn.click();
  };

  try {
    document.documentElement.dataset.utilsOuo = "1";
  } catch {
    // Ignore if documentElement is not writable yet
  }

  removeAdElements(document);
  clickWhenReady();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) {
          removeAdElements(node);
        }
      }
    }
    clickWhenReady();
  });

  const startObserver = () => {
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      removeAdElements(document);
      clickWhenReady();
    }
  };

  startObserver();
  document.addEventListener("DOMContentLoaded", () => {
    removeAdElements(document);
    clickWhenReady();
  });
  window.addEventListener("load", () => {
    removeAdElements(document);
    clickWhenReady();
  });

  const poll = setInterval(clickWhenReady, 400);
  setTimeout(() => clearInterval(poll), 30000);
})();
