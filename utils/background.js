const LOCAL_API_BASE_URL = "http://127.0.0.1:8787";

const formatLocalApiError = (error) => {
  if (error instanceof TypeError && error.message === "Failed to fetch") {
    return `Local API is not running at ${LOCAL_API_BASE_URL}. Start it with npm run api:utils, then retry.`;
  }

  return error.message;
};

const callLocalApi = async (payload) => {
  const response = await fetch(`${LOCAL_API_BASE_URL}/api/hello`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      extension: "utils",
      sentAt: new Date().toISOString(),
      ...payload
    })
  });

  if (!response.ok) {
    throw new Error(`Local API returned HTTP ${response.status}`);
  }

  return response.json();
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "LOCAL_API_HELLO") {
    return false;
  }

  callLocalApi(message.payload)
    .then((data) => {
      sendResponse({
        ok: true,
        data
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: formatLocalApiError(error)
      });
    });

  return true;
});
