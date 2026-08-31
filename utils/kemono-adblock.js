(() => {
  const AD_SELECTORS = [
    ".ad-container",
    "#ad-banner",
    ".sidebar-extra-style.global-sidebar-entry-item",
    'a[href*="theporndude.com"]',
    'a[href*="tsyndicate.com"]',
    'a[href*="trafficstars.com"]',
    'a[href*="mnaspm.com"]',
    'a[href*="magsrv.com"]',
    'iframe[src*="tsyndicate"]',
    'iframe[src*="trafficstars"]',
    'iframe[src*="mnaspm"]',
    'iframe[src*="magsrv"]',
    'iframe[src*="exoclick"]',
    'iframe[src*="juicyads"]',
    'iframe[src*="popcash"]',
    'script[src*="tsyndicate"]',
    'script[src*="mnaspm"]',
    'script[src*="magsrv"]',
  ];

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
        el.remove();
      }
    }
  };

  try {
    document.documentElement.dataset.utilsKemono = "1";
  } catch {
    // Ignore if documentElement is not writable yet
  }

  removeAdElements(document);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) {
          removeAdElements(node);
        }
      }
    }
  });

  const startObserver = () => {
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      removeAdElements(document);
    }
  };

  startObserver();
  document.addEventListener("DOMContentLoaded", () => removeAdElements(document));
  window.addEventListener("load", () => removeAdElements(document));
})();
