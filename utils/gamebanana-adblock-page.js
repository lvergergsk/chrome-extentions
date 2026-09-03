(() => {
  // gamebanana.com links out to real mirrors and author sites, so unlike the
  // shortener blockers this one only vetoes opens/writes aimed at ad networks.
  const AD_HOSTS = [
    "intergient.com",
    "intergi.com",
    "playwire.com",
    "googlesyndication.com",
    "doubleclick.net",
    "adtrafficquality.google",
    "fundingchoicesmessages.google.com",
    "imasdk.googleapis.com",
    "amazon-adsystem.com",
    "btloader.com",
    "ad-delivery.net",
    "html-load.com",
    "criteo.com",
    "criteo.net",
    "rubiconproject.com",
    "pubmatic.com",
    "openx.net",
    "3lift.com",
    "casalemedia.com",
    "adsrvr.org",
    "gumgum.com",
    "crwdcntrl.net",
    "id5-sync.com",
    "liadm.com",
    "eyeota.net",
    "agkn.com",
    "33across.com",
    "hadronid.net",
    "quantserve.com",
    "quantcount.com",
    "privacymanager.io",
    "bounceexchange.com",
    "bouncex.net",
    "ccgateway.net",
    "wknd.ai",
    "dns-finder.com",
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
