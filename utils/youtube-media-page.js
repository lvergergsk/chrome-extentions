// Runs in YouTube's MAIN world so it can use the page's current Innertube key
// and session when resolving the direct, muxed video stream.
(() => {
  const { isVideoId, selectDownloadFormat } = globalThis.UtilsYouTubeMedia;
  const SOURCE = "utils-youtube-media";
  const CLIENTS = [
    { clientName: "ANDROID", clientVersion: "20.10.38" },
    { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2" },
  ];

  const post = (payload) => window.postMessage({ source: SOURCE, ...payload }, window.location.origin);
  const config = (key) => window.ytcfg?.get?.(key);

  const requestPlayer = async (videoId, client) => {
    const apiKey = config("INNERTUBE_API_KEY");
    if (!apiKey) {
      return null;
    }
    const visitorData = config("VISITOR_DATA");
    const response = await fetch(`/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            ...client,
            hl: document.documentElement.lang || "en",
            ...(visitorData ? { visitorData } : {}),
          },
        },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });
    return response.ok ? response.json() : null;
  };

  const resolveVideo = async (videoId) => {
    if (!isVideoId(videoId)) {
      return { ok: false, error: "bad-id" };
    }
    for (const client of CLIENTS) {
      try {
        const player = await requestPlayer(videoId, client);
        const format = selectDownloadFormat(player?.streamingData);
        if (format) {
          return {
            ok: true,
            videoId,
            title: String(player?.videoDetails?.title || "YouTube video"),
            ...format,
          };
        }
      } catch {
        // Try the next first-party client profile.
      }
    }
    return { ok: false, error: "unavailable" };
  };

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== SOURCE || data.type !== "resolve") {
      return;
    }
    resolveVideo(data.videoId)
      .catch(() => ({ ok: false, error: "unavailable" }))
      .then((result) => post({ type: "reply", requestId: data.requestId, result }));
  });
})();
