(() => {
  const OUO_HOST = /(^|\.)ouo\.(io|press)$/i;
  const AD_WRITE_RE =
    /popcash|onclck|pubadx|cuplikenominee|excavatenearbywand|adspector|coosync|drimquop|metricswpsh/i;

  const isOuoUrl = (url) =>
    typeof url === "string" &&
    (OUO_HOST.test(url) || /^(?:https?:)?\/\/(?:[^/]*\.)?ouo\.(?:io|press)(?:[/:?#]|$)/i.test(url));

  try {
    const originalOpen = window.open.bind(window);
    window.open = function (url, ...rest) {
      if (typeof url === "string" && isOuoUrl(url)) {
        return originalOpen(url, ...rest);
      }
      return null;
    };
  } catch {
    // Ignore sandbox restrictions
  }

  try {
    const isAdContent = (content) => AD_WRITE_RE.test(content);

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
})();
