import { createHash } from "node:crypto";
import path from "node:path";

export const UTILS_CHROME_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA49zjaYcSVaR0yJDty20MrTFngBy8dNsWnHBZ6p/eORVc+DikHsvV92k3f73Jdg6wNo2pto+W9wjtGoGJ/pDaFgE0Afqp0+W1qsxFOiEpNcmFgbToQk0or85vmHTLoapQiT/caxh7hK8zPXYPNRJ77sddMc54+vuASxWlra8oVKVsRhhqQJ351e5lvMoTmBHYW2Bla7OuFgfAUXSdsOB2OSLlZ6iPhGBdRPgdw/T9BzcYGguqx+fYHJWjS7oYN5Oq0KUgtA7oLVGyyz2/Aah4+9QegF1h/UIubQscNX9ELZjW8o+xxxuIKByIbXWl1W2IvGV1tCPCX4W+bD+ldQ2+HQIDAQAB";

export const UTILS_EXTENSION_ID = extensionIdFromChromeKey(UTILS_CHROME_KEY);

const UNPACKED_LOCATION = 4;

export function extensionIdFromChromeKey(chromeKey) {
  const der = Buffer.from(String(chromeKey).replace(/\s+/g, ""), "base64");
  const hex = createHash("sha256").update(der).digest("hex").slice(0, 32);
  return [...hex].map((nibble) => String.fromCharCode(97 + Number.parseInt(nibble, 16))).join("");
}

export function normalizeFsPath(value) {
  return path.normalize(String(value ?? "")).replace(/[\\/]+$/, "").toLowerCase();
}

export const DEFAULT_PROFILE_EMAIL = "lvergergsk@gmail.com";

export function findProfileByEmail(infoCache, email) {
  const wanted = String(email ?? "").trim().toLowerCase();
  if (!wanted) {
    return null;
  }
  for (const [dir, info] of Object.entries(infoCache ?? {})) {
    const user = String(info?.user_name ?? "").trim().toLowerCase();
    if (user === wanted) {
      return { dir, email: info.user_name };
    }
  }
  return null;
}

export function findUnpackedInstall(settings, { id, path: expectedPath }) {
  const expectedId = String(id ?? "");
  const expected = normalizeFsPath(expectedPath);
  for (const [entryId, entry] of Object.entries(settings ?? {})) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const sameId = entryId === expectedId;
    const samePath = entry.path && normalizeFsPath(entry.path) === expected;
    if (entry.location !== UNPACKED_LOCATION || (!sameId && !samePath)) {
      continue;
    }
    const disabled = Array.isArray(entry.disable_reasons) && entry.disable_reasons.length > 0;
    return { id: entryId, path: entry.path, enabled: !disabled };
  }
  return null;
}
