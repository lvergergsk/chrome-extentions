(() => {
  // Stub TrafficStars / Tsyndicate / Exoclick global SDK objects and functions
  // so inline scripts on Sukebei do not throw ReferenceError when the external
  // ad SDKs are blocked.
  const noop = () => {};
  try {
    const stubs = [
      "TSVideoInstantMessage",
      "TSOutstreamVideo",
      "TSPopunder",
      "TSBanner",
      "TSNative",
      "TSVideo",
      "ts_ad"
    ];
    for (const name of stubs) {
      if (typeof window[name] === "undefined") {
        window[name] = noop;
      }
    }
  } catch {
    // Ignore context or sandbox restrictions
  }

  // Intercept document.write / writeln calls that inject ad scripts
  try {
    const isAdContent = (content) =>
      /tsyndicate|trafficstars|exoclick|juicyads|popcash|outstream\.video|video\.instant\.message|ms\.js/i.test(
        content,
      );

    const originalDocWrite = document.write.bind(document);
    document.write = function (...args) {
      const content = args.join("");
      if (isAdContent(content)) {
        return;
      }
      return originalDocWrite.apply(document, args);
    };

    if (document.writeln) {
      const originalDocWriteln = document.writeln.bind(document);
      document.writeln = function (...args) {
        const content = args.join("");
        if (isAdContent(content)) {
          return;
        }
        return originalDocWriteln.apply(document, args);
      };
    }
  } catch {
    // Ignore if document.write cannot be rebound
  }

  // Prevent popup/popunder redirection from ad click handlers
  try {
    const originalOpen = window.open.bind(window);
    window.open = function (url, ...rest) {
      if (
        typeof url === "string" &&
        /tsyndicate|trafficstars|exoclick|juicyads|popcash|theporndude/i.test(url)
      ) {
        return null;
      }
      return originalOpen(url, ...rest);
    };
  } catch {
    // Ignore sandbox restrictions
  }
})();
