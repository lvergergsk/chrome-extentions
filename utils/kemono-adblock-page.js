(() => {
  const AD_HOSTS = [
    "tsyndicate.com",
    "trafficstars.com",
    "mnaspm.com",
    "magsrv.com",
    "exoclick.com",
    "juicyads.com",
    "popcash.net",
    "theporndude.com",
  ];

  const hostFromUrl = (url) => {
    const match = String(url).match(/^(?:https?:)?\/\/([^/?#]+)/i);
    return match ? match[1].toLowerCase().replace(/\.$/, "") : "";
  };

  const isAdHost = (host) => AD_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));

  const isAdUrl = (url) => isAdHost(hostFromUrl(url));

  const isAdContent = (content) => {
    const matches = String(content).match(/(?:https?:)?\/\/[^/?#\s"'<>]+/gi);
    if (!matches) {
      return false;
    }
    return matches.some((raw) => isAdUrl(raw.startsWith("//") ? `https:${raw}` : raw));
  };

  try {
    const originalOpen = window.open.bind(window);
    window.open = function (url, ...rest) {
      if (isAdUrl(url)) {
        return null;
      }
      return originalOpen(url, ...rest);
    };
  } catch {
    // Ignore sandbox restrictions
  }

  try {
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
