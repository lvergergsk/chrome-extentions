import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UTILS_EXTENSION_ID, findUnpackedInstall } from "./extension-id.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const utilsDir = path.join(repoRoot, "utils");
const mode = process.argv.includes("--open") ? "open" : process.argv.includes("--reload") ? "reload" : "auto";

const chromeCandidates = [
  path.join(process.env["ProgramFiles"] ?? "", "Google/Chrome/Application/chrome.exe"),
  path.join(process.env["ProgramFiles(x86)"] ?? "", "Google/Chrome/Application/chrome.exe"),
  path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
];

const findChrome = () => chromeCandidates.find((candidate) => candidate && existsSync(candidate));

const readSettings = (filePath) => {
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8")).extensions?.settings ?? {};
  } catch {
    return {};
  }
};

const launch = (command, args) => {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
};

const chromePath = findChrome();
if (!chromePath) {
  console.error("找不到 Chrome。请先安装 Google Chrome。");
  process.exit(1);
}

const profileDir = path.join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/User Data/Default");
const settings = {
  ...readSettings(path.join(profileDir, "Preferences")),
  ...readSettings(path.join(profileDir, "Secure Preferences")),
};
const installed = findUnpackedInstall(settings, { id: UTILS_EXTENSION_ID, path: utilsDir });
const reloadUrl = `chrome-extension://${UTILS_EXTENSION_ID}/reload.html`;

if (mode === "open" || (mode === "auto" && !installed)) {
  launch(chromePath, ["chrome://extensions"]);
  if (process.platform === "win32") {
    launch("explorer.exe", [`/select,${utilsDir}`]);
  }
  console.log("Chrome 151 已去掉 --load-extension，第一次安装还是要点一次「加载已解压的扩展程序」。");
  console.log(`已打开扩展页。选中这个文件夹：${utilsDir}`);
  process.exit(0);
}

if (!installed) {
  console.error("还没装过 Utils。先运行 npm run load，再在 Chrome 里点一次加载已解压。");
  process.exit(1);
}

launch(chromePath, [reloadUrl]);
console.log(`已请求重新加载 Utils（${installed.id}）。刷新 x.com 即可用新代码。`);
