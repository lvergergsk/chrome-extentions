(() => {
  const AD_SELECTORS = [
    "#e71bf691-4eb4-453f-8f11-6f40280c18f6",
    "#ec01fd54-016b-41b4-bec9-b9b93f9b3b77",
    ".ts-outstream-video",
    ".ts-video-instant-message",
    "[class*=\"ts-outstream\"]",
    "[class*=\"ts-video\"]",
    "[id*=\"ts-\"]",
    "[data-ts-spot]",
    "[data-ts-container-id]",
    "[data-ts-native-settings]",
    "[data-ts-wrapper-styles]",
    "iframe[src*=\"tsyndicate\"]",
    "iframe[src*=\"trafficstars\"]",
    "a[href*=\"theporndude.com\"]"
  ];

  const removeAdElements = (root = document) => {
    if (!root || !root.querySelectorAll) {
      return;
    }

    // Clean up all standard ad elements
    for (const selector of AD_SELECTORS) {
      const elements = root.querySelectorAll(selector);
      for (const el of elements) {
        if (el.tagName === "A" && el.closest(".navbar-nav")) {
          const navItem = el.closest("li");
          if (navItem) {
            navItem.remove();
            continue;
          }
        }
        el.remove();
      }
    }
  };

  // Initial pass as early as possible
  removeAdElements(document);

  // Observe dynamically added ad elements
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) { // ELEMENT_NODE
          removeAdElements(node);
        }
      }
    }
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      removeAdElements(document);
    });
  }

  // Ensure cleanup on DOMContentLoaded & load
  document.addEventListener("DOMContentLoaded", () => removeAdElements(document));
  window.addEventListener("load", () => removeAdElements(document));
})();
