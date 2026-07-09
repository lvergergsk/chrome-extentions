import http from "node:http";

const host = "127.0.0.1";
const port = 8787;

const readRequestBody = (request) =>
  new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      resolve(body);
    });
    request.on("error", reject);
  });

const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json"
  });
  response.end(JSON.stringify(payload, null, 2));
};

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.url === "/health") {
    sendJson(response, 200, {
      ok: true
    });
    return;
  }

  if (request.url === "/api/hello" && request.method === "POST") {
    const rawBody = await readRequestBody(request);
    let body = {};

    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      sendJson(response, 400, {
        ok: false,
        error: "Request body must be valid JSON"
      });
      return;
    }

    sendJson(response, 200, {
      ok: true,
      message: "Hello from outside Chrome",
      received: body,
      handledAt: new Date().toISOString()
    });
    return;
  }

  sendJson(response, 404, {
    ok: false,
    error: "Not found"
  });
});

server.listen(port, host, () => {
  console.log(`Utils local API listening at http://${host}:${port}`);
  console.log("Open the Utils extension popup and click Call Local API.");
});
