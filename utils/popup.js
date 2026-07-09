const message = document.querySelector("#message");
const helloButton = document.querySelector("#helloButton");

helloButton.addEventListener("click", () => {
  const now = new Date().toLocaleTimeString();
  message.textContent = `Hello world. Last clicked at ${now}.`;
});
