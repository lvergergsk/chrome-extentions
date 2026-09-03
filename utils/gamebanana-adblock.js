(() => {
  // Playwire/RAMP slots and the GPT containers they fill. gamebanana.com also
  // ships bait nodes (#adBanner, .ad_row.adbannertop...) purely to detect ad
  // blockers -- leave those alone so the site keeps thinking ads rendered.
  const AD_SELECTORS = [
    ".pw-tag",
    "#pw-oop-flex_container",
    "#pwAdContainer",
    ".InGridPlaceholder",
    "#pw_user_data",
    '[id^="google_ads_iframe"]',
    'iframe[src*="safeframe.googlesyndication.com"]',
    'iframe[src*="intergient.com"]',
    'script[src*="intergient.com"]',
    'script[src*="intergi.com"]',
    'script[src*="playwire.com"]',
    'script[src*="bounceexchange.com"]',
    'script[src*="btloader.com"]',
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
    document.documentElement.dataset.utilsGamebanana = "1";
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
