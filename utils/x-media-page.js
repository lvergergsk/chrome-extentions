// Classic content script (MAIN world). Wrapped in an IIFE so nothing leaks into the
// real x.com global scope, where a stray top-level name could break the page itself.
(() => {
  const { harvestTweetMedia } = globalThis.UtilsXMedia;

  const SOURCE = "utils-x-media";

  const cache = new Map();

  const post = (payload) => {
    window.postMessage({ source: SOURCE, ...payload }, window.location.origin);
  };

  const remember = (byTweetId) => {
    for (const [tweetId, media] of byTweetId) {
      if (!media.length) {
        continue;
      }
      cache.set(tweetId, media);
      post({ type: "harvest", tweetId, media });
    }
  };

  const harvestPayload = (data) => {
    remember(harvestTweetMedia(data));
  };

  const fiberOf = (element) => {
    for (const key of Object.keys(element)) {
      if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
        return element[key];
      }
    }
    return null;
  };

  const walkFiber = (fiber, visit, depth = 0) => {
    let node = fiber;
    while (node && depth <= 40) {
      visit(node);
      if (node.child) {
        walkFiber(node.child, visit, depth + 1);
      }
      node = node.sibling;
    }
  };

  const harvestArticleFiber = (tweetId) => {
    const into = new Map();
    for (const article of document.querySelectorAll('article[data-testid="tweet"], article')) {
      const fiber = fiberOf(article);
      if (!fiber) {
        continue;
      }
      const visit = (node) => {
        const props = node.memoizedProps;
        if (props && typeof props === "object") {
          harvestTweetMedia(props, into);
        }
      };
      visit(fiber);
      if (fiber.child) {
        walkFiber(fiber.child, visit, 1);
      }
    }
    return into.get(String(tweetId)) ?? cache.get(String(tweetId)) ?? [];
  };

  const hookFetch = () => {
    const original = window.fetch;
    if (typeof original !== "function" || original.__utilsXMedia) {
      return;
    }
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      try {
        const request = args[0];
        const url = typeof request === "string" ? request : request?.url;
        if (typeof url === "string" && url.includes("/graphql/")) {
          result
            .then(async (response) => {
              const text = await response.clone().text();
              if (!/extended_entities|mediaDetails|video_info|videoInfo/.test(text)) {
                return;
              }
              harvestPayload(JSON.parse(text));
            })
            .catch(() => {});
        }
      } catch {
        // Keep the page fetch path intact.
      }
      return result;
    };
    wrapped.__utilsXMedia = true;
    window.fetch = wrapped;
  };

  hookFetch();

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== SOURCE || data.type !== "ask") {
      return;
    }
    let media = [];
    try {
      media = harvestArticleFiber(data.tweetId);
    } catch {
      // Always answer: the isolated side would otherwise wait for its full timeout.
    }
    post({ type: "reply", requestId: data.requestId, media });
  });
})();
