(() => {
  // Stub TrafficStars / Tsyndicate global functions so inline scripts on Sukebei
  // do not throw ReferenceError when the external ad SDKs are blocked.
  const noop = () => {};
  try {
    if (typeof window.TSVideoInstantMessage === "undefined") {
      window.TSVideoInstantMessage = noop;
    }
    if (typeof window.TSOutstreamVideo === "undefined") {
      window.TSOutstreamVideo = noop;
    }
  } catch {
    // Ignore context or sandbox restrictions
  }

  // Intercept document.write calls that inject ad scripts into the page
  try {
    const originalDocWrite = document.write.bind(document);
    document.write = function (...args) {
      const content = args.join("");
      if (/tsyndicate|trafficstars|outstream\.video|video\.instant\.message|ms\.js/i.test(content)) {
        return;
      }
      return originalDocWrite.apply(document, args);
    };
  } catch {
    // Ignore if document.write cannot be rebound
  }
})();
