(() => {
  const AD_SELECTORS = [
    ".bnrs",
    ".bnr",
    'a[href*="aagm.link"]',
    'a[href*="bbwafx.com"]',
    'a[href*="vexlira.com"]',
    'iframe[src*="miserly-wrap"]',
    'iframe[src*="armsbroodelusive"]',
    'iframe[src*="new-split"]',
    'iframe[src*="aagm.link"]',
    'iframe[src*="vexlira"]',
    'script[src*="htsrc.js"]',
    'script[src*="miserly-wrap"]',
    'script[src*="armsbroodelusive"]',
    'img[src*="/b_pics/"]',
    'img[src*="/istrp/"]',
  ];

  const removeAdElements = (root = document) => {
    if (!root || !root.querySelectorAll) {
      return;
    }

    for (const selector of AD_SELECTORS) {
      const elements = root.querySelectorAll(selector);
      for (const el of elements) {
        el.remove();
      }
    }
  };

  try {
    document.documentElement.dataset.utilsOrangepix = "1";
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
