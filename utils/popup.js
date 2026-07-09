const message = document.querySelector("#message");
const helloButton = document.querySelector("#helloButton");
const apiButton = document.querySelector("#apiButton");
const apiOutput = document.querySelector("#apiOutput");

helloButton.addEventListener("click", () => {
  const now = new Date().toLocaleTimeString();
  message.textContent = `Hello world. Last clicked at ${now}.`;
});

apiButton.addEventListener("click", async () => {
  apiButton.disabled = true;
  apiOutput.textContent = "Calling http://127.0.0.1:8787/api/hello ...";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LOCAL_API_HELLO",
      payload: {
        note: "Hello from the Utils extension popup"
      }
    });

    apiOutput.textContent = JSON.stringify(response, null, 2);
  } catch (error) {
    apiOutput.textContent = `Local API call failed: ${error.message}`;
  } finally {
    apiButton.disabled = false;
  }
});
